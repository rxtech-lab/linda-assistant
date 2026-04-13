import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { test as base, expect } from "@playwright/test";
import { ensureOnboarded } from "./onboard.utils";
import {
  createAssigneeWithModel,
  deleteAssignee,
  getAssignee,
  sendMessage,
  sendMessageWithAttachments,
  consumeStream,
  getChatHistory,
  updateAssigneePermissions,
  findToolCallParts,
  findToolResultParts,
  uploadFileToS3,
  getDataSheet,
  getDataSheetRows,
  deleteDataSheet,
} from "./chat.utils";

const GEMMA_MODEL = "google/gemini-3.1-flash-lite-preview";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, "assets");

const test = base.extend<{ assigneeId: string }>({
  assigneeId: async ({}, use, testInfo) => {
    await ensureOnboarded();
    const id = await createAssigneeWithModel(
      `e2e-chat-file-${testInfo.testId}`,
      GEMMA_MODEL,
    );
    console.log(`Created assignee ${id} (gemma) for: ${testInfo.title}`);

    // Auto-confirm all tools so the agent can freely use them
    const assignee = await getAssignee(id);
    const perms = assignee.toolPermissions.map((tp) => ({
      toolName: tp.toolName,
      permission: "auto-confirm",
    }));
    await updateAssigneePermissions(id, perms);

    await use(id);

    await deleteAssignee(id);
    console.log(`Deleted assignee ${id}`);
  },
});

test.describe.serial("Chat with file uploads", () => {
  test.setTimeout(300_000);

  test("upload image from online and markdown file, verify agent knows content", async ({
    assigneeId,
  }) => {
    // Step 1: Upload markdown to S3 directly and send as attachment
    const mdContent = fs.readFileSync(
      path.join(ASSETS_DIR, "test-document.md"),
    );
    const { publicUrl: mdUrl, key: mdKey } = await uploadFileToS3(
      mdContent,
      "text/markdown",
      "md",
    );
    console.log(`Uploaded markdown to S3: ${mdKey}`);

    const stream = consumeStream(assigneeId, {
      timeout: 180_000,
      label: "image-and-md",
    });

    try {
      // Step 2: Send message with both image (online URL) and markdown (S3 URL) as attachments
      await sendMessageWithAttachments(
        assigneeId,
        "I attached a pure red color image and a markdown document. What color is the image? And what is the project name mentioned in the markdown file? Use the read_uploaded_file tool to read the document content. Answer both questions.",
        [
          {
            type: "image",
            url: "https://placehold.co/100x100/ff0000/ff0000.png",
            name: "red-square.png",
            mimeType: "image/png",
          },
          {
            type: "file",
            url: mdUrl,
            key: mdKey,
            name: "test-document.md",
            mimeType: "text/markdown",
          },
        ],
      );
      await stream.waitForDone();

      // Step 3: Verify read_uploaded_file was called for the markdown
      const { messages } = await getChatHistory(assigneeId);
      const readFileCalls = findToolCallParts(messages, "read_uploaded_file");
      expect(readFileCalls.length).toBeGreaterThanOrEqual(1);
      console.log(
        `read_uploaded_file was called ${readFileCalls.length} time(s)`,
      );

      // Step 4: Verify agent response mentions both color and project name
      const assistantMessages = messages.filter((m) => m.role === "assistant");
      expect(assistantMessages.length).toBeGreaterThanOrEqual(1);

      const lastAssistant = assistantMessages[assistantMessages.length - 1]!;
      const textParts = Array.isArray(lastAssistant.content)
        ? lastAssistant.content
            .filter((p) => p.type === "text")
            .map((p) => (p.text as string).toLowerCase())
            .join(" ")
        : String(lastAssistant.content).toLowerCase();

      expect(textParts).toContain("red");
      expect(textParts).toMatch(/project\s*alpha/i);
      console.log("Agent correctly identified image color and project name");
    } finally {
      stream.cancel();
    }
  });

  test("upload CSV with ranks and create filtered data sheet with rank > 8", async ({
    assigneeId,
  }) => {
    // Step 1: Upload CSV to S3 directly and send as attachment
    const csvContent = fs.readFileSync(path.join(ASSETS_DIR, "test-ranks.csv"));
    const { publicUrl: csvUrl, key: csvKey } = await uploadFileToS3(
      csvContent,
      "text/csv",
      "csv",
    );
    console.log(`Uploaded CSV to S3: ${csvKey}`);

    const uploadStream = consumeStream(assigneeId, {
      timeout: 180_000,
      label: "csv-upload",
    });

    try {
      // Step 2: Send CSV as attachment and ask agent to read it
      await sendMessageWithAttachments(
        assigneeId,
        "I attached a CSV file with columns: name, department, rank (values 0-10). Please read the file content using read_uploaded_file. Do not use any other tools yet. Do not repeat the table data in your response, just confirm you read it.",
        [
          {
            type: "file",
            url: csvUrl,
            key: csvKey,
            name: "test-ranks.csv",
            mimeType: "text/csv",
          },
        ],
      );
      await uploadStream.waitForDone();
    } finally {
      uploadStream.cancel();
    }

    // Step 3: Ask agent to create a data sheet with rank > 8
    const stream = consumeStream(assigneeId, {
      timeout: 240_000,
      label: "data-sheet-create",
    });

    let sheetId: string | undefined;

    try {
      await sendMessage(
        assigneeId,
        "Create a data sheet containing only the rows from the CSV where rank is greater than 8. Include all columns (name, department, rank). Use the create_data_sheet tool. You must provide all required parameters: title, description (a detailed description of the transformation), and data (the filtered rows as JSON array).",
      );
      await stream.waitForDone();

      // Step 4: Verify create_data_sheet was called successfully
      const sheetToolResults = stream.events.filter(
        (e) =>
          e.event === "tool-result" &&
          e.data.toolName === "create_data_sheet" &&
          !e.data.isError,
      );
      expect(sheetToolResults.length).toBeGreaterThanOrEqual(1);

      const output = sheetToolResults[0]!.data.output as {
        sheetId: string;
        title: string;
        rowCount: number;
        columns: Array<{ name: string; type: string }>;
      };
      expect(output.sheetId).toBeTruthy();
      sheetId = output.sheetId;
      console.log(
        `Data sheet created: ${sheetId} (${output.rowCount} rows, ${output.columns.length} columns)`,
      );

      // Step 5: Verify sheet metadata via API
      const sheet = await getDataSheet(sheetId);
      expect(sheet.id).toBe(sheetId);
      expect(sheet.title).toBeTruthy();
      expect(sheet.columns.length).toBeGreaterThan(0);
      expect(sheet.rowCount).toBeGreaterThan(0);
      console.log(
        `Sheet metadata: "${sheet.title}", ${sheet.rowCount} rows, columns: ${sheet.columns.map((c) => c.name).join(", ")}`,
      );

      // Step 6: Verify rows via API — all rows should have rank > 8
      const rowsResponse = await getDataSheetRows(sheetId);
      expect(rowsResponse.data.length).toBeGreaterThan(0);
      console.log(
        `Fetched ${rowsResponse.data.length} rows (total: ${rowsResponse.pagination.total})`,
      );

      // Find the rank column (may be named "rank" or similar)
      const rankKey = Object.keys(rowsResponse.data[0]!).find(
        (k) => k.toLowerCase() === "rank",
      );
      expect(rankKey).toBeTruthy();

      for (const row of rowsResponse.data) {
        const rankValue = Number(row[rankKey!]);
        expect(rankValue).toBeGreaterThan(8);
        console.log(`  Row: ${row.name ?? "?"} — rank ${rankValue} (> 8 ✓)`);
      }

      // Expected: Alice(9), Charlie(10), Grace(9), Ivy(10) = 4 rows
      expect(rowsResponse.data.length).toBe(4);
      console.log("All data sheet rows correctly filtered to rank > 8");
    } finally {
      stream.cancel();
      if (sheetId) {
        await deleteDataSheet(sheetId).catch(() => {});
        console.log(`Cleaned up data sheet ${sheetId}`);
      }
    }
  });
});
