import { test as base, expect } from "@playwright/test";
import { ensureOnboarded } from "./onboard.utils";
import {
  createAssignee,
  deleteAssignee,
  getAssignee,
  sendMessage,
  consumeStream,
  getChatHistory,
  updateAssigneePermissions,
  findToolCallParts,
  findToolResultParts,
  listChatDocuments,
} from "./chat.utils";

const test = base.extend<{ assigneeId: string }>({
  assigneeId: async ({}, use, testInfo) => {
    await ensureOnboarded();
    const id = await createAssignee(`e2e-drawing-${testInfo.testId}`);
    console.log(`Created assignee ${id} for: ${testInfo.title}`);

    // Auto-confirm create_drawing and create_document so the agent can proceed
    const assignee = await getAssignee(id);
    const perms = assignee.toolPermissions.map((tp) => ({
      toolName: tp.toolName,
      permission:
        tp.toolName === "create_drawing" || tp.toolName === "create_document"
          ? "auto-confirm"
          : "manual-confirm",
    }));
    await updateAssigneePermissions(id, perms);

    await use(id);

    await deleteAssignee(id);
    console.log(`Deleted assignee ${id}`);
  },
});

test.describe("Agent Drawing", () => {
  test.setTimeout(300_000);

  test("creates a bar chart and embeds it in a document with S3 image URL", async ({
    assigneeId,
  }) => {
    const stream = consumeStream(assigneeId, {
      timeout: 180_000,
      label: "drawing",
    });

    try {
      await sendMessage(
        assigneeId,
        "Create a simple bar chart with this data: Q1=100, Q2=150, Q3=200, Q4=175. " +
          "Then create a document called 'Quarterly Sales' that includes the chart image. " +
          "Use the create_drawing tool first, then use create_document to write the report with the chart embedded as a markdown image. " +
          "Only use create_drawing and create_document. " +
          "Do NOT call search_emails, search_documents, search_history, or any other tool under any circumstances. " +
          "If create_drawing fails, retry it with adjusted arguments — do not search for anything.",
      );
      await stream.waitForDone();

      // Verify create_drawing tool was called and at least one returned a URL
      const drawingResults = stream.events.filter(
        (e) =>
          e.event === "tool-result" &&
          e.data.toolName === "create_drawing" &&
          !e.data.isError,
      );
      console.log("Successful drawing results:", drawingResults);
      expect(drawingResults.length).toBeGreaterThanOrEqual(1);
      const drawingOutput = drawingResults[0]!.data.output as { url: string };
      expect(drawingOutput.url).toBeTruthy();
      expect(typeof drawingOutput.url).toBe("string");
      console.log("Drawing URL:", drawingOutput.url);

      // Verify create_document tool was called
      const docResults = stream.events.filter(
        (e) =>
          e.event === "tool-result" && e.data.toolName === "create_document",
      );
      expect(docResults.length).toBeGreaterThanOrEqual(1);

      // Verify chat history contains both tool calls
      const { messages } = await getChatHistory(assigneeId);
      const drawingCalls = findToolCallParts(messages, "create_drawing");
      expect(drawingCalls.length).toBeGreaterThanOrEqual(1);

      const docCalls = findToolCallParts(messages, "create_document");
      expect(docCalls.length).toBeGreaterThanOrEqual(1);

      // Verify the document was saved and contains the S3 image URL
      const docs = await listChatDocuments(assigneeId);
      expect(docs.length).toBeGreaterThanOrEqual(1);

      // check docs contain
      const docMarkdown = docs[0]?.content!;

      //check markdown image syntax ![alt text](image_url)
      const markdownImageRegex = /!\[.*\]\((.*)\)/;
      const match = docMarkdown.match(markdownImageRegex);
      expect(match).toBeTruthy();
      const imageUrlInDoc = match![1];
      expect(imageUrlInDoc).toBe(drawingOutput.url);

      console.log(
        `Test passed: Document contains markdown image with URL ${imageUrlInDoc}`,
      );
    } finally {
      stream.cancel();
    }
  });
});
