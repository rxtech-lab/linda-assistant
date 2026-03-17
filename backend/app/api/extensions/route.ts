import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { extensions, assigneeExtensions } from "@/lib/db/schema";
import { eq, or } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { insertExtensionSchema } from "@/lib/schemas";
import { errorJson } from "@/lib/utils/response";
import { ensureSystemExtensions } from "@/lib/db/seed-extensions";

let systemExtensionsSeeded = false;
async function ensureSeeded() {
  if (!systemExtensionsSeeded) {
    await ensureSystemExtensions();
    systemExtensionsSeeded = true;
  }
}

/**
 * @openapi
 * @operationId listExtensions
 * @response z.array(extensionWithStatusSchema)
 */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  await ensureSeeded();

  const assigneeId = request.nextUrl.searchParams.get("assigneeId");

  const allExtensions = await db
    .select()
    .from(extensions)
    .where(or(eq(extensions.type, "system"), eq(extensions.userId, auth.userId)));

  // If assigneeId provided, merge enabled status + tool permissions
  if (assigneeId) {
    const aeRows = await db
      .select()
      .from(assigneeExtensions)
      .where(eq(assigneeExtensions.assigneeId, assigneeId));

    const aeMap = new Map(aeRows.map((ae) => [ae.extensionId, ae]));

    const result = allExtensions.map((ext) => {
      const ae = aeMap.get(ext.id);
      return {
        ...ext,
        enabled: ae?.enabled ?? false,
        toolPermissions: ae?.toolPermissions ?? null,
      };
    });

    return NextResponse.json(result);
  }

  // Without assigneeId, return extensions with default status
  const result = allExtensions.map((ext) => ({
    ...ext,
    enabled: false,
    toolPermissions: null,
  }));

  return NextResponse.json(result);
}

/**
 * @openapi
 * @operationId createExtension
 * @body insertExtensionSchema
 * @response selectExtensionSchema
 */
export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const body = await request.json();
  const parsed = insertExtensionSchema.safeParse(body);
  if (!parsed.success) {
    return errorJson(parsed.error.issues[0].message);
  }

  const { title, description, mcpUrl, prefix, authType, authConfig } = parsed.data;

  // Ensure prefix ends with underscore
  const normalizedPrefix = prefix.endsWith("_") ? prefix : `${prefix}_`;

  const [created] = await db
    .insert(extensions)
    .values({
      userId: auth.userId,
      type: "user",
      slug: normalizedPrefix.slice(0, -1), // Remove trailing underscore for slug
      title,
      description: description ?? null,
      mcpUrl,
      prefix: normalizedPrefix,
      authType: authType ?? "rxauth",
      authConfig: authConfig ?? null,
    })
    .returning();

  return NextResponse.json(created, { status: 201 });
}
