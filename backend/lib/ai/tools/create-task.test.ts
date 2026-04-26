import { describe, test, expect, mock, beforeEach } from "bun:test";

type InsertedValues = {
  userId: string;
  title: string;
  description?: string;
  tags?: string[];
  categories?: string[];
  assigneeId?: string;
  source?: string;
  cronSchedule?: string | null;
  isCronEnabled?: boolean;
  status?: string;
  runsAt?: string | null;
  timezone?: string | null;
};

const state: {
  sessionRows: { timezone: string | null }[];
  lastInsertedValues: InsertedValues | null;
  lastSelectWhereArg: unknown;
  registerCronCalls: Array<[string, string, string | null | undefined]>;
  scheduleOnceCalls: Array<[string, string]>;
  inheritCalls: Array<[string, string, string]>;
} = {
  sessionRows: [],
  lastInsertedValues: null,
  lastSelectWhereArg: null,
  registerCronCalls: [],
  scheduleOnceCalls: [],
  inheritCalls: [],
};

function makeInsertedRow(values: InsertedValues) {
  return {
    id: "task-generated-id",
    title: values.title,
    status: values.status ?? "running",
    cronSchedule: values.cronSchedule ?? null,
    isCronEnabled: values.isCronEnabled ?? false,
    runsAt: values.runsAt ?? null,
    timezone: values.timezone ?? null,
  };
}

mock.module("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (arg: unknown) => {
          state.lastSelectWhereArg = arg;
          return Promise.resolve(state.sessionRows);
        },
      }),
    }),
    insert: () => ({
      values: (values: InsertedValues) => {
        state.lastInsertedValues = values;
        return {
          returning: () => Promise.resolve([makeInsertedRow(values)]),
        };
      },
    }),
    update: () => ({
      set: () => ({
        where: () => Promise.resolve(),
      }),
    }),
  },
}));

mock.module("@/lib/celery/client", () => ({
  registerCronTask: (taskId: string, cron: string, tz: string | null | undefined) => {
    state.registerCronCalls.push([taskId, cron, tz]);
    return Promise.resolve();
  },
  scheduleOnceTask: (taskId: string, runsAt: string) => {
    state.scheduleOnceCalls.push([taskId, runsAt]);
    return Promise.resolve();
  },
}));

mock.module("@/lib/db/task-toolset", () => ({
  inheritAssigneeToolset: (taskId: string, assigneeId: string, userId: string) => {
    state.inheritCalls.push([taskId, assigneeId, userId]);
    return Promise.resolve(null);
  },
}));

const { createTaskTool } = await import("./create-task");

type ToolResult = {
  taskId?: string;
  title?: string;
  status?: string;
  cronSchedule?: string | null;
  isCronEnabled?: boolean;
  runsAt?: string | null;
  error?: string;
};

async function runTool(
  tool: ReturnType<typeof createTaskTool>,
  input: Parameters<NonNullable<typeof tool.execute>>[0],
): Promise<ToolResult> {
  if (!tool.execute) throw new Error("tool.execute missing");
  const res = await tool.execute(input, {
    toolCallId: "test",
    messages: [],
  } as Parameters<NonNullable<typeof tool.execute>>[1]);
  return res as ToolResult;
}

beforeEach(() => {
  state.sessionRows = [];
  state.lastInsertedValues = null;
  state.lastSelectWhereArg = null;
  state.registerCronCalls = [];
  state.scheduleOnceCalls = [];
  state.inheritCalls = [];
});

describe("createTaskTool", () => {
  test("rejects when both cronSchedule and runsAt are provided", async () => {
    const tool = createTaskTool("user-1", false);
    const result = await runTool(tool, {
      title: "Bad task",
      cronSchedule: "0 9 * * *",
      runsAt: "2026-06-15T09:00:00",
    });
    expect(result.error).toBeDefined();
    expect(state.lastInsertedValues).toBeNull();
  });

  test("rejects invalid cron expressions", async () => {
    const tool = createTaskTool("user-1", false);
    const result = await runTool(tool, {
      title: "Bad cron",
      cronSchedule: "not-a-cron-expression",
    });
    expect(result.error).toBe("Invalid cron expression");
    expect(state.lastInsertedValues).toBeNull();
  });

  test("creates a simple task without schedule", async () => {
    const tool = createTaskTool("user-1", false);
    const result = await runTool(tool, {
      title: "Simple task",
      description: "desc",
    });
    expect(result.error).toBeUndefined();
    expect(result.title).toBe("Simple task");
    expect(result.isCronEnabled).toBe(false);
    expect(state.lastInsertedValues?.userId).toBe("user-1");
    expect(state.lastInsertedValues?.source).toBe("agent");
    expect(state.lastInsertedValues?.timezone).toBeUndefined();
    expect(state.registerCronCalls).toHaveLength(0);
    expect(state.scheduleOnceCalls).toHaveLength(0);
  });

  test("uses explicit timezone parameter to convert runsAt to UTC", async () => {
    const tool = createTaskTool("user-1", false);
    const result = await runTool(tool, {
      title: "Scheduled",
      runsAt: "2026-06-15T09:00:00",
      timezone: "Asia/Tokyo",
    });
    expect(result.error).toBeUndefined();
    // 2026-06-15T09:00 JST (UTC+9) → 00:00Z
    const storedRunsAt = state.lastInsertedValues?.runsAt;
    expect(storedRunsAt).toBeDefined();
    const runsAtUtc = new Date(storedRunsAt!);
    expect(runsAtUtc.getUTCHours()).toBe(0);
    expect(runsAtUtc.getUTCMinutes()).toBe(0);
    // timezone stored on task row
    expect(state.lastInsertedValues?.timezone).toBe("Asia/Tokyo");
    // celery scheduled with the UTC time
    expect(state.scheduleOnceCalls).toHaveLength(1);
  });

  test("explicit timezone parameter overrides the chat session's timezone", async () => {
    state.sessionRows = [{ timezone: "America/New_York" }];
    const tool = createTaskTool("user-1", false, "session-1");
    await runTool(tool, {
      title: "Scheduled",
      runsAt: "2026-06-15T09:00:00",
      timezone: "Asia/Tokyo",
    });
    // Explicit param (Tokyo, UTC+9) wins: 09:00 Tokyo → 00:00Z
    const runsAtUtc = new Date(state.lastInsertedValues!.runsAt!);
    expect(runsAtUtc.getUTCHours()).toBe(0);
    expect(state.lastInsertedValues?.timezone).toBe("Asia/Tokyo");
    // Session timezone lookup should be skipped
    expect(state.lastSelectWhereArg).toBeNull();
  });

  test("falls back to the chat session's timezone when no explicit timezone is passed", async () => {
    state.sessionRows = [{ timezone: "America/New_York" }];
    const tool = createTaskTool("user-1", false, "session-1");
    await runTool(tool, {
      title: "Scheduled",
      runsAt: "2026-06-15T09:00:00",
    });
    // 09:00 in NYC (UTC-4 in June DST) → 13:00Z
    const runsAtUtc = new Date(state.lastInsertedValues!.runsAt!);
    expect(runsAtUtc.getUTCHours()).toBe(13);
    expect(state.lastInsertedValues?.timezone).toBe("America/New_York");
    expect(state.lastSelectWhereArg).not.toBeNull();
  });

  test("registers cron with effective timezone when cronSchedule is provided", async () => {
    const tool = createTaskTool("user-1", false);
    const result = await runTool(tool, {
      title: "Cron task",
      cronSchedule: "0 9 * * *",
      timezone: "Asia/Tokyo",
    });
    expect(result.error).toBeUndefined();
    expect(result.isCronEnabled).toBe(true);
    expect(state.registerCronCalls).toHaveLength(1);
    const [, cronExpr, tz] = state.registerCronCalls[0];
    expect(cronExpr).toBe("0 9 * * *");
    expect(tz).toBe("Asia/Tokyo");
    expect(state.lastInsertedValues?.timezone).toBe("Asia/Tokyo");
  });

  test("does not store timezone on task row when no schedule is set", async () => {
    const tool = createTaskTool("user-1", false);
    await runTool(tool, {
      title: "Plain task",
      timezone: "Asia/Tokyo",
    });
    expect(state.lastInsertedValues?.timezone).toBeUndefined();
  });

  test("inherits assignee toolset when defaultAssigneeId is provided", async () => {
    const tool = createTaskTool("user-1", false, undefined, "assignee-42");
    await runTool(tool, { title: "With assignee" });
    expect(state.lastInsertedValues?.assigneeId).toBe("assignee-42");
    expect(state.inheritCalls).toHaveLength(1);
    expect(state.inheritCalls[0]).toEqual(["task-generated-id", "assignee-42", "user-1"]);
  });
});
