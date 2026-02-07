import { NextRequest } from "next/server";
import { authenticate } from "@/lib/auth/middleware";
import { successJson } from "@/lib/utils/response";
import { z } from "zod";
import { AVAILABLE_MODEL_IDS, availableModelSchema } from "@/lib/ai/models";

const modelsResponseSchema = z.object({
  data: z.array(availableModelSchema),
});

/**
 * @openapi
 * @response 200 - modelsResponseSchema
 */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  return successJson([...AVAILABLE_MODEL_IDS]);
}
