import { MockLanguageModelV3 } from "ai/test";

/**
 * Get model provider by environment. Return an test provider in E2E test environment, and return the modelId for vercel ai gateway in production.
 * @param modelId Model name
 * @returns
 */
export function getModelProvider(modelId: string) {
  if (process.env.IS_E2E) {
    return new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text", text: `Hello, world!` }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: {
            total: 10,
            noCache: 10,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 20,
            text: 20,
            reasoning: undefined,
          },
        },
        warnings: [],
      }),
    });
  }
  return modelId;
}
