import { tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { questions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const askQuestionTool = () =>
  tool({
    description:
      "Ask the user one or more structured questions. Use this when you need clarification, preferences, or decisions from the user before proceeding. Supports boolean, single-choice, multiple-choice, and fill-in-the-blank question types. The user will see the questions in a form and can answer or reject them.",
    inputSchema: z.object({
      questions: z
        .array(
          z.object({
            title: z.string().describe("The question text"),
            description: z
              .string()
              .optional()
              .describe("Additional context or explanation for the question"),
            type: z
              .enum(["boolean", "multiple_choice", "single_choice", "fill_in_blank"])
              .describe("The type of question"),
            options: z
              .array(
                z.object({
                  title: z.string().describe("Option label"),
                  description: z.string().optional().describe("Option description"),
                }),
              )
              .nullish()
              .describe("Available options for single_choice and multiple_choice types"),
          }),
        )
        .min(1)
        .describe("Array of questions to ask the user"),
    }),
    needsApproval: true,
    execute: async (_input, { toolCallId }) => {
      // When this executes, the user has already answered (or rejected).
      // Read the answers from the questions table.
      const [question] = await db
        .select()
        .from(questions)
        .where(eq(questions.toolCallId, toolCallId));

      if (!question) {
        return { error: "Question record not found" };
      }

      if (question.status === "rejected") {
        return { error: "User rejected all questions" };
      }

      return { answers: question.answers, status: question.status };
    },
  });

export const ASK_QUESTION_TOOL_NAME = "ask_question";
