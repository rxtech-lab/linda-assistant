import { createMCPClient } from "@ai-sdk/mcp";

/**
 *
 * @param accessToken Same Oauth token used to authenticate to api server
 * @param needsApproval A mapping of tool names to whether they need approval
 * @returns
 */
export const createFilesMcp = async (
  accessToken: string,
  needsApproval: Record<string, boolean>,
) => {
  const mcpUrl = process.env.FILES_MCP_URL;
  if (!mcpUrl) {
    throw new Error("FILES_MCP_URL is not defined");
  }
  const httpClient = await createMCPClient({
    transport: {
      type: "http",
      url: mcpUrl,
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });

  const tools = await httpClient.tools();

  // every tool in the mcp needs to be approvaled before use
  for (const [name, tool] of Object.entries(tools)) {
    tool.needsApproval = needsApproval[name] ?? true;
  }

  return tools;
};
