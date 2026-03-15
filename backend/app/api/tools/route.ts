import { NextRequest } from "next/server";
import { authenticate } from "@/lib/auth/middleware";
import { NextResponse } from "next/server";
import { z } from "zod";
import { buildToolSet } from "@/lib/ai/tools";

const toolSchema = z.object({
  name: z.string(),
  description: z.string(),
  defaultPermission: z.enum(["auto-confirm", "manual-confirm", "auto-reject", "disabled"]),
});

const toolsListSchema = z.array(toolSchema);

/**
 * @openapi
 * @operationId listTools
 * @response toolsListSchema
 */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  // Get assigneeId from query params if provided
  const assigneeId = request.nextUrl.searchParams.get("assigneeId");

  // Build tool set dynamically
  const { tools } = await buildToolSet(auth.userId, assigneeId, auth.accessToken);

  // Convert tool objects to API response format
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
    };
  });

  return NextResponse.json(toolsList);
}
