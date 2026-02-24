import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { nanoid } from "nanoid";
import { createWriteStream, createReadStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

let _s3Client: S3Client | undefined;

export const s3Client = new Proxy({} as S3Client, {
  get(_, prop) {
    if (!_s3Client) {
      _s3Client = new S3Client({
        region: process.env.AWS_REGION!,
        ...(process.env.S3_API_URL && {
          endpoint: process.env.S3_API_URL,
          forcePathStyle: true,
        }),
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        },
      });
    }
    return (_s3Client as any)[prop];
  },
});

export async function getPresignedUploadUrl(
  contentType: string,
  prefix = "uploads",
) {
  const key = `${prefix}/${nanoid()}-${Date.now()}`;
  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME!,
    Key: key,
    ContentType: contentType,
  });
  const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
  return { url, key };
}

export async function downloadAndUploadToS3(
  url: string,
  contentType: string,
  filename: string,
) {
  const start = Date.now();
  const log = (step: string) =>
    console.log(`[s3:upload] ${filename} ${step} (+${Date.now() - start}ms)`);

  // Create a unique temp directory for this download
  const tempDir = join(tmpdir(), `s3-upload-${nanoid()}`);
  await mkdir(tempDir, { recursive: true });

  const tempFilePath = join(tempDir, filename);

  try {
    // Download the file from the URL to temp file
    log("downloading from resend");
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      throw new Error(
        `Failed to download file from ${url}: ${response.statusText}`,
      );
    }

    if (!response.body) {
      throw new Error("Response body is null");
    }

    // Stream the download to temp file
    const fileStream = createWriteStream(tempFilePath);
    await pipeline(Readable.fromWeb(response.body as any), fileStream);
    log("download complete");

    // Generate a unique key for the file in S3
    const key = `email-attachments/${nanoid()}-${filename}`;

    // Upload to S3 from temp file
    log("uploading to s3");
    const fileReadStream = createReadStream(tempFilePath);
    const command = new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME!,
      Key: key,
      Body: fileReadStream,
      ContentType: contentType,
    });

    await s3Client.send(command, {
      requestTimeout: 30_000,
    });
    log("upload complete");

    // Return the S3 URL (construct based on bucket configuration)
    const bucketUrl =
      process.env.S3_PUBLIC_URL ||
      `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com`;
    return `${bucketUrl}/${key}`;
  } finally {
    // Clean up: delete temp directory and all its contents
    await rm(tempDir, { recursive: true, force: true });
  }
}
