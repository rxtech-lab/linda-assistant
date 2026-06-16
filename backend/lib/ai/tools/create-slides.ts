import { hasToolCall, tool, ToolLoopAgent } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { slideDecks, slidePages } from "@/lib/db/schema";
import { publishEvent } from "@/lib/queue/producer";
import { uploadBufferToS3 } from "@/lib/s3";
import { renderAndUploadPptxSlide } from "@/lib/slides";
import {
  PPTX_SLIDE_SPEC_FORMAT,
  PptxSlideSpecSchema,
  parsePptxSlideSpec,
  type PptxSlideSpec,
} from "@/lib/slides/spec";
import { SLIDE_GENERATION_MODEL } from "../context";
import { getModelProvider } from "../model";
import { generateImageTool, GENERATE_IMAGE_TOOL_NAME } from "./generate-image";

const SLIDE_AGENT_PROMPT = `You are a world-class presentation designer. Create native editable PowerPoint slides using the Linda PPTX slide spec.

## Design Philosophy

Visual-first, text-minimal, section-organized. Every slide should feel polished and purposeful. The audience should understand the message in 3 seconds.

- One idea per slide.
- Prefer short titles, single strong statements, tables, simple comparisons, and visual structure.
- Avoid bullet lists unless the user explicitly asks for them.
- Split dense content into more slides rather than crowding a single page.
- Use real editable text and shapes whenever possible. Use images only for illustrations, backgrounds, or visual examples.

## Output Format

Submit each slide through submitSlide using this JSON shape:

\`\`\`json
{
  "format": "${PPTX_SLIDE_SPEC_FORMAT}",
  "backgroundColor": "#FFFFFF",
  "elements": [
    {
      "type": "text",
      "x": 120,
      "y": 80,
      "w": 1680,
      "h": 160,
      "text": "Slide title",
      "fontSize": 72,
      "fontFace": "Helvetica",
      "color": "#1D1D1F",
      "bold": true,
      "align": "center",
      "valign": "middle"
    }
  ],
  "speakerNotes": "Optional short presenter note"
}
\`\`\`

Coordinates use a 1920x1080 canvas. The backend converts this to 13.33in x 7.5in PowerPoint coordinates.

## Element Types

- text: x, y, w, h, text, fontSize, fontFace, color, bold, italic, align, valign, fill, opacity, margin
- rect: x, y, w, h, fill, radius, line, opacity
- ellipse: x, y, w, h, fill, line, opacity
- line: x, y, x2, y2, color, width, opacity
- image: x, y, w, h, src, altText, sizing ("cover", "contain", "stretch")

Use 6-digit hex colors. Use Helvetica unless the content requires another common system font.

## Slide Patterns

1. Cover: full-bleed image or bold color background, large title, compact subtitle, one or two accent shapes.
2. Section divider: strong color, large section number, short section label.
3. Statement: dark or light background, one strong sentence with a highlighted keyword.
4. Comparison/table: editable text rows and cards, not image-only tables.
5. Data/graph: simple native shapes/text for labels and values; generated image only for illustrative charts.
6. Content with image: left text block, right illustration.

## Images

You have access to generate_image. Use it for topic-relevant illustrations and backgrounds. Always include this sentence in image prompts: "Do not include any text, words, letters, or numbers in the image."

## Execution

1. Plan the presentation and call planSlides first.
2. Generate images only where they improve the slide.
3. Call submitSlide once per slide, in order.
4. Review the returned thumbnail. If it has overflow, weak composition, or unreadable text, call reviseSlide.
5. Call finalizeDeck after all slides are submitted and reviewed.`;

/**
 * Emit a tool-progress SSE event for slide generation.
 */
async function emitSlideProgress(
  chatSessionId: string,
  toolCallId: string,
  toolName: string,
  opts: {
    current: number;
    total: number;
    step: string;
    message: string;
    thumbnailUrl?: string;
  },
) {
  await publishEvent({
    sessionId: chatSessionId,
    event: "tool-progress",
    data: {
      toolCallId,
      toolName,
      current: opts.current,
      total: opts.total,
      step: opts.step,
      message: opts.message,
      thumbnailUrl: opts.thumbnailUrl,
    },
    timestamp: Date.now(),
  });
}

/**
 * Wrap the generate_image tool to emit progress events when images are being generated.
 */
function wrapGenerateImageWithProgress(
  chatSessionId: string,
  toolCallId: string,
  toolName: string,
  getCurrentPage: () => number,
  getTotal: () => number,
) {
  const baseTool = generateImageTool();
  const baseExecute = (
    baseTool as unknown as {
      execute: (input: { prompt: string; filename?: string }, context: unknown) => Promise<unknown>;
    }
  ).execute;
  return tool({
    description: (baseTool as unknown as { description: string }).description,
    inputSchema: (baseTool as unknown as { inputSchema: z.ZodType }).inputSchema,
    execute: async (input: { prompt: string; filename?: string }, context: unknown) => {
      const slideNum = getCurrentPage() + 1;
      await emitSlideProgress(chatSessionId, toolCallId, toolName, {
        current: slideNum,
        total: getTotal(),
        step: "generating_image",
        message: `Generating image for slide ${slideNum}`,
      });
      return baseExecute(input, context);
    },
  });
}

/**
 * Generate slides using a sub-agent that produces native PPTX slide specs.
 */
async function generateSlides(
  title: string,
  description: string,
  numSlides: number | undefined,
  deckId: string,
  chatSessionId: string,
  toolCallId: string,
): Promise<{
  pages: Array<{ pageNumber: number; imageUrl: string; thumbnailUrl: string }>;
}> {
  let currentPage = 0;
  let totalSlides = 0;
  const pages: Array<{
    pageNumber: number;
    imageUrl: string;
    thumbnailUrl: string;
  }> = [];

  await emitSlideProgress(chatSessionId, toolCallId, CREATE_SLIDES_TOOL_NAME, {
    current: 0,
    total: totalSlides,
    step: "planning",
    message: "Planning slide layout",
  });

  const agent = new ToolLoopAgent({
    model: getModelProvider(SLIDE_GENERATION_MODEL),
    instructions: SLIDE_AGENT_PROMPT,
    stopWhen: hasToolCall("finalizeDeck"),
    providerOptions: {
      gateway: { caching: "auto" },
    },
    tools: {
      planSlides: tool({
        description:
          "Plan the total number of slides for this presentation. You MUST call this FIRST before generating any slides.",
        inputSchema: z.object({
          totalSlides: z.number().describe("The total number of slides you plan to generate"),
        }),
        execute: async ({ totalSlides: planned }) => {
          totalSlides = planned;
          await emitSlideProgress(chatSessionId, toolCallId, CREATE_SLIDES_TOOL_NAME, {
            current: 0,
            total: planned,
            step: "planned",
            message: `Planning ${planned} slides`,
          });
          return { confirmed: true, totalSlides: planned };
        },
      }),
      [GENERATE_IMAGE_TOOL_NAME]: wrapGenerateImageWithProgress(
        chatSessionId,
        toolCallId,
        CREATE_SLIDES_TOOL_NAME,
        () => currentPage,
        () => totalSlides,
      ),
      submitSlide: tool({
        description:
          "Submit one native PPTX slide spec. Call once per slide, in order. Returns a rendered thumbnail for review.",
        inputSchema: z.object({
          slideSpec: PptxSlideSpecSchema.describe("The complete Linda PPTX slide spec"),
        }),
        execute: async ({ slideSpec }) => {
          currentPage++;
          const pageNum = currentPage;
          console.log(`[create_slides] Rendering slide ${pageNum}...`);

          await emitSlideProgress(chatSessionId, toolCallId, CREATE_SLIDES_TOOL_NAME, {
            current: pageNum,
            total: totalSlides,
            step: "rendering",
            message: `Rendering slide ${pageNum}`,
          });

          try {
            const parsed = parsePptxSlideSpec(slideSpec);
            const { imageUrl, thumbnailUrl } = await renderAndUploadPptxSlide(
              parsed,
              deckId,
              pageNum,
            );

            await db.insert(slidePages).values({
              deckId,
              pageNumber: pageNum,
              sceneData: parsed,
              imageUrl,
              thumbnailUrl,
            });

            pages.push({ pageNumber: pageNum, imageUrl, thumbnailUrl });

            await emitSlideProgress(chatSessionId, toolCallId, CREATE_SLIDES_TOOL_NAME, {
              current: pageNum,
              total: totalSlides,
              step: "rendered",
              message: `Slide ${pageNum} rendered`,
              thumbnailUrl,
            });

            return {
              type: "content" as const,
              value: [
                {
                  type: "image-url" as const,
                  url: thumbnailUrl,
                },
                {
                  type: "text" as const,
                  text: `Slide ${pageNum} rendered. Review the image above. If text is cut off, spacing is weak, or the design is not presentation-ready, call reviseSlide.`,
                },
              ],
            };
          } catch (err) {
            console.error(`[create_slides] Slide ${pageNum} render failed:`, err);
            throw err;
          }
        },
      }),
      reviseSlide: tool({
        description:
          "Replace a previously submitted slide with an improved native PPTX slide spec.",
        inputSchema: z.object({
          pageNumber: z.number().describe("The page number to revise"),
          slideSpec: PptxSlideSpecSchema.describe("The improved Linda PPTX slide spec"),
        }),
        execute: async ({ pageNumber, slideSpec }) => {
          console.log(`[create_slides] Revising slide ${pageNumber}...`);

          await emitSlideProgress(chatSessionId, toolCallId, CREATE_SLIDES_TOOL_NAME, {
            current: pageNumber,
            total: totalSlides,
            step: "revising",
            message: `Revising slide ${pageNumber}`,
          });

          try {
            const parsed = parsePptxSlideSpec(slideSpec);
            const { imageUrl, thumbnailUrl } = await renderAndUploadPptxSlide(
              parsed,
              deckId,
              pageNumber,
            );

            const { eq, and } = await import("drizzle-orm");
            await db
              .update(slidePages)
              .set({
                sceneData: parsed,
                imageUrl,
                thumbnailUrl,
              })
              .where(and(eq(slidePages.deckId, deckId), eq(slidePages.pageNumber, pageNumber)));

            const idx = pages.findIndex((p) => p.pageNumber === pageNumber);
            if (idx >= 0) {
              pages[idx] = { pageNumber, imageUrl, thumbnailUrl };
            }

            await emitSlideProgress(chatSessionId, toolCallId, CREATE_SLIDES_TOOL_NAME, {
              current: pageNumber,
              total: totalSlides,
              step: "rendered",
              message: `Slide ${pageNumber} revised`,
              thumbnailUrl,
            });

            return {
              type: "content" as const,
              value: [
                {
                  type: "image-url" as const,
                  url: thumbnailUrl,
                },
                {
                  type: "text" as const,
                  text: `Slide ${pageNumber} revised. Review the image above.`,
                },
              ],
            };
          } catch (err) {
            console.error(`[create_slides] Slide ${pageNumber} revision failed:`, err);
            throw err;
          }
        },
      }),
      finalizeDeck: tool({
        description:
          "Call this after all slides have been submitted and reviewed to finalize the deck.",
        inputSchema: z.object({}),
        execute: async () => ({ finalized: true, totalPages: currentPage }),
      }),
    },
  });

  const slideCountHint = numSlides
    ? `The user requested approximately ${numSlides} slides; use this as a guide.`
    : "";
  await agent.generate({
    prompt: `Create a presentation titled "${title}". ${slideCountHint}\n\nDescription: ${description}\n\nIMPORTANT: First call planSlides with the total number of slides you intend to create. Then generate each slide in order as a native PPTX slide spec. Review each rendered thumbnail before finalizing.`,
  });

  return { pages };
}

function createE2ESlideSpec(title: string): PptxSlideSpec {
  return {
    format: PPTX_SLIDE_SPEC_FORMAT,
    backgroundColor: "#FFFFFF",
    elements: [
      {
        type: "text",
        x: 120,
        y: 120,
        w: 1680,
        h: 180,
        text: title,
        fontSize: 72,
        fontFace: "Helvetica",
        color: "#1D1D1F",
        bold: true,
        italic: false,
        align: "center",
        valign: "middle",
      },
      {
        type: "rect",
        x: 420,
        y: 420,
        w: 1080,
        h: 240,
        fill: "#4A90D9",
        radius: 28,
      },
      {
        type: "text",
        x: 470,
        y: 480,
        w: 980,
        h: 120,
        text: "E2E test slide",
        fontSize: 48,
        fontFace: "Helvetica",
        color: "#FFFFFF",
        bold: true,
        italic: false,
        align: "center",
        valign: "middle",
      },
    ],
  };
}

export const createSlidesTool = (userId: string, chatSessionId: string) =>
  tool({
    description:
      "Create a slide presentation with one or more pages. Use this when the user asks for a " +
      "presentation, slide deck, or slides. Slides are generated as native editable PPTX content " +
      "and rendered to images for preview. Returns the deck ID, title, and page count. Do NOT " +
      "embed the deck ID or any slide syntax in your chat response; the slide carousel is rendered " +
      "automatically from the tool call. Just mention what you created by title.",
    inputSchema: z.object({
      title: z.string().describe("Title of the slide deck"),
      description: z
        .string()
        .describe(
          "Detailed description of the slides to create. Include content for each slide, " +
            "the overall theme/style, and any specific layout preferences.",
        ),
      numSlides: z
        .number()
        .optional()
        .describe("Optional number of slides to generate. If not specified, the agent decides."),
    }),
    execute: async ({ title, description, numSlides }, { toolCallId }) => {
      console.log(`[create_slides] Starting: "${title}" (${numSlides ?? "auto"} slides)`);

      if (process.env.IS_E2E?.toLowerCase() === "true") {
        const testPng = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
          "base64",
        );
        const { url: imageUrl } = await uploadBufferToS3(
          testPng,
          "image/png",
          `slide-test-${Date.now()}.png`,
          "slides",
        );

        const [deck] = await db
          .insert(slideDecks)
          .values({ userId, chatSessionId, title })
          .returning();

        await db.insert(slidePages).values({
          deckId: deck.id,
          pageNumber: 1,
          sceneData: createE2ESlideSpec(title),
          imageUrl,
          thumbnailUrl: imageUrl,
        });

        return {
          deckId: deck.id,
          title: deck.title,
          pageCount: 1,
          thumbnailUrl: imageUrl,
        };
      }

      const [deck] = await db
        .insert(slideDecks)
        .values({ userId, chatSessionId, title })
        .returning();

      try {
        const { pages } = await generateSlides(
          title,
          description,
          numSlides,
          deck.id,
          chatSessionId,
          toolCallId,
        );

        console.log(`[create_slides] Done: ${pages.length} slides created`);
        return {
          deckId: deck.id,
          title: deck.title,
          pageCount: pages.length,
          thumbnailUrl: pages[0]?.thumbnailUrl ?? null,
        };
      } catch (err) {
        console.error("[create_slides] Failed:", err);
        throw err;
      }
    },
  });

export const CREATE_SLIDES_TOOL_NAME = "create_slides";
