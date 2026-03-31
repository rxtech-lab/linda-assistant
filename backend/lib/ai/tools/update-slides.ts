import { hasToolCall, tool, ToolLoopAgent } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { slideDecks, slidePages } from "@/lib/db/schema";
import { renderAndUploadSlide } from "@/lib/slides";
import { publishEvent } from "@/lib/queue/producer";
import { eq, and, asc, gt, sql } from "drizzle-orm";
import { SLIDE_GENERATION_MODEL } from "../context";
import { getModelProvider } from "../model";
import { generateImageTool, GENERATE_IMAGE_TOOL_NAME } from "./generate-image";

const SINGLE_SLIDE_PROMPT = `You are a world-class slide designer inspired by NotebookLM's presentation style. Create a single clean, bold KonvaJS slide (1920x1080).

**Visual-first, text-minimal.** One idea per slide, 10-15 words max. No bullet points — use short phrases or highlighted keywords.

## KonvaJS Format

Stage JSON: \`{ "attrs": { "width": 1920, "height": 1080 }, "className": "Stage", "children": [{ "attrs": {}, "className": "Layer", "children": [...] }] }\`

## Available Nodes
- Rect: { attrs: { x, y, width, height, fill, cornerRadius }, className: "Rect" }
- Text: { attrs: { x, y, width, text, fontSize, fontFamily: "Helvetica", fontStyle, fill, align, lineHeight }, className: "Text" }
- Circle: { attrs: { x, y, radius, fill }, className: "Circle" }
- Line: { attrs: { points: [...], stroke, strokeWidth }, className: "Line" }
- Group: { attrs: { x, y }, className: "Group", children: [...] }
- Image: { attrs: { x, y, width, height, src: "https://..." }, className: "Image" }

## 6 Slide Types — Pick the best fit

**0. Cover Page** — Full-bleed topic background image + centered frosted white card (rgba(255,255,255,0.85), cornerRadius: 24) with accent line + dot above title, bold title (56-72px), subtitle (28-36px). Used as the first slide only.

**1. Section Header** — Large bold title (64-96px), short subtitle, illustration in rounded card below. Cream bg (#F5F0E8). Can use giant number (160-240px) with decorative illustrations.

**2. Section Page** — Bold blue bg (#4A90D9), large semi-transparent section number (180-240px, left), title in white rounded card (right), decorative dot patterns.

**3. Content** — Dark bg (#1D1D1F), centered text (36-48px), highlighted keywords with yellow (#FFD60A) Rect behind them. Short impactful statement.

**4. Graph / Data** — Chart: title + side-by-side chart images via generate_image + insight box at bottom. Table: title + header row (colored) + content rows. Cream bg (#F5F0E8).

**5. Content with Image** — Split layout: left half text (title 48-64px + 2-3 body paragraphs 24-28px, up to ~80 words), right half generated image. Light bg (#F5F0E8). Can span multiple slides if content is too long.

## Design Rules
- Colors: cream #F5F0E8, dark #1D1D1F, yellow #FFD60A, blue #4A90D9, red #C0392B, green #34C759
- Typography: Helvetica, title 64-96px bold, body 28-36px
- Margins: 120px minimum
- **No bullet points** — single phrase or highlighted keyword
- **Generate images** via generate_image for illustrations. Always include "Do not include any text, words, letters, or numbers in the image." in prompt.
- **Decorative elements**: dot patterns (small circles in grid), accent dots, divider lines, rounded rect cards (cornerRadius: 24)
- **Highlight keywords**: colored Rect behind keyword text (yellow #FFD60A on dark bg)

**TEXT OVERFLOW CHECK**: After reviewing the rendered image, verify ALL text fits within its container and slide bounds. If text is cut off or overflows, submit again with adjusted fontSize, width, y position, or split into multiple slides.

Submit via submitSlide, then call finalize.`;

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
): Promise<{ imageUrl: string; thumbnailUrl: string; sceneData: unknown }> {
  let resultData: {
    imageUrl: string;
    thumbnailUrl: string;
    sceneData: unknown;
  } | null = null;

  /** Helper to emit progress for single-slide generation */
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

  // Emit planning step
  await emitProgress("planning", "Planning slide layout");

  // Wrap generate_image to emit progress
  const baseImageTool = generateImageTool(IMAGE_SYSTEM_PROMPT);
  const baseImageExecute = (baseImageTool as unknown as { execute: (input: { prompt: string; filename?: string }, context: unknown) => Promise<unknown> }).execute;
  const wrappedImageTool = tool({
    description: (baseImageTool as unknown as { description: string }).description,
    inputSchema: (baseImageTool as unknown as { inputSchema: z.ZodType }).inputSchema,
    execute: async (input: { prompt: string; filename?: string }, context: unknown) => {
      await emitProgress("generating_image", "Generating image");
      const result = await baseImageExecute(input, context);
      return result;
    },
  });

  const agent = new ToolLoopAgent({
    model: getModelProvider(SLIDE_GENERATION_MODEL),
    instructions: SINGLE_SLIDE_PROMPT,
    stopWhen: hasToolCall("finalize"),
    tools: {
      [GENERATE_IMAGE_TOOL_NAME]: wrappedImageTool,
      submitSlide: tool({
        description:
          "Submit KonvaJS JSON scene data for the slide. Returns the rendered image URL for review.",
        inputSchema: z.object({
          sceneData: z
            .unknown()
            .describe("The complete KonvaJS Stage JSON (1920x1080)"),
        }),
        execute: async ({ sceneData }) => {
          await emitProgress("rendering", "Rendering slide");

          const sceneStr =
            typeof sceneData === "string"
              ? sceneData
              : JSON.stringify(sceneData);
          const parsed = JSON.parse(sceneStr);
          const { imageUrl, thumbnailUrl } = await renderAndUploadSlide(
            parsed,
            deckId,
            pageNumber,
          );
          resultData = { imageUrl, thumbnailUrl, sceneData: parsed };

          await emitProgress("rendered", "Slide rendered", thumbnailUrl);

          // Return rendered image URL so the model can visually review it
          return {
            type: "content" as const,
            value: [
              {
                type: "image-url" as const,
                url: thumbnailUrl,
              },
              {
                type: "text" as const,
                text: `Slide rendered. Review the image above — if it doesn't look Apple-clean, submit again with improvements before calling finalize.`,
              },
            ],
          };
        },
      }),
      finalize: tool({
        description:
          "Call after submitting the slide and confirming it looks good.",
        inputSchema: z.object({}),
        execute: async () => ({ done: true }),
      }),
    },
  });

  const themeHint = existingTheme
    ? `\nMatch this existing theme: ${existingTheme}`
    : "";
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
      action: z
        .enum(["add_page", "delete_page", "update_page"])
        .describe("The action to perform"),
      pageNumber: z
        .number()
        .optional()
        .describe(
          "Page number to delete or update (required for delete_page and update_page)",
        ),
      description: z
        .string()
        .optional()
        .describe(
          "Description of the new or updated slide content (required for add_page and update_page)",
        ),
    }),
    execute: async ({ deckId, action, pageNumber, description }, { toolCallId }) => {
      console.log(
        `[update_slides] ${action} on deck ${deckId}, page ${pageNumber ?? "N/A"}`,
      );

      // Verify deck belongs to user
      const [deck] = await db
        .select()
        .from(slideDecks)
        .where(and(eq(slideDecks.id, deckId), eq(slideDecks.userId, userId)));

      if (!deck) return { error: "Slide deck not found" };

      switch (action) {
        case "add_page": {
          if (!description)
            return { error: "description is required for add_page" };

          // Get current max page number
          const existingPages = await db
            .select({ pageNumber: slidePages.pageNumber })
            .from(slidePages)
            .where(eq(slidePages.deckId, deckId))
            .orderBy(asc(slidePages.pageNumber));

          const nextPage =
            existingPages.length > 0
              ? existingPages[existingPages.length - 1].pageNumber + 1
              : 1;

          const progressCtx = chatSessionId ? { chatSessionId, toolCallId } : undefined;
          const result = await generateSingleSlide(
            description,
            deckId,
            nextPage,
            undefined,
            progressCtx,
          );

          await db.insert(slidePages).values({
            deckId,
            pageNumber: nextPage,
            sceneData: result.sceneData,
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
          if (pageNumber == null)
            return { error: "pageNumber is required for delete_page" };

          // Delete the page
          await db
            .delete(slidePages)
            .where(
              and(
                eq(slidePages.deckId, deckId),
                eq(slidePages.pageNumber, pageNumber),
              ),
            );

          // Re-number subsequent pages
          const remaining = await db
            .select()
            .from(slidePages)
            .where(
              and(
                eq(slidePages.deckId, deckId),
                gt(slidePages.pageNumber, pageNumber),
              ),
            );

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
          if (pageNumber == null)
            return { error: "pageNumber is required for update_page" };
          if (!description)
            return { error: "description is required for update_page" };

          const progressCtx = chatSessionId ? { chatSessionId, toolCallId } : undefined;
          const result = await generateSingleSlide(
            description,
            deckId,
            pageNumber,
            undefined,
            progressCtx,
          );

          await db
            .update(slidePages)
            .set({
              sceneData: result.sceneData,
              imageUrl: result.imageUrl,
              thumbnailUrl: result.thumbnailUrl,
              updatedAt: sql`(datetime('now'))`,
            })
            .where(
              and(
                eq(slidePages.deckId, deckId),
                eq(slidePages.pageNumber, pageNumber),
              ),
            );

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
