import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { questions } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { selectQuestionSchema } from "@/lib/schemas";
import { NextResponse } from "next/server";
import { z } from "zod";

const questionsListSchema = z.array(selectQuestionSchema);

/**
 * @openapi
 * @operationId listQuestions
 * @response questionsListSchema
 */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const items = await db
    .select()
    .from(questions)
    .where(and(eq(questions.userId, auth.userId), eq(questions.status, "pending")));

  return NextResponse.json(items);
}
