import { z } from "zod";
import { availableModelSchema, DEFAULT_MODEL } from "@/lib/ai/models";
import { isValidCronExpression } from "@/lib/utils/cron";

// Tool condition schemas — discriminated by parameterType
const stringConditionSchema = z.object({
  parameterName: z.string().describe("Name of the parameter to check"),
  parameterType: z.literal("string"),
  operator: z
    .enum(["startsWith", "endsWith", "contains", "equals", "regex"])
    .describe("Comparison operator"),
  value: z.string().describe("Value to compare against"),
});

const numberConditionSchema = z.object({
  parameterName: z.string().describe("Name of the parameter to check"),
  parameterType: z.literal("number"),
  operator: z.enum(["gt", "gte", "lt", "lte", "regex"]).describe("Comparison operator"),
  value: z
    .union([z.number(), z.string()])
    .describe("Number for comparison or string for regex pattern"),
});

const booleanConditionSchema = z.object({
  parameterName: z.string().describe("Name of the parameter to check"),
  parameterType: z.literal("boolean"),
  operator: z.enum(["isTrue", "isFalse"]).describe("Boolean check operator"),
});

const arrayConditionSchema = z.object({
  parameterName: z.string().describe("Name of the parameter to check"),
  parameterType: z.literal("array"),
  operator: z
    .enum(["contains", "equals", "lengthGt", "lengthLt", "lengthGte", "lengthLte"])
    .describe("Array comparison operator"),
  value: z
    .union([z.string(), z.array(z.string()), z.number()])
    .describe("String for contains, string[] for equals, number for length ops"),
});

export const toolConditionSchema = z.discriminatedUnion("parameterType", [
  stringConditionSchema,
  numberConditionSchema,
  booleanConditionSchema,
  arrayConditionSchema,
]);

// Tool permissions
export const toolPermissionSchema = z.object({
  toolName: z.string().describe("Name of the tool"),
  permission: z
    .enum(["auto-confirm", "manual-confirm", "auto-reject", "disabled"])
    .describe("Permission level for the tool"),
  conditions: z
    .array(toolConditionSchema)
    .optional()
    .describe("Conditions for conditional auto-confirm"),
  conditionLogic: z
    .enum(["and", "or"])
    .optional()
    .describe("Logic operator for combining conditions (default: and)"),
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
  personality: z.string().max(2000).optional().describe("System prompt personality"),
  model: availableModelSchema.catch(DEFAULT_MODEL).optional().describe("AI model to use"),
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
  attachments: z.array(emailAttachmentSchema).nullable().describe("Email attachments"),
  metadata: z.record(z.unknown()).nullable().describe("Additional metadata"),
});

export const insertEmailSchema = z.object({
  emailId: z.string().describe("Unique email ID"),
  assigneeId: z.string().nullable().optional().describe("Assigned assistant ID"),
  fromEmail: z.string().email().describe("Sender email address"),
  fromName: z.string().nullable().optional().describe("Sender display name"),
  toEmail: z.string().email().describe("Recipient email address"),
  subject: z.string().max(500).nullable().optional().describe("Email subject line"),
  textBody: z.string().nullable().optional().describe("Email plain text body"),
  htmlBody: z.string().nullable().optional().describe("Email HTML body"),
  receivedAt: z.string().describe("When the email was received"),
  isRead: z.boolean().optional().describe("Whether the email has been read"),
  attachments: z.array(emailAttachmentSchema).nullable().optional().describe("Email attachments"),
  metadata: z.record(z.unknown()).nullable().optional().describe("Additional metadata"),
});

export const updateEmailSchema = z.object({
  isRead: z.boolean().optional().describe("Whether the email has been read"),
  metadata: z.record(z.unknown()).optional().describe("Additional metadata"),
  assigneeId: z.string().optional().nullable().describe("Assigned assistant ID"),
});

// ---- Webhook Inbox ----

export const selectWebhookSchema = z.object({
  id: z.string().describe("Unique identifier"),
  userId: z.string().describe("Owner user ID"),
  source: z.string().describe("Webhook source (e.g. github, stripe, custom)"),
  event: z.string().nullable().describe("Event type (e.g. push, payment.succeeded)"),
  summary: z.string().nullable().describe("Human-readable summary"),
  payload: z.record(z.unknown()).nullable().describe("Raw webhook payload"),
  receivedAt: z.string().describe("When the webhook was received"),
  isRead: z.boolean().nullable().describe("Whether the webhook has been read"),
  metadata: z.record(z.unknown()).nullable().describe("Additional metadata"),
});

export const insertWebhookSchema = z.object({
  source: z.string().min(1).describe("Webhook source (e.g. github, stripe, custom)"),
  event: z.string().nullable().optional().describe("Event type"),
  summary: z.string().nullable().optional().describe("Human-readable summary"),
  payload: z.record(z.unknown()).nullable().optional().describe("Raw webhook payload"),
  receivedAt: z.string().describe("When the webhook was received"),
  isRead: z.boolean().optional().describe("Whether the webhook has been read"),
  metadata: z.record(z.unknown()).nullable().optional().describe("Additional metadata"),
});

export const updateWebhookSchema = z.object({
  isRead: z.boolean().optional().describe("Whether the webhook has been read"),
  metadata: z.record(z.unknown()).optional().describe("Additional metadata"),
});

// ---- Resend Webhook ----

export const resendWebhookAttachmentSchema = z.object({
  id: z.string().optional().describe("Attachment ID from Resend"),
  filename: z.string().describe("Attachment filename"),
  content_type: z.string().describe("MIME type of the attachment"),
  content_id: z.string().optional().describe("Content ID for inline images"),
  content_disposition: z.string().nullable().optional().describe("Content disposition"),
  size: z.number().optional().describe("File size in bytes"),
  url: z.string().url().optional().describe("Temporary download URL from Resend"),
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
  attachments: z.array(resendWebhookAttachmentSchema).optional().describe("Email attachments"),
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
  source: z.string().nullable().describe("Task creation source: manual, agent, or email"),
  tags: z.array(z.string()).nullable().describe("Freeform tags"),
  categories: z.array(z.string()).nullable().describe("Category labels"),
  cronSchedule: z.string().nullable().describe("Cron expression e.g. '0 9 * * *'"),
  isCronEnabled: z.boolean().nullable().describe("Whether cron scheduling is active"),
  runsAt: z.string().nullable().describe("ISO datetime for one-shot scheduled execution"),
  timezone: z
    .string()
    .nullable()
    .optional()
    .describe("IANA timezone (e.g. 'America/New_York') for interpreting schedule times"),
  toolPermissions: z
    .array(toolPermissionSchema)
    .nullable()
    .optional()
    .describe("Per-tool permission overrides inherited from assignee"),
  liveActivityEnabled: z
    .boolean()
    .nullable()
    .optional()
    .describe("Whether to show a Live Activity for this task while it is running"),
  nextRunAt: z
    .number()
    .nullable()
    .optional()
    .describe(
      "Seconds from now until next scheduled run (null if cron disabled or no schedule, omitted on write responses)",
    ),
  createdAt: z.string().nullable().describe("Creation timestamp"),
  updatedAt: z.string().nullable().describe("Last update timestamp"),
});

export const taskSourceSchema = z.enum(["manual", "agent", "email", "webhook"]);

/** Accepted values for the `source` query filter — includes "inbox" which maps to email+webhook. */
export const taskSourceFilterSchema = z.enum(["manual", "agent", "email", "webhook", "inbox"]);

export const insertTaskSchema = z
  .object({
    assigneeId: z.string().optional().nullable().describe("Linked assignee ID"),
    title: z.string().min(1).max(200).describe("Task title"),
    description: z.string().max(5000).optional().describe("Detailed task description"),
    source: taskSourceSchema.optional().describe("Task creation source (defaults to manual)"),
    emailId: z
      .string()
      .optional()
      .describe("Email ID to link this task to (auto-sets source to email)"),
    execute: z
      .boolean()
      .optional()
      .describe("If true, immediately trigger task execution after creation"),
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
    runsAt: z
      .string()
      .datetime({ offset: true })
      .optional()
      .nullable()
      .describe("ISO datetime for one-shot scheduled execution"),
    timezone: z
      .string()
      .optional()
      .nullable()
      .describe("IANA timezone (e.g. 'America/New_York') for interpreting schedule times"),
    liveActivityEnabled: z
      .boolean()
      .optional()
      .describe("Whether to show a Live Activity for this task while it is running (default true)"),
  })
  .refine((data) => !(data.isCronEnabled && data.runsAt), {
    message: "A task cannot have both cron scheduling and a one-shot runsAt schedule",
    path: ["runsAt"],
  })
  .refine((data) => !data.isCronEnabled || (data.cronSchedule && data.cronSchedule.trim() !== ""), {
    message: "A cron expression is required when cron scheduling is enabled",
    path: ["cronSchedule"],
  });

export const updateTaskSchema = z
  .object({
    assigneeId: z.string().optional().nullable().describe("Linked assignee ID"),
    title: z.string().min(1).max(200).optional().describe("Task title"),
    description: z.string().max(5000).optional().describe("Detailed task description"),
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
    runsAt: z
      .string()
      .datetime({ offset: true })
      .optional()
      .nullable()
      .describe("ISO datetime for one-shot scheduled execution"),
    timezone: z
      .string()
      .optional()
      .nullable()
      .describe("IANA timezone (e.g. 'America/New_York') for interpreting schedule times"),
    toolPermissions: z
      .array(toolPermissionSchema)
      .optional()
      .nullable()
      .describe("Per-tool permission overrides for this task"),
    liveActivityEnabled: z
      .boolean()
      .optional()
      .describe("Whether to show a Live Activity for this task while it is running"),
  })
  .refine((data) => !(data.isCronEnabled && data.runsAt), {
    message: "A task cannot have both cron scheduling and a one-shot runsAt schedule",
    path: ["runsAt"],
  })
  .refine(
    (data) => {
      // Only validate when both fields are present in the update payload
      if (data.isCronEnabled === undefined || data.cronSchedule === undefined) return true;
      return !data.isCronEnabled || (data.cronSchedule !== null && data.cronSchedule.trim() !== "");
    },
    {
      message: "A cron expression is required when cron scheduling is enabled",
      path: ["cronSchedule"],
    },
  );

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
  error: z.string().optional().describe("Error message if the tool call failed"),
});

const toolResultPartSchema = z.object({
  type: z.literal("tool-result").describe("Tool result part"),
  toolCallId: z.string().describe("Matching tool call identifier"),
  toolName: z.string().describe("Name of the tool"),
  output: z.unknown().describe("Tool execution output"),
  approveStatus: z
    .enum(["auto-approved", "confirmed", "rejected"])
    .optional()
    .describe("Approval status — present for tools that went through the permission system"),
  isError: z.boolean().optional().describe("Whether this tool result is an error"),
});

const toolApprovalRequestPartSchema = z.object({
  type: z.literal("tool-approval-request").describe("Tool approval request part"),
  approvalId: z.string().describe("Unique approval request ID"),
  toolCallId: z.string().describe("Tool call that requires approval"),
});

const toolApprovalResponsePartSchema = z.object({
  type: z.literal("tool-approval-response").describe("Tool approval response part"),
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
  role: z.enum(["system", "user", "assistant", "tool"]).describe("Message role"),
  content: z
    .union([z.string(), z.array(contentPartSchema)])
    .describe("Message content — string for simple text, array of parts for rich content"),
  seq: z
    .number()
    .optional()
    .describe("Message sequence number within the session, used for ordering"),
  isCompacted: z
    .boolean()
    .optional()
    .describe(
      "Whether the message has been compacted (summarized for AI context). Compacted messages are preserved for user history but not sent to the AI agent.",
    ),
  createdAt: z
    .string()
    .nullable()
    .optional()
    .describe("Server-side timestamp the message was persisted at (ISO 8601, UTC)."),
});

// ---- Chat Sessions ----

export const selectChatSessionSchema = z.object({
  id: z.string().describe("Unique identifier"),
  userId: z.string().describe("Owner user ID"),
  taskId: z.string().nullable().describe("Associated task ID"),
  assigneeId: z.string().nullable().describe("Associated assignee ID"),
  title: z.string().nullable().describe("Session title"),
  status: z.string().nullable().describe("Current session status"),
  timezone: z
    .string()
    .nullable()
    .optional()
    .describe("IANA timezone of the user (e.g. 'America/New_York')"),
  assignee: z
    .object({
      id: z.string().describe("Assignee ID"),
      name: z.string().describe("Assignee display name"),
    })
    .nullable()
    .optional()
    .describe("Resolved assignee info"),
  messages: z.array(z.any()).optional().describe("Session messages (included in detail view)"),
  createdAt: z.string().nullable().describe("Creation timestamp"),
  updatedAt: z.string().nullable().describe("Last update timestamp"),
});

export const selectMessageSchema = z.object({
  id: z.string().describe("Unique message identifier"),
  chatSessionId: z.string().describe("Parent chat session ID"),
  seq: z.number().describe("0-based ordering within session"),
  role: z.enum(["system", "user", "assistant", "tool"]).describe("Message role"),
  content: z
    .union([z.string(), z.array(contentPartSchema), z.null()])
    .describe("Message content — string for simple text, array of parts for rich content"),
  createdAt: z.string().nullable().describe("Creation timestamp"),
});

export const insertChatSessionSchema = z.object({
  taskId: z.string().nullable().optional().describe("Associated task ID"),
  assigneeId: z.string().nullable().optional().describe("Associated assignee ID"),
  title: z.string().max(200).optional().describe("Session title"),
  status: z
    .enum(["starting", "in_progress", "waiting_confirmation", "stopped"])
    .optional()
    .describe("Initial session status"),
});

export const updateChatSessionSchema = z.object({
  title: z.string().max(200).optional().describe("Session title"),
  assigneeId: z.string().optional().nullable().describe("Associated assignee ID"),
});

// ---- Confirmations ----

export const selectConfirmationSchema = z.object({
  id: z.string().describe("Unique identifier"),
  userId: z.string().describe("Owner user ID"),
  chatSessionId: z.string().describe("Associated chat session ID"),
  toolCallId: z.string().describe("Tool call that triggered this confirmation"),
  toolName: z.string().describe("Name of the tool requiring confirmation"),
  approvalId: z.string().describe("SDK approval ID for tool-approval-response matching"),
  parameters: z.record(z.unknown()).nullable().describe("Tool call parameters"),
  status: z.string().nullable().describe("Confirmation status (pending/confirmed/rejected)"),
  createdAt: z.string().nullable().describe("Creation timestamp"),
  resolvedAt: z.string().nullable().describe("When the confirmation was resolved"),
});

export const resolveConfirmationSchema = z.object({
  action: z.enum(["confirm", "reject"]).describe("Whether to confirm or reject the tool call"),
  alwaysAllow: z
    .boolean()
    .optional()
    .describe("If true, update assignee permissions to auto-confirm this tool in the future"),
});

// ---- Questions ----

export const questionItemSchema = z.object({
  title: z.string().describe("The question text"),
  description: z.string().optional().describe("Additional context for the question"),
  type: z
    .enum(["boolean", "multiple_choice", "single_choice", "fill_in_blank"])
    .describe("Question type"),
  options: z
    .array(
      z.object({
        title: z.string().describe("Option label"),
        description: z.string().optional().describe("Option description"),
      }),
    )
    .optional()
    .describe("Available options for choice-type questions"),
});

export const questionAnswerSchema = z.object({
  questionIndex: z.number().describe("Index of the question being answered"),
  answer: z.union([z.string(), z.array(z.string()), z.boolean()]).describe("The answer value"),
});

export const selectQuestionSchema = z.object({
  id: z.string().describe("Unique identifier"),
  userId: z.string().describe("Owner user ID"),
  chatSessionId: z.string().describe("Associated chat session ID"),
  toolCallId: z.string().describe("Tool call that triggered this question"),
  toolName: z.string().describe("Name of the tool (ask_question)"),
  approvalId: z.string().describe("SDK approval ID for tool-approval-response matching"),
  questionsData: z.array(questionItemSchema).nullable().describe("The questions asked"),
  answers: z.array(questionAnswerSchema).nullable().describe("User's answers"),
  status: z.string().nullable().describe("Question status (pending/answered/rejected)"),
  createdAt: z.string().nullable().describe("Creation timestamp"),
  answeredAt: z.string().nullable().describe("When the question was answered"),
});

export const answerQuestionSchema = z.object({
  action: z.enum(["answer", "reject"]).describe("Whether to answer or reject the questions"),
  answers: z
    .array(questionAnswerSchema)
    .optional()
    .describe("Answers to the questions (required when action is 'answer')"),
});

export const answerQuestionResponseSchema = z.object({
  action: z.enum(["answered", "rejected"]).describe("Action taken"),
  questionId: z.string().describe("Question ID that was resolved"),
});

// ---- Documents ----

export const selectDocumentSchema = z.object({
  id: z.string().describe("Unique identifier"),
  userId: z.string().describe("Owner user ID"),
  chatSessionId: z.string().describe("Associated chat session ID"),
  title: z.string().describe("Document title"),
  format: z.enum(["markdown", "html"]).describe("Content format: markdown or html"),
  content: z.string().describe("Document content"),
  createdAt: z.string().nullable().describe("Creation timestamp"),
  updatedAt: z.string().nullable().describe("Last update timestamp"),
});

export const insertDocumentSchema = z.object({
  chatSessionId: z.string().describe("Associated chat session ID"),
  title: z.string().max(500).describe("Document title"),
  format: z.enum(["markdown", "html"]).describe("Content format: markdown or html"),
  content: z.string().describe("Document content"),
});

export const updateDocumentSchema = z.object({
  title: z.string().max(500).optional().describe("Updated document title"),
  content: z.string().optional().describe("Updated document content"),
});

export const documentSummarySchema = z.object({
  id: z.string().describe("Unique identifier"),
  title: z.string().describe("Document title"),
  format: z.enum(["markdown", "html"]).describe("Content format: markdown or html"),
  chatSessionId: z.string().describe("Associated chat session ID"),
  createdAt: z.string().nullable().describe("Creation timestamp"),
  updatedAt: z.string().nullable().describe("Last update timestamp"),
});

// ---- Audios ----

export const selectAudioSchema = z.object({
  id: z.string().describe("Unique identifier"),
  userId: z.string().describe("Owner user ID"),
  chatSessionId: z.string().describe("Associated chat session ID"),
  title: z.string().describe("Audio title"),
  type: z.string().describe("Audio type (e.g. 'podcast')"),
  prompt: z.string().describe("Prompt steering the generation"),
  content: z.string().describe("Source content converted to audio"),
  audioUrl: z.string().nullable().describe("URL of the generated MP3 (null until ready)"),
  status: z.string().describe("'generating' | 'ready' | 'failed'"),
  errorMessage: z.string().nullable().describe("Error message when status is 'failed'"),
  transcript: z
    .string()
    .nullable()
    .describe(
      "JSON-encoded array of { speaker, voiceShortName, locale, text } produced by the podcast agent",
    ),
  createdAt: z.string().nullable().describe("Creation timestamp"),
  updatedAt: z.string().nullable().describe("Last update timestamp"),
});

// ---- Briefings ----

export const podcastStatusSchema = z
  .enum(["pending", "generating", "ready", "failed"])
  .describe("Podcast generation lifecycle state");

export const selectBriefingSchema = z.object({
  id: z.string().describe("Unique identifier"),
  userId: z.string().describe("Owner user ID"),
  chatSessionId: z.string().nullable().describe("Associated chat session ID"),
  assigneeId: z.string().nullable().describe("Associated assignee ID"),
  title: z.string().describe("Briefing title"),
  content: z.string().describe("Briefing markdown content"),
  imageUrl: z.string().nullable().describe("Cover image URL"),
  podcastUrl: z.string().nullable().describe("URL to generated podcast MP3"),
  podcastStatus: podcastStatusSchema.nullable(),
  podcastError: z.string().nullable().describe("Last error from a failed generation attempt"),
  podcastAttempts: z.number().nullable().describe("Number of generation attempts so far"),
  isPublic: z.boolean().nullable().describe("Whether the briefing is publicly shareable"),
  shareUrl: z.string().nullable().describe("Public share URL when isPublic is true"),
  documents: z.array(selectDocumentSchema).optional().describe("Linked documents"),
  createdAt: z.string().nullable().describe("Creation timestamp"),
  updatedAt: z.string().nullable().describe("Last update timestamp"),
});

export const briefingSummarySchema = z.object({
  id: z.string().describe("Unique identifier"),
  title: z.string().describe("Briefing title"),
  imageUrl: z.string().nullable().describe("Cover image URL"),
  podcastUrl: z.string().nullable().describe("URL to generated podcast MP3"),
  podcastStatus: podcastStatusSchema.nullable(),
  podcastError: z.string().nullable().describe("Last error from a failed generation attempt"),
  podcastAttempts: z.number().nullable().describe("Number of generation attempts so far"),
  isPublic: z.boolean().nullable().describe("Whether the briefing is publicly shareable"),
  shareUrl: z.string().nullable().describe("Public share URL when isPublic is true"),
  chatSessionId: z.string().nullable().describe("Associated chat session ID"),
  assigneeId: z.string().nullable().describe("Associated assignee ID"),
  createdAt: z.string().nullable().describe("Creation timestamp"),
  updatedAt: z.string().nullable().describe("Last update timestamp"),
});

export const insertBriefingSchema = z.object({
  title: z.string().min(1).max(500).describe("Briefing title"),
  content: z.string().describe("Briefing markdown content"),
  imageUrl: z.string().optional().describe("Cover image URL"),
  assigneeId: z.string().optional().describe("Associated assignee ID"),
  chatSessionId: z.string().optional().describe("Associated chat session ID"),
});

export const updateBriefingSchema = z.object({
  isPublic: z.boolean().describe("Whether the briefing should be publicly shareable"),
});

export const briefingSectionSchema = z.object({
  date: z.string().describe("Date in YYYY-MM-DD format"),
  briefings: z.array(selectBriefingSchema).describe("Briefings for this date"),
});

export const generateBriefingPodcastResponseSchema = z.object({
  status: z
    .enum(["queued", "already_running", "ready"])
    .describe(
      "Generation status: 'queued' when newly enqueued, 'already_running' when a job is in flight, 'ready' when the podcast already exists",
    ),
  briefingId: z.string().describe("Briefing id"),
  podcastUrl: z
    .string()
    .nullable()
    .describe("Existing podcast URL when status='ready', otherwise null"),
});

export const listBriefingResponseSchema = z.object({
  data: z.array(briefingSectionSchema),
  pagination: z.object({
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
    hasMore: z.boolean(),
  }),
});

// ---- Extensions ----

export const selectExtensionSchema = z.object({
  id: z.string().describe("Unique identifier"),
  userId: z.string().describe("Owner user ID or 'system'"),
  type: z.enum(["system", "user"]).describe("Extension type"),
  slug: z.string().describe("Unique slug identifier"),
  title: z.string().describe("Display title"),
  description: z.string().nullable().describe("Extension description"),
  imageUrl: z.string().nullable().describe("Extension icon/image URL"),
  mcpUrl: z.string().describe("MCP server URL"),
  prefix: z.string().describe("Tool name prefix"),
  authType: z.enum(["rxauth", "api_key", "none"]).describe("Authentication type"),
  createdAt: z.string().nullable().describe("Creation timestamp"),
  updatedAt: z.string().nullable().describe("Last update timestamp"),
});

export const insertExtensionSchema = z.object({
  title: z.string().min(1).max(200).describe("Display title"),
  description: z.string().max(1000).optional().describe("Extension description"),
  mcpUrl: z.string().url().describe("MCP server URL"),
  prefix: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9_]+$/, "Prefix must be lowercase alphanumeric with underscores")
    .describe("Tool name prefix (e.g. 'my_ext_')"),
  authType: z.enum(["rxauth", "api_key", "none"]).optional().describe("Authentication type"),
  authConfig: z.record(z.unknown()).optional().describe("Auth-specific configuration"),
});

export const extensionToolSchema = z.object({
  name: z.string().describe("Tool name (without prefix)"),
  description: z.string().describe("Tool description"),
  effectivePermission: z.string().optional().describe("Resolved effective permission"),
});

export const extensionWithStatusSchema = selectExtensionSchema.extend({
  enabled: z.boolean().describe("Whether this extension is enabled for the assignee"),
  toolPermissions: z
    .array(toolPermissionSchema)
    .nullable()
    .describe("Per-tool permission overrides"),
  tools: z.array(extensionToolSchema).optional().describe("Discovered tools from MCP server"),
});

export const assigneeExtensionSettingsSchema = z.object({
  enabled: z.boolean().describe("Whether to enable this extension"),
  toolPermissions: z
    .array(toolPermissionSchema)
    .optional()
    .describe("Per-tool permission overrides"),
});

export const taskExtensionSettingsSchema = z.object({
  enabled: z.boolean().describe("Whether to enable this extension for the task"),
  toolPermissions: z
    .array(toolPermissionSchema)
    .optional()
    .describe("Per-tool permission overrides for this task's extension"),
});

// ---- Devices ----

export const selectDeviceSchema = z.object({
  id: z.string().describe("Unique identifier"),
  userId: z.string().describe("Owner user ID"),
  deviceToken: z.string().describe("APNs device token"),
  platform: z.string().describe("Device platform"),
  liveActivityStartToken: z
    .string()
    .nullable()
    .optional()
    .describe("APNs push-to-start token for Live Activities (iOS 17.2+)"),
  createdAt: z.string().nullable().describe("Registration timestamp"),
});

export const insertDeviceSchema = z.object({
  deviceToken: z.string().min(1).describe("APNs device token"),
  platform: z.string().min(1).describe("Device platform"),
  liveActivityStartToken: z
    .string()
    .min(1)
    .nullable()
    .optional()
    .describe("APNs push-to-start token for Live Activities (iOS 17.2+)"),
});

// ---- Live Activities ----

export const liveActivityStatusSchema = z.enum([
  "starting",
  "inProgress",
  "waitingConfirmation",
  "completed",
  "failed",
]);

export const insertLiveActivityTokenSchema = z.object({
  activityId: z.string().min(1).describe("Activity instance identifier"),
  taskId: z.string().min(1).describe("Task this activity is bound to"),
  token: z.string().min(1).describe("Per-activity APNs push token (hex)"),
});

export const selectLiveActivityTokenSchema = z.object({
  id: z.string().describe("Unique identifier"),
  userId: z.string().describe("Owner user ID"),
  taskId: z.string().describe("Task this activity is bound to"),
  activityId: z.string().describe("Activity instance identifier"),
  token: z.string().describe("Per-activity APNs push token"),
  endedAt: z.string().nullable().describe("When the activity was ended (server-side)"),
  createdAt: z.string().nullable().describe("Registration timestamp"),
  updatedAt: z.string().nullable().describe("Last update timestamp"),
});

// ---- Send message ----

export const sendMessageSchema = z.object({
  content: z.string().min(1).describe("Message text content"),
  attachments: z
    .array(
      z.object({
        type: z.enum(["image", "audio", "pdf", "file"]).describe("Attachment media type"),
        url: z.string().url().describe("Attachment URL"),
        key: z.string().optional().describe("S3 object key"),
        name: z.string().optional().describe("Attachment filename"),
        mimeType: z.string().optional().describe("MIME type of the attachment"),
      }),
    )
    .optional()
    .describe("File attachments"),
  deviceToken: z
    .string()
    .optional()
    .describe("APNs device token of the sending device, used for targeted silent push"),
  timezone: z
    .string()
    .optional()
    .describe(
      "IANA timezone of the sender (e.g. 'America/New_York'), stored on the chat session for scheduling",
    ),
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
  extension: z
    .string()
    .optional()
    .describe("File extension to append to S3 key (e.g. 'md', 'pdf')"),
});

export const presignedUrlResponseSchema = z.object({
  url: z.string().describe("Presigned upload URL"),
  key: z.string().describe("S3 object key"),
  publicUrl: z.string().describe("Public URL for the uploaded object"),
});

// ---- Batch Presigned URLs ----

export const batchPresignedUrlSchema = z.object({
  extensions: z
    .array(z.string().min(1))
    .min(1)
    .max(10)
    .describe("File extensions for which to generate presigned upload URLs"),
});

export const batchPresignedUrlResponseSchema = z
  .array(
    z.object({
      url: z.string().describe("Presigned PUT URL"),
      key: z.string().describe("S3 object key"),
      extension: z.string().describe("File extension"),
    }),
  )
  .describe("Presigned upload URLs for the requested file extensions");

// ---- Upload Resolution ----

export const resolveUploadSchema = z.object({
  action: z.enum(["complete", "reject"]).describe("Whether user completed or rejected the upload"),
  uploadedKeys: z
    .array(z.string())
    .optional()
    .describe("S3 keys of uploaded files (required when action is 'complete')"),
});

export const resolveUploadResponseSchema = z.object({
  action: z.string().describe("Resolved status"),
  uploadId: z.string().describe("Upload record ID"),
});

export const uploadDownloadUrlSchema = z.object({
  key: z.string().describe("S3 object key"),
  url: z.string().describe("Presigned GET URL for downloading"),
  extension: z.string().describe("File extension"),
  mimeType: z.string().describe("MIME type from S3 object metadata"),
});

export const uploadDownloadUrlsResponseSchema = z
  .array(uploadDownloadUrlSchema)
  .describe("Presigned download URLs for completed uploads");

// ---- Upload Config ----

export const uploadConfigResponseSchema = z.object({
  maxSizeBytes: z.number().describe("Maximum file size in bytes"),
  acceptedExtensions: z.array(z.string()).describe("Accepted file extensions"),
  acceptedMimeTypes: z.array(z.string()).describe("Accepted MIME types"),
});

// ---- Delete Upload Object ----

export const deleteUploadObjectSchema = z.object({
  key: z.string().min(1).describe("S3 object key to delete"),
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
  input: z.record(z.unknown()).optional().describe("Tool call input parameters"),
  output: z.record(z.unknown()).optional().describe("Tool result output"),
  parameters: z.record(z.unknown()).optional().describe("Parameters awaiting confirmation"),
  error: z.string().optional().describe("Error message (for error events or tool-result errors)"),
  isError: z.boolean().optional().describe("Whether this tool result is an error"),
});

// ---- Usage ----

export const usageDailyEntrySchema = z.object({
  date: z.string().describe("Date in YYYY-MM-DD format"),
  inputTokens: z.number().describe("Total input tokens for the day"),
  outputTokens: z.number().describe("Total output tokens for the day"),
  costUsd: z.number().describe("Total cost in USD for the day"),
});

export const usageByAssigneeSchema = z.object({
  assigneeId: z.string().describe("Assignee ID"),
  assigneeName: z.string().describe("Assignee display name"),
  inputTokens: z.number().describe("Total input tokens for this assignee"),
  outputTokens: z.number().describe("Total output tokens for this assignee"),
  costUsd: z.number().describe("Total cost in USD for this assignee"),
});

export const usageTotalSchema = z.object({
  inputTokens: z.number().describe("Grand total input tokens"),
  outputTokens: z.number().describe("Grand total output tokens"),
  costUsd: z.number().describe("Grand total cost in USD"),
});

export const usageResponseSchema = z.object({
  daily: z.array(usageDailyEntrySchema).describe("Daily token usage breakdown"),
  byAssignee: z.array(usageByAssigneeSchema).describe("Token usage grouped by assignee"),
  total: usageTotalSchema.describe("Aggregate totals for the period"),
});

// ---- User Settings ----

export const selectUserSettingsSchema = z.object({
  id: z.string().describe("Unique identifier"),
  userId: z.string().describe("Owner user ID"),
  defaultEmailAssigneeId: z
    .string()
    .nullable()
    .describe("Default assignee ID for processing incoming emails"),
  createdAt: z.string().nullable().describe("Creation timestamp"),
  updatedAt: z.string().nullable().describe("Last update timestamp"),
});

export const updateUserSettingsSchema = z.object({
  defaultEmailAssigneeId: z
    .string()
    .nullable()
    .optional()
    .describe("Default assignee ID for processing incoming emails"),
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
  messages: z.array(chatMessageSchema).describe("Messages in chronological order"),
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

// ---- Location Response ----

export const locationResponseSchema = z.object({
  toolCallId: z.string().describe("Tool call ID for the location request"),
  action: z.enum(["confirm", "reject"]).describe("Whether to share or reject location"),
  latitude: z.number().optional().describe("GPS latitude (required when action is confirm)"),
  longitude: z.number().optional().describe("GPS longitude (required when action is confirm)"),
  accuracy: z.number().optional().describe("Location accuracy in meters"),
  alwaysAllow: z
    .boolean()
    .optional()
    .describe("If true, update assignee permissions to auto-confirm get_location in the future"),
});

export const locationResponseResultSchema = z.object({
  action: z.enum(["confirm", "reject"]).describe("Action taken"),
  toolCallId: z.string().describe("Tool call ID that was resolved"),
});

// ---- Task History ----

export const taskWebhookSummarySchema = z.object({
  id: z.string(),
  source: z.string(),
  event: z.string().nullable(),
  summary: z.string().nullable(),
  receivedAt: z.string(),
  isRead: z.boolean().nullable(),
});

export const selectTaskHistorySchema = z.object({
  id: z.string(),
  taskId: z.string(),
  chatSessionId: z.string(),
  assigneeId: z.string().nullable(),
  summary: z.string(),
  toolCalls: z.array(z.string()).nullable(),
  status: z.string().nullable(),
  source: z.string().nullable(),
  durationSecs: z.number().nullable(),
  taskTitle: z.string().optional(),
  score: z.number().optional(),
  createdAt: z.string().nullable(),
});

export const toolCallDetailSchema = z.object({
  toolName: z.string(),
  toolCallId: z.string(),
  input: z.unknown(),
  output: z.unknown().optional(),
});

export const selectTaskHistoryDetailSchema = selectTaskHistorySchema.extend({
  toolCallDetails: z.array(toolCallDetailSchema).nullable(),
  emails: z.array(
    z.object({
      id: z.string(),
      fromEmail: z.string(),
      fromName: z.string().nullable(),
      subject: z.string().nullable(),
      receivedAt: z.string(),
      isRead: z.boolean().nullable(),
    }),
  ),
  webhooks: z.array(taskWebhookSummarySchema),
});

export const listHistoryResponseSchema = z.object({
  data: z.array(selectTaskHistorySchema),
  pagination: z.object({
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
    hasMore: z.boolean(),
  }),
});
