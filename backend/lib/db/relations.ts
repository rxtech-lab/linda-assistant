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
  chatSessions,
  messages,
  confirmations,
  devices,
  documents,
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
  chatSessions: many(chatSessions),
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

export const devicesRelations = relations(devices, () => ({}));
