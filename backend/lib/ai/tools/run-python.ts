import { Sandbox } from "@vercel/sandbox";
import { tool } from "ai";
import { z } from "zod";

/**
 * Execute Python code in a Vercel Sandbox environment.
 *
 * @param code - The Python code to execute.
 * @param packages - Optional list of pip packages to install before execution.
 * @returns The stdout output of the script (truncated to 10 000 chars).
 */
async function executePython(code: string, packages?: string[]): Promise<string> {
  console.log(
    "[executePython] Creating sandbox with teamId:",
    process.env.VERCEL_TEAM_ID,
    "projectId:",
    process.env.VERCEL_PROJECT_ID,
    "token present:",
    !!process.env.VERCEL_TOKEN,
  );
  const sandbox = await Sandbox.create({
    teamId: process.env.VERCEL_TEAM_ID!,
    projectId: process.env.VERCEL_PROJECT_ID!,
    token: process.env.VERCEL_TOKEN!,
    runtime: "python3.13",
  });
  console.log("[executePython] Sandbox created successfully");

  try {
    // Install requested pip packages
    if (packages && packages.length > 0) {
      console.log("[executePython] Installing packages:", packages);
      const installResult = await sandbox.runCommand("pip", ["install", ...packages]);
      if (installResult.exitCode !== 0) {
        const stderr = await installResult.stderr();
        console.error("[executePython] pip install failed:", stderr);
        throw new Error(`Failed to install packages: ${stderr}`);
      }
      console.log("[executePython] Packages installed");
    }

    // Write and execute the script
    await sandbox.writeFiles([
      {
        path: "/tmp/script.py",
        content: Buffer.from(code, "utf-8"),
      },
    ]);

    const result = await sandbox.runCommand("python", ["/tmp/script.py"]);
    console.log("[executePython] Command executed with exit code:", result.exitCode);

    if (result.exitCode !== 0) {
      const stderr = await result.stderr();
      throw new Error(`Python execution failed:\n${stderr}`);
    }

    const stdout = await result.stdout();
    const MAX_OUTPUT = 10_000;
    if (stdout.length > MAX_OUTPUT) {
      return `${stdout.slice(0, MAX_OUTPUT)}\n... (output truncated at ${MAX_OUTPUT} characters)`;
    }
    return stdout || "Script executed successfully (no output).";
  } finally {
    console.log("[executePython] Stopping sandbox...");
    await sandbox.stop();
  }
}

export const runPythonTool = () =>
  tool({
    description:
      "Execute arbitrary Python code in a secure sandboxed environment. " +
      "Use this when the user asks you to run Python code, perform calculations, " +
      "data processing, text manipulation, or any general-purpose computation. " +
      "You can optionally specify pip packages to install before execution. " +
      "Returns the standard output of the script.",
    inputSchema: z.object({
      code: z.string().describe("The Python code to execute"),
      packages: z
        .array(z.string())
        .optional()
        .describe(
          "Optional list of pip packages to install before running the code " +
            "(e.g. ['requests', 'pandas', 'numpy'])",
        ),
    }),
    execute: async ({ code, packages }) => {
      console.log(
        "[run_python] Starting execution, code length:",
        code.length,
        "packages:",
        packages,
      );
      // In E2E mode, skip Vercel Sandbox and return a stub result
      if (process.env.IS_E2E?.toLowerCase() === "true") {
        return { output: "E2E stub: Python execution skipped." };
      }
      try {
        const output = await executePython(code, packages);
        console.log("[run_python] Success, output length:", output.length);
        return { output };
      } catch (err) {
        console.error("[run_python] Failed:", err);
        throw err;
      }
    },
  });

export const RUN_PYTHON_TOOL_NAME = "run_python";
