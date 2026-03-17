import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
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

export async function getPresignedUploadUrl(contentType: string, prefix = "uploads") {
  const key = `${prefix}/${nanoid()}-${Date.now()}`;
  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME!,
    Key: key,
    ContentType: contentType,
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

function getS3PublicUrl(key: string): string {
  const bucketUrl =
    process.env.S3_PUBLIC_URL ||
    `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com`;
  return `${bucketUrl}/${key}`;
}
