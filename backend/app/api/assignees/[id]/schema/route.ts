import { authenticate } from "@/lib/auth/middleware";
import { buildToolSet, extractParameters, NO_PERMISSION_CHANGE_TOOLS } from "@/lib/ai/tools";
import { AVAILABLE_MODELS } from "@/lib/ai/models";
import { db } from "@/lib/db";
import { assignees } from "@/lib/db/schema";
import { errorJson } from "@/lib/utils/response";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

/**
 * @openapi
 * @operationId getAssigneeEditFormSchema
 * @pathParams idParamSchema
 * @response assigneeEditFormSchemaResponse
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const [item] = await db
    .select()
    .from(assignees)
    .where(and(eq(assignees.id, id), eq(assignees.userId, auth.userId)));

  if (!item) return errorJson("Assignee not found", 404);

  const { tools } = await buildToolSet(auth.userId, item.id, auth.accessToken);
  const toolNames = Object.keys(tools);

  const toolPermissions = toolNames.map((toolName) => {
    const existing = item.toolPermissions?.find((permission) => permission.toolName === toolName);
    return {
      toolName,
      permission: existing?.permission ?? ("manual-confirm" as const),
      conditions: existing?.conditions,
    };
  });

  const toolsList = Object.entries(tools).map(([name, tool]) => {
    const toolObj = tool as {
      description: string;
      needsApproval?: boolean;
    };
    return {
      name,
      description: toolObj.description,
      defaultPermission: toolObj.needsApproval
        ? ("manual-confirm" as const)
        : ("auto-confirm" as const),
      parameters: extractParameters(tool),
      disablePermissionChange: NO_PERMISSION_CHANGE_TOOLS.has(name) || undefined,
    };
  });

  return NextResponse.json({
    assignee: { ...item, toolPermissions },
    models: [...AVAILABLE_MODELS],
    tools: toolsList,
  });
}
