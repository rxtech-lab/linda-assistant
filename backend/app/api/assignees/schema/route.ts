import { authenticate } from "@/lib/auth/middleware";
import { buildToolSet, extractParameters, NO_PERMISSION_CHANGE_TOOLS } from "@/lib/ai/tools";
import { AVAILABLE_MODEL_IDS } from "@/lib/ai/models";
import { NextResponse } from "next/server";
import { NextRequest } from "next/server";

/**
 * @openapi
 * @operationId getAssigneeFormSchema
 * @response assigneeFormSchemaResponse
 */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { tools } = await buildToolSet(auth.userId, null, auth.accessToken);

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
    models: [...AVAILABLE_MODEL_IDS],
    tools: toolsList,
  });
}
