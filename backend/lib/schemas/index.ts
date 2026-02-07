import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { availableModelSchema, DEFAULT_MODEL } from "@/lib/ai/models";
import {
  assignees,
  emailInbox,
  tasks,
  taskEmails,
  chatSessions,
  confirmations,
  devices,
} from "@/lib/db/schema";

// Tool permissions
export const toolPermissionSchema = z.object({
  toolName: z.string(),
  permission: z.enum(["auto-confirm", "manual-confirm", "auto-reject"]),
});

// Assignees
export const insertAssigneeSchema = createInsertSchema(assignees, {
  name: z.string().min(1).max(100),
  email: z.string().email(),
  personality: z.string().max(2000).optional(),
  model: availableModelSchema.catch(DEFAULT_MODEL).optional(),
  toolPermissions: z.array(toolPermissionSchema).optional(),
}).omit({ id: true, userId: true, createdAt: true, updatedAt: true });

export const updateAssigneeSchema = insertAssigneeSchema.partial();

export const selectAssigneeSchema = createSelectSchema(assignees);

// Email Inbox
export const insertEmailSchema = createInsertSchema(emailInbox, {
  fromEmail: z.string().email(),
  toEmail: z.string().email(),
  subject: z.string().max(500).optional(),
  body: z.string().optional(),
  receivedAt: z.string(),
  metadata: z.record(z.unknown()).optional(),
}).omit({ id: true, userId: true });

export const updateEmailSchema = z.object({
  isRead: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
  assigneeId: z.string().optional().nullable(),
});

export const selectEmailSchema = createSelectSchema(emailInbox);

// Tasks
export const insertTaskSchema = createInsertSchema(tasks, {
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  status: z.enum(["pending", "running", "finished", "cancelled"]).optional(),
  tags: z.array(z.string()).optional(),
  categories: z.array(z.string()).optional(),
}).omit({ id: true, userId: true, createdAt: true, updatedAt: true });

export const updateTaskSchema = insertTaskSchema.partial();

export const selectTaskSchema = createSelectSchema(tasks);

// Task Emails
export const insertTaskEmailSchema = createInsertSchema(taskEmails, {
  taskId: z.string(),
  emailId: z.string(),
}).omit({ id: true });

export const selectTaskEmailSchema = createSelectSchema(taskEmails);

// Chat Sessions
export const insertChatSessionSchema = createInsertSchema(chatSessions, {
  title: z.string().max(200).optional(),
  status: z
    .enum(["starting", "in_progress", "waiting_confirmation", "stopped"])
    .optional(),
}).omit({
  id: true,
  userId: true,
  messages: true,
  createdAt: true,
  updatedAt: true,
});

export const updateChatSessionSchema = z.object({
  title: z.string().max(200).optional(),
  assigneeId: z.string().optional().nullable(),
});

export const selectChatSessionSchema = createSelectSchema(chatSessions);

// Confirmations
export const selectConfirmationSchema = createSelectSchema(confirmations);

export const resolveConfirmationSchema = z.object({
  action: z.enum(["confirm", "reject"]),
});

// Devices
export const insertDeviceSchema = createInsertSchema(devices, {
  deviceToken: z.string().min(1),
  platform: z.literal("ios"),
}).omit({ id: true, userId: true, createdAt: true });

export const selectDeviceSchema = createSelectSchema(devices);

// Send message
export const sendMessageSchema = z.object({
  content: z.string().min(1),
  attachments: z
    .array(
      z.object({
        type: z.enum(["image", "audio", "pdf", "file"]),
        url: z.string().url(),
        name: z.string().optional(),
      })
    )
    .optional(),
});

// Onboard
export const onboardResponseSchema = z.object({
  assignee: z.object({
    check: z.boolean(),
    required: z.array(z.string()).optional(),
  }),
  overall: z.boolean(),
});

// Presigned URL
export const presignedUrlSchema = z.object({
  contentType: z.string().min(1),
  prefix: z.string().optional(),
});

export const presignedUrlResponseSchema = z.object({
  url: z.string(),
  key: z.string(),
});

// Common path params
export const idParamSchema = z.object({ id: z.string() });

// Common response schemas
export const deletedResponseSchema = z.object({ deleted: z.boolean() });

export const queuedResponseSchema = z.object({ queued: z.boolean() });

export const receivedResponseSchema = z.object({ received: z.boolean() });

export const resolveResponseSchema = z.object({
  action: z.enum(["confirm", "reject"]),
  confirmationId: z.string(),
});
