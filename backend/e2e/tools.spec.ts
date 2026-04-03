import { test, expect } from "@playwright/test";
import { toolsResponseSchema } from "./helpers/schemas";

const SYSTEM_TOOLS_NO_PERMISSION_CHANGE = [
  "update_document",
  "create_document",
  "search_documents",
  "create_briefing",
  "send_notification",
  "generate_image",
  "create_slides",
  "update_slides",
  "search_history",
  "read_uploaded_file",
  "search_tools",
  "read_tool",
  "use_tool",
];

test.describe("Tools API", () => {
  test("GET /api/tools returns available tools", async ({ request }) => {
    const res = await request.get("/api/tools");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    toolsResponseSchema.parse(body);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(4);

    const toolNames = body.map((t: { name: string }) => t.name);
    expect(toolNames).toContain("send_email");
    expect(toolNames).toContain("search_emails");
    expect(toolNames).toContain("create_task");
    expect(toolNames).toContain("update_task");

    // Each tool has required fields
    for (const tool of body) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(["auto-confirm", "manual-confirm", "auto-reject", "disabled"]).toContain(
        tool.defaultPermission,
      );
    }
  });

  test("GET /api/tools includes disablePermissionChange for system tools", async ({ request }) => {
    const res = await request.get("/api/tools");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();

    for (const tool of body) {
      if (SYSTEM_TOOLS_NO_PERMISSION_CHANGE.includes(tool.name)) {
        expect(tool.disablePermissionChange).toBe(true);
      } else {
        expect(tool.disablePermissionChange).toBeUndefined();
      }
    }
  });

  test("GET /api/tools requires auth", async ({ request }) => {
    const res = await request.fetch("/api/tools", {
      headers: { authorization: "" },
    });
    expect(res.status()).toBe(401);
  });
});
