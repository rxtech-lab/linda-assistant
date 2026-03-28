import { relations } from "drizzle-orm";
import {
  assignees,
  assigneeExtensions,
  briefingDocuments,
  briefings,
  emailInbox,
  extensions,
  tasks,
  taskEmails,
  taskWebhooks,
  taskExtensions,
  taskHistory,
  historyEmails,
  historyWebhooks,
  chatSessions,
  messages,
  confirmations,
  devices,
  documents,
  scheduledNotifications,
  webhookInbox,
} from "./schema";

export const assigneesRelations = relations(assignees, ({ many }) => ({
  emails: many(emailInbox),
  chatSessions: many(chatSessions),
}));

export const emailInboxRelations = relations(emailInbox, ({ one, many }) => ({
  assignee: one(assignees, {
    fields: [emailInbox.assigneeId],
    references: [assignees.id],
  }),
  taskEmails: many(taskEmails),
}));

export const tasksRelations = relations(tasks, ({ many }) => ({
  taskEmails: many(taskEmails),
  taskWebhooks: many(taskWebhooks),
  chatSessions: many(chatSessions),
  taskExtensions: many(taskExtensions),
}));

export const taskEmailsRelations = relations(taskEmails, ({ one }) => ({
  task: one(tasks, {
    fields: [taskEmails.taskId],
    references: [tasks.id],
  }),
  email: one(emailInbox, {
    fields: [taskEmails.emailId],
    references: [emailInbox.id],
  }),
}));

export const chatSessionsRelations = relations(chatSessions, ({ one, many }) => ({
  task: one(tasks, {
    fields: [chatSessions.taskId],
    references: [tasks.id],
  }),
  assignee: one(assignees, {
    fields: [chatSessions.assigneeId],
    references: [assignees.id],
  }),
  messages: many(messages),
  confirmations: many(confirmations),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  chatSession: one(chatSessions, {
    fields: [messages.chatSessionId],
    references: [chatSessions.id],
  }),
}));

export const confirmationsRelations = relations(confirmations, ({ one }) => ({
  chatSession: one(chatSessions, {
    fields: [confirmations.chatSessionId],
    references: [chatSessions.id],
  }),
}));

export const briefingsRelations = relations(briefings, ({ one, many }) => ({
  assignee: one(assignees, {
    fields: [briefings.assigneeId],
    references: [assignees.id],
  }),
  chatSession: one(chatSessions, {
    fields: [briefings.chatSessionId],
    references: [chatSessions.id],
  }),
  briefingDocuments: many(briefingDocuments),
}));

export const briefingDocumentsRelations = relations(briefingDocuments, ({ one }) => ({
  briefing: one(briefings, {
    fields: [briefingDocuments.briefingId],
    references: [briefings.id],
  }),
  document: one(documents, {
    fields: [briefingDocuments.documentId],
    references: [documents.id],
  }),
}));

export const extensionsRelations = relations(extensions, ({ many }) => ({
  assigneeExtensions: many(assigneeExtensions),
  taskExtensions: many(taskExtensions),
}));

export const assigneeExtensionsRelations = relations(assigneeExtensions, ({ one }) => ({
  assignee: one(assignees, {
    fields: [assigneeExtensions.assigneeId],
    references: [assignees.id],
  }),
  extension: one(extensions, {
    fields: [assigneeExtensions.extensionId],
    references: [extensions.id],
  }),
}));

export const taskExtensionsRelations = relations(taskExtensions, ({ one }) => ({
  task: one(tasks, {
    fields: [taskExtensions.taskId],
    references: [tasks.id],
  }),
  extension: one(extensions, {
    fields: [taskExtensions.extensionId],
    references: [extensions.id],
  }),
}));

export const taskWebhooksRelations = relations(taskWebhooks, ({ one }) => ({
  task: one(tasks, {
    fields: [taskWebhooks.taskId],
    references: [tasks.id],
  }),
  webhook: one(webhookInbox, {
    fields: [taskWebhooks.webhookId],
    references: [webhookInbox.id],
  }),
}));

export const taskHistoryRelations = relations(taskHistory, ({ one, many }) => ({
  task: one(tasks, {
    fields: [taskHistory.taskId],
    references: [tasks.id],
  }),
  chatSession: one(chatSessions, {
    fields: [taskHistory.chatSessionId],
    references: [chatSessions.id],
  }),
  assignee: one(assignees, {
    fields: [taskHistory.assigneeId],
    references: [assignees.id],
  }),
  historyEmails: many(historyEmails),
  historyWebhooks: many(historyWebhooks),
}));

export const historyEmailsRelations = relations(historyEmails, ({ one }) => ({
  history: one(taskHistory, {
    fields: [historyEmails.historyId],
    references: [taskHistory.id],
  }),
  email: one(emailInbox, {
    fields: [historyEmails.emailId],
    references: [emailInbox.id],
  }),
}));

export const historyWebhooksRelations = relations(historyWebhooks, ({ one }) => ({
  history: one(taskHistory, {
    fields: [historyWebhooks.historyId],
    references: [taskHistory.id],
  }),
  webhook: one(webhookInbox, {
    fields: [historyWebhooks.webhookId],
    references: [webhookInbox.id],
  }),
}));

export const webhookInboxRelations = relations(webhookInbox, ({ many }) => ({
  taskWebhooks: many(taskWebhooks),
  historyWebhooks: many(historyWebhooks),
}));

export const devicesRelations = relations(devices, () => ({}));

export const scheduledNotificationsRelations = relations(scheduledNotifications, () => ({}));
