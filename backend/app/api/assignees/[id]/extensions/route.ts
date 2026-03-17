import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { extensions, assigneeExtensions, assignees } from "@/lib/db/schema";
import { eq, or, and } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
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
 * @operationId listAssigneeExtensions
 * @response z.array(extensionWithStatusSchema)
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id: assigneeId } = await params;

  // Verify assignee belongs to user
  const [assignee] = await db
    .select({ id: assignees.id })
    .from(assignees)
    .where(and(eq(assignees.id, assigneeId), eq(assignees.userId, auth.userId)));

  if (!assignee) {
    return errorJson("Assignee not found", 404);
  }

  await ensureSeeded();

  const allExtensions = await db
    .select()
    .from(extensions)
    .where(or(eq(extensions.type, "system"), eq(extensions.userId, auth.userId)));

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
