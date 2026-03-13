import { z } from "zod";
import { availableModelSchema, DEFAULT_MODEL } from "@/lib/ai/models";
import { isValidCronExpression } from "@/lib/utils/cron";

// Tool permissions
export const toolPermissionSchema = z.object({
  toolName: z.string().describe("Name of the tool"),
  permission: z
    .enum(["auto-confirm", "manual-confirm", "auto-reject", "disabled"])
    .describe("Permission level for the tool"),
});

// ---- Assignees ----

export const selectAssigneeSchema = z.object({
  id: z.string().describe("Unique identifier"),
  userId: z.string().describe("Owner user ID"),
  name: z.string().describe("Display name"),
  email: z.string().describe("Email address"),
  personality: z.string().nullable().describe("System prompt personality"),
  model: z.string().nullable().describe("AI model override"),
  toolPermissions: z
    .array(toolPermissionSchema)
    .nullable()
    .describe("Per-tool permission overrides"),
  createdAt: z.string().nullable().describe("Creation timestamp"),
  updatedAt: z.string().nullable().describe("Last update timestamp"),
});

export const insertAssigneeSchema = z.object({
  name: z.string().min(1).max(100).describe("Display name"),
  email: z.string().email().describe("Email address"),
  personality: z
    .string()
    .max(2000)
    .optional()
    .describe("System prompt personality"),
  model: availableModelSchema
    .catch(DEFAULT_MODEL)
    .optional()
    .describe("AI model to use"),
  toolPermissions: z
    .array(toolPermissionSchema)
    .optional()
    .describe("Per-tool permission overrides"),
});

export const updateAssigneeSchema = insertAssigneeSchema.partial();

// ---- Email Inbox ----

const emailAttachmentSchema = z.object({
  type: z.enum(["image", "pdf", "file", "audio"]).describe("Attachment type"),
  url: z.string().url().describe("S3 URL of the attachment"),
  name: z.string().describe("Original filename"),
});

export const selectEmailSchema = z.object({
  id: z.string().describe("Unique identifier"),
  emailId: z.string().describe("Unique email ID"),
  userId: z.string().describe("Owner user ID"),
  assigneeId: z.string().nullable().describe("Assigned assistant ID"),
  fromEmail: z.string().describe("Sender email address"),
  fromName: z.string().nullable().describe("Sender display name"),
  toEmail: z.string().describe("Recipient email address"),
  subject: z.string().nullable().describe("Email subject line"),
  textBody: z.string().nullable().describe("Email plain text body"),
  htmlBody: z.string().nullable().describe("Email HTML body"),
  receivedAt: z.string().describe("When the email was received"),
  isRead: z.boolean().nullable().describe("Whether the email has been read"),
  attachments: z
    .array(emailAttachmentSchema)
    .nullable()
    .describe("Email attachments"),
  metadata: z.record(z.unknown()).nullable().describe("Additional metadata"),
});

export const insertEmailSchema = z.object({
  emailId: z.string().describe("Unique email ID"),
  assigneeId: z
    .string()
    .nullable()
    .optional()
    .describe("Assigned assistant ID"),
  fromEmail: z.string().email().describe("Sender email address"),
  fromName: z.string().nullable().optional().describe("Sender display name"),
  toEmail: z.string().email().describe("Recipient email address"),
  subject: z
    .string()
    .max(500)
    .nullable()
    .optional()
    .describe("Email subject line"),
  textBody: z.string().nullable().optional().describe("Email plain text body"),
  htmlBody: z.string().nullable().optional().describe("Email HTML body"),
  receivedAt: z.string().describe("When the email was received"),
  isRead: z.boolean().optional().describe("Whether the email has been read"),
  attachments: z
    .array(emailAttachmentSchema)
    .nullable()
    .optional()
    .describe("Email attachments"),
  metadata: z
    .record(z.unknown())
    .nullable()
    .optional()
    .describe("Additional metadata"),
});

export const updateEmailSchema = z.object({
  isRead: z.boolean().optional().describe("Whether the email has been read"),
  metadata: z.record(z.unknown()).optional().describe("Additional metadata"),
  assigneeId: z
    .string()
    .optional()
    .nullable()
    .describe("Assigned assistant ID"),
});

// ---- Resend Webhook ----

export const resendWebhookAttachmentSchema = z.object({
  id: z.string().optional().describe("Attachment ID from Resend"),
  filename: z.string().describe("Attachment filename"),
  content_type: z.string().describe("MIME type of the attachment"),
  content_id: z.string().optional().describe("Content ID for inline images"),
  content_disposition: z.string().nullable().optional().describe("Content disposition"),
  size: z.number().optional().describe("File size in bytes"),
  url: z
    .string()
    .url()
    .optional()
    .describe("Temporary download URL from Resend"),
});

export const resendEmailReceivedDataSchema = z.object({
  email_id: z.string().describe("Email ID for retrieving full content"),
  to: z.array(z.string().email()).describe("Recipient email addresses"),
  from: z.string().describe("Sender email address"),
  from_name: z.string().nullable().optional().describe("Sender display name"),
  subject: z.string().nullable().optional().describe("Email subject line"),
  html: z.string().nullable().optional().describe("HTML body content"),
  text: z.string().nullable().optional().describe("Plain text body content"),
  message_id: z.string().describe("Message identifier"),
  headers: z.record(z.unknown()).optional().describe("Email headers"),
  attachments: z
    .array(resendWebhookAttachmentSchema)
    .optional()
    .describe("Email attachments"),
});

export const resendWebhookPayloadSchema = z.object({
  type: z.string().describe("Event type (e.g., email.received)"),
  data: resendEmailReceivedDataSchema.describe("Email data payload"),
});

// ---- Tasks ----

export const selectTaskSchema = z.object({
  id: z.string().describe("Unique identifier"),
  userId: z.string().describe("Owner user ID"),
  assigneeId: z.string().nullable().describe("Linked assignee ID"),
  title: z.string().describe("Task title"),
  description: z.string().nullable().describe("Detailed task description"),
  status: z.string().nullable().describe("Current status"),
  tags: z.array(z.string()).nullable().describe("Freeform tags"),
  categories: z.array(z.string()).nullable().describe("Category labels"),
  cronSchedule: z.string().nullable().describe("Cron expression e.g. '0 9 * * *'"),
  isCronEnabled: z.boolean().nullable().describe("Whether cron scheduling is active"),
  nextRunAt: z.number().nullable().optional().describe("Seconds from now until next scheduled run (null if cron disabled or no schedule, omitted on write responses)"),
  createdAt: z.string().nullable().describe("Creation timestamp"),
  updatedAt: z.string().nullable().describe("Last update timestamp"),
});

export const insertTaskSchema = z.object({
  assigneeId: z.string().optional().nullable().describe("Linked assignee ID"),
  title: z.string().min(1).max(200).describe("Task title"),
  description: z
    .string()
    .max(5000)
    .optional()
    .describe("Detailed task description"),
  tags: z.array(z.string()).optional().describe("Freeform tags"),
  categories: z.array(z.string()).optional().describe("Category labels"),
  cronSchedule: z
    .string()
    .optional()
    .nullable()
    .refine((val) => !val || isValidCronExpression(val), {
      message: "Invalid cron expression",
    })
    .describe("Cron expression e.g. '0 9 * * *'"),
  isCronEnabled: z.boolean().optional().describe("Enable cron scheduling"),
});

export const updateTaskSchema = insertTaskSchema.partial();

// ---- Task Emails ----

export const selectTaskEmailSchema = z.object({
  id: z.string().describe("Unique identifier"),
  taskId: z.string().describe("Associated task ID"),
  emailId: z.string().describe("Associated email ID"),
});

export const insertTaskEmailSchema = z.object({
  taskId: z.string().describe("Associated task ID"),
  emailId: z.string().describe("Associated email ID"),
});

// ---- Chat Messages (AI SDK v6 ModelMessage format) ----

const textPartSchema = z.object({
  type: z.literal("text").describe("Text content part"),
  text: z.string().describe("Text content"),
});

const imagePartSchema = z.object({
  type: z.literal("image").describe("Image content part"),
  image: z.string().describe("Image URL or base64 data"),
  mimeType: z.string().optional().describe("Image MIME type"),
});

const filePartSchema = z.object({
  type: z.literal("file").describe("File content part"),
  data: z.string().describe("File URL or base64 data"),
  mimeType: z.string().describe("File MIME type"),
});

const toolCallConfirmationSchema = z.object({
  id: z.string().describe("Confirmation record ID"),
  status: z.string().describe("pending, confirmed, or rejected"),
});

const toolCallPartSchema = z.object({
  type: z.literal("tool-call").describe("Tool call part"),
  toolCallId: z.string().describe("Unique tool call identifier"),
  toolName: z.string().describe("Name of the tool being called"),
  input: z.record(z.unknown()).describe("Tool call input parameters"),
  confirmation: toolCallConfirmationSchema
    .optional()
    .describe("Confirmation info if this tool call requires manual approval"),
  error: z
    .string()
    .optional()
    .describe("Error message if the tool call failed"),
});

const toolResultPartSchema = z.object({
  type: z.literal("tool-result").describe("Tool result part"),
  toolCallId: z.string().describe("Matching tool call identifier"),
  toolName: z.string().describe("Name of the tool"),
  output: z.unknown().describe("Tool execution output"),
  approveStatus: z
    .enum(["auto-approved", "confirmed", "rejected"])
    .optional()
    .describe(
      "Approval status — present for tools that went through the permission system",
    ),
  isError: z
    .boolean()
    .optional()
    .describe("Whether this tool result is an error"),
});

const toolApprovalRequestPartSchema = z.object({
  type: z
    .literal("tool-approval-request")
    .describe("Tool approval request part"),
  approvalId: z.string().describe("Unique approval request ID"),
  toolCallId: z.string().describe("Tool call that requires approval"),
});

const toolApprovalResponsePartSchema = z.object({
  type: z
    .literal("tool-approval-response")
    .describe("Tool approval response part"),
  approvalId: z.string().describe("Matching approval request ID"),
  approved: z.boolean().describe("Whether the tool call was approved"),
  reason: z.string().optional().describe("Reason for denial"),
});

const contentPartSchema = z.discriminatedUnion("type", [
  textPartSchema,
  imagePartSchema,
  filePartSchema,
  toolCallPartSchema,
  toolResultPartSchema,
  toolApprovalRequestPartSchema,
  toolApprovalResponsePartSchema,
]);

export const chatMessageSchema = z.object({
  id: z.string().optional().describe("Unique message identifier"),
  role: z
    .enum(["system", "user", "assistant", "tool"])
    .describe("Message role"),
  content: z
    .union([z.string(), z.array(contentPartSchema)])
    .describe(
      "Message content — string for simple text, array of parts for rich content",
    ),
  seq: z
    .number()
    .optional()
    .describe("Message sequence number within the session, used for ordering"),
  isCompacted: z
    .boolean()
    .optional()
    .describe("Whether the message has been compacted (summarized for AI context). Compacted messages are preserved for user history but not sent to the AI agent."),
});

// ---- Chat Sessions ----

export const selectChatSessionSchema = z.object({
  id: z.string().describe("Unique identifier"),
  userId: z.string().describe("Owner user ID"),
  taskId: z.string().nullable().describe("Associated task ID"),
  assigneeId: z.string().nullable().describe("Associated assignee ID"),
  title: z.string().nullable().describe("Session title"),
  status: z.string().nullable().describe("Current session status"),
  assignee: z
    .object({
      id: z.string().describe("Assignee ID"),
      name: z.string().describe("Assignee display name"),
    })
    .nullable()
    .optional()
    .describe("Resolved assignee info"),
  messages: z
    .array(z.any())
    .optional()
    .describe("Session messages (included in detail view)"),
  createdAt: z.string().nullable().describe("Creation timestamp"),
  updatedAt: z.string().nullable().describe("Last update timestamp"),
});

export const selectMessageSchema = z.object({
  id: z.string().describe("Unique message identifier"),
  chatSessionId: z.string().describe("Parent chat session ID"),
  seq: z.number().describe("0-based ordering within session"),
  role: z
    .enum(["system", "user", "assistant", "tool"])
    .describe("Message role"),
  content: z
    .union([z.string(), z.array(contentPartSchema), z.null()])
    .describe(
      "Message content — string for simple text, array of parts for rich content",
    ),
  createdAt: z.string().nullable().describe("Creation timestamp"),
});

export const insertChatSessionSchema = z.object({
  taskId: z.string().nullable().optional().describe("Associated task ID"),
  assigneeId: z
    .string()
    .nullable()
    .optional()
    .describe("Associated assignee ID"),
  title: z.string().max(200).optional().describe("Session title"),
  status: z
    .enum(["starting", "in_progress", "waiting_confirmation", "stopped"])
    .optional()
    .describe("Initial session status"),
});

export const updateChatSessionSchema = z.object({
  title: z.string().max(200).optional().describe("Session title"),
  assigneeId: z
    .string()
    .optional()
    .nullable()
    .describe("Associated assignee ID"),
});

// ---- Confirmations ----

export const selectConfirmationSchema = z.object({
  id: z.string().describe("Unique identifier"),
  userId: z.string().describe("Owner user ID"),
  chatSessionId: z.string().describe("Associated chat session ID"),
  toolCallId: z.string().describe("Tool call that triggered this confirmation"),
  toolName: z.string().describe("Name of the tool requiring confirmation"),
  approvalId: z
    .string()
    .describe("SDK approval ID for tool-approval-response matching"),
  parameters: z.record(z.unknown()).nullable().describe("Tool call parameters"),
  status: z
    .string()
    .nullable()
    .describe("Confirmation status (pending/confirmed/rejected)"),
  createdAt: z.string().nullable().describe("Creation timestamp"),
  resolvedAt: z
    .string()
    .nullable()
    .describe("When the confirmation was resolved"),
});

export const resolveConfirmationSchema = z.object({
  action: z
    .enum(["confirm", "reject"])
    .describe("Whether to confirm or reject the tool call"),
  alwaysAllow: z
    .boolean()
    .optional()
    .describe(
      "If true, update assignee permissions to auto-confirm this tool in the future",
    ),
});

// ---- Documents ----

export const selectDocumentSchema = z.object({
  id: z.string().describe("Unique identifier"),
  userId: z.string().describe("Owner user ID"),
  chatSessionId: z.string().describe("Associated chat session ID"),
  title: z.string().describe("Document title"),
  format: z
    .enum(["markdown", "html"])
    .describe("Content format: markdown or html"),
  content: z.string().describe("Document content"),
  createdAt: z.string().nullable().describe("Creation timestamp"),
  updatedAt: z.string().nullable().describe("Last update timestamp"),
});

export const insertDocumentSchema = z.object({
  chatSessionId: z.string().describe("Associated chat session ID"),
  title: z.string().max(500).describe("Document title"),
  format: z
    .enum(["markdown", "html"])
    .describe("Content format: markdown or html"),
  content: z.string().describe("Document content"),
});

export const updateDocumentSchema = z.object({
  title: z.string().max(500).optional().describe("Updated document title"),
  content: z.string().optional().describe("Updated document content"),
});

// ---- Devices ----

export const selectDeviceSchema = z.object({
  id: z.string().describe("Unique identifier"),
  userId: z.string().describe("Owner user ID"),
  deviceToken: z.string().describe("APNs device token"),
  platform: z.string().describe("Device platform"),
  createdAt: z.string().nullable().describe("Registration timestamp"),
});

export const insertDeviceSchema = z.object({
  deviceToken: z.string().min(1).describe("APNs device token"),
  platform: z.string().min(1).describe("Device platform"),
});

// ---- Send message ----

export const sendMessageSchema = z.object({
  content: z.string().min(1).describe("Message text content"),
  attachments: z
    .array(
      z.object({
        type: z
          .enum(["image", "audio", "pdf", "file"])
          .describe("Attachment media type"),
        url: z.string().url().describe("Attachment URL"),
        name: z.string().optional().describe("Attachment filename"),
      }),
    )
    .optional()
    .describe("File attachments"),
});

// ---- Onboard ----

export const onboardResponseSchema = z.object({
  assignee: z
    .object({
      check: z.boolean().describe("Whether an assignee exists"),
      required: z.array(z.string()).optional().describe("Missing setup steps"),
    })
    .describe("Assignee onboarding status"),
  device: z
    .object({
      check: z
        .boolean()
        .describe(
          "Whether the specified device token is registered (false if deviceToken query param not provided)",
        ),
    })
    .describe("Device registration status"),
  overall: z.boolean().describe("Whether onboarding is complete"),
});

// ---- Presigned URL ----

export const presignedUrlSchema = z.object({
  contentType: z.string().min(1).describe("MIME type of the file to upload"),
  prefix: z.string().optional().describe("Optional S3 key prefix"),
});

export const presignedUrlResponseSchema = z.object({
  url: z.string().describe("Presigned upload URL"),
  key: z.string().describe("S3 object key"),
});

// ---- SSE Stream Events ----

export const streamEventSchema = z.object({
  id: z
    .string()
    .describe(
      "Message ID — all events from the same agent step share this, matching the stored message's id for deduplication",
    ),
  type: z
    .enum([
      "status",
      "text-delta",
      "tool-call",
      "tool-result",
      "confirmation_required",
      "user-message",
      "error",
      "done",
    ])
    .describe("Event type"),
  status: z.string().optional().describe("Session status (for status events)"),
  text: z.string().optional().describe("Text content (for text-delta events)"),
  toolCallId: z.string().optional().describe("Tool call identifier"),
  toolName: z.string().optional().describe("Name of the tool"),
  input: z
    .record(z.unknown())
    .optional()
    .describe("Tool call input parameters"),
  output: z.record(z.unknown()).optional().describe("Tool result output"),
  parameters: z
    .record(z.unknown())
    .optional()
    .describe("Parameters awaiting confirmation"),
  error: z
    .string()
    .optional()
    .describe("Error message (for error events or tool-result errors)"),
  isError: z
    .boolean()
    .optional()
    .describe("Whether this tool result is an error"),
});

// ---- Common path params ----

export const idParamSchema = z.object({
  id: z.string().describe("Resource ID"),
});

export const assigneeIdParamSchema = z.object({
  assigneeId: z.string().describe("Assignee ID"),
});

// ---- Chat Messages (cursor-paginated) ----

export const chatMessagesResponseSchema = z.object({
  messages: z
    .array(chatMessageSchema)
    .describe("Messages in chronological order"),
  nextCursor: z
    .string()
    .nullable()
    .describe(
      "Cursor for loading older messages (pass as 'before' query param). Null if no more messages.",
    ),
});

// ---- Common response schemas ----

export const deletedResponseSchema = z.object({
  deleted: z.boolean().describe("Whether the resource was deleted"),
});

export const queuedResponseSchema = z.object({
  queued: z.boolean().describe("Whether the message was queued for processing"),
  messageId: z.string().describe("The ID of the stored user message"),
});

export const receivedResponseSchema = z.object({
  received: z.boolean().describe("Whether the webhook was received"),
});

export const resolveResponseSchema = z.object({
  action: z.enum(["confirm", "reject"]).describe("Action taken"),
  confirmationId: z.string().describe("Confirmation ID that was resolved"),
});
