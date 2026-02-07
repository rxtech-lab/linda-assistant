import { NextRequest } from "next/server";
import { authenticate } from "@/lib/auth/middleware";
import { successJson } from "@/lib/utils/response";
import { z } from "zod";

const toolSchema = z.object({
  name: z.string(),
  description: z.string(),
  requiresConfirmation: z.boolean(),
});

const toolsResponseSchema = z.object({
  data: z.array(toolSchema),
});

const AVAILABLE_TOOLS = [
  {
    name: "send_email",
    description: "Send an email via Resend on behalf of the assignee",
    requiresConfirmation: true,
  },
  {
    name: "search_emails",
    description: "Search through the user's email inbox",
    requiresConfirmation: false,
  },
  {
    name: "create_task",
    description: "Create a new task",
    requiresConfirmation: false,
  },
  {
    name: "update_task",
    description: "Update an existing task's status or details",
    requiresConfirmation: false,
  },
];

/**
 * @openapi
 * @response 200 - toolsResponseSchema
 */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  return successJson(AVAILABLE_TOOLS);
}

