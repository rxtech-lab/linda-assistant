import { tool } from "ai";
import { z } from "zod";
import { createMCPClient } from "@ai-sdk/mcp";
import type { AuthConfig } from "./mcps/generic";
import type { ToolPermission } from "@/lib/db/schema";
import { resolvePermissionWithConditions } from "./permission";

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

/** Minimal metadata for a single MCP tool (no parameters). */
export interface McpToolSummary {
  /** Prefixed tool ID, e.g. "invoice_create_invoice" */
  id: string;
  /** Raw (unprefixed) tool name from the MCP server */
  name: string;
  /** Human-readable description from the MCP server */
  description: string;
  /** Which extension this tool belongs to */
  extensionPrefix: string;
}

/** Full tool detail including parameters. */
export interface McpToolDetail extends McpToolSummary {
  parameters: Array<{
    name: string;
    type: string;
    description?: string;
    required: boolean;
  }>;
}

/** Represents one enabled extension that can be lazily loaded. */
export interface LazyExtensionConfig {
  prefix: string;
  mcpUrl: string;
  auth: AuthConfig;
  extToolPermissions: ToolPermission[] | null;
}

// ────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────

function buildHeaders(auth: AuthConfig): Record<string, string> {
  switch (auth.type) {
    case "rxauth":
      return { Authorization: `Bearer ${auth.accessToken}` };
    case "api_key":
      return { Authorization: `Bearer ${auth.apiKey}` };
    case "none":
      return {};
  }
}

/**
 * Check if a tool is allowed (not auto-reject / disabled) based on permissions.
 */
function isToolAllowed(
  toolName: string,
  prefix: string,
  toolPermissions: ToolPermission[] | null,
): boolean {
  const prefixedName = `${prefix}${toolName}`;
  let resolved = resolvePermissionWithConditions(prefixedName, toolPermissions);
  if (resolved.permission === "manual-confirm" && toolPermissions?.length) {
    const unprefixed = resolvePermissionWithConditions(toolName, toolPermissions);
    if (unprefixed.permission !== "manual-confirm") {
      resolved = unprefixed;
    }
  }
  return resolved.permission !== "auto-reject" && resolved.permission !== "disabled";
}

/**
 * Discover available tools from all enabled extensions, filtered by permissions.
 * Returns summaries only (no parameters) to save tokens.
 */
async function discoverAllTools(extensions: LazyExtensionConfig[]): Promise<McpToolSummary[]> {
  const results: McpToolSummary[] = [];

  const settled = await Promise.allSettled(
    extensions.map(async (ext) => {
      const client = await createMCPClient({
        transport: { type: "http", url: ext.mcpUrl, headers: buildHeaders(ext.auth) },
      });
      try {
        const listing = await client.listTools();
        const tools: McpToolSummary[] = [];
        for (const t of listing.tools) {
          if (!isToolAllowed(t.name, ext.prefix, ext.extToolPermissions)) continue;
          tools.push({
            id: `${ext.prefix}${t.name}`,
            name: t.name,
            description: t.description ?? "",
            extensionPrefix: ext.prefix,
          });
        }
        return tools;
      } finally {
        await client.close().catch(() => {});
      }
    }),
  );

  for (const s of settled) {
    if (s.status === "fulfilled") results.push(...s.value);
  }

  return results;
}

/**
 * Find the extension config that owns a prefixed tool ID.
 */
function findExtensionForTool(
  toolId: string,
  extensions: LazyExtensionConfig[],
): LazyExtensionConfig | undefined {
  return extensions.find((ext) => toolId.startsWith(ext.prefix));
}

/**
 * Parse JSON Schema properties into a simple parameter list.
 */
function parseJsonSchemaParams(
  schema: Record<string, unknown> | undefined,
): McpToolDetail["parameters"] {
  if (!schema) return [];
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = new Set((schema.required as string[]) ?? []);
  return Object.entries(properties).map(([name, prop]) => ({
    name,
    type: (prop.type as string) ?? "string",
    description: (prop.description as string) || undefined,
    required: required.has(name),
  }));
}

// ────────────────────────────────────────────────────────────
// Tool name constants
// ────────────────────────────────────────────────────────────
export const SEARCH_TOOLS_TOOL_NAME = "search_tools";
export const READ_TOOL_TOOL_NAME = "read_tool";
export const USE_TOOL_TOOL_NAME = "use_tool";

// ────────────────────────────────────────────────────────────
// Tool factories
// ────────────────────────────────────────────────────────────

/**
 * search_tools — search available extension tools by keyword.
 * Returns tool id, name, description (no parameters) to save tokens.
 */
export function searchToolsTool(extensions: LazyExtensionConfig[]) {
  return tool({
    description:
      "Search available extension tools by keyword. Returns matching tool IDs, names, and descriptions (no parameters). Use read_tool to get full parameter details for specific tools before calling them with use_tool.",
    needsApproval: false,
    inputSchema: z.object({
      query: z.string().describe("Keyword or phrase to search for in tool names and descriptions"),
    }),
    execute: async ({ query }) => {
      if (extensions.length === 0) {
        return { tools: [], message: "No extensions are enabled." };
      }

      const allTools = await discoverAllTools(extensions);
      const q = query.toLowerCase();
      const matches = allTools.filter(
        (t) =>
          t.id.toLowerCase().includes(q) ||
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q),
      );

      return {
        tools: matches.map(({ id, name, description, extensionPrefix }) => ({
          id,
          name,
          description,
          extensionPrefix,
        })),
      };
    },
  });
}

/**
 * read_tool — get full details (including parameters) for one or more tools by ID.
 */
export function readToolTool(extensions: LazyExtensionConfig[]) {
  return tool({
    description:
      "Get full details (including input parameters) for one or more extension tools by their IDs. Use this after search_tools to inspect a tool's parameters before calling it with use_tool.",
    needsApproval: false,
    inputSchema: z.object({
      toolIds: z
        .array(z.string())
        .min(1)
        .describe("Array of tool IDs (prefixed names) to read details for"),
    }),
    execute: async ({ toolIds }) => {
      if (extensions.length === 0) {
        return { tools: [], errors: ["No extensions are enabled."] };
      }

      const results: McpToolDetail[] = [];
      const errors: string[] = [];

      // Group tool IDs by extension
      const byExtension = new Map<LazyExtensionConfig, string[]>();
      for (const toolId of toolIds) {
        const ext = findExtensionForTool(toolId, extensions);
        if (!ext) {
          errors.push(`Tool "${toolId}" not found: no matching enabled extension.`);
          continue;
        }
        const list = byExtension.get(ext) ?? [];
        list.push(toolId);
        byExtension.set(ext, list);
      }

      // Fetch details from each extension
      const settled = await Promise.allSettled(
        Array.from(byExtension.entries()).map(async ([ext, ids]) => {
          const client = await createMCPClient({
            transport: { type: "http", url: ext.mcpUrl, headers: buildHeaders(ext.auth) },
          });
          try {
            const listing = await client.listTools();
            const details: McpToolDetail[] = [];
            for (const id of ids) {
              const rawName = id.slice(ext.prefix.length);
              const tDef = listing.tools.find((t) => t.name === rawName);
              if (!tDef) {
                errors.push(`Tool "${id}" not found on the extension server.`);
                continue;
              }
              if (!isToolAllowed(rawName, ext.prefix, ext.extToolPermissions)) {
                errors.push(`Tool "${id}" is not available (disabled or rejected by permissions).`);
                continue;
              }
              details.push({
                id,
                name: rawName,
                description: tDef.description ?? "",
                extensionPrefix: ext.prefix,
                parameters: parseJsonSchemaParams(
                  tDef.inputSchema as Record<string, unknown> | undefined,
                ),
              });
            }
            return details;
          } finally {
            await client.close().catch(() => {});
          }
        }),
      );

      for (const s of settled) {
        if (s.status === "fulfilled") results.push(...s.value);
        else errors.push(`Failed to load tool details: ${String(s.reason)}`);
      }

      return { tools: results, errors: errors.length > 0 ? errors : undefined };
    },
  });
}

/**
 * use_tool — execute an extension tool by its prefixed ID with given parameters.
 */
export function useToolTool(extensions: LazyExtensionConfig[]) {
  return tool({
    description:
      "Execute an extension tool by its ID with given parameters. Use search_tools and read_tool first to find and inspect tools. Pass the tool ID and a parameters object matching the tool's input schema.",
    needsApproval: false,
    inputSchema: z.object({
      toolId: z.string().describe("The prefixed tool ID (e.g. 'invoice_create_invoice')"),
      parameters: z
        .record(z.unknown())
        .describe("Input parameters for the tool, matching its input schema"),
    }),
    execute: async ({ toolId, parameters }) => {
      if (extensions.length === 0) {
        return { error: "No extensions are enabled." };
      }

      const ext = findExtensionForTool(toolId, extensions);
      if (!ext) {
        return { error: `Tool "${toolId}" not found: no matching enabled extension.` };
      }

      const rawName = toolId.slice(ext.prefix.length);

      // Verify the tool is allowed before executing
      if (!isToolAllowed(rawName, ext.prefix, ext.extToolPermissions)) {
        return {
          error: `Tool "${toolId}" is not available (disabled or rejected by permissions).`,
        };
      }

      // Create MCP client and get the actual executable tool
      const client = await createMCPClient({
        transport: { type: "http", url: ext.mcpUrl, headers: buildHeaders(ext.auth) },
      });

      try {
        const toolSet = await client.tools();
        const mcpTool = toolSet[rawName] as Record<string, unknown> | undefined;

        if (!mcpTool || typeof mcpTool.execute !== "function") {
          return { error: `Tool "${toolId}" does not have an execute function.` };
        }

        const result = await (mcpTool.execute as Function)(parameters);
        return { result };
      } catch (err) {
        return { error: `Failed to execute tool "${toolId}": ${String(err)}` };
      } finally {
        await client.close().catch(() => {});
      }
    },
  });
}
