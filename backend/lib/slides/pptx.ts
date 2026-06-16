import type PptxGenJS from "pptxgenjs";
import {
  normalizeHexColor,
  PPTX_HEIGHT,
  PPTX_WIDTH,
  toPptxH,
  toPptxW,
  toPptxX,
  toPptxY,
  type PptxSlideElement,
  type PptxSlideSpec,
} from "./spec";

export function addPptxSpecSlide(pptx: PptxGenJS, spec: PptxSlideSpec) {
  const slide = pptx.addSlide();
  slide.background = { color: normalizeHexColor(spec.backgroundColor) };

  for (const element of spec.elements) {
    addElement(pptx, slide, element);
  }

  if (spec.speakerNotes) {
    slide.addNotes(spec.speakerNotes);
  }
}

function addElement(pptx: PptxGenJS, slide: PptxGenJS.Slide, element: PptxSlideElement) {
  switch (element.type) {
    case "text":
      slide.addText(element.text, {
        x: toPptxX(element.x),
        y: toPptxY(element.y),
        w: toPptxW(element.w),
        h: toPptxH(element.h),
        fontFace: element.fontFace,
        fontSize: element.fontSize,
        color: normalizeHexColor(element.color),
        bold: element.bold,
        italic: element.italic,
        align: element.align,
        valign: element.valign,
        fit: "shrink",
        margin: element.margin ? toPptxW(element.margin) : undefined,
        fill: element.fill
          ? {
              color: normalizeHexColor(element.fill),
              transparency: transparencyFor(element.opacity),
            }
          : undefined,
        transparency: transparencyFor(element.opacity),
      });
      return;

    case "rect":
      slide.addShape(element.radius ? pptx.ShapeType.roundRect : pptx.ShapeType.rect, {
        x: toPptxX(element.x),
        y: toPptxY(element.y),
        w: toPptxW(element.w),
        h: toPptxH(element.h),
        rectRadius: element.radius ? toPptxW(element.radius) : undefined,
        fill: {
          color: normalizeHexColor(element.fill),
          transparency: transparencyFor(element.opacity),
        },
        line: element.line
          ? {
              color: normalizeHexColor(element.line.color ?? "#000000"),
              width: element.line.width,
            }
          : { transparency: 100 },
      });
      return;

    case "ellipse":
      slide.addShape(pptx.ShapeType.ellipse, {
        x: toPptxX(element.x),
        y: toPptxY(element.y),
        w: toPptxW(element.w),
        h: toPptxH(element.h),
        fill: {
          color: normalizeHexColor(element.fill),
          transparency: transparencyFor(element.opacity),
        },
        line: element.line
          ? {
              color: normalizeHexColor(element.line.color ?? "#000000"),
              width: element.line.width,
            }
          : { transparency: 100 },
      });
      return;

    case "line":
      slide.addShape(pptx.ShapeType.line, {
        x: toPptxX(element.x),
        y: toPptxY(element.y),
        w: toPptxW(element.x2 - element.x),
        h: toPptxH(element.y2 - element.y),
        line: {
          color: normalizeHexColor(element.color),
          width: element.width,
          transparency: transparencyFor(element.opacity),
        },
      });
      return;

    case "image":
      slide.addImage({
        path: element.src,
        x: toPptxX(element.x),
        y: toPptxY(element.y),
        w: toPptxW(element.w),
        h: toPptxH(element.h),
        altText: element.altText,
        sizing:
          element.sizing === "stretch"
            ? undefined
            : {
                type: element.sizing,
                x: toPptxX(element.x),
                y: toPptxY(element.y),
                w: toPptxW(element.w),
                h: toPptxH(element.h),
              },
      });
      return;
  }
}

function transparencyFor(opacity: number | undefined): number {
  if (opacity == null) return 0;
  return Math.round((1 - Math.max(0, Math.min(1, opacity))) * 100);
}

export function configurePptx(pptx: PptxGenJS, title: string) {
  pptx.title = title;
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Linda";
  pptx.subject = title;
  pptx.theme = {
    headFontFace: "Helvetica",
    bodyFontFace: "Helvetica",
  };
}

export const pptxPageSize = {
  width: PPTX_WIDTH,
  height: PPTX_HEIGHT,
};
