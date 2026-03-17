import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { extensions } from "@/lib/db/schema";
import { eq, and, or } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { errorJson } from "@/lib/utils/response";
import { createGenericMcp, type AuthConfig } from "@/lib/ai/tools/mcps/generic";

/**
 * @openapi
 * @operationId getExtension
 * @response extensionWithStatusSchema
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;

  const [ext] = await db
    .select()
    .from(extensions)
    .where(
      and(
        eq(extensions.id, id),
        or(eq(extensions.type, "system"), eq(extensions.userId, auth.userId)),
      ),
    );

  if (!ext) {
    return errorJson("Extension not found", 404);
  }

  // Try to discover tools from the MCP server
  let tools: Array<{ name: string; description: string }> = [];
  try {
    const authConfig: AuthConfig =
      ext.authType === "api_key"
        ? { type: "api_key", apiKey: (ext.authConfig?.apiKey as string) ?? "" }
        : ext.authType === "none"
          ? { type: "none" }
          : { type: "rxauth", accessToken: auth.accessToken };

    const mcpTools = await createGenericMcp(ext.mcpUrl, authConfig, {});
    tools = Object.entries(mcpTools).map(([name, tool]) => ({
      name,
      description: (tool as any).description ?? "",
    }));
  } catch {
    // MCP server may be unavailable — return extension without tools
  }

  return NextResponse.json({
    ...ext,
    enabled: false,
    toolPermissions: null,
    tools,
  });
}

/**
 * @openapi
 * @operationId updateExtension
 * @body insertExtensionSchema
 * @response selectExtensionSchema
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;

  const [ext] = await db
    .select()
    .from(extensions)
    .where(and(eq(extensions.id, id), eq(extensions.userId, auth.userId)));

  if (!ext) {
    return errorJson("Extension not found or not editable", 404);
  }

  if (ext.type === "system") {
    return errorJson("Cannot modify system extensions", 403);
  }

  const body = await request.json();
  const { title, description, mcpUrl, prefix, authType, authConfig } = body;

  const [updated] = await db
    .update(extensions)
    .set({
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description }),
      ...(mcpUrl !== undefined && { mcpUrl }),
      ...(prefix !== undefined && { prefix: prefix.endsWith("_") ? prefix : `${prefix}_` }),
      ...(authType !== undefined && { authType }),
      ...(authConfig !== undefined && { authConfig }),
      updatedAt: new Date().toISOString().replace("T", " ").slice(0, 19),
    })
    .where(eq(extensions.id, id))
    .returning();

  return NextResponse.json(updated);
}

/**
 * @openapi
 * @operationId deleteExtension
 * @response deletedResponseSchema
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;

  const [ext] = await db
    .select()
    .from(extensions)
    .where(and(eq(extensions.id, id), eq(extensions.userId, auth.userId)));

  if (!ext) {
    return errorJson("Extension not found", 404);
  }

  if (ext.type === "system") {
    return errorJson("Cannot delete system extensions", 403);
  }

  await db.delete(extensions).where(eq(extensions.id, id));

  return NextResponse.json({ deleted: true });
}
