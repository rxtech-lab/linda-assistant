import { Sandbox } from "@vercel/sandbox";
import { hasToolCall, tool, ToolLoopAgent } from "ai";
import { z } from "zod";
import { uploadBufferToS3 } from "../../s3";
import { CHART_GENERATION_MODEL } from "../context";
import { getModelProvider } from "../model";

const CJK_FONT_URL =
  "https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf";
const CJK_FONT_PATH = "/tmp/NotoSansCJKsc-Regular.otf";

const prompt = (
  description: string,
) => `You are a data visualization expert that creates beautiful, modern charts using Python and matplotlib.

Chart description: ${description}

## Style Guidelines — follow these for every chart:

1. **Theme**: Always start with plt.style.use('seaborn-v0_8-whitegrid') or a clean minimal style. Set figure background to white ('#FFFFFF') and axes background to white or very light gray ('#FAFAFA').

2. **Colors**: Use a modern, harmonious color palette. Good defaults:
   - Single series: '#4F46E5' (indigo)
   - Multi-series: ['#4F46E5', '#06B6D4', '#F59E0B', '#EF4444', '#10B981', '#8B5CF6', '#EC4899']
   - Avoid default matplotlib colors — they look dated

3. **Typography**:
   - Title: fontsize=16, fontweight='bold', pad=20, color='#1F2937'
   - Axis labels: fontsize=12, color='#374151'
   - Tick labels: fontsize=10, color='#6B7280'
   - **CJK fonts are pre-registered globally; do not configure \`font.family\` or \`font.sans-serif\` yourself.** Chinese/Japanese/Korean characters will render correctly out of the box.

4. **Layout**:
   - Figure size: at least (10, 6) for most charts, (8, 8) for pie charts
   - Remove top and right spines: ax.spines['top'].set_visible(False); ax.spines['right'].set_visible(False)
   - Use light gray gridlines: ax.grid(axis='y', alpha=0.3, color='#D1D5DB')
   - Add generous padding: plt.tight_layout(pad=2.0)

5. **Bar charts**: Use rounded-looking bars with edgecolor='none', width=0.6. Add value labels on top of bars.

6. **Line charts**: Use linewidth=2.5, add subtle markers (markersize=6). Add a light fill under lines with alpha=0.1.

7. **Pie charts**: Use a slight explode for emphasis, startangle=90, shadow=False. Add percentage labels with fontsize=11.

8. **Legend**: frameon=False, fontsize=10. Place outside the plot area when possible.

## Execution Steps:
1. Write Python code following the style guidelines above
2. Save the chart to /tmp/chart.png using plt.savefig('/tmp/chart.png', dpi=200, bbox_inches='tight', facecolor='white')
3. Use the runPython tool to execute the code
4. After the chart is saved, call the exportImage tool with path "/tmp/chart.png"
5. Do NOT print base64 in Python — the exportImage tool handles that`;

/**
 * Create a chart based on the provided data and chart description.
 * @param data - The data to be visualized in the chart.
 * @param chartDescription - A description of the chart to be created.
 * @returns A promise that resolves to a base64-encoded string representing the generated chart image.
 */
async function createChart(
  data: unknown,
  chartDescription: string,
): Promise<string> {
  console.log(
    "[createChart] Creating sandbox with teamId:",
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
  console.log("[createChart] Sandbox created successfully");

  try {
    // Install matplotlib and CJK font support
    console.log("[createChart] Installing matplotlib...");
    const installResult = await sandbox.runCommand("pip", [
      "install",
      "matplotlib",
    ]);
    if (installResult.exitCode !== 0) {
      const stderr = await installResult.stderr();
      console.error("[createChart] matplotlib install failed:", stderr);
      throw new Error(`Failed to install matplotlib: ${stderr}`);
    }
    console.log("[createChart] matplotlib installed");

    // Download CJK font directly (apt-get is unreliable in the sandbox).
    // The prompt tells matplotlib to load this file via font_manager.addfont.
    console.log("[createChart] Downloading CJK font to", CJK_FONT_PATH);
    const fontDownload = await sandbox.runCommand("curl", [
      "-fsSL",
      "--retry",
      "2",
      "-o",
      CJK_FONT_PATH,
      CJK_FONT_URL,
    ]);
    if (fontDownload.exitCode !== 0) {
      const stderr = await fontDownload.stderr();
      console.warn(
        "[createChart] CJK font download failed — Chinese text may not render:",
        stderr,
      );
    } else {
      // Clear matplotlib font cache so the new font is picked up
      await sandbox.runCommand("python", [
        "-c",
        "import matplotlib, shutil; shutil.rmtree(matplotlib.get_cachedir(), ignore_errors=True)",
      ]);

      // Defensive: install a sitecustomize.py that auto-registers the CJK font
      // and patches RcParams.__setitem__ so any mutation of font.sans-serif or
      // font.family ends up with the CJK font first. Every rcParams write path
      // (plt.style.use, rcdefaults, rcParams.update, direct subscript) funnels
      // through __setitem__, so the agent cannot accidentally produce tofu
      // glyphs by overwriting font.sans-serif after style.use.
      const sitecustomize = `import os
try:
    import matplotlib
    from matplotlib import font_manager, RcParams
    _font_path = ${JSON.stringify(CJK_FONT_PATH)}
    if os.path.exists(_font_path):
        font_manager.fontManager.addfont(_font_path)
        _cjk_name = font_manager.FontProperties(fname=_font_path).get_name()

        _orig_setitem = RcParams.__setitem__

        def _ensure_cjk_first(value):
            if isinstance(value, str):
                items = [v.strip() for v in value.split(',') if v.strip()]
            else:
                try:
                    items = [str(v) for v in value]
                except TypeError:
                    items = [str(value)]
            if _cjk_name in items:
                items.remove(_cjk_name)
            return [_cjk_name] + items

        def _patched_setitem(self, key, value):
            if key == 'font.sans-serif':
                value = _ensure_cjk_first(value)
            elif key == 'font.family':
                value = 'sans-serif'
            return _orig_setitem(self, key, value)

        RcParams.__setitem__ = _patched_setitem

        matplotlib.rcParams['font.family'] = 'sans-serif'
        matplotlib.rcParams['font.sans-serif'] = ['DejaVu Sans', 'sans-serif']
        matplotlib.rcParams['axes.unicode_minus'] = False
except Exception:
    pass
`;
      await sandbox.writeFiles([
        {
          path: "/tmp/sitecustomize.py",
          content: Buffer.from(sitecustomize, "utf-8"),
        },
      ]);
      console.log("[createChart] CJK font ready");
    }

    const agent = new ToolLoopAgent({
      model: getModelProvider(CHART_GENERATION_MODEL),
      instructions: prompt(chartDescription),
      stopWhen: hasToolCall("exportImage"),
      providerOptions: {
        gateway: { caching: "auto" },
      },
      tools: {
        runPython: tool({
          description: "Execute Python code in a sandboxed environment",
          inputSchema: z.object({
            code: z.string().describe("The Python code to execute"),
          }),
          execute: async ({ code }) => {
            console.log("[runPython] Executing code:\n", code);
            await sandbox.writeFiles([
              {
                path: "/tmp/script.py",
                content: Buffer.from(code, "utf-8"),
              },
            ]);
            const result = await sandbox.runCommand({
              cmd: "python",
              args: ["/tmp/script.py"],
              env: { PYTHONPATH: "/tmp" },
            });
            console.log(
              "[runPython] Command executed with exit code:",
              result.exitCode,
            );
            if (result.exitCode !== 0) {
              const stderr = await result.stderr();
              throw new Error(`Python execution failed: ${stderr}`);
            }
            const stdout = await result.stdout();
            return stdout || "Script executed successfully.";
          },
        }),
        exportImage: tool({
          description:
            "Read a generated image file and return its base64 encoding. Call this after saving a chart to export it.",
          inputSchema: z.object({
            path: z
              .string()
              .describe(
                "The file path of the image to export (e.g. /tmp/chart.png)",
              ),
          }),
          execute: async ({ path }) => {
            console.log("[exportImage] Reading file:", path);
            const buf = await sandbox.readFileToBuffer({ path });
            if (!buf || buf.length === 0) {
              throw new Error(`File not found or empty: ${path}`);
            }
            const base64 = buf.toString("base64");
            console.log("[exportImage] Base64 length:", base64.length);
            return base64;
          },
        }),
      },
    });

    console.log("[createChart] Starting agent generation...");
    const result = await agent.generate({
      prompt: `Create a chart with the following data:\n${JSON.stringify(data, null, 2)}`,
    });
    console.log("[createChart] Agent finished.");

    // Extract base64 from the exportImage tool result in the last step
    const steps = result.steps;
    for (let i = steps.length - 1; i >= 0; i--) {
      const step = steps[i];
      for (const toolResult of step.toolResults) {
        if (
          toolResult.toolName === "exportImage" &&
          typeof toolResult.output === "string"
        ) {
          return toolResult.output;
        }
      }
    }

    // Fallback: try extracting from text
    const base64 = extractBase64(result.text);
    if (!base64) {
      throw new Error("Agent did not produce a base64-encoded chart image");
    }
    return base64;
  } finally {
    console.log("[createChart] Stopping sandbox...");
    await sandbox.stop();
  }
}

/**
 * Extract a base64-encoded string from text.
 * Looks for a long continuous base64 string (PNG images are typically large).
 */
function extractBase64(text: string): string | null {
  // Match a base64 string (at least 100 chars to avoid false positives)
  const match = text.match(/[A-Za-z0-9+/]{100,}={0,2}/);
  return match ? match[0] : null;
}

async function createDrawingAndUpload(
  data: unknown,
  chartDescription: string,
): Promise<string> {
  // In E2E mode, skip Vercel Sandbox and upload a tiny test PNG
  if (process.env.IS_E2E?.toLowerCase() === "true") {
    const testPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
      "base64",
    );
    const { url } = await uploadBufferToS3(
      testPng,
      "image/png",
      `chart-${Date.now()}.png`,
      "drawings",
    );
    return url;
  }

  const base64Image = await createChart(data, chartDescription);
  const buffer = Buffer.from(base64Image, "base64");
  const filename = `chart-${Date.now()}.png`;
  const { url } = await uploadBufferToS3(
    buffer,
    "image/png",
    filename,
    "drawings",
  );
  return url;
}

export const createDrawingTool = () =>
  tool({
    description:
      "Create a chart or data visualization using Python and matplotlib. " +
      "Use this when the user asks for a chart, graph, plot, or data visualization, " +
      "or when adding visual data representations to documents or briefings. " +
      "Returns the URL of the generated chart image.",
    inputSchema: z.object({
      data: z
        .unknown()
        .describe(
          "The data to visualize (arrays, objects, key-value pairs, etc.)",
        ),
      chartDescription: z
        .string()
        .describe(
          "Detailed description of the chart to create, including chart type (bar, line, pie, etc.), " +
            "axis labels, title, colors, and any specific styling instructions",
        ),
    }),
    execute: async ({ data, chartDescription }) => {
      console.log(
        "[create_drawing] Starting with data:",
        JSON.stringify(data),
        "description:",
        chartDescription,
      );
      try {
        const url = await createDrawingAndUpload(data, chartDescription);
        console.log("[create_drawing] Success, URL:", url);
        return { url };
      } catch (err) {
        console.error("[create_drawing] Failed:", err);
        throw err;
      }
    },
  });

export const CREATE_DRAWING_TOOL_NAME = "create_drawing";
