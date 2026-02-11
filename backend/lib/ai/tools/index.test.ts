import { describe, test, expect, mock } from "bun:test";
import type { ToolPermission } from "@/lib/db/schema";
import { resolvePermission } from "./permission";

// Mock loadAssigneePermissions before importing buildToolSet
const mockLoadAssigneePermissions = mock<(id: string) => Promise<ToolPermission[] | null>>(() =>
  Promise.resolve(null),
);

mock.module("./permission", () => ({
  loadAssigneePermissions: mockLoadAssigneePermissions,
  resolvePermission,
}));

const { buildToolSet } = await import("./index");

const ALL_TOOL_NAMES = ["send_email", "search_emails", "create_task", "update_task"];

describe("buildToolSet", () => {
  test("returns all tools when assigneeId is null", async () => {
    const { tools, checkPermission } = await buildToolSet("user-1", null);

    expect(Object.keys(tools).sort()).toEqual(ALL_TOOL_NAMES.sort());
    // All default to manual-confirm
    expect(checkPermission("send_email")).toBe("manual-confirm");
    expect(checkPermission("create_task")).toBe("manual-confirm");
  });

  test("returns all tools when assignee has no permissions configured", async () => {
    mockLoadAssigneePermissions.mockResolvedValueOnce(null);

    const { tools } = await buildToolSet("user-1", "assignee-1");

    expect(Object.keys(tools).sort()).toEqual(ALL_TOOL_NAMES.sort());
  });

  test("filters out auto-reject tools", async () => {
    mockLoadAssigneePermissions.mockResolvedValueOnce([
      { toolName: "send_email", permission: "auto-reject" },
    ]);

    const { tools, checkPermission } = await buildToolSet("user-1", "assignee-1");

    expect(Object.keys(tools)).not.toContain("send_email");
    expect(Object.keys(tools)).toContain("search_emails");
    expect(Object.keys(tools)).toContain("create_task");
    expect(Object.keys(tools)).toContain("update_task");
    expect(checkPermission("send_email")).toBe("auto-reject");
  });

  test("keeps auto-confirm tools in the set", async () => {
    mockLoadAssigneePermissions.mockResolvedValueOnce([
      { toolName: "send_email", permission: "auto-confirm" },
    ]);

    const { tools, checkPermission } = await buildToolSet("user-1", "assignee-1");

    expect(Object.keys(tools)).toContain("send_email");
    expect(checkPermission("send_email")).toBe("auto-confirm");
    // Others still default to manual-confirm
    expect(checkPermission("create_task")).toBe("manual-confirm");
  });

  test("keeps manual-confirm tools in the set", async () => {
    mockLoadAssigneePermissions.mockResolvedValueOnce([
      { toolName: "create_task", permission: "manual-confirm" },
    ]);

    const { tools, checkPermission } = await buildToolSet("user-1", "assignee-1");

    expect(Object.keys(tools)).toContain("create_task");
    expect(checkPermission("create_task")).toBe("manual-confirm");
  });

  test("handles multiple permissions including mixed reject", async () => {
    mockLoadAssigneePermissions.mockResolvedValueOnce([
      { toolName: "send_email", permission: "auto-reject" },
      { toolName: "create_task", permission: "auto-reject" },
      { toolName: "search_emails", permission: "auto-confirm" },
    ]);

    const { tools, checkPermission } = await buildToolSet("user-1", "assignee-1");

    expect(Object.keys(tools).sort()).toEqual(["search_emails", "update_task"].sort());
    expect(checkPermission("send_email")).toBe("auto-reject");
    expect(checkPermission("create_task")).toBe("auto-reject");
    expect(checkPermission("search_emails")).toBe("auto-confirm");
    expect(checkPermission("update_task")).toBe("manual-confirm");
  });

  test("checkPermission returns manual-confirm for unknown tools", async () => {
    mockLoadAssigneePermissions.mockResolvedValueOnce([
      { toolName: "send_email", permission: "auto-confirm" },
    ]);

    const { checkPermission } = await buildToolSet("user-1", "assignee-1");

    expect(checkPermission("nonexistent_tool")).toBe("manual-confirm");
  });

  test("tools not in permission array default to manual-confirm", async () => {
    mockLoadAssigneePermissions.mockResolvedValueOnce([
      { toolName: "send_email", permission: "auto-confirm" },
    ]);

    const { checkPermission } = await buildToolSet("user-1", "assignee-1");

    // Only send_email is configured — all others must require manual approval
    expect(checkPermission("search_emails2")).toBe("manual-confirm");
    expect(checkPermission("create_task2")).toBe("manual-confirm");
    expect(checkPermission("update_task2")).toBe("manual-confirm");
  });
});
