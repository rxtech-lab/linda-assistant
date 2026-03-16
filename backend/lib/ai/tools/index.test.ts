import { describe, test, expect, mock, beforeAll, afterAll } from "bun:test";
import type { ToolPermission } from "@/lib/db/schema";
import { resolvePermission } from "./permission";

// Skip MCP tools in tests (they require valid OAuth tokens)
const originalIsE2E = process.env.IS_E2E;
beforeAll(() => {
  process.env.IS_E2E = "true";
});
afterAll(() => {
  process.env.IS_E2E = originalIsE2E;
});

// Mock loadAssigneePermissions before importing buildToolSet
const mockLoadAssigneePermissions = mock<(id: string) => Promise<ToolPermission[] | null>>(() =>
  Promise.resolve(null),
);

mock.module("./permission", () => ({
  loadAssigneePermissions: mockLoadAssigneePermissions,
  resolvePermission,
}));

// Mock the database module to avoid real DB connections in unit tests
const mockSelect = mock(() => ({
  from: () => ({
    where: () => ({
      orderBy: () => Promise.resolve([]),
      then: (resolve: (v: unknown[]) => void) => resolve([{ email: "test@example.com" }]),
    }),
  }),
}));

mock.module("@/lib/db", () => ({
  db: {
    select: mockSelect,
  },
}));

// Mock push notification module to avoid real APNs calls in unit tests
mock.module("@/lib/push", () => ({
  sendPushNotification: mock(() => Promise.resolve([])),
}));

const { buildToolSet } = await import("./index");

// Well-known tools that must always be present (not exhaustive — new tools may be added)
const KNOWN_TOOLS = [
  "send_email",
  "search_emails",
  "create_task",
  "update_task",
  "update_document",
  "get_current_time",
  "ask_question",
  "send_notification",
];

describe("buildToolSet", () => {
  test("returns all known tools when assigneeId is null", async () => {
    const { tools } = await buildToolSet("user-1", null, "test-token");
    const names = Object.keys(tools);

    for (const tool of KNOWN_TOOLS) {
      expect(names).toContain(tool);
    }
    // create_document excluded without chatSessionId
    expect(names).not.toContain("create_document");
  });

  test("includes create_document when chatSessionId is provided", async () => {
    const { tools } = await buildToolSet("user-1", null, "test-token", "session-1");
    const names = Object.keys(tools);

    for (const tool of [...KNOWN_TOOLS, "create_document"]) {
      expect(names).toContain(tool);
    }
  });

  test("returns all known tools when assignee has no permissions configured", async () => {
    mockLoadAssigneePermissions.mockResolvedValueOnce(null);

    const { tools } = await buildToolSet("user-1", "assignee-1", "test-token");
    const names = Object.keys(tools);

    for (const tool of KNOWN_TOOLS) {
      expect(names).toContain(tool);
    }
  });

  test("filters out auto-reject tools", async () => {
    mockLoadAssigneePermissions.mockResolvedValueOnce([
      { toolName: "send_email", permission: "auto-reject" },
    ]);

    const { tools } = await buildToolSet("user-1", "assignee-1", "test-token");

    expect(Object.keys(tools)).not.toContain("send_email");
    expect(Object.keys(tools)).toContain("search_emails");
    expect(Object.keys(tools)).toContain("create_task");
    expect(Object.keys(tools)).toContain("update_task");
  });

  test("keeps auto-confirm tools in the set", async () => {
    mockLoadAssigneePermissions.mockResolvedValueOnce([
      { toolName: "send_email", permission: "auto-confirm" },
    ]);

    const { tools } = await buildToolSet("user-1", "assignee-1", "test-token");

    expect(Object.keys(tools)).toContain("send_email");
  });

  test("keeps manual-confirm tools in the set", async () => {
    mockLoadAssigneePermissions.mockResolvedValueOnce([
      { toolName: "create_task", permission: "manual-confirm" },
    ]);

    const { tools } = await buildToolSet("user-1", "assignee-1", "test-token");

    expect(Object.keys(tools)).toContain("create_task");
  });

  test("handles multiple permissions including mixed reject", async () => {
    mockLoadAssigneePermissions.mockResolvedValueOnce([
      { toolName: "send_email", permission: "auto-reject" },
      { toolName: "create_task", permission: "auto-reject" },
      { toolName: "search_emails", permission: "auto-confirm" },
    ]);

    const { tools } = await buildToolSet("user-1", "assignee-1", "test-token");
    const names = Object.keys(tools);

    expect(names).not.toContain("send_email");
    expect(names).not.toContain("create_task");
    expect(names).toContain("search_emails");
    expect(names).toContain("update_task");
    expect(names).toContain("get_current_time");
    expect(names).toContain("ask_question");
  });

  test("filters out disabled tools", async () => {
    mockLoadAssigneePermissions.mockResolvedValueOnce([
      { toolName: "send_email", permission: "disabled" },
    ]);

    const { tools } = await buildToolSet("user-1", "assignee-1", "test-token");

    expect(Object.keys(tools)).not.toContain("send_email");
    expect(Object.keys(tools)).toContain("search_emails");
    expect(Object.keys(tools)).toContain("create_task");
    expect(Object.keys(tools)).toContain("update_task");
  });

  test("handles multiple permissions including mixed disabled and reject", async () => {
    mockLoadAssigneePermissions.mockResolvedValueOnce([
      { toolName: "send_email", permission: "disabled" },
      { toolName: "create_task", permission: "auto-reject" },
      { toolName: "search_emails", permission: "auto-confirm" },
    ]);

    const { tools } = await buildToolSet("user-1", "assignee-1", "test-token");
    const names = Object.keys(tools);

    expect(names).not.toContain("send_email");
    expect(names).not.toContain("create_task");
    expect(names).toContain("search_emails");
    expect(names).toContain("update_task");
    expect(names).toContain("get_current_time");
    expect(names).toContain("ask_question");
  });

  test("tools not in permission array are included (default manual-confirm)", async () => {
    mockLoadAssigneePermissions.mockResolvedValueOnce([
      { toolName: "send_email", permission: "auto-confirm" },
    ]);

    const { tools } = await buildToolSet("user-1", "assignee-1", "test-token");
    const names = Object.keys(tools);

    // All known tools should be present — unconfigured ones default to manual-confirm (still included)
    for (const tool of KNOWN_TOOLS) {
      expect(names).toContain(tool);
    }
  });
});

describe("resolvePermission", () => {
  test("returns manual-confirm for unknown tools", () => {
    expect(resolvePermission("nonexistent_tool", null)).toBe("manual-confirm");
  });

  test("returns manual-confirm when no permissions configured", () => {
    expect(resolvePermission("send_email", null)).toBe("manual-confirm");
  });

  test("returns correct permission when configured", () => {
    const perms: ToolPermission[] = [
      { toolName: "send_email", permission: "auto-confirm" },
      { toolName: "create_task", permission: "auto-reject" },
      { toolName: "update_task", permission: "disabled" },
    ];

    expect(resolvePermission("send_email", perms)).toBe("auto-confirm");
    expect(resolvePermission("create_task", perms)).toBe("auto-reject");
    expect(resolvePermission("update_task", perms)).toBe("disabled");
    expect(resolvePermission("search_emails", perms)).toBe("manual-confirm");
  });
});
