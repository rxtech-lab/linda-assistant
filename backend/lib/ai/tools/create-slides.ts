import { hasToolCall, tool, ToolLoopAgent } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { slideDecks, slidePages } from "@/lib/db/schema";
import { uploadBufferToS3 } from "@/lib/s3";
import { publishEvent } from "@/lib/queue/producer";
import { renderAndUploadSlide } from "@/lib/slides";
import { SLIDE_GENERATION_MODEL } from "../context";
import { getModelProvider } from "../model";
import { generateImageTool, GENERATE_IMAGE_TOOL_NAME } from "./generate-image";

const SLIDE_AGENT_PROMPT = `You are a world-class slide designer inspired by NotebookLM's presentation style. You create clean, bold, and impactful slides using KonvaJS JSON.

## Design Philosophy — NotebookLM Style

**Visual-first, text-minimal, section-organized.** Every slide should feel polished and purposeful. The audience grasps the message in 3 seconds.

- **MINIMAL TEXT** — most slides should have at most 10-15 words total. A short title (3-6 words) and optionally one short sentence. **Exception**: Content with Image slides can have 2-3 short paragraphs of body text on the text side (up to ~80 words). If you need more words on other slide types, SPLIT into multiple slides.
- **Split aggressively** — more slides with less text is always better. If a topic has 3 points, make 3 slides.
- **One idea per slide** — never crowd multiple concepts
- **Section-based structure** — organize the presentation into sections. Each section starts with a Section Page (divider), followed by detail slides (Content, Graph, Content with Image).
- **No bullet points ever** — use a single short phrase, bold keyword, or highlighted text instead.
- **Decorative elements** — dot patterns, geometric accents, colored shapes, thin divider lines for visual polish.

## Presentation Structure

Organize slides in this order:
1. **Cover Page** (ALWAYS the first slide — full-bleed background image + frosted title card)
2. **Section Page** (divider for Section 1) — large number "1" + section title
3. Detail slides for Section 1 (Content / Graph / Content with Image / Section Header for stats)
4. **Section Page** (divider for Section 2) — large number "2" + section title
5. Detail slides for Section 2...
...and so on. End with a closing slide.

## 5 Slide Types

### Type 0: Cover Page (FIRST slide only)
The very first slide of every presentation. Full-bleed topic-relevant background image with a centered frosted white card containing the title and subtitle.
- Full-bleed background image generated via \`generate_image\` — topic-relevant, visually striking
- Centered white frosted card (semi-transparent white, cornerRadius: 24) containing:
  - Short decorative accent line (blue #4A90D9, ~120px wide) centered above the title
  - Small accent dot (blue #4A90D9, radius 5) centered above the line
  - Bold title (56-72px, centered, 3-6 words)
  - Subtitle below (28-36px, lighter color, centered)
- Small decorative accent dots (pink/purple) floating outside the card

Example structure:
\`\`\`json
{ "attrs": { "width": 1920, "height": 1080 }, "className": "Stage", "children": [{ "attrs": {}, "className": "Layer", "children": [
  { "attrs": { "x": 0, "y": 0, "width": 1920, "height": 1080, "src": "https://generated-bg-url" }, "className": "Image" },
  { "attrs": { "x": 460, "y": 260, "width": 1000, "height": 420, "fill": "rgba(255,255,255,0.85)", "cornerRadius": 24 }, "className": "Rect" },
  { "attrs": { "x": 900, "y": 310, "radius": 5, "fill": "#4A90D9" }, "className": "Circle" },
  { "attrs": { "points": [840, 330, 1080, 330], "stroke": "#4A90D9", "strokeWidth": 2.5 }, "className": "Line" },
  { "attrs": { "x": 500, "y": 360, "width": 920, "text": "Presentation Title", "fontSize": 64, "fontFamily": "Helvetica", "fontStyle": "bold", "fill": "#1D1D1F", "align": "center", "lineHeight": 1.3 }, "className": "Text" },
  { "attrs": { "x": 500, "y": 480, "width": 920, "text": "A short subtitle goes here", "fontSize": 30, "fontFamily": "Helvetica", "fill": "#86868B", "align": "center" }, "className": "Text" },
  { "attrs": { "x": 1350, "y": 250, "radius": 6, "fill": "#AF52DE" }, "className": "Circle" }
]}]}
\`\`\`

### Type 1: Section Header (Key stat / Intro slides)
Use for key stat slides, topic intro slides, or closing slides — NOT for the first cover page.
- Large bold centered title (64-96px, 3-6 words)
- Short subtitle below (32-40px, few words)
- Full-width illustration in a rounded card below the title
- Clean light background (#F5F0E8 or white)
- Can feature a giant number (160-240px) with decorative illustrations around it

Example structure:
\`\`\`json
{ "attrs": { "width": 1920, "height": 1080 }, "className": "Stage", "children": [{ "attrs": {}, "className": "Layer", "children": [
  { "attrs": { "x": 0, "y": 0, "width": 1920, "height": 1080, "fill": "#F5F0E8" }, "className": "Rect" },
  { "attrs": { "x": 120, "y": 60, "width": 1680, "text": "Title Here", "fontSize": 80, "fontFamily": "Helvetica", "fontStyle": "bold", "fill": "#1D1D1F", "align": "center", "lineHeight": 1.2 }, "className": "Text" },
  { "attrs": { "x": 120, "y": 200, "width": 1680, "height": 700, "fill": "#FFFFFF", "cornerRadius": 24 }, "className": "Rect" },
  { "attrs": { "x": 140, "y": 220, "width": 1640, "height": 660, "src": "https://generated-image-url", "cornerRadius": 16 }, "className": "Image" },
  { "attrs": { "x": 60, "y": 500, "radius": 8, "fill": "#4A90D9" }, "className": "Circle" }
]}]}
\`\`\`

### Type 2: Section Page (Section Divider)
Use to introduce each new section of the presentation.
- Bold colored background (blue #4A90D9 or theme color)
- Large section number (180-240px, semi-transparent white, left side)
- Section title in a white rounded card/speech bubble (right side)
- Decorative dot patterns (grid of small circles)
- Accent shapes and geometric elements

Example structure:
\`\`\`json
{ "attrs": { "width": 1920, "height": 1080 }, "className": "Stage", "children": [{ "attrs": {}, "className": "Layer", "children": [
  { "attrs": { "x": 0, "y": 0, "width": 1920, "height": 1080, "fill": "#4A90D9" }, "className": "Rect" },
  { "attrs": { "x": 80, "y": 180, "width": 600, "text": "1", "fontSize": 500, "fontFamily": "Helvetica", "fontStyle": "bold", "fill": "rgba(255,255,255,0.3)", "align": "center" }, "className": "Text" },
  { "attrs": { "x": 700, "y": 300, "width": 1100, "height": 400, "fill": "#FFFFFF", "cornerRadius": 32 }, "className": "Rect" },
  { "attrs": { "x": 760, "y": 380, "width": 980, "text": "Section Title Here", "fontSize": 64, "fontFamily": "Helvetica", "fontStyle": "bold", "fill": "#1D1D1F", "lineHeight": 1.3 }, "className": "Text" }
]}]}
\`\`\`
Add decorative dot patterns using small circles in a grid pattern on the right side.

### Type 3: Content
Use for key statements, quotes, or impactful single-sentence points.
- Dark background (#1D1D1F or #2D2D3F)
- Light watermark decorative icons in background (using generate_image with very subtle, faded design elements)
- Centered text (36-48px) with highlighted keywords
- Highlighted words: place a colored Rect (#FFD60A yellow) behind the keyword, then overlay the keyword Text on top in dark color
- Short, impactful statement — one sentence max

Example highlight technique:
\`\`\`json
{ "attrs": { "x": 0, "y": 0, "width": 1920, "height": 1080, "fill": "#1D1D1F" }, "className": "Rect" },
{ "attrs": { "x": 120, "y": 400, "width": 1680, "text": "The data was full of", "fontSize": 48, "fontFamily": "Helvetica", "fontStyle": "bold", "fill": "#F5F5F7", "align": "left", "lineHeight": 1.6 }, "className": "Text" },
{ "attrs": { "x": 830, "y": 395, "width": 200, "height": 60, "fill": "#FFD60A", "cornerRadius": 4 }, "className": "Rect" },
{ "attrs": { "x": 835, "y": 400, "width": 190, "text": "noise", "fontSize": 48, "fontFamily": "Helvetica", "fontStyle": "bold", "fill": "#1D1D1F" }, "className": "Text" }
\`\`\`

### Type 4: Graph / Data
Use for charts, comparisons, tables, and data visualization.

**Chart variant:**
- Title at top (48-64px bold)
- Side-by-side chart images via \`generate_image\` (describe the chart style: line chart, bar chart, etc.)
- Key insight box at bottom — rounded rect with summary text
- Cream/beige background (#F5F0E8)

**Table variant:**
- Title at top (48-64px bold)
- Header row with colored category text (e.g., red #C0392B and blue #4A90D9 for comparison)
- Content rows built with Rect backgrounds and Text nodes
- Clean cream background (#F5F0E8)

Example table structure:
\`\`\`json
{ "attrs": { "x": 0, "y": 0, "width": 1920, "height": 1080, "fill": "#F5F0E8" }, "className": "Rect" },
{ "attrs": { "x": 120, "y": 60, "width": 1680, "text": "Comparison Title", "fontSize": 56, "fontFamily": "Helvetica", "fontStyle": "bold", "fill": "#1D1D1F", "align": "center", "lineHeight": 1.3 }, "className": "Text" },
{ "attrs": { "x": 120, "y": 200, "width": 500, "text": "Dimension", "fontSize": 28, "fontFamily": "Helvetica", "fontStyle": "bold", "fill": "#86868B" }, "className": "Text" },
{ "attrs": { "x": 650, "y": 200, "width": 550, "text": "Option A", "fontSize": 28, "fontFamily": "Helvetica", "fontStyle": "bold", "fill": "#C0392B" }, "className": "Text" },
{ "attrs": { "x": 1230, "y": 200, "width": 550, "text": "Option B", "fontSize": 28, "fontFamily": "Helvetica", "fontStyle": "bold", "fill": "#4A90D9" }, "className": "Text" },
{ "attrs": { "points": [120, 240, 1800, 240], "stroke": "#D2D2D7", "strokeWidth": 1 }, "className": "Line" }
\`\`\`
Then repeat rows with alternating content.

### Type 5: Content with Image (Split Layout)
Use when you need to explain something alongside a visual. This type allows MORE TEXT than other slide types — use 2-3 short paragraphs to explain the concept in detail. Can span multiple slides if there's too much content for one.
- Left half (~50%): Bold title (48-64px) + 2-3 body paragraphs (24-28px), up to ~80 words
- Right half (~50%): Generated image filling the right side
- Clean light background (#F5F0E8 or white)
- If the content is too long for one slide, split into multiple Content with Image slides continuing the topic

Example structure:
\`\`\`json
{ "attrs": { "x": 0, "y": 0, "width": 1920, "height": 1080, "fill": "#F5F0E8" }, "className": "Rect" },
{ "attrs": { "x": 80, "y": 80, "width": 840, "text": "The Consequence of Scale", "fontSize": 52, "fontFamily": "Helvetica", "fontStyle": "bold", "fill": "#1D1D1F", "lineHeight": 1.3 }, "className": "Text" },
{ "attrs": { "x": 80, "y": 240, "width": 840, "text": "While functionally necessary for handling massive flows, the immense scale creates a significant user-experience challenge.", "fontSize": 26, "fontFamily": "Helvetica", "fill": "#4A4A4A", "lineHeight": 1.7 }, "className": "Text" },
{ "attrs": { "x": 80, "y": 480, "width": 840, "text": "The most critical issue is a systemic bottleneck that emerges when the national system meets the city's transport network.", "fontSize": 26, "fontFamily": "Helvetica", "fill": "#4A4A4A", "lineHeight": 1.7 }, "className": "Text" },
{ "attrs": { "x": 980, "y": 40, "width": 900, "height": 1000, "src": "https://generated-image-url", "cornerRadius": 16 }, "className": "Image" }
\`\`\`

## Using Images

You have access to the \`generate_image\` tool. Use it to create topic-relevant illustrations.

**CRITICAL: Always include "Do not include any text, words, letters, or numbers in the image." in every generate_image prompt.**

**When to generate images:**
- **Section Header**: Wide illustration of the topic (placed in the rounded card below title)
- **Content with Image**: Focused illustration for the right panel
- **Graph (chart variant)**: Stylized chart illustrations (describe the chart type and data pattern you want)
- **Content**: Optional — subtle watermark-style background decoration

**What to generate:**
- Topic-relevant visuals with recognizable subject matter
- Clean compositions with one clear focal element
- Stylized, slightly abstract versions of real subjects
- Images that look compelling even at thumbnail size

**What NOT to generate:**
- Plain solid colors or simple gradients
- Images with text, labels, or numbers baked in
- Overly busy compositions

After generating, embed using: \`{ "attrs": { "x": 0, "y": 0, "width": 1920, "height": 1080, "src": "https://..." }, "className": "Image" }\`

## KonvaJS Scene Format

Each slide is a KonvaJS Stage JSON with a single Layer. Standard size: 1920x1080 (16:9).

\`\`\`json
{
  "attrs": { "width": 1920, "height": 1080 },
  "className": "Stage",
  "children": [{
    "attrs": {},
    "className": "Layer",
    "children": [ /* shapes */ ]
  }]
}
\`\`\`

## Available Nodes

- **Rect**: \`{ "attrs": { "x": 0, "y": 0, "width": 1920, "height": 1080, "fill": "#FFFFFF", "cornerRadius": 0 }, "className": "Rect" }\`
- **Text**: \`{ "attrs": { "x": 120, "y": 80, "width": 1680, "text": "Title", "fontSize": 72, "fontFamily": "Helvetica", "fontStyle": "bold", "fill": "#1D1D1F", "align": "center", "lineHeight": 1.2 }, "className": "Text" }\`
- **Circle**: \`{ "attrs": { "x": 960, "y": 540, "radius": 50, "fill": "#4A90D9" }, "className": "Circle" }\`
- **Line**: \`{ "attrs": { "points": [120, 400, 1800, 400], "stroke": "#D2D2D7", "strokeWidth": 1 }, "className": "Line" }\`
- **Group**: \`{ "attrs": { "x": 120, "y": 200 }, "className": "Group", "children": [...] }\`
- **Image**: \`{ "attrs": { "x": 0, "y": 0, "width": 1920, "height": 1080, "src": "https://url-to-image" }, "className": "Image" }\`

## Design Guidelines

1. **Color Palette**:
   - Cream/beige background: #F5F0E8, #FFF8F0
   - Dark background: #1D1D1F, #2D2D3F
   - Highlight yellow: #FFD60A
   - Bold blue: #4A90D9
   - Accent red: #C0392B
   - Accent green: #34C759
   - Text dark: #1D1D1F
   - Text light: #F5F5F7
   - Secondary text: #86868B, #4A4A4A

2. **Typography**: Helvetica family. Title 64-96px bold, subtitle 32-44px, body 28-36px, caption 24px. Use #1D1D1F on light backgrounds, #F5F5F7 on dark.

3. **Layout**: Edge margins 120px minimum. Center text for Section Headers and Content. Left-align for Content with Image and tables.

4. **Decorative Elements**:
   - Dot patterns: grids of small Circle nodes (radius 4-6, low opacity)
   - Accent dots: small colored circles near headings
   - Thin divider lines (strokeWidth 1-2)
   - Rounded rect cards (cornerRadius: 24-32) as content containers
   - Arrow shapes using Line nodes

## Execution

1. First, plan all slides — what's the story arc? How many sections? How many detail slides per section?
2. **Call \`planSlides\` with the total slide count** — you MUST do this before generating any slides.
3. **Generate images as needed** — call \`generate_image\` for illustrations. Always include "Do not include any text, words, letters, or numbers in the image." in the prompt.
4. Design each slide's KonvaJS JSON. Submit via \`submitSlide\`
5. After submitting, review the rendered image. If it doesn't look right, submit an improved version via \`reviseSlide\`
6. When all slides look good, call \`finalizeDeck\`

## Self-Review Checklist (check after each slide)

- Does this slide match one of the 6 types (Cover Page, Section Header, Section Page, Content, Graph, Content with Image)?
- Is the first slide a Cover Page (full-bleed background + frosted white title card)?
- **Too many words?** Max 10-15 words for most slides. Content with Image allows up to ~80 words of body text. If more, split into multiple slides.
- Are highlighted keywords using colored background Rects (not just bold text)?
- Does it have decorative elements (dot patterns, accent shapes, divider lines)?
- Is the color scheme consistent with the design palette?
- No bullet points? (Use single phrases or split into separate slides)
- Does the section structure make sense? (Section Pages before detail slides)
- **TEXT OVERFLOW CHECK** — After reviewing the rendered image, verify that ALL text fits within its container and the slide bounds. If any text is cut off, overflows beyond the slide edges, or overlaps other elements, you MUST call \`reviseSlide\` with adjusted fontSize, width, y position, or split the content across multiple slides. Common fixes: reduce fontSize, increase text width, move text up, or split into two slides.`;

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
  const baseExecute = (baseTool as unknown as { execute: (input: { prompt: string; filename?: string }, context: unknown) => Promise<unknown> }).execute;
  return tool({
    description: (baseTool as unknown as { description: string }).description,
    inputSchema: (baseTool as unknown as { inputSchema: z.ZodType }).inputSchema,
    execute: async (input: { prompt: string; filename?: string }, context: unknown) => {
      const slideNum = getCurrentPage() + 1; // next slide being worked on
      await emitSlideProgress(chatSessionId, toolCallId, toolName, {
        current: slideNum,
        total: getTotal(),
        step: "generating_image",
        message: `Generating image for slide ${slideNum}`,
      });
      const result = await baseExecute(input, context);
      return result;
    },
  });
}

/**
 * Generate slides using a sub-agent that produces KonvaJS scene JSON.
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
  let totalSlides = 0; // will be set by planSlides tool
  const pages: Array<{
    pageNumber: number;
    imageUrl: string;
    thumbnailUrl: string;
  }> = [];

  // Emit initial planning step
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
    tools: {
      planSlides: tool({
        description:
          "Plan the total number of slides for this presentation. You MUST call this FIRST before generating any slides.",
        inputSchema: z.object({
          totalSlides: z
            .number()
            .describe("The total number of slides you plan to generate"),
        }),
        execute: async ({ totalSlides: planned }) => {
          totalSlides = planned;
          await emitSlideProgress(
            chatSessionId,
            toolCallId,
            CREATE_SLIDES_TOOL_NAME,
            {
              current: 0,
              total: planned,
              step: "planned",
              message: `Planning ${planned} slides`,
            },
          );
          return { confirmed: true, totalSlides: planned };
        },
      }),
      // Wrapped generate_image that emits progress
      [GENERATE_IMAGE_TOOL_NAME]: wrapGenerateImageWithProgress(
        chatSessionId,
        toolCallId,
        CREATE_SLIDES_TOOL_NAME,
        () => currentPage,
        () => totalSlides,
      ),
      submitSlide: tool({
        description:
          "Submit KonvaJS JSON scene data for one slide. Call this once per slide, in order. " +
          "Returns the rendered image URL — review it to decide if the slide needs revision.",
        inputSchema: z.object({
          sceneData: z
            .unknown()
            .describe(
              "The complete KonvaJS Stage JSON for this slide (1920x1080)",
            ),
        }),
        execute: async ({ sceneData }) => {
          currentPage++;
          const pageNum = currentPage;
          console.log(`[create_slides] Rendering slide ${pageNum}...`);

          // Emit rendering step
          await emitSlideProgress(chatSessionId, toolCallId, CREATE_SLIDES_TOOL_NAME, {
            current: pageNum,
            total: totalSlides,
            step: "rendering",
            message: `Rendering slide ${pageNum}`,
          });

          try {
            const sceneStr =
              typeof sceneData === "string"
                ? sceneData
                : JSON.stringify(sceneData);
            const parsed = JSON.parse(sceneStr);

            const { imageUrl, thumbnailUrl } = await renderAndUploadSlide(
              parsed,
              deckId,
              pageNum,
            );

            // Insert page into DB
            await db.insert(slidePages).values({
              deckId,
              pageNumber: pageNum,
              sceneData: parsed,
              imageUrl,
              thumbnailUrl,
            });

            pages.push({ pageNumber: pageNum, imageUrl, thumbnailUrl });

            // Emit completed step with thumbnail
            await emitSlideProgress(chatSessionId, toolCallId, CREATE_SLIDES_TOOL_NAME, {
              current: pageNum,
              total: totalSlides,
              step: "rendered",
              message: `Slide ${pageNum} rendered`,
              thumbnailUrl,
            });

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
                  text: `Slide ${pageNum} rendered. Review the image above — if it doesn't look clean and Apple-like, call reviseSlide with an improved version.`,
                },
              ],
            };
          } catch (err) {
            console.error(
              `[create_slides] Slide ${pageNum} render failed:`,
              err,
            );
            throw err;
          }
        },
      }),
      reviseSlide: tool({
        description:
          "Replace a previously submitted slide with an improved version. Use this after reviewing " +
          "a rendered slide that doesn't meet the Apple design standard.",
        inputSchema: z.object({
          pageNumber: z.number().describe("The page number to revise"),
          sceneData: z
            .unknown()
            .describe(
              "The improved KonvaJS Stage JSON for this slide (1920x1080)",
            ),
        }),
        execute: async ({ pageNumber, sceneData }) => {
          console.log(`[create_slides] Revising slide ${pageNumber}...`);

          // Emit revising step
          await emitSlideProgress(chatSessionId, toolCallId, CREATE_SLIDES_TOOL_NAME, {
            current: pageNumber,
            total: totalSlides,
            step: "revising",
            message: `Revising slide ${pageNumber}`,
          });

          try {
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

            // Update existing page in DB
            const { eq, and } = await import("drizzle-orm");
            await db
              .update(slidePages)
              .set({
                sceneData: parsed,
                imageUrl,
                thumbnailUrl,
              })
              .where(
                and(
                  eq(slidePages.deckId, deckId),
                  eq(slidePages.pageNumber, pageNumber),
                ),
              );

            // Update in pages array
            const idx = pages.findIndex((p) => p.pageNumber === pageNumber);
            if (idx >= 0) {
              pages[idx] = { pageNumber, imageUrl, thumbnailUrl };
            }

            // Emit revised step with thumbnail
            await emitSlideProgress(chatSessionId, toolCallId, CREATE_SLIDES_TOOL_NAME, {
              current: pageNumber,
              total: totalSlides,
              step: "rendered",
              message: `Slide ${pageNumber} revised`,
              thumbnailUrl,
            });

            // Return revised image URL so the model can visually review it
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
            console.error(
              `[create_slides] Slide ${pageNumber} revision failed:`,
              err,
            );
            throw err;
          }
        },
      }),
      finalizeDeck: tool({
        description:
          "Call this after all slides have been submitted and reviewed to finalize the deck.",
        inputSchema: z.object({}),
        execute: async () => {
          return { finalized: true, totalPages: currentPage };
        },
      }),
    },
  });

  const slideCountHint = numSlides
    ? `The user requested approximately ${numSlides} slides — use this as a guide.`
    : "";
  await agent.generate({
    prompt: `Create a presentation titled "${title}". ${slideCountHint}\n\nDescription: ${description}\n\nIMPORTANT: First call planSlides with the total number of slides you intend to create. Then generate each slide in order. Review each slide after rendering.`,
  });

  return { pages };
}

export const createSlidesTool = (userId: string, chatSessionId: string) =>
  tool({
    description:
      "Create a slide presentation with one or more pages. Use this when the user asks for a " +
      "presentation, slide deck, or slides. Each slide is rendered as a high-quality image. " +
      "Returns the deck ID, title, and page count. Do NOT embed the deck ID or any slide syntax " +
      "in your chat response — the slide carousel is rendered automatically from the tool call. " +
      "Just mention what you created by title.\n\n" +
      "Slides follow Apple keynote design — clean, minimal, elegant with generous white space. " +
      "The slide agent can generate AI images for visual impact and embeds them directly into slides. " +
      "After each slide is rendered, the agent reviews it and can revise if needed.",
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
        .describe(
          "Optional number of slides to generate. If not specified, the agent decides.",
        ),
    }),
    execute: async ({ title, description, numSlides }, { toolCallId }) => {
      console.log(
        `[create_slides] Starting: "${title}" (${numSlides ?? "auto"} slides)`,
      );

      // In E2E mode, create a minimal deck with a test image
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
          sceneData: { test: true },
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

      // Create the deck first
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
