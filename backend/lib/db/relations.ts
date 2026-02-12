import { relations } from "drizzle-orm";
import {
  assignees,
  emailInbox,
  tasks,
  taskEmails,
  chatSessions,
  messages,
  confirmations,
  devices,
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

export const devicesRelations = relations(devices, () => ({}));
