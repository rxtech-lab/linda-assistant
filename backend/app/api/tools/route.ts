import { NextRequest } from "next/server";
import { authenticate } from "@/lib/auth/middleware";
import { NextResponse } from "next/server";
import { z } from "zod";

const toolSchema = z.object({
  name: z.string(),
  description: z.string(),
  defaultPermission: z.enum(["auto-confirm", "manual-confirm", "auto-reject"]),
});

const toolsListSchema = z.array(toolSchema);

const AVAILABLE_TOOLS = [
  {
    name: "send_email",
    description: "Send an email via Resend on behalf of the assignee",
    defaultPermission: "manual-confirm" as const,
  },
  {
    name: "search_emails",
    description: "Search through the user's email inbox",
    defaultPermission: "manual-confirm" as const,
  },
  {
    name: "create_task",
    description: "Create a new task",
    defaultPermission: "manual-confirm" as const,
  },
  {
    name: "update_task",
    description: "Update an existing task's status or details",
    defaultPermission: "manual-confirm" as const,
  },
];

/**
 * @openapi
 * @operationId listTools
 * @response toolsListSchema
 */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  return NextResponse.json(AVAILABLE_TOOLS);
}
