import { hasToolCall, tool, ToolLoopAgent } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { slideDecks, slidePages } from "@/lib/db/schema";
import { publishEvent } from "@/lib/queue/producer";
import { renderAndUploadPptxSlide } from "@/lib/slides";
import {
  PPTX_SLIDE_SPEC_FORMAT,
  PptxSlideSpecSchema,
  parsePptxSlideSpec,
  type PptxSlideSpec,
} from "@/lib/slides/spec";
import { eq, and, asc, gt, sql } from "drizzle-orm";
import { SLIDE_GENERATION_MODEL } from "../context";
import { getModelProvider } from "../model";
import { generateImageTool, GENERATE_IMAGE_TOOL_NAME } from "./generate-image";

const SINGLE_SLIDE_PROMPT = `You are a world-class presentation designer. Create one native editable PowerPoint slide using the Linda PPTX slide spec.

Submit via submitSlide using:
{
  "format": "${PPTX_SLIDE_SPEC_FORMAT}",
  "backgroundColor": "#FFFFFF",
  "elements": [...]
}

Coordinates use a 1920x1080 canvas. The backend converts them into native PowerPoint coordinates.

Element types:
- text: x, y, w, h, text, fontSize, fontFace, color, bold, italic, align, valign, fill, opacity, margin
- rect: x, y, w, h, fill, radius, line, opacity
- ellipse: x, y, w, h, fill, line, opacity
- line: x, y, x2, y2, color, width, opacity
- image: x, y, w, h, src, altText, sizing ("cover", "contain", "stretch")

Use real editable text and shapes whenever possible. Use images only for illustrations, backgrounds, or visual examples. Keep text concise and avoid bullet lists unless requested.

If you use generate_image, always include: "Do not include any text, words, letters, or numbers in the image."

After submitSlide returns a thumbnail, review it for overflow, spacing, and visual quality. Submit an improved version before finalize if needed.`;

const IMAGE_SYSTEM_PROMPT = `Generate a visually rich image related to the slide topic. Include recognizable subject matter (objects, scenes, abstract representations of the topic) — NOT plain gradients or solid colors. The image should look compelling even at thumbnail size. Use a clean composition with one clear focal element. Do not include any text, words, letters, or numbers in the image.`;

/**
 * Generate a single slide using a sub-agent.
 */
async function generateSingleSlide(
  description: string,
  deckId: string,
  pageNumber: number,
  existingTheme?: string,
  progressContext?: { chatSessionId: string; toolCallId: string },
): Promise<{ imageUrl: string; thumbnailUrl: string; slideSpec: PptxSlideSpec }> {
  let resultData: {
    imageUrl: string;
    thumbnailUrl: string;
    slideSpec: PptxSlideSpec;
  } | null = null;

  async function emitProgress(step: string, message: string, thumbnailUrl?: string) {
    if (!progressContext) return;
    await publishEvent({
      sessionId: progressContext.chatSessionId,
      event: "tool-progress",
      data: {
        toolCallId: progressContext.toolCallId,
        toolName: UPDATE_SLIDES_TOOL_NAME,
        current: 1,
        total: 1,
        step,
        message,
        thumbnailUrl,
      },
      timestamp: Date.now(),
    });
  }

  await emitProgress("planning", "Planning slide layout");

  const baseImageTool = generateImageTool(IMAGE_SYSTEM_PROMPT);
  const baseImageExecute = (
    baseImageTool as unknown as {
      execute: (input: { prompt: string; filename?: string }, context: unknown) => Promise<unknown>;
    }
  ).execute;
  const wrappedImageTool = tool({
    description: (baseImageTool as unknown as { description: string }).description,
    inputSchema: (baseImageTool as unknown as { inputSchema: z.ZodType }).inputSchema,
    execute: async (input: { prompt: string; filename?: string }, context: unknown) => {
      await emitProgress("generating_image", "Generating image");
      return baseImageExecute(input, context);
    },
  });

  const agent = new ToolLoopAgent({
    model: getModelProvider(SLIDE_GENERATION_MODEL),
    instructions: SINGLE_SLIDE_PROMPT,
    stopWhen: hasToolCall("finalize"),
    providerOptions: {
      gateway: { caching: "auto" },
    },
    tools: {
      [GENERATE_IMAGE_TOOL_NAME]: wrappedImageTool,
      submitSlide: tool({
        description: "Submit the native PPTX slide spec. Returns a rendered thumbnail for review.",
        inputSchema: z.object({
          slideSpec: PptxSlideSpecSchema.describe("The complete Linda PPTX slide spec"),
        }),
        execute: async ({ slideSpec }) => {
          await emitProgress("rendering", "Rendering slide");

          const parsed = parsePptxSlideSpec(slideSpec);
          const { imageUrl, thumbnailUrl } = await renderAndUploadPptxSlide(
            parsed,
            deckId,
            pageNumber,
          );
          resultData = { imageUrl, thumbnailUrl, slideSpec: parsed };

          await emitProgress("rendered", "Slide rendered", thumbnailUrl);

          return {
            type: "content" as const,
            value: [
              {
                type: "image-url" as const,
                url: thumbnailUrl,
              },
              {
                type: "text" as const,
                text: `Slide rendered. Review the image above. If it needs improvement, submit again before calling finalize.`,
              },
            ],
          };
        },
      }),
      finalize: tool({
        description: "Call after submitting the slide and confirming it looks good.",
        inputSchema: z.object({}),
        execute: async () => ({ done: true }),
      }),
    },
  });

  const themeHint = existingTheme ? `\nMatch this existing theme: ${existingTheme}` : "";
  await agent.generate({
    prompt: `Create a slide for: ${description}${themeHint}`,
  });

  if (!resultData) {
    throw new Error("Sub-agent did not produce a slide");
  }
  return resultData;
}

export const updateSlidesTool = (userId: string, chatSessionId?: string) =>
  tool({
    description:
      "Modify an existing slide deck: add a new page, delete a page, or update a page's content. " +
      "Use this when the user asks to change, add to, or remove from an existing slide deck.",
    inputSchema: z.object({
      deckId: z.string().describe("The ID of the slide deck to modify"),
      action: z.enum(["add_page", "delete_page", "update_page"]).describe("The action to perform"),
      pageNumber: z
        .number()
        .optional()
        .describe("Page number to delete or update (required for delete_page and update_page)"),
      description: z
        .string()
        .optional()
        .describe(
          "Description of the new or updated slide content (required for add_page and update_page)",
        ),
    }),
    execute: async ({ deckId, action, pageNumber, description }, { toolCallId }) => {
      console.log(`[update_slides] ${action} on deck ${deckId}, page ${pageNumber ?? "N/A"}`);

      const [deck] = await db
        .select()
        .from(slideDecks)
        .where(and(eq(slideDecks.id, deckId), eq(slideDecks.userId, userId)));

      if (!deck) return { error: "Slide deck not found" };

      switch (action) {
        case "add_page": {
          if (!description) return { error: "description is required for add_page" };

          const existingPages = await db
            .select({ pageNumber: slidePages.pageNumber })
            .from(slidePages)
            .where(eq(slidePages.deckId, deckId))
            .orderBy(asc(slidePages.pageNumber));

          const nextPage =
            existingPages.length > 0 ? existingPages[existingPages.length - 1].pageNumber + 1 : 1;

          const progressCtx = chatSessionId ? { chatSessionId, toolCallId } : undefined;
          const result = await generateSingleSlide(
            description,
            deckId,
            nextPage,
            JSON.stringify(deck.theme ?? {}),
            progressCtx,
          );

          await db.insert(slidePages).values({
            deckId,
            pageNumber: nextPage,
            sceneData: result.slideSpec,
            imageUrl: result.imageUrl,
            thumbnailUrl: result.thumbnailUrl,
          });

          await db
            .update(slideDecks)
            .set({ updatedAt: sql`(datetime('now'))` })
            .where(eq(slideDecks.id, deckId));

          const totalPages = existingPages.length + 1;
          return {
            deckId,
            title: deck.title,
            action: "add_page",
            pageNumber: nextPage,
            pageCount: totalPages,
            imageUrl: result.imageUrl,
            thumbnailUrl: result.thumbnailUrl,
          };
        }

        case "delete_page": {
          if (pageNumber == null) return { error: "pageNumber is required for delete_page" };

          await db
            .delete(slidePages)
            .where(and(eq(slidePages.deckId, deckId), eq(slidePages.pageNumber, pageNumber)));

          const remaining = await db
            .select()
            .from(slidePages)
            .where(and(eq(slidePages.deckId, deckId), gt(slidePages.pageNumber, pageNumber)));

          for (const page of remaining) {
            await db
              .update(slidePages)
              .set({ pageNumber: page.pageNumber - 1 })
              .where(eq(slidePages.id, page.id));
          }

          await db
            .update(slideDecks)
            .set({ updatedAt: sql`(datetime('now'))` })
            .where(eq(slideDecks.id, deckId));

          const remainingCount = await db
            .select({ count: sql<number>`count(*)` })
            .from(slidePages)
            .where(eq(slidePages.deckId, deckId));

          return {
            deckId,
            title: deck.title,
            action: "delete_page",
            deletedPageNumber: pageNumber,
            pageCount: remainingCount[0]?.count ?? 0,
          };
        }

        case "update_page": {
          if (pageNumber == null) return { error: "pageNumber is required for update_page" };
          if (!description) return { error: "description is required for update_page" };

          const progressCtx = chatSessionId ? { chatSessionId, toolCallId } : undefined;
          const result = await generateSingleSlide(
            description,
            deckId,
            pageNumber,
            JSON.stringify(deck.theme ?? {}),
            progressCtx,
          );

          await db
            .update(slidePages)
            .set({
              sceneData: result.slideSpec,
              imageUrl: result.imageUrl,
              thumbnailUrl: result.thumbnailUrl,
              updatedAt: sql`(datetime('now'))`,
            })
            .where(and(eq(slidePages.deckId, deckId), eq(slidePages.pageNumber, pageNumber)));

          await db
            .update(slideDecks)
            .set({ updatedAt: sql`(datetime('now'))` })
            .where(eq(slideDecks.id, deckId));

          const pageCountResult = await db
            .select({ count: sql<number>`count(*)` })
            .from(slidePages)
            .where(eq(slidePages.deckId, deckId));

          return {
            deckId,
            title: deck.title,
            action: "update_page",
            pageNumber,
            pageCount: pageCountResult[0]?.count ?? 0,
            imageUrl: result.imageUrl,
            thumbnailUrl: result.thumbnailUrl,
          };
        }

        default:
          return { error: `Unknown action: ${action}` };
      }
    },
  });

export const UPDATE_SLIDES_TOOL_NAME = "update_slides";
