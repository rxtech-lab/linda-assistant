import { describe, mock, test, expect } from "bun:test";
import { replaceInlineImages, stripBase64DataUris } from "./html";

// Mock uploadBufferToS3
mock.module("@/lib/s3", () => ({
  uploadBufferToS3: async (
    _buffer: Buffer,
    contentType: string,
    filename: string,
  ) => `https://s3.example.com/email-inline-images/${filename}`,
}));

describe("stripBase64DataUris", () => {
  test("strips base64 PNG image from src attribute", () => {
    const html = '<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==">';
    expect(stripBase64DataUris(html)).toBe('<img src="">');
  });

  test("strips base64 JPEG image from src attribute", () => {
    const html = '<img src="data:image/jpeg;base64,/9j/4AAQSkZJRg==">';
    expect(stripBase64DataUris(html)).toBe('<img src="">');
  });

  test("strips multiple base64 images", () => {
    const html =
      '<img src="data:image/png;base64,abc123"><p>text</p><img src="data:image/gif;base64,xyz789">';
    expect(stripBase64DataUris(html)).toBe(
      '<img src=""><p>text</p><img src="">',
    );
  });

  test("preserves normal URL src attributes", () => {
    const html = '<img src="https://example.com/image.png">';
    expect(stripBase64DataUris(html)).toBe(html);
  });

  test("preserves HTML without images", () => {
    const html = "<div><p>Hello world</p></div>";
    expect(stripBase64DataUris(html)).toBe(html);
  });

  test("handles mixed normal and base64 src attributes", () => {
    const html =
      '<img src="https://example.com/ok.png"><img src="data:image/png;base64,abc">';
    expect(stripBase64DataUris(html)).toBe(
      '<img src="https://example.com/ok.png"><img src="">',
    );
  });

  test("is case-insensitive for SRC attribute", () => {
    const html = '<img SRC="data:image/png;base64,abc">';
    expect(stripBase64DataUris(html)).toBe('<img src="">');
  });
});

describe("replaceInlineImages", () => {
  test("replaces cid: references with S3 URLs from cidMap", async () => {
    const html = '<img src="cid:inline-image-1.png">';
    const cidMap = new Map([
      ["<inline-image-1.png>", "https://s3.example.com/attachment1.png"],
    ]);
    const result = await replaceInlineImages(html, cidMap);
    expect(result).toBe(
      '<img src="https://s3.example.com/attachment1.png">',
    );
  });

  test("replaces multiple cid: references", async () => {
    const html =
      '<img src="cid:img1.png"><p>text</p><img src="cid:img2.jpg">';
    const cidMap = new Map([
      ["<img1.png>", "https://s3.example.com/1.png"],
      ["<img2.jpg>", "https://s3.example.com/2.jpg"],
    ]);
    const result = await replaceInlineImages(html, cidMap);
    expect(result).toBe(
      '<img src="https://s3.example.com/1.png"><p>text</p><img src="https://s3.example.com/2.jpg">',
    );
  });

  test("uploads base64 data URIs to S3 and replaces with URLs", async () => {
    const html = '<img src="data:image/png;base64,iVBORw0KGgo=">';
    const result = await replaceInlineImages(html, new Map());
    expect(result).toBe(
      '<img src="https://s3.example.com/email-inline-images/inline.png">',
    );
  });

  test("handles both cid and base64 in same HTML", async () => {
    const html =
      '<img src="cid:att1.png"><img src="data:image/jpeg;base64,/9j/4A==">';
    const cidMap = new Map([
      ["<att1.png>", "https://s3.example.com/att1.png"],
    ]);
    const result = await replaceInlineImages(html, cidMap);
    expect(result).toContain(
      '<img src="https://s3.example.com/att1.png">',
    );
    expect(result).toContain(
      '<img src="https://s3.example.com/email-inline-images/inline.jpeg">',
    );
  });

  test("preserves HTML with no inline images", async () => {
    const html = "<div><p>Hello world</p></div>";
    const result = await replaceInlineImages(html, new Map());
    expect(result).toBe(html);
  });
});
