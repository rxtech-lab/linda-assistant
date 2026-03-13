import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { nanoid } from "nanoid";

export type ToolPermission = {
  toolName: string;
  permission: "auto-confirm" | "manual-confirm" | "auto-reject" | "disabled";
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
  toolPermissions: text("tool_permissions", { mode: "json" }).$type<
    ToolPermission[]
  >(),
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
  assigneeId: text("assignee_id").references(() => assignees.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").default("pending"),
  tags: text("tags", { mode: "json" }).$type<string[]>(),
  categories: text("categories", { mode: "json" }).$type<string[]>(),
  cronSchedule: text("cron_schedule"),
  isCronEnabled: integer("is_cron_enabled", { mode: "boolean" }).default(false),
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
  createdAt: text("created_at").default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
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
  parameters: text("parameters", { mode: "json" }).$type<
    Record<string, unknown>
  >(),
  status: text("status").default("pending"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
  resolvedAt: text("resolved_at"),
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

export const devices = sqliteTable("devices", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => nanoid()),
  userId: text("user_id").notNull(),
  deviceToken: text("device_token").notNull().unique(),
  platform: text("platform").notNull(),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});
