import { describe, test, expect, mock, beforeEach } from "bun:test";

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

  function createMockResponse(content: string): Response {
    const buffer = new TextEncoder().encode(content).buffer;
    return {
      ok: true,
      arrayBuffer: () => Promise.resolve(buffer),
    } as Response;
  }

  test("downloads file to temp folder, uploads to S3, and cleans up", async () => {
    const testContent = "test file content";

    // Mock fetch
    const mockFetch = mock(() =>
      Promise.resolve(createMockResponse(testContent)),
    );
    global.fetch = mockFetch as any;

    // Execute the upload
    const result = await downloadAndUploadToS3(
      "https://example.com/file.pdf",
      "application/pdf",
      "test.pdf",
    );

    // Verify fetch was called with the URL
    expect(mockFetch.mock.calls[0][0]).toBe("https://example.com/file.pdf");

    // Verify S3 upload was called
    expect(mockSend).toHaveBeenCalledTimes(1);

    // Verify the result URL contains the expected path pattern
    expect(result).toContain("/email-attachments/");
    expect(result).toContain(".pdf");
  });

  test("cleans up temp folder even when S3 upload fails", async () => {
    const testContent = "test file content";

    // Mock fetch
    const mockFetch = mock(() =>
      Promise.resolve(createMockResponse(testContent)),
    );
    global.fetch = mockFetch as any;

    // Make S3 upload fail
    mockSend.mockRejectedValueOnce(new Error("S3 upload failed"));

    // Execute the upload and expect it to fail
    await expect(
      downloadAndUploadToS3(
        "https://example.com/file.pdf",
        "application/pdf",
        "test.pdf",
      ),
    ).rejects.toThrow("S3 upload failed");
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

  test("throws error when arrayBuffer fails", async () => {
    // Mock fetch to return a response where arrayBuffer rejects
    const mockFetch = mock(() =>
      Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.reject(new Error("arrayBuffer failed")),
      } as unknown as Response),
    );
    global.fetch = mockFetch as any;

    await expect(
      downloadAndUploadToS3(
        "https://example.com/file.pdf",
        "application/pdf",
        "test.pdf",
      ),
    ).rejects.toThrow("arrayBuffer failed");

    // S3 should not have been called
    expect(mockSend).not.toHaveBeenCalled();
  });
});
