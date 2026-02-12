import { describe, test, expect, mock, beforeEach } from "bun:test";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";

// Mock environment variables
process.env.S3_BUCKET_NAME = "test-bucket";
process.env.AWS_REGION = "us-east-1";
process.env.AWS_ACCESS_KEY_ID = "test-key";
process.env.AWS_SECRET_ACCESS_KEY = "test-secret";

// Mock the S3Client before importing the module
const mockSend = mock(() => Promise.resolve({}));

mock.module("@aws-sdk/client-s3", () => ({
  S3Client: class MockS3Client {
    send = mockSend;
  },
  PutObjectCommand: class MockPutObjectCommand {
    constructor(public params: any) {}
  },
}));

mock.module("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: mock(() => Promise.resolve("https://signed-url.example.com")),
}));

const { downloadAndUploadToS3 } = await import("./index");

describe("downloadAndUploadToS3", () => {
  beforeEach(() => {
    mockSend.mockClear();
  });

  async function getTempS3Directories(): Promise<string[]> {
    const tempDir = tmpdir();
    const entries = await readdir(tempDir);
    return entries.filter((entry) => entry.startsWith("s3-upload-"));
  }

  function createMockWebStream(content: string): ReadableStream {
    return new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(content));
        controller.close();
      },
    });
  }

  test("downloads file to temp folder, uploads to S3, and cleans up", async () => {
    // Create a mock response stream (Web ReadableStream)
    const testContent = "test file content";
    const mockStream = createMockWebStream(testContent);

    // Mock fetch
    const mockFetch = mock(() =>
      Promise.resolve({
        ok: true,
        body: mockStream,
      } as Response),
    );
    global.fetch = mockFetch as any;

    // Get initial temp directories
    const tempDirsBefore = await getTempS3Directories();

    // Execute the upload
    const result = await downloadAndUploadToS3(
      "https://example.com/file.pdf",
      "application/pdf",
      "test.pdf",
    );

    // Get temp directories after
    const tempDirsAfter = await getTempS3Directories();

    // Verify fetch was called
    expect(mockFetch).toHaveBeenCalledWith("https://example.com/file.pdf");

    // Verify S3 upload was called
    expect(mockSend).toHaveBeenCalledTimes(1);

    // Verify the result URL contains the expected path pattern
    expect(result).toContain("/email-attachments/");
    expect(result).toContain(".pdf");

    // Verify temp directories are cleaned up (should be same or fewer than before)
    expect(tempDirsAfter.length).toBeLessThanOrEqual(tempDirsBefore.length);
  });

  test("cleans up temp folder even when S3 upload fails", async () => {
    // Create a mock response stream (Web ReadableStream)
    const testContent = "test file content";
    const mockStream = createMockWebStream(testContent);

    // Mock fetch
    const mockFetch = mock(() =>
      Promise.resolve({
        ok: true,
        body: mockStream,
      } as Response),
    );
    global.fetch = mockFetch as any;

    // Make S3 upload fail
    mockSend.mockRejectedValueOnce(new Error("S3 upload failed"));

    // Get initial temp directories
    const tempDirsBefore = await getTempS3Directories();

    // Execute the upload and expect it to fail
    await expect(
      downloadAndUploadToS3(
        "https://example.com/file.pdf",
        "application/pdf",
        "test.pdf",
      ),
    ).rejects.toThrow("S3 upload failed");

    // Get temp directories after
    const tempDirsAfter = await getTempS3Directories();

    // Verify temp directories are still cleaned up despite the error
    expect(tempDirsAfter.length).toBeLessThanOrEqual(tempDirsBefore.length);
  });

  test("throws error when download fails", async () => {
    // Mock fetch to return error
    const mockFetch = mock(() =>
      Promise.resolve({
        ok: false,
        statusText: "Not Found",
      } as Response),
    );
    global.fetch = mockFetch as any;

    await expect(
      downloadAndUploadToS3(
        "https://example.com/file.pdf",
        "application/pdf",
        "test.pdf",
      ),
    ).rejects.toThrow("Failed to download file");

    // S3 should not have been called
    expect(mockSend).not.toHaveBeenCalled();
  });

  test("throws error when response body is null", async () => {
    // Mock fetch to return null body
    const mockFetch = mock(() =>
      Promise.resolve({
        ok: true,
        body: null,
      } as Response),
    );
    global.fetch = mockFetch as any;

    await expect(
      downloadAndUploadToS3(
        "https://example.com/file.pdf",
        "application/pdf",
        "test.pdf",
      ),
    ).rejects.toThrow("Response body is null");

    // S3 should not have been called
    expect(mockSend).not.toHaveBeenCalled();
  });
});
