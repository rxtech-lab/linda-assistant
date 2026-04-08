import Konva from "konva";
import "konva/canvas-backend";
import { loadImage } from "canvas";

/**
 * Collect all image `src` URLs from the scene JSON tree.
 */
function collectImageSrcs(json: Record<string, unknown>): string[] {
  const srcs: string[] = [];
  const {
    className,
    attrs = {},
    children = [],
  } = json as {
    className: string;
    attrs: Record<string, unknown>;
    children: Record<string, unknown>[];
  };
  if (className === "Image" && typeof (attrs as Record<string, unknown>).src === "string") {
    srcs.push((attrs as Record<string, unknown>).src as string);
  }
  for (const child of children as Record<string, unknown>[]) {
    srcs.push(...collectImageSrcs(child));
  }
  return srcs;
}

/**
 * Pre-fetch all remote images and return a map of src → canvas Image.
 */
async function prefetchImages(srcs: string[]): Promise<Map<string, InstanceType<typeof Image>>> {
  const unique = [...new Set(srcs)];
  const map = new Map<string, InstanceType<typeof Image>>();
  await Promise.all(
    unique.map(async (src) => {
      try {
        const img = await loadImage(src);
        map.set(src, img as unknown as InstanceType<typeof Image>);
      } catch (err) {
        console.warn(`[renderer] Failed to load image: ${src}`, err);
      }
    }),
  );
  return map;
}

/**
 * Recursively build a Konva node tree from scene JSON without requiring a DOM container.
 * Konva.Node.create() calls setContainer() which needs `document` — unavailable server-side.
 *
 * For Image nodes, the `src` attribute is resolved against the pre-fetched imageMap
 * and replaced with a canvas `image` object that Konva can render.
 */
function buildNode(
  json: Record<string, unknown>,
  imageMap: Map<string, InstanceType<typeof Image>>,
): Konva.Node | null {
  const {
    className,
    attrs = {},
    children = [],
  } = json as {
    className: string;
    attrs: Record<string, unknown>;
    children: Record<string, unknown>[];
  };

  const cleanAttrs = { ...attrs };
  delete cleanAttrs.container;

  // Handle Image nodes: resolve src → canvas image object
  if (className === "Image") {
    const src = cleanAttrs.src as string | undefined;
    delete cleanAttrs.src;
    if (src && imageMap.has(src)) {
      cleanAttrs.image = imageMap.get(src)!;
    } else {
      // No image available — render a placeholder rect instead
      return new Konva.Rect({
        ...cleanAttrs,
        fill: "#E5E7EB",
        cornerRadius: 12,
      } as Record<string, unknown>);
    }
  }

  const NodeClass = (Konva as Record<string, unknown>)[className] as
    | (new (
        config: Record<string, unknown>,
      ) => Konva.Node)
    | undefined;
  if (!NodeClass) {
    console.warn(`[renderer] Unknown Konva className: "${className}", skipping node`);
    return null;
  }

  const node = new NodeClass(cleanAttrs);
  for (const child of children as Record<string, unknown>[]) {
    const childNode = buildNode(child, imageMap);
    if (childNode && "add" in node) {
      (node as Konva.Container).add(childNode);
    }
  }
  return node;
}

/**
 * Render KonvaJS scene JSON to a PNG buffer.
 *
 * The sceneData should be a valid Konva Stage JSON (as produced by stage.toJSON()).
 * We build a Stage from the JSON server-side and return the PNG buffer.
 */
export async function renderSlideToBuffer(
  sceneData: unknown,
  width = 1920,
  height = 1080,
): Promise<Buffer> {
  const json = typeof sceneData === "string" ? JSON.parse(sceneData) : sceneData;

  // Pre-fetch any remote images referenced in the scene
  const srcs = collectImageSrcs(json as Record<string, unknown>);
  const imageMap = srcs.length > 0 ? await prefetchImages(srcs) : new Map();

  const rootJson = json as Record<string, unknown>;
  let stage: Konva.Stage;

  if (rootJson.className === "Stage") {
    // Standard case: root is a Stage
    const built = buildNode(rootJson, imageMap) as Konva.Stage | null;
    if (!built) throw new Error("Failed to build Konva stage from scene data");
    stage = built;
  } else {
    // Model sent a non-Stage root (e.g. Layer, Group) — wrap it
    stage = new Konva.Stage({ width, height });
    if (rootJson.className === "Layer") {
      const layer = buildNode(rootJson, imageMap) as Konva.Layer | null;
      if (!layer)
        throw new Error(
          `Failed to build Konva node from scene data (root className: ${rootJson.className})`,
        );
      stage.add(layer);
    } else {
      const layer = new Konva.Layer();
      const node = buildNode(rootJson, imageMap);
      if (!node)
        throw new Error(
          `Failed to build Konva node from scene data (root className: ${rootJson.className})`,
        );
      layer.add(node as Konva.Group);
      stage.add(layer);
    }
  }

  stage.width(width);
  stage.height(height);

  const dataURL = stage.toDataURL({ pixelRatio: 1 });
  // dataURL is "data:image/png;base64,<base64>"
  const base64 = dataURL.split(",")[1];
  stage.destroy();
  return Buffer.from(base64, "base64");
}

/**
 * Render a smaller thumbnail of the slide.
 */
export async function renderSlideThumbnail(
  sceneData: unknown,
  width = 400,
  height = 225,
): Promise<Buffer> {
  return renderSlideToBuffer(sceneData, width, height);
}
