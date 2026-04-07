import { z } from "zod";

const DEFAULT_PAGE_SIZE = process.env.IS_E2E ? 10 : 20;

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(DEFAULT_PAGE_SIZE),
  offset: z.coerce.number().int().min(0).default(0),
});

export function parsePagination(searchParams: URLSearchParams) {
  return paginationSchema.parse({
    limit: searchParams.get("limit") ?? undefined,
    offset: searchParams.get("offset") ?? undefined,
  });
}
