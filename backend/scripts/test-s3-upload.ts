/**
 * Test script for downloadAndUploadToS3 using a real Resend attachment.
 *
 * Usage: bun run scripts/test-s3-upload.ts <attachmentId> <emailId>
 *
 * Example: bun run scripts/test-s3-upload.ts abc123 af731b39-bbf0-4d81-a3f8-c5c8b1db2a69
 */

import { downloadAndUploadToS3 } from "@/lib/s3";
import { resend } from "@/lib/resend";

const [attachmentId, emailId] = process.argv.slice(2);

if (!attachmentId || !emailId) {
  console.error("Usage: bun run scripts/test-s3-upload.ts <attachmentId> <emailId>");
  process.exit(1);
}

console.log(`Fetching attachment ${attachmentId} from email ${emailId}...\n`);

const { data, error } = await resend.emails.receiving.attachments.get({
  id: attachmentId,
  emailId,
});

if (error || !data) {
  console.error("Failed to get attachment from Resend:", error);
  process.exit(1);
}

const filename = data.filename ?? `attachment-${attachmentId}`;

console.log(`Attachment info:`);
console.log(`  filename:     ${filename}`);
console.log(`  content_type: ${data.content_type}`);
console.log(`  size:         ${data.size}`);
console.log(`  download_url: ${data.download_url}\n`);

console.log("Calling downloadAndUploadToS3...\n");

try {
  const { url } = await downloadAndUploadToS3(
    data.download_url,
    data.content_type,
    filename,
  );
  console.log(`\n✓ Upload succeeded!`);
  console.log(`  S3 URL: ${url}`);
} catch (err) {
  console.error(`\n✗ Upload failed:`, err);
  process.exit(1);
}
