import { uploadBufferToS3 } from "@/lib/s3";

export interface InlineImageResult {
  html: string;
  inlineImages: Array<{
    type: "image";
    url: string;
    name: string;
  }>;
}

/**
 * Replace inline base64 data URIs in HTML with S3-hosted URLs.
 * Also replaces cid: references using a contentId → URL map.
 * Returns the modified HTML and a list of images extracted from base64.
 */
export async function replaceInlineImages(
  html: string,
  cidMap: Map<string, string>,
): Promise<InlineImageResult> {
  const inlineImages: InlineImageResult["inlineImages"] = [];

  // 1. Replace cid: references with S3 URLs from processed attachments
  for (const [cid, url] of cidMap) {
    // CID refs appear as src="cid:xxx" — strip angle brackets from content_id
    const cleanCid = cid.replace(/^<|>$/g, "");
    html = html.replaceAll(`src="cid:${cleanCid}"`, `src="${url}"`);
  }

  // 2. Extract and upload base64 data URIs to S3
  const dataUriRegex = /src="(data:([\w/+-]+);base64,([^"]+))"/gi;
  let match: RegExpExecArray | null;
  const replacements: Array<{ original: string; url: string }> = [];

  while ((match = dataUriRegex.exec(html)) !== null) {
    const fullMatch = match[0]; // src="data:..."
    const contentType = match[2]; // image/png
    const base64Data = match[3]; // raw base64

    try {
      const buffer = Buffer.from(base64Data, "base64");
      const ext = contentType.split("/")[1] || "bin";
      const filename = `inline.${ext}`;
      const url = await uploadBufferToS3(buffer, contentType, filename);
      replacements.push({ original: fullMatch, url });
      inlineImages.push({ type: "image", url, name: filename });
    } catch (error) {
      console.error("[html] failed to upload inline base64 image to S3:", error);
      // Strip the broken data URI rather than keeping a massive base64 blob
      replacements.push({ original: fullMatch, url: "" });
    }
  }

  for (const { original, url } of replacements) {
    html = html.replace(original, `src="${url}"`);
  }

  return { html, inlineImages };
}

/**
 * Strip all base64 data URIs from src attributes (sync fallback).
 */
export function stripBase64DataUris(html: string): string {
  return html.replace(/src="data:[^"]*"/gi, 'src=""');
}
