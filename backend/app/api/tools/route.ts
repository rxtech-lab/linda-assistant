import { NextRequest } from "next/server";
import { authenticate } from "@/lib/auth/middleware";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getToolMetadataList } from "@/lib/ai/tools";

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

  const assigneeId = request.nextUrl.searchParams.get("assigneeId");

  const { data: metadata, fromCache } = await getToolMetadataList(auth.userId, assigneeId, auth.accessToken);

  const toolsList = metadata.map((tool) => ({
    name: tool.name,
    description: tool.description,
    defaultPermission: tool.needsApproval
      ? ("manual-confirm" as const)
      : ("auto-confirm" as const),
  }));

  return NextResponse.json(toolsList, {
    headers: { "X-Cache": fromCache ? "HIT" : "MISS" },
  });
}
