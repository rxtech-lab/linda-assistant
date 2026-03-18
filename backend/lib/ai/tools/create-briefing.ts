import { db } from "@/lib/db";
import { briefings, briefingDocuments } from "@/lib/db/schema";
import { generateText } from "ai";
import { uploadBufferToS3 } from "@/lib/s3";
import { sendPushNotification } from "@/lib/push";
import { tool } from "ai";
import { z } from "zod";
import { IMAGE_GENERATION_MODEL } from "../context";

export const createBriefingTool = (
  userId: string,
  chatSessionId: string,
  defaultAssigneeId?: string | null,
) =>
  tool({
    description:
      "Create a briefing — an AI-generated report with a cover image, markdown content, and optional linked documents. " +
      "Use this when the user asks for a briefing, summary report, or digest that should appear in their Briefing feed.",
    inputSchema: z.object({
      title: z.string().describe("Briefing title"),
      content: z.string().describe("Briefing content in markdown format"),
      imageDescription: z
        .string()
        .describe(
          "Short description for generating a cover image (e.g. 'sunrise over a calm ocean')",
        ),
      documentIds: z
        .array(z.string())
        .optional()
        .describe("IDs of existing documents to link to this briefing"),
    }),
    execute: async ({ title, content, imageDescription, documentIds }) => {
      const assigneeId = defaultAssigneeId ?? undefined;

      // Generate cover image
      let imageUrl: string | undefined;
      try {
        const result = await generateText({
          model: IMAGE_GENERATION_MODEL,
          providerOptions: {
            google: { responseModalities: ["TEXT", "IMAGE"] },
          },
          prompt: `Generate a simple, minimal, relaxed, no text, just colors and some decorative elements, poster illustration with soft gradients and clean shapes for: ${imageDescription}`,
        });

        if (result.files && result.files.length > 0) {
          console.log("[createBriefingTool] Generated image file:", result.files[0]);
          const file = result.files[0];
          const buffer = Buffer.from(file.base64, "base64");
          const ext = file.mediaType === "image/png" ? "png" : "jpg";
          const uploaded = await uploadBufferToS3(
            buffer,
            file.mediaType,
            `briefing-${Date.now()}.${ext}`,
            "briefing-images",
          );
          imageUrl = uploaded.url;
        }
      } catch (err) {
        console.warn("[create-briefing] Image generation failed, proceeding without image:", err);
      }

      // Insert briefing
      const [created] = await db
        .insert(briefings)
        .values({
          userId,
          chatSessionId,
          assigneeId,
          title,
          content,
          imageUrl,
        })
        .returning();

      // Link documents if provided
      if (documentIds && documentIds.length > 0) {
        await db.insert(briefingDocuments).values(
          documentIds.map((documentId) => ({
            briefingId: created.id,
            documentId,
          })),
        );
      }

      // Send push notification
      const dateStr = new Date().toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      await sendPushNotification(userId, {
        title: `New Briefing: ${title} — ${dateStr}`,
        body: title,
        data: {
          type: "briefing",
          briefingId: created.id,
          chatSessionId,
        },
      }).catch((err) => {
        console.error("Failed to send briefing push notification:", err);
      });

      return {
        briefingId: created.id,
        title: created.title,
        imageUrl: created.imageUrl,
      };
    },
  });

export const CREATE_BRIEFING_TOOL_NAME = "create_briefing";
