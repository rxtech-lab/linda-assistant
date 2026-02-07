import { NextRequest } from "next/server";
import { authenticate } from "@/lib/auth/middleware";
import { NextResponse } from "next/server";
import { AVAILABLE_MODEL_IDS, availableModelSchema } from "@/lib/ai/models";
import { z } from "zod";

const modelsListSchema = z.array(availableModelSchema);

/**
 * @openapi
 * @operationId listModels
 * @response modelsListSchema
 */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  return NextResponse.json([...AVAILABLE_MODEL_IDS]);
}
