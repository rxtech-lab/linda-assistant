import { describe, test, expect } from "bun:test";
import { formatHistoryContext, groupHistoryByTask, type TaskHistoryEntry } from "../history";

function makeEntry(overrides: Partial<TaskHistoryEntry> = {}): TaskHistoryEntry {
  return {
    id: "h1",
    taskId: "t1",
    chatSessionId: "cs1",
    assigneeId: "a1",
    summary: "Sent an email to user@example.com and received confirmation.",
    toolCalls: ["send_email"],
    status: "stopped",
    durationSecs: 120,
    taskTitle: "Send report email",
    createdAt: "2026-03-27T10:00:00Z",
    ...overrides,
  };
}

describe("groupHistoryByTask", () => {
  test("groups entries by taskId", () => {
    const entries: TaskHistoryEntry[] = [
      makeEntry({ id: "h1", taskId: "t1", chatSessionId: "cs1" }),
      makeEntry({ id: "h2", taskId: "t1", chatSessionId: "cs2" }),
      makeEntry({ id: "h3", taskId: "t2", chatSessionId: "cs3", taskTitle: "Other task" }),
    ];

    const grouped = groupHistoryByTask(entries);
    expect(grouped).toHaveLength(2);
    expect(grouped[0].taskId).toBe("t1");
    expect(grouped[0].sessions).toHaveLength(2);
    expect(grouped[1].taskId).toBe("t2");
    expect(grouped[1].sessions).toHaveLength(1);
  });

  test("preserves order of first occurrence", () => {
    const entries: TaskHistoryEntry[] = [
      makeEntry({ taskId: "t2", taskTitle: "Second" }),
      makeEntry({ taskId: "t1", taskTitle: "First" }),
    ];

    const grouped = groupHistoryByTask(entries);
    expect(grouped[0].taskTitle).toBe("Second");
    expect(grouped[1].taskTitle).toBe("First");
  });

  test("single entry produces single group with one session", () => {
    const grouped = groupHistoryByTask([makeEntry()]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].sessions).toHaveLength(1);
  });

  test("empty array returns empty", () => {
    expect(groupHistoryByTask([])).toEqual([]);
  });
});

describe("formatHistoryContext", () => {
  test("returns null for empty array", () => {
    expect(formatHistoryContext([])).toBeNull();
  });

  test("single task, single session — no (X runs) suffix", () => {
    const result = formatHistoryContext([makeEntry()]);
    expect(result).not.toBeNull();
    expect(result).toContain("<task_history>");
    expect(result).toContain('Task("Send report email")');
    expect(result).not.toContain("runs)");
    expect(result).toContain("Tools: send_email");
    expect(result).toContain("2min");
    expect(result).toContain("Sent an email");
  });

  test("single task, multiple sessions — shows (X runs)", () => {
    const entries: TaskHistoryEntry[] = [
      makeEntry({ id: "h1", chatSessionId: "cs1", summary: "First run completed." }),
      makeEntry({ id: "h2", chatSessionId: "cs2", summary: "Second run completed." }),
      makeEntry({ id: "h3", chatSessionId: "cs3", summary: "Third run completed." }),
    ];

    const result = formatHistoryContext(entries)!;
    expect(result).toContain("(3 runs)");
    expect(result).toContain("First run completed.");
    expect(result).toContain("Second run completed.");
    expect(result).toContain("Third run completed.");
  });

  test("multiple tasks each listed separately", () => {
    const entries: TaskHistoryEntry[] = [
      makeEntry({ taskId: "t1", taskTitle: "Task A", summary: "A done." }),
      makeEntry({ taskId: "t2", taskTitle: "Task B", summary: "B done." }),
    ];

    const result = formatHistoryContext(entries)!;
    expect(result).toContain('Task("Task A")');
    expect(result).toContain('Task("Task B")');
    expect(result).toContain("A done.");
    expect(result).toContain("B done.");
  });

  test("missing toolCalls — no Tools section", () => {
    const result = formatHistoryContext([makeEntry({ toolCalls: null })])!;
    expect(result).not.toContain("Tools:");
  });

  test("empty toolCalls array — no Tools section", () => {
    const result = formatHistoryContext([makeEntry({ toolCalls: [] })])!;
    expect(result).not.toContain("Tools:");
  });

  test("missing durationSecs — no duration section", () => {
    const result = formatHistoryContext([makeEntry({ durationSecs: null })])!;
    expect(result).not.toContain("min");
  });

  test("multiple tool names comma-joined", () => {
    const result = formatHistoryContext([
      makeEntry({ toolCalls: ["send_email", "create_task", "search_emails"] }),
    ])!;
    expect(result).toContain("Tools: send_email, create_task, search_emails");
  });

  test("duration rounds to minutes", () => {
    // 90 seconds = 2 minutes (Math.round(90/60) = 2)
    const result = formatHistoryContext([makeEntry({ durationSecs: 90 })])!;
    expect(result).toContain("2min");

    // 30 seconds = 1 minute (Math.round(30/60) = 1 — rounds to nearest)
    const result2 = formatHistoryContext([makeEntry({ durationSecs: 30 })])!;
    expect(result2).toContain("1min");
  });

  test("wraps in <task_history> tags", () => {
    const result = formatHistoryContext([makeEntry()])!;
    expect(result).toContain("<task_history>");
    expect(result).toContain("</task_history>");
    expect(result).toContain("Recent task execution history for this assistant:");
  });
});
