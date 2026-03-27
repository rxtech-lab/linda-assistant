import { MockEmbeddingModelV3 } from "ai/test";
import { EMBEDDING_DIMENSIONS } from "./context";

/**
 * Get embedding model provider by environment.
 * Returns a mock embedding model in E2E test environment,
 * and the modelId string for Vercel AI Gateway in production.
 */
export function getEmbeddingProvider(modelId: string) {
  if (process.env.IS_E2E) {
    return new MockEmbeddingModelV3({
      doEmbed: async ({ values }) => ({
        embeddings: values.map(() => Array(EMBEDDING_DIMENSIONS).fill(0.1) as number[]),
        usage: { tokens: 10 },
        warnings: [],
      }),
    });
  }
  return modelId;
}
