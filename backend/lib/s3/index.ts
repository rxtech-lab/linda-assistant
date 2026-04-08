import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHash } from "crypto";
import { nanoid } from "nanoid";

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
  contentType: string | undefined,
  prefix = "uploads",
  extension?: string,
) {
  const base = `${prefix}/${nanoid()}-${Date.now()}`;
  const key = extension && extension !== "*" ? `${base}.${extension.toLowerCase()}` : base;
  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME!,
    Key: key,
    ...(contentType && { ContentType: contentType }),
  });
  const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
  return { url, key };
}

export async function downloadAndUploadToS3(url: string, contentType: string, filename: string) {
  const start = Date.now();
  const log = (step: string) =>
    console.log(`[s3:upload] ${filename} ${step} (+${Date.now() - start}ms)`);

  // Download the file into memory as a Buffer
  log("downloading from resend");
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new Error(`Failed to download file from ${url}: ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const contentHash = createHash("sha256").update(buffer).digest("hex");
  log("download complete");

  // Generate a unique key for the file in S3
  const key = `email-attachments/${nanoid()}-${filename}`;

  if (process.env.IS_E2E?.toLowerCase() === "true") {
    const baseUrl = `http://localhost:${process.env.PORT || 3001}`;
    return { url: `${baseUrl}/api/mock-s3/${key}`, contentHash };
  }

  // Upload buffer directly to S3
  log("uploading to s3");
  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME!,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    ContentLength: buffer.length,
  });

  await s3Client.send(command, {
    requestTimeout: 60_000,
  });
  log("upload complete");

  return { url: getS3PublicUrl(key), contentHash };
}

export async function uploadBufferToS3(
  buffer: Buffer,
  contentType: string,
  filename: string,
  prefix = "email-inline-images",
) {
  const contentHash = createHash("sha256").update(buffer).digest("hex");
  const key = `${prefix}/${nanoid()}-${filename}`;

  if (process.env.IS_E2E?.toLowerCase() === "true") {
    const baseUrl = `http://localhost:${process.env.PORT || 3001}`;
    return { url: `${baseUrl}/api/mock-s3/${key}`, contentHash };
  }

  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME!,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    ContentLength: buffer.length,
  });

  await s3Client.send(command, { requestTimeout: 60_000 });

  return { url: getS3PublicUrl(key), contentHash };
}

const MIME_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  mov: "video/quicktime",
  zip: "application/zip",
};

export function extensionToMimeType(ext: string): string {
  return MIME_TYPES[ext.toLowerCase()] ?? "application/octet-stream";
}

export async function getPresignedDownloadUrl(key: string, expiresIn = 3600) {
  const command = new GetObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME!,
    Key: key,
  });
  return getSignedUrl(s3Client, command, { expiresIn });
}

export async function getPresignedUploadUrls(
  extensions: string[],
  prefix = "tool-uploads",
): Promise<Array<{ url: string; key: string; extension: string }>> {
  const isE2E = process.env.IS_E2E?.toLowerCase() === "true";

  if (isE2E) {
    // In E2E mode, return mock URLs pointing to the backend instead of S3.
    // This lets the iOS simulator upload without direct MinIO access.
    const baseUrl = `http://localhost:${process.env.PORT || 3001}`;
    return extensions.map((ext) => {
      const base = `${prefix}/${nanoid()}-${Date.now()}`;
      const key = ext !== "*" ? `${base}.${ext.toLowerCase()}` : base;
      return { url: `${baseUrl}/api/mock-s3/${key}`, key, extension: ext };
    });
  }

  return Promise.all(
    extensions.map(async (ext) => {
      const contentType = ext === "*" ? undefined : extensionToMimeType(ext);
      const { url, key } = await getPresignedUploadUrl(contentType, prefix, ext);
      return { url, key, extension: ext };
    }),
  );
}

export async function verifyObjectExists(key: string): Promise<boolean> {
  try {
    await s3Client.send(
      new HeadObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME!,
        Key: key,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

export async function deleteObject(key: string): Promise<void> {
  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME!,
      Key: key,
    }),
  );
}

export async function getObjectContentType(key: string): Promise<string | undefined> {
  try {
    const response = await s3Client.send(
      new HeadObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME!,
        Key: key,
      }),
    );
    return response.ContentType;
  } catch {
    return undefined;
  }
}

export function getS3PublicUrl(key: string): string {
  const bucketUrl =
    process.env.S3_PUBLIC_URL ||
    `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com`;
  return `${bucketUrl}/${key}`;
}
