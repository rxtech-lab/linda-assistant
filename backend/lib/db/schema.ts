import { sql } from "drizzle-orm";
import { customType, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { nanoid } from "nanoid";

/** Custom column type for Turso's F32_BLOB vector storage. */
const f32Blob = (dimensions: number) =>
  customType<{ data: number[]; driverData: Buffer }>({
    dataType() {
      return `F32_BLOB(${dimensions})`;
    },
  });

// Discriminated union by parameterType — each type allows only its valid operators
export type StringCondition = {
  parameterName: string;
  parameterType: "string";
  operator: "startsWith" | "endsWith" | "contains" | "equals" | "regex";
  value: string;
};

export type NumberCondition = {
  parameterName: string;
  parameterType: "number";
  operator: "gt" | "gte" | "lt" | "lte" | "regex";
  value: number | string; // number for comparison, string for regex pattern
};

export type BooleanCondition = {
  parameterName: string;
  parameterType: "boolean";
  operator: "isTrue" | "isFalse";
};

export type ArrayCondition = {
  parameterName: string;
  parameterType: "array";
  operator: "contains" | "equals" | "lengthGt" | "lengthLt" | "lengthGte" | "lengthLte";
  value: string | string[] | number; // string for contains, string[] for equals, number for length ops
};

export type ToolCondition = StringCondition | NumberCondition | BooleanCondition | ArrayCondition;

export type ToolPermission = {
  toolName: string;
  permission: "auto-confirm" | "manual-confirm" | "auto-reject" | "disabled";
  conditions?: ToolCondition[];
  conditionLogic?: "and" | "or";
};

export type EmailAttachment = {
  type: "image" | "pdf" | "file" | "audio";
  url: string;
  name: string;
};

export const assignees = sqliteTable("assignees", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => nanoid()),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  personality: text("personality"),
  model: text("model"),
  toolPermissions: text("tool_permissions", { mode: "json" }).$type<ToolPermission[]>(),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
});

export const emailInbox = sqliteTable("email_inbox", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => nanoid()),
  emailId: text("email_id").notNull().unique(),
  userId: text("user_id").notNull(),
  assigneeId: text("assignee_id").references(() => assignees.id, {
    onDelete: "set null",
  }),
  fromEmail: text("from_email").notNull(),
  fromName: text("from_name"),
  toEmail: text("to_email").notNull(),
  subject: text("subject"),
  textBody: text("text_body"),
  htmlBody: text("html_body"),
  receivedAt: text("received_at").notNull(),
  isRead: integer("is_read", { mode: "boolean" }).default(false),
  attachments: text("attachments", { mode: "json" }).$type<EmailAttachment[]>(),
  metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
});

export const tasks = sqliteTable("tasks", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => nanoid()),
  userId: text("user_id").notNull(),
  assigneeId: text("assignee_id").references(() => assignees.id, {
    onDelete: "set null",
  }),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").default("pending"),
  source: text("source").default("manual"), // "manual" | "agent" | "email"
  tags: text("tags", { mode: "json" }).$type<string[]>(),
  categories: text("categories", { mode: "json" }).$type<string[]>(),
  cronSchedule: text("cron_schedule"),
  isCronEnabled: integer("is_cron_enabled", { mode: "boolean" }).default(false),
  runsAt: text("runs_at"),
  timezone: text("timezone"),
  toolPermissions: text("tool_permissions", { mode: "json" }).$type<ToolPermission[]>(),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
});

export const taskEmails = sqliteTable("task_emails", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => nanoid()),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  emailId: text("email_id")
    .notNull()
    .references(() => emailInbox.id, { onDelete: "cascade" }),
});

export const chatSessions = sqliteTable("chat_sessions", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => nanoid()),
  userId: text("user_id").notNull(),
  taskId: text("task_id").references(() => tasks.id, { onDelete: "set null" }),
  assigneeId: text("assignee_id").references(() => assignees.id, {
    onDelete: "set null",
  }),
  title: text("title"),
  status: text("status").default("starting"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  deviceToken: text("device_token"),
  timezone: text("timezone"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
});

export const usage = sqliteTable("usage", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => nanoid()),
  userId: text("user_id").notNull(),
  chatSessionId: text("chat_session_id").references(() => chatSessions.id, {
    onDelete: "set null",
  }),
  assigneeId: text("assignee_id").references(() => assignees.id, {
    onDelete: "set null",
  }),
  model: text("model"),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  costUsd: real("cost_usd"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

export const messages = sqliteTable("messages", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => nanoid()),
  chatSessionId: text("chat_session_id")
    .notNull()
    .references(() => chatSessions.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  role: text("role").notNull(),
  content: text("content", { mode: "json" }).$type<unknown>(),
  isCompacted: integer("is_compacted", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

export const confirmations = sqliteTable("confirmations", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => nanoid()),
  userId: text("user_id").notNull(),
  chatSessionId: text("chat_session_id")
    .notNull()
    .references(() => chatSessions.id, { onDelete: "cascade" }),
  toolCallId: text("tool_call_id").notNull(),
  toolName: text("tool_name").notNull(),
  approvalId: text("approval_id").notNull(),
  parameters: text("parameters", { mode: "json" }).$type<Record<string, unknown>>(),
  status: text("status").default("pending"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
  resolvedAt: text("resolved_at"),
});

export const questions = sqliteTable("questions", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => nanoid()),
  userId: text("user_id").notNull(),
  chatSessionId: text("chat_session_id")
    .notNull()
    .references(() => chatSessions.id, { onDelete: "cascade" }),
  toolCallId: text("tool_call_id").notNull(),
  toolName: text("tool_name").notNull(),
  approvalId: text("approval_id").notNull(),
  questionsData: text("questions_data", { mode: "json" }).$type<
    Array<{
      title: string;
      description?: string;
      type: "boolean" | "multiple_choice" | "single_choice" | "fill_in_blank";
      options?: Array<{ title: string; description?: string }>;
    }>
  >(),
  answers: text("answers", { mode: "json" }).$type<
    Array<{ questionIndex: number; answer: string | string[] | boolean }>
  >(),
  status: text("status").default("pending"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
  answeredAt: text("answered_at"),
});

export const documents = sqliteTable("documents", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => nanoid()),
  userId: text("user_id").notNull(),
  chatSessionId: text("chat_session_id")
    .notNull()
    .references(() => chatSessions.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  format: text("format").notNull(), // "markdown" | "html"
  content: text("content").notNull(),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
});

export const briefings = sqliteTable("briefings", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => nanoid()),
  userId: text("user_id").notNull(),
  chatSessionId: text("chat_session_id").references(() => chatSessions.id, {
    onDelete: "set null",
  }),
  assigneeId: text("assignee_id").references(() => assignees.id, {
    onDelete: "set null",
  }),
  title: text("title").notNull(),
  content: text("content").notNull(),
  imageUrl: text("image_url"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
});

export const briefingDocuments = sqliteTable("briefing_documents", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => nanoid()),
  briefingId: text("briefing_id")
    .notNull()
    .references(() => briefings.id, { onDelete: "cascade" }),
  documentId: text("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
});

export const extensions = sqliteTable("extensions", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => nanoid()),
  userId: text("user_id").notNull(), // "system" for built-in, actual userId for user-registered
  type: text("type").notNull(), // "system" | "user"
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  imageUrl: text("image_url"),
  mcpUrl: text("mcp_url").notNull(),
  prefix: text("prefix").notNull(),
  authType: text("auth_type").notNull().default("rxauth"), // "rxauth" | "api_key" | "none"
  authConfig: text("auth_config", { mode: "json" }).$type<Record<string, unknown>>(),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
});

export const assigneeExtensions = sqliteTable("assignee_extensions", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => nanoid()),
  assigneeId: text("assignee_id")
    .notNull()
    .references(() => assignees.id, { onDelete: "cascade" }),
  extensionId: text("extension_id")
    .notNull()
    .references(() => extensions.id, { onDelete: "cascade" }),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  toolPermissions: text("tool_permissions", { mode: "json" }).$type<ToolPermission[]>(),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
});

export const taskExtensions = sqliteTable(
  "task_extensions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    extensionId: text("extension_id")
      .notNull()
      .references(() => extensions.id, { onDelete: "cascade" }),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    toolPermissions: text("tool_permissions", { mode: "json" }).$type<ToolPermission[]>(),
    createdAt: text("created_at").default(sql`(datetime('now'))`),
    updatedAt: text("updated_at").default(sql`(datetime('now'))`),
  },
  (table) => [
    uniqueIndex("task_extensions_task_id_extension_id_unique").on(table.taskId, table.extensionId),
  ],
);

export const scheduledNotifications = sqliteTable("scheduled_notifications", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => nanoid()),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  scheduledAt: text("scheduled_at").notNull(), // UTC ISO datetime
  sent: integer("sent", { mode: "boolean" }).default(false),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

export const userSettings = sqliteTable("user_settings", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => nanoid()),
  userId: text("user_id").notNull().unique(),
  defaultEmailAssigneeId: text("default_email_assignee_id").references(() => assignees.id, {
    onDelete: "set null",
  }),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
});

export const devices = sqliteTable("devices", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => nanoid()),
  userId: text("user_id").notNull(),
  deviceToken: text("device_token").notNull().unique(),
  platform: text("platform").notNull(),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

export const taskHistory = sqliteTable("task_history", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => nanoid()),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  chatSessionId: text("chat_session_id")
    .notNull()
    .references(() => chatSessions.id, { onDelete: "cascade" }),
  assigneeId: text("assignee_id").references(() => assignees.id, {
    onDelete: "set null",
  }),
  userId: text("user_id").notNull(),
  summary: text("summary").notNull(),
  embedding: f32Blob(768)("embedding"),
  toolCalls: text("tool_calls", { mode: "json" }).$type<string[]>(),
  status: text("status"),
  durationSecs: integer("duration_secs"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});
