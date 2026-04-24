import { db } from "@/lib/db";
import { audios } from "@/lib/db/schema";
import { generatePodcastForAudio } from "@/lib/ai/podcast/generate";
import { publishEvent } from "@/lib/queue/producer";
import { tool } from "ai";
import { z } from "zod";

export const GENERATE_AUDIO_TOOL_NAME = "generate_audio";

function deriveTitle(content: string): string {
  const firstLine = content
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return "Untitled Audio";
  const cleaned = firstLine.replace(/^#+\s*/, "").trim();
  return cleaned.length > 80 ? `${cleaned.slice(0, 77)}...` : cleaned;
}

export const generateAudioTool = (userId: string, chatSessionId: string) =>
  tool({
    description:
      "Generate a standalone spoken audio asset (currently podcasts) from prose content. " +
      "Use when the user asks to turn arbitrary text — an article, a summary, a note — into a listenable podcast or narration. " +
      "The tool waits for generation to finish and returns the final audio URL. " +
      "Do NOT call this tool for briefings: create_briefing already generates a podcast for the briefing automatically.",
    inputSchema: z.object({
      prompt: z
        .string()
        .describe(
          "Creative direction for the podcast (tone, style, pacing, target audience).",
        ),
      content: z
        .string()
        .describe(
          "The source content to convert into audio (e.g. a briefing, article, summary).",
        ),
      type: z
        .enum(["podcast"])
        .describe("Audio type. Only 'podcast' is supported currently."),
    }),
    execute: async ({ prompt, content, type }, { toolCallId }) => {
      const title = deriveTitle(content);
      const [row] = await db
        .insert(audios)
        .values({
          userId,
          chatSessionId,
          title,
          type,
          prompt,
          content,
          status: "generating",
        })
        .returning();

      await publishEvent({
        sessionId: chatSessionId,
        event: "tool-progress",
        data: {
          toolCallId,
          toolName: GENERATE_AUDIO_TOOL_NAME,
          current: 0,
          total: 1,
          step: "queued",
          message: "Queuing podcast generation...",
        },
        timestamp: Date.now(),
      });

      const { audioUrl, transcript, locale } = await generatePodcastForAudio({
        audioId: row.id,
        userId,
        sessionId: chatSessionId,
        toolCallId,
        title,
        content: prompt ? `${prompt}\n\n${content}` : content,
      });

      return {
        audioId: row.id,
        title,
        type,
        status: "ready" as const,
        audioUrl,
        locale,
        speakers: Array.from(
          new Map(
            transcript.map((s) => [
              s.voiceShortName,
              { speaker: s.speaker, voiceShortName: s.voiceShortName, locale: s.locale },
            ]),
          ).values(),
        ),
      };
    },
  });
