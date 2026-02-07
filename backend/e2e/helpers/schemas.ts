import { z } from "zod";
import {
  selectAssigneeSchema,
  selectEmailSchema,
  selectTaskSchema,
  selectChatSessionSchema,
  selectConfirmationSchema,
  selectDeviceSchema,
} from "../../lib/schemas";

// Shared pagination schema (matches paginatedJson utility)
export const paginationSchema = z.object({
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  hasMore: z.boolean(),
});

// Generic wrappers
export const deleteResponseSchema = z.object({
  data: z.object({ deleted: z.boolean() }),
});

export const errorResponseSchema = z.object({
  error: z.string(),
});

// Health
export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  timestamp: z.string(),
});

// Assignees
export const assigneeResponseSchema = z.object({ data: selectAssigneeSchema });
export const assigneeListResponseSchema = z.object({
  data: z.array(selectAssigneeSchema),
  pagination: paginationSchema,
});

// Tasks
export const taskResponseSchema = z.object({ data: selectTaskSchema });
export const taskListResponseSchema = z.object({
  data: z.array(selectTaskSchema),
  pagination: paginationSchema,
});
export const taskDetailResponseSchema = z.object({
  data: selectTaskSchema.extend({
    chatSessions: z.array(
      z.object({
        id: z.string(),
        title: z.string().nullable(),
        status: z.string().nullable(),
        updatedAt: z.string().nullable(),
      })
    ),
    emails: z.array(z.any()),
  }),
});
export const taskSessionsResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      title: z.string().nullable(),
      status: z.string().nullable(),
      assigneeId: z.string().nullable(),
      createdAt: z.string().nullable(),
      updatedAt: z.string().nullable(),
    })
  ),
});

// Chat Sessions
export const chatSessionResponseSchema = z.object({
  data: selectChatSessionSchema,
});
export const chatSessionListResponseSchema = z.object({
  data: z.array(selectChatSessionSchema.omit({ messages: true })),
  pagination: paginationSchema,
});

// Emails
export const emailResponseSchema = z.object({ data: selectEmailSchema });
export const emailListResponseSchema = z.object({
  data: z.array(selectEmailSchema),
  pagination: paginationSchema,
});

// Devices
export const deviceResponseSchema = z.object({ data: selectDeviceSchema });

// Tools
export const toolsResponseSchema = z.object({
  data: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      defaultPermission: z.enum([
        "auto-confirm",
        "manual-confirm",
        "auto-reject",
      ]),
    })
  ),
});

// Models
export const modelsResponseSchema = z.object({
  data: z.array(z.string()),
});

// Confirmations
export const confirmationListResponseSchema = z.object({
  data: z.array(selectConfirmationSchema),
});
export const resolveConfirmationResponseSchema = z.object({
  data: z.object({
    action: z.enum(["confirm", "reject"]),
    confirmationId: z.string(),
  }),
});

// Send message
export const sendMessageResponseSchema = z.object({
  data: z.object({ queued: z.boolean() }),
});
