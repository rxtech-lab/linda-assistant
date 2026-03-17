import { createMCPClient } from "@ai-sdk/mcp";

export type AuthConfig =
  | { type: "rxauth"; accessToken: string }
  | { type: "api_key"; apiKey: string }
  | { type: "none" };

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

export async function createGenericMcp(
  mcpUrl: string,
  auth: AuthConfig,
  needsApproval: Record<string, boolean>,
): Promise<Record<string, unknown>> {
  const httpClient = await createMCPClient({
    transport: {
      type: "http",
      url: mcpUrl,
      headers: buildHeaders(auth),
    },
  });

  const tools = await httpClient.tools();

  for (const [name, tool] of Object.entries(tools)) {
    (tool as any).needsApproval = needsApproval[name] ?? true;
  }

  return tools;
}
