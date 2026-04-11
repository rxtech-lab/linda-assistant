import { Sandbox } from "@vercel/sandbox";
import { hasToolCall, tool, ToolLoopAgent } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { dataSheets, type DataSheetColumn } from "@/lib/db/schema";
import { uploadBufferToS3 } from "@/lib/s3";
import { publishEvent } from "@/lib/queue/producer";
import { DATA_SHEET_GENERATION_MODEL } from "../context";
import { getModelProvider } from "../model";

const DATA_SHEET_AGENT_PROMPT = `You are a data analysis expert that transforms and analyzes tabular data using Python and pandas.

## Your Workflow

1. Load the input data from /tmp/input.json (it's a JSON array of objects/rows)
2. Use pandas to perform the requested transformation or analysis
3. Save the result to /tmp/result.json as a JSON array of objects (orient="records")
4. Call exportResult to finalize

## Guidelines

- Always use pandas for data manipulation
- Output clean, well-structured data
- Handle missing values gracefully (fill with null, not NaN — use .where(pd.notnull(df), None))
- For aggregations, reset the index so the result is a flat table
- Always save result as: df.to_json('/tmp/result.json', orient='records', force_ascii=False, date_format='iso')
- If the input data is a URL (S3 file), download it first:
  \`\`\`python
  import urllib.request
  urllib.request.urlretrieve(url, '/tmp/input.json')
  \`\`\`
- For CSV/Excel input files from S3, load with the appropriate pandas reader
- Print a brief summary of the result (shape, columns, first few rows) after saving

## Execution Steps

1. Write and run Python code using the runPython tool
2. After saving /tmp/result.json, call exportResult with path "/tmp/result.json"
3. Do NOT print the full result data — the exportResult tool handles reading it`;

/**
 * Emit a tool-progress SSE event for data sheet generation.
 */
async function emitSheetProgress(
  chatSessionId: string,
  toolCallId: string,
  opts: {
    step: string;
    message: string;
  },
) {
  await publishEvent({
    sessionId: chatSessionId,
    event: "tool-progress",
    data: {
      toolCallId,
      toolName: CREATE_DATA_SHEET_TOOL_NAME,
      current: 0,
      total: 0,
      step: opts.step,
      message: opts.message,
    },
    timestamp: Date.now(),
  });
}

/**
 * Infer column types from the first few rows of data.
 */
function inferColumns(rows: Record<string, unknown>[]): DataSheetColumn[] {
  if (rows.length === 0) return [];
  const sample = rows.slice(0, 50);
  const allKeys = new Set<string>();
  for (const row of sample) {
    for (const key of Object.keys(row)) {
      allKeys.add(key);
    }
  }

  return Array.from(allKeys).map((name) => {
    const values = sample.map((r) => r[name]).filter((v) => v != null);
    if (values.length === 0) return { name, type: "string" as const };

    if (values.every((v) => typeof v === "boolean")) return { name, type: "boolean" as const };
    if (values.every((v) => typeof v === "number")) return { name, type: "number" as const };

    // Check if values look like ISO dates
    const isoDatePattern = /^\d{4}-\d{2}-\d{2}/;
    if (values.every((v) => typeof v === "string" && isoDatePattern.test(v))) {
      return { name, type: "date" as const };
    }

    return { name, type: "string" as const };
  });
}

const INLINE_DATA_THRESHOLD = 500; // rows

/**
 * Run pandas transformation in Vercel Sandbox and return result data.
 */
async function runDataAnalysis(
  description: string,
  inputData: unknown | undefined,
  s3FileUrl: string | undefined,
  chatSessionId: string,
  toolCallId: string,
): Promise<{ rows: Record<string, unknown>[]; columns: DataSheetColumn[] }> {
  await emitSheetProgress(chatSessionId, toolCallId, {
    step: "planning",
    message: "Setting up data analysis environment",
  });

  const sandbox = await Sandbox.create({
    teamId: process.env.VERCEL_TEAM_ID!,
    projectId: process.env.VERCEL_PROJECT_ID!,
    token: process.env.VERCEL_TOKEN!,
    runtime: "python3.13",
  });

  try {
    // Install pandas
    const installResult = await sandbox.runCommand("pip", ["install", "pandas"]);
    if (installResult.exitCode !== 0) {
      const stderr = await installResult.stderr();
      throw new Error(`Failed to install pandas: ${stderr}`);
    }

    // Write input data to sandbox if provided inline
    if (inputData) {
      const inputJson = JSON.stringify(inputData);
      await sandbox.writeFiles([
        { path: "/tmp/input.json", content: Buffer.from(inputJson, "utf-8") },
      ]);
    }

    await emitSheetProgress(chatSessionId, toolCallId, {
      step: "transforming",
      message: "Running data transformation",
    });

    const agent = new ToolLoopAgent({
      model: getModelProvider(DATA_SHEET_GENERATION_MODEL),
      instructions: DATA_SHEET_AGENT_PROMPT,
      stopWhen: hasToolCall("exportResult"),
      providerOptions: {
        gateway: { caching: "auto" },
      },
      tools: {
        runPython: tool({
          description: "Execute Python code in a sandboxed environment with pandas available",
          inputSchema: z.object({
            code: z.string().describe("The Python code to execute"),
          }),
          execute: async ({ code }) => {
            console.log("[runPython:dataSheet] Executing code:\n", code);
            await sandbox.writeFiles([
              { path: "/tmp/script.py", content: Buffer.from(code, "utf-8") },
            ]);
            const result = await sandbox.runCommand("python", ["/tmp/script.py"]);
            if (result.exitCode !== 0) {
              const stderr = await result.stderr();
              throw new Error(`Python execution failed: ${stderr}`);
            }
            const stdout = await result.stdout();
            return stdout || "Script executed successfully.";
          },
        }),
        exportResult: tool({
          description:
            "Read the result JSON file after saving it with pandas. " +
            "Call this after saving the result to /tmp/result.json.",
          inputSchema: z.object({
            path: z
              .string()
              .describe("The file path of the result JSON (e.g. /tmp/result.json)"),
          }),
          execute: async ({ path }) => {
            const buf = await sandbox.readFileToBuffer({ path });
            if (!buf || buf.length === 0) {
              throw new Error(`File not found or empty: ${path}`);
            }
            return buf.toString("utf-8");
          },
        }),
      },
    });

    // Build the prompt for the agent
    let prompt = `Analyze and transform the following data as described:\n\nDescription: ${description}\n\n`;
    if (s3FileUrl) {
      prompt += `The input data is available at this URL: ${s3FileUrl}\nDownload it first, then process it.\n`;
    } else {
      prompt += `The input data has been saved to /tmp/input.json. Load it with:\nimport pandas as pd\ndf = pd.read_json('/tmp/input.json')\n`;
    }

    const result = await agent.generate({ prompt });

    await emitSheetProgress(chatSessionId, toolCallId, {
      step: "exporting",
      message: "Processing results",
    });

    // Extract result from the exportResult tool output
    const steps = result.steps;
    for (let i = steps.length - 1; i >= 0; i--) {
      const step = steps[i];
      for (const toolResult of step.toolResults) {
        if (toolResult.toolName === "exportResult" && typeof toolResult.output === "string") {
          const rows = JSON.parse(toolResult.output) as Record<string, unknown>[];
          const columns = inferColumns(rows);
          return { rows, columns };
        }
      }
    }

    throw new Error("Agent did not produce result data");
  } finally {
    await sandbox.stop();
  }
}

export const createDataSheetTool = (userId: string, chatSessionId: string) =>
  tool({
    description:
      "Create a data sheet by analyzing and transforming tabular data using Python and pandas. " +
      "Use this when the user asks to analyze, transform, filter, aggregate, pivot, clean, or " +
      "summarize tabular data. Supports input as inline JSON data or an S3 file URL for large " +
      "datasets. Returns the sheet ID, title, row count, and column metadata. " +
      "Do NOT embed the sheet ID or any sheet syntax in your chat response — the data sheet " +
      "view is rendered automatically from the tool call. Just mention what you created by title.",
    inputSchema: z.object({
      title: z.string().describe("Title of the data sheet"),
      description: z
        .string()
        .describe(
          "Detailed description of the data analysis or transformation to perform. " +
            "Include what columns to create, aggregations, filters, pivots, etc.",
        ),
      data: z
        .unknown()
        .optional()
        .describe(
          "Inline JSON data (array of objects or nested structure). Use for small datasets.",
        ),
      s3FileUrl: z
        .string()
        .optional()
        .describe(
          "S3 URL of a file containing the data (CSV, JSON, Excel). Use for large datasets.",
        ),
    }),
    execute: async ({ title, description, data, s3FileUrl }, { toolCallId }) => {
      console.log(`[create_data_sheet] Starting: "${title}"`);

      // E2E mode shortcut
      if (process.env.IS_E2E?.toLowerCase() === "true") {
        const testData = [
          { name: "Test", value: 1 },
          { name: "Data", value: 2 },
        ];
        const testColumns: DataSheetColumn[] = [
          { name: "name", type: "string" },
          { name: "value", type: "number" },
        ];
        const buf = Buffer.from(JSON.stringify(testData), "utf-8");
        const { url: s3Url } = await uploadBufferToS3(
          buf,
          "application/json",
          `data-sheet-${Date.now()}.json`,
          "data-sheets",
        );

        const [sheet] = await db
          .insert(dataSheets)
          .values({
            userId,
            chatSessionId,
            title,
            description,
            columns: testColumns,
            rowCount: testData.length,
            s3DataUrl: s3Url,
            inlineData: testData,
          })
          .returning();

        return {
          sheetId: sheet.id,
          title: sheet.title,
          rowCount: testData.length,
          columns: testColumns,
        };
      }

      try {
        const { rows, columns } = await runDataAnalysis(
          description,
          data,
          s3FileUrl,
          chatSessionId,
          toolCallId,
        );

        // Upload result to S3
        const resultJson = JSON.stringify(rows);
        const buf = Buffer.from(resultJson, "utf-8");
        const { url: s3Url } = await uploadBufferToS3(
          buf,
          "application/json",
          `data-sheet-${Date.now()}.json`,
          "data-sheets",
        );

        // Store in DB
        const [sheet] = await db
          .insert(dataSheets)
          .values({
            userId,
            chatSessionId,
            title,
            description,
            columns,
            rowCount: rows.length,
            s3DataUrl: s3Url,
            inlineData: rows.length <= INLINE_DATA_THRESHOLD ? rows : undefined,
          })
          .returning();

        await emitSheetProgress(chatSessionId, toolCallId, {
          step: "complete",
          message: `Data sheet created: ${rows.length} rows, ${columns.length} columns`,
        });

        console.log(
          `[create_data_sheet] Done: ${rows.length} rows, ${columns.length} columns`,
        );
        return {
          sheetId: sheet.id,
          title: sheet.title,
          rowCount: rows.length,
          columns,
        };
      } catch (err) {
        console.error("[create_data_sheet] Failed:", err);
        throw err;
      }
    },
  });

export const CREATE_DATA_SHEET_TOOL_NAME = "create_data_sheet";
