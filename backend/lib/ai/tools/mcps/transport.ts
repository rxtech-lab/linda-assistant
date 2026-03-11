import { createMCPClient } from "@ai-sdk/mcp";

/**
 *
 * @param accessToken Same Oauth token used to authenticate to api server
 * @param needsApproval A mapping of tool names to whether they need approval
 * @returns
 */
export const createTransportMcp = async (
  accessToken: string,
  needsApproval: Record<string, boolean>,
) => {
  if (process.env.IS_E2E?.toLowerCase() === "true") {
    return {};
  }
  const mcpUrl = process.env.TRANSPORT_MCP_URL;
  if (!mcpUrl) {
    throw new Error("TRANSPORT_MCP_URL is not defined");
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
