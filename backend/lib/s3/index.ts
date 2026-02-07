import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { nanoid } from "nanoid";

let _s3Client: S3Client | undefined;

export const s3Client = new Proxy({} as S3Client, {
  get(_, prop) {
    if (!_s3Client) {
      _s3Client = new S3Client({
        region: process.env.AWS_REGION!,
        ...(process.env.S3_API_URL && { endpoint: process.env.S3_API_URL, forcePathStyle: true }),
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
  prefix = "uploads"
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
