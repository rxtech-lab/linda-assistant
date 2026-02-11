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
    const { tools } = await buildToolSet("user-1", null);

    expect(Object.keys(tools).sort()).toEqual(ALL_TOOL_NAMES.sort());
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

    const { tools } = await buildToolSet("user-1", "assignee-1");

    expect(Object.keys(tools)).not.toContain("send_email");
    expect(Object.keys(tools)).toContain("search_emails");
    expect(Object.keys(tools)).toContain("create_task");
    expect(Object.keys(tools)).toContain("update_task");
  });

  test("keeps auto-confirm tools in the set", async () => {
    mockLoadAssigneePermissions.mockResolvedValueOnce([
      { toolName: "send_email", permission: "auto-confirm" },
    ]);

    const { tools } = await buildToolSet("user-1", "assignee-1");

    expect(Object.keys(tools)).toContain("send_email");
  });

  test("keeps manual-confirm tools in the set", async () => {
    mockLoadAssigneePermissions.mockResolvedValueOnce([
      { toolName: "create_task", permission: "manual-confirm" },
    ]);

    const { tools } = await buildToolSet("user-1", "assignee-1");

    expect(Object.keys(tools)).toContain("create_task");
  });

  test("handles multiple permissions including mixed reject", async () => {
    mockLoadAssigneePermissions.mockResolvedValueOnce([
      { toolName: "send_email", permission: "auto-reject" },
      { toolName: "create_task", permission: "auto-reject" },
      { toolName: "search_emails", permission: "auto-confirm" },
    ]);

    const { tools } = await buildToolSet("user-1", "assignee-1");

    expect(Object.keys(tools).sort()).toEqual(["search_emails", "update_task"].sort());
  });

  test("tools not in permission array are included (default manual-confirm)", async () => {
    mockLoadAssigneePermissions.mockResolvedValueOnce([
      { toolName: "send_email", permission: "auto-confirm" },
    ]);

    const { tools } = await buildToolSet("user-1", "assignee-1");

    // All tools should be present — unconfigured ones default to manual-confirm (still included)
    expect(Object.keys(tools).sort()).toEqual(ALL_TOOL_NAMES.sort());
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
    ];

    expect(resolvePermission("send_email", perms)).toBe("auto-confirm");
    expect(resolvePermission("create_task", perms)).toBe("auto-reject");
    expect(resolvePermission("update_task", perms)).toBe("manual-confirm");
  });
});
