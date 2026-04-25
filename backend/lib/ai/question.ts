import crypto from "crypto";
import type { ModelMessage } from "ai";
import { db } from "@/lib/db";
import { questions, chatSessions } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { sendPushNotification } from "@/lib/push";
import { syncTaskStatus } from "@/lib/utils/task-status-sync";
import { publishTask, publishEvent } from "@/lib/queue/producer";
import { annotateToolCallQuestion } from "./agent";
import { getActiveSessionMessages, insertMessages, updateMessageContent } from "@/lib/db/messages";

interface CreateQuestionParams {
  userId: string;
  chatSessionId: string;
  toolCallId: string;
  toolName: string;
  approvalId: string;
  questionsData: Array<{
    title: string;
    description?: string;
    type: "boolean" | "multiple_choice" | "single_choice" | "fill_in_blank";
    options?: Array<{ title: string; description?: string }>;
  }>;
  skipNotification?: boolean;
}

export async function createQuestion(params: CreateQuestionParams) {
  const [question] = await db.insert(questions).values(params).returning();

  if (!params.skipNotification) {
    const taskId = await getSessionTaskId(params.chatSessionId);
    await sendPushNotification(params.userId, {
      title: "Question from Linda",
      body:
        params.questionsData.length === 1
          ? params.questionsData[0].title
          : `Linda has ${params.questionsData.length} questions for you`,
      data: {
        type: "question",
        questionId: question.id,
        chatSessionId: params.chatSessionId,
        ...(taskId ? { taskId } : {}),
      },
    }).catch((err) => {
      console.error("Failed to send push notification:", err);
    });
  }

  return question;
}

export async function sendQuestionGroupNotification(
  userId: string,
  chatSessionId: string,
  items: Array<{ questionId: string; questionCount: number }>,
) {
  if (items.length === 0) return;

  const totalQuestions = items.reduce((sum, i) => sum + i.questionCount, 0);
  const title = "Questions from Linda";
  const body = `Linda has ${totalQuestions} question${totalQuestions === 1 ? "" : "s"} for you. Please review.`;

  const taskId = await getSessionTaskId(chatSessionId);

  await sendPushNotification(userId, {
    title,
    body,
    data: {
      type: "question",
      chatSessionId,
      ...(items.length === 1 ? { questionId: items[0].questionId } : {}),
      ...(taskId ? { taskId } : {}),
    },
  }).catch((err) => {
    console.error("Failed to send grouped push notification:", err);
  });
}

async function getSessionTaskId(chatSessionId: string): Promise<string | null> {
  const [row] = await db
    .select({ taskId: chatSessions.taskId })
    .from(chatSessions)
    .where(eq(chatSessions.id, chatSessionId));
  return row?.taskId ?? null;
}

export async function resolveQuestion(
  questionId: string,
  action: "answer" | "reject",
  answers?: Array<{ questionIndex: number; answer: string | string[] | boolean }>,
) {
  console.log(`[resolveQuestion] START id=${questionId} action=${action}`);

  const [question] = await db.select().from(questions).where(eq(questions.id, questionId));

  if (!question) throw new Error("Question not found");
  if (question.status !== "pending") throw new Error("Question already resolved");

  console.log(
    `[resolveQuestion] Found question: session=${question.chatSessionId} toolCallId=${question.toolCallId}`,
  );

  const resolvedStatus = action === "answer" ? "answered" : "rejected";

  // Update question status
  await db
    .update(questions)
    .set({
      status: resolvedStatus,
      answers: action === "answer" ? answers : null,
      answeredAt: sql`(datetime('now'))`,
    })
    .where(eq(questions.id, questionId));

  console.log(`[resolveQuestion] Updated question status to ${resolvedStatus}`);

  // Load the chat session
  const [session] = await db
    .select({
      id: chatSessions.id,
      assigneeId: chatSessions.assigneeId,
      taskId: chatSessions.taskId,
    })
    .from(chatSessions)
    .where(eq(chatSessions.id, question.chatSessionId));

  if (!session) throw new Error("Chat session not found");

  // Load persisted messages, annotate the tool-call
  const persistedMessages = await getActiveSessionMessages(question.chatSessionId);
  console.log(`[resolveQuestion] Loaded ${persistedMessages.length} messages for annotation`);

  annotateToolCallQuestion(persistedMessages, question.toolCallId, question.id, resolvedStatus);

  // Find the annotated message and update its content in DB
  for (const msg of persistedMessages) {
    if (!Array.isArray(msg.content)) continue;
    for (const part of msg.content as Record<string, unknown>[]) {
      if (part.type === "tool-call" && part.toolCallId === question.toolCallId) {
        const record = msg as Record<string, unknown>;
        await updateMessageContent(record.id as string, msg.content);
      }
    }
  }

  console.log(`[resolveQuestion] Annotated messages, about to handle reject/events`);

  // For rejection: insert a tool-result with isError so the SDK sees a complete pair
  if (action === "reject") {
    const rejectResult = {
      id: crypto.randomUUID(),
      role: "tool" as const,
      content: [
        {
          type: "tool-result" as const,
          toolCallId: question.toolCallId,
          toolName: question.toolName,
          output: { error: "User rejected all questions" },
          isError: true,
        },
      ],
    } as unknown as ModelMessage;
    await insertMessages(question.chatSessionId, [rejectResult]);

    // Emit tool-result event so SSE clients see the rejection immediately
    await publishEvent({
      sessionId: question.chatSessionId,
      event: "tool-result",
      data: {
        toolCallId: question.toolCallId,
        toolName: question.toolName,
        output: { error: "User rejected all questions" },
        isError: true,
        error: "User rejected all questions",
      },
      timestamp: Date.now(),
    });
  }

  console.log(`[resolveQuestion] About to emit question_answered event`);

  // Emit question_answered event so client can update UI immediately
  await publishEvent({
    sessionId: question.chatSessionId,
    event: "question_answered",
    data: {
      questionId,
      toolCallId: question.toolCallId,
      toolName: question.toolName,
      action: resolvedStatus,
    },
    timestamp: Date.now(),
  });

  // Check if there are remaining pending questions for this session
  const [{ count: pendingCount }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(questions)
    .where(
      and(eq(questions.chatSessionId, question.chatSessionId), eq(questions.status, "pending")),
    );

  console.log(`[resolveQuestion] pendingCount=${pendingCount} session=${question.chatSessionId}`);

  // Only resume the agent when ALL questions have been resolved
  if (pendingCount === 0) {
    await db
      .update(chatSessions)
      .set({
        status: "in_progress",
        updatedAt: sql`(datetime('now'))`,
      })
      .where(eq(chatSessions.id, question.chatSessionId));

    // Emit status event so the SSE stream knows we're resuming
    await publishEvent({
      sessionId: question.chatSessionId,
      event: "status",
      data: { status: "in_progress" },
      timestamp: Date.now(),
    });

    console.log(`[resolveQuestion] All questions resolved, publishing task to resume agent`);
    // Signal agent to resume via queue
    await publishTask({
      sessionId: question.chatSessionId,
      userId: question.userId,
      type: "question_resolved",
      timestamp: Date.now(),
    });
  } else {
    console.log(`[resolveQuestion] Still ${pendingCount} pending questions, NOT resuming agent`);
  }

  // Sync task status if applicable
  if (session.taskId) {
    await syncTaskStatus(session.taskId);
  }

  console.log(`[resolveQuestion] DONE id=${questionId} action=${action}`);
  return { action: resolvedStatus, questionId };
}
