import { z } from "zod";

export const PPTX_SLIDE_SPEC_FORMAT = "pptxgenjs/v1";
export const SLIDE_WIDTH = 1920;
export const SLIDE_HEIGHT = 1080;
export const PPTX_WIDTH = 13.333;
export const PPTX_HEIGHT = 7.5;

const hexColorSchema = z.string().regex(/^#?[0-9a-fA-F]{6}$/, "Use a 6-digit hex color");

const percentSchema = z.number().min(0).max(1);
const coordSchema = z.number().finite();

const baseElementSchema = z.object({
  x: coordSchema,
  y: coordSchema,
  w: z.number().positive(),
  h: z.number().positive(),
  opacity: percentSchema.optional(),
});

const lineSchema = z.object({
  color: hexColorSchema.optional(),
  width: z.number().positive().optional(),
});

export const PptxSlideSpecSchema = z.object({
  format: z.literal(PPTX_SLIDE_SPEC_FORMAT),
  backgroundColor: hexColorSchema.default("#FFFFFF"),
  speakerNotes: z.string().optional(),
  elements: z
    .array(
      z.discriminatedUnion("type", [
        baseElementSchema.extend({
          type: z.literal("text"),
          text: z.string(),
          fontSize: z.number().positive().default(36),
          fontFace: z.string().default("Helvetica"),
          color: hexColorSchema.default("#1D1D1F"),
          bold: z.boolean().default(false),
          italic: z.boolean().default(false),
          align: z.enum(["left", "center", "right"]).default("left"),
          valign: z.enum(["top", "middle", "bottom"]).default("top"),
          fill: hexColorSchema.optional(),
          margin: z.number().min(0).optional(),
        }),
        baseElementSchema.extend({
          type: z.literal("rect"),
          fill: hexColorSchema.default("#FFFFFF"),
          radius: z.number().min(0).optional(),
          line: lineSchema.optional(),
        }),
        baseElementSchema.extend({
          type: z.literal("ellipse"),
          fill: hexColorSchema.default("#FFFFFF"),
          line: lineSchema.optional(),
        }),
        z.object({
          type: z.literal("line"),
          x: coordSchema,
          y: coordSchema,
          x2: coordSchema,
          y2: coordSchema,
          color: hexColorSchema.default("#1D1D1F"),
          width: z.number().positive().default(2),
          opacity: percentSchema.optional(),
        }),
        baseElementSchema.extend({
          type: z.literal("image"),
          src: z.string().url(),
          altText: z.string().optional(),
          sizing: z.enum(["contain", "cover", "stretch"]).default("cover"),
        }),
      ]),
    )
    .min(1),
});

export type PptxSlideSpec = z.infer<typeof PptxSlideSpecSchema>;
export type PptxSlideElement = PptxSlideSpec["elements"][number];

export function parsePptxSlideSpec(value: unknown): PptxSlideSpec {
  const raw = typeof value === "string" ? JSON.parse(value) : value;
  return PptxSlideSpecSchema.parse(raw);
}

export function isPptxSlideSpec(value: unknown): value is PptxSlideSpec {
  const raw = typeof value === "string" ? tryParseJson(value) : value;
  return PptxSlideSpecSchema.safeParse(raw).success;
}

export function normalizeHexColor(color: string): string {
  return color.replace(/^#/, "").toUpperCase();
}

export function fillWithOpacity(color: string, opacity?: number): string {
  const normalized = color.startsWith("#") ? color : `#${color}`;
  if (opacity == null || opacity >= 1) return normalized;

  const alpha = Math.round(Math.max(0, Math.min(1, opacity)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${normalized}${alpha}`;
}

export function toPptxX(x: number): number {
  return (x / SLIDE_WIDTH) * PPTX_WIDTH;
}

export function toPptxY(y: number): number {
  return (y / SLIDE_HEIGHT) * PPTX_HEIGHT;
}

export function toPptxW(w: number): number {
  return (w / SLIDE_WIDTH) * PPTX_WIDTH;
}

export function toPptxH(h: number): number {
  return (h / SLIDE_HEIGHT) * PPTX_HEIGHT;
}

export function toKonvaSceneData(spec: PptxSlideSpec): unknown {
  return {
    attrs: { width: SLIDE_WIDTH, height: SLIDE_HEIGHT },
    className: "Stage",
    children: [
      {
        attrs: {},
        className: "Layer",
        children: [
          {
            attrs: {
              x: 0,
              y: 0,
              width: SLIDE_WIDTH,
              height: SLIDE_HEIGHT,
              fill: fillWithOpacity(spec.backgroundColor),
            },
            className: "Rect",
          },
          ...spec.elements.map(toKonvaNode),
        ],
      },
    ],
  };
}

function toKonvaNode(element: PptxSlideElement): Record<string, unknown> {
  switch (element.type) {
    case "text":
      return {
        attrs: {
          x: element.x,
          y: element.y,
          width: element.w,
          height: element.h,
          text: element.text,
          fontSize: element.fontSize,
          fontFamily: element.fontFace,
          fontStyle: `${element.bold ? "bold" : ""}${element.italic ? " italic" : ""}`.trim(),
          fill: fillWithOpacity(element.color, element.opacity),
          align: element.align,
          verticalAlign: element.valign === "middle" ? "middle" : element.valign,
          lineHeight: 1.2,
          padding: element.margin,
        },
        className: "Text",
      };

    case "rect":
      return {
        attrs: {
          x: element.x,
          y: element.y,
          width: element.w,
          height: element.h,
          fill: fillWithOpacity(element.fill, element.opacity),
          cornerRadius: element.radius ?? 0,
          stroke: element.line?.color,
          strokeWidth: element.line?.width,
        },
        className: "Rect",
      };

    case "ellipse":
      return {
        attrs: {
          x: element.x + element.w / 2,
          y: element.y + element.h / 2,
          radiusX: element.w / 2,
          radiusY: element.h / 2,
          fill: fillWithOpacity(element.fill, element.opacity),
          stroke: element.line?.color,
          strokeWidth: element.line?.width,
        },
        className: "Ellipse",
      };

    case "line":
      return {
        attrs: {
          points: [element.x, element.y, element.x2, element.y2],
          stroke: fillWithOpacity(element.color, element.opacity),
          strokeWidth: element.width,
        },
        className: "Line",
      };

    case "image":
      return {
        attrs: {
          x: element.x,
          y: element.y,
          width: element.w,
          height: element.h,
          src: element.src,
        },
        className: "Image",
      };
  }
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
