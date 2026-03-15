import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { questions } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { answerQuestionSchema, answerQuestionResponseSchema, idParamSchema } from "@/lib/schemas";
import { successJson, errorJson } from "@/lib/utils/response";
import { resolveQuestion } from "@/lib/ai/question";

/**
 * @openapi
 * @operationId answerQuestion
 * @pathParams idParamSchema
 * @body answerQuestionSchema
 * @response answerQuestionResponseSchema
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const body = await request.json();
  const parsed = answerQuestionSchema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.message, 422);

  // Validate that answers are provided when action is "answer"
  if (
    parsed.data.action === "answer" &&
    (!parsed.data.answers || parsed.data.answers.length === 0)
  ) {
    return errorJson("Answers are required when action is 'answer'", 422);
  }

  console.log(`[Question] Question parsed success: id=${id} action=${parsed.data.action}`);

  // Verify question belongs to user
  const [question] = await db
    .select()
    .from(questions)
    .where(and(eq(questions.id, id), eq(questions.userId, auth.userId)));

  if (!question) return errorJson("Question not found", 404);
  if (question.status !== "pending") return errorJson("Question already resolved", 409);

  const result = await resolveQuestion(id, parsed.data.action, parsed.data.answers);
  console.log(
    `[Question] Resolved: id=${id} action=${parsed.data.action} result=${JSON.stringify(result)}`,
  );
  return successJson(result);
}
