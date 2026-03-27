import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { extensions, assigneeExtensions, assignees } from "@/lib/db/schema";
import { eq, and, or } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { assigneeExtensionSettingsSchema, extensionWithStatusSchema } from "@/lib/schemas";
import { errorJson } from "@/lib/utils/response";
import { invalidateToolMetadataCache } from "@/lib/ai/tools";
import { createGenericMcp, type AuthConfig } from "@/lib/ai/tools/mcps/generic";
import { resolvePermission } from "@/lib/ai/tools/permission";

/**
 * @openapi
 * @operationId getAssigneeExtension
 * @response extensionWithStatusSchema
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; extensionId: string }> },
) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id: assigneeId, extensionId } = await params;

  // Verify assignee belongs to user
  const [assignee] = await db
    .select({ id: assignees.id })
    .from(assignees)
    .where(and(eq(assignees.id, assigneeId), eq(assignees.userId, auth.userId)));

  if (!assignee) {
    return errorJson("Assignee not found", 404);
  }

  // Get extension
  const [ext] = await db
    .select()
    .from(extensions)
    .where(
      and(
        eq(extensions.id, extensionId),
        or(eq(extensions.type, "system"), eq(extensions.userId, auth.userId)),
      ),
    );

  if (!ext) {
    return errorJson("Extension not found", 404);
  }

  // Get assignee-specific extension status
  const [ae] = await db
    .select()
    .from(assigneeExtensions)
    .where(
      and(
        eq(assigneeExtensions.assigneeId, assigneeId),
        eq(assigneeExtensions.extensionId, extensionId),
      ),
    );

  // Load assignee-level tool permissions for effective permission resolution
  const [assigneeRow] = await db
    .select({ toolPermissions: assignees.toolPermissions })
    .from(assignees)
    .where(eq(assignees.id, assigneeId));
  const assigneeToolPerms = assigneeRow?.toolPermissions ?? null;

  // Discover tools from MCP server
  let tools: Array<{ name: string; description: string; effectivePermission: string }> = [];
  try {
    const authConfig: AuthConfig =
      ext.authType === "api_key"
        ? { type: "api_key", apiKey: (ext.authConfig?.apiKey as string) ?? "" }
        : ext.authType === "none"
          ? { type: "none" }
          : { type: "rxauth", accessToken: auth.accessToken };

    const mcpTools = await createGenericMcp(ext.mcpUrl, authConfig, {});
    tools = Object.entries(mcpTools).map(([name, tool]) => {
      const prefixedName = `${ext.prefix}${name}`;
      // Resolve effective permission: extension-level (unprefixed) → assignee-level (prefixed) → default
      let perm = resolvePermission(name, ae?.toolPermissions);
      if (perm === "manual-confirm") {
        const assigneePerm = resolvePermission(prefixedName, assigneeToolPerms);
        if (assigneePerm !== "manual-confirm") {
          perm = assigneePerm;
        }
      }
      return {
        name,
        description: (tool as any).description ?? "",
        effectivePermission: perm,
      };
    });
  } catch {
    // MCP server may be unavailable — return extension without tools
  }

  return NextResponse.json({
    ...ext,
    enabled: ae?.enabled ?? false,
    toolPermissions: ae?.toolPermissions ?? null,
    tools,
  });
}

/**
 * @openapi
 * @operationId updateAssigneeExtension
 * @body assigneeExtensionSettingsSchema
 * @response extensionWithStatusSchema
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; extensionId: string }> },
) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id: assigneeId, extensionId } = await params;

  // Verify assignee belongs to user
  const [assignee] = await db
    .select({ id: assignees.id })
    .from(assignees)
    .where(and(eq(assignees.id, assigneeId), eq(assignees.userId, auth.userId)));

  if (!assignee) {
    return errorJson("Assignee not found", 404);
  }

  // Verify extension exists and is accessible
  const [ext] = await db
    .select()
    .from(extensions)
    .where(
      and(
        eq(extensions.id, extensionId),
        or(eq(extensions.type, "system"), eq(extensions.userId, auth.userId)),
      ),
    );

  if (!ext) {
    return errorJson("Extension not found", 404);
  }

  const body = await request.json();
  const parsed = assigneeExtensionSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return errorJson(parsed.error.issues[0].message);
  }

  const { enabled, toolPermissions } = parsed.data;

  // Upsert assignee_extensions row
  const existing = await db
    .select()
    .from(assigneeExtensions)
    .where(
      and(
        eq(assigneeExtensions.assigneeId, assigneeId),
        eq(assigneeExtensions.extensionId, extensionId),
      ),
    );

  if (existing.length > 0) {
    await db
      .update(assigneeExtensions)
      .set({
        enabled,
        ...(toolPermissions !== undefined && { toolPermissions }),
        updatedAt: new Date().toISOString().replace("T", " ").slice(0, 19),
      })
      .where(eq(assigneeExtensions.id, existing[0].id));
  } else {
    await db.insert(assigneeExtensions).values({
      assigneeId,
      extensionId,
      enabled,
      toolPermissions: toolPermissions ?? null,
    });
  }

  await invalidateToolMetadataCache(auth.userId, assigneeId);

  return NextResponse.json({
    ...ext,
    enabled,
    toolPermissions: toolPermissions ?? existing[0]?.toolPermissions ?? null,
  });
}
