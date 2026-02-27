import { createTestProvider } from "./test-provider";

/**
 * Get model provider by environment. Return a test provider in E2E test environment, and return the modelId for vercel ai gateway in production.
 * @param modelId Model name
 * @returns
 */
export function getModelProvider(modelId: string) {
  if (process.env.IS_E2E) {
    return createTestProvider();
  }
  return modelId;
}
