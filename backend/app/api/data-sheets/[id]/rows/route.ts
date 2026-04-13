import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { dataSheets } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { errorJson, paginatedJson } from "@/lib/utils/response";

type Row = Record<string, unknown>;

/** Simple in-memory cache for S3 data to avoid repeated downloads during pagination. */
const dataCache = new Map<string, { rows: Row[]; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_ENTRIES = 20;

function getCachedData(sheetId: string): Row[] | null {
  const entry = dataCache.get(sheetId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    dataCache.delete(sheetId);
    return null;
  }
  return entry.rows;
}

function setCachedData(sheetId: string, rows: Row[]) {
  // Evict oldest if at capacity
  if (dataCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = dataCache.keys().next().value;
    if (oldest) dataCache.delete(oldest);
  }
  dataCache.set(sheetId, { rows, expiresAt: Date.now() + CACHE_TTL_MS });
}

/**
 * Load all rows for a data sheet — from inlineData or S3.
 */
async function loadAllRows(sheet: {
  id: string;
  inlineData: unknown[] | null;
  s3DataUrl: string | null;
}): Promise<Row[]> {
  // Try inline data first
  if (sheet.inlineData && Array.isArray(sheet.inlineData)) {
    return sheet.inlineData as Row[];
  }

  // Check cache
  const cached = getCachedData(sheet.id);
  if (cached) return cached;

  // Download from S3
  if (!sheet.s3DataUrl) {
    return [];
  }

  const response = await fetch(sheet.s3DataUrl, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new Error(`Failed to download data from S3: ${response.statusText}`);
  }
  const rows = (await response.json()) as Row[];
  setCachedData(sheet.id, rows);
  return rows;
}

/**
 * Apply filter to rows.
 * Filter format: { column: string, operator: "eq"|"neq"|"gt"|"lt"|"gte"|"lte"|"contains", value: string|number }
 */
function applyFilter(
  rows: Row[],
  filter: { column: string; operator: string; value: unknown },
): Row[] {
  return rows.filter((row) => {
    const cellValue = row[filter.column];
    const filterValue = filter.value;

    switch (filter.operator) {
      case "eq":
        return String(cellValue) === String(filterValue);
      case "neq":
        return String(cellValue) !== String(filterValue);
      case "contains":
        return String(cellValue ?? "")
          .toLowerCase()
          .includes(String(filterValue).toLowerCase());
      case "gt":
        return Number(cellValue) > Number(filterValue);
      case "lt":
        return Number(cellValue) < Number(filterValue);
      case "gte":
        return Number(cellValue) >= Number(filterValue);
      case "lte":
        return Number(cellValue) <= Number(filterValue);
      default:
        return true;
    }
  });
}

/**
 * Apply sort to rows.
 */
function applySort(rows: Row[], sortColumn: string, order: "asc" | "desc"): Row[] {
  return [...rows].sort((a, b) => {
    const aVal = a[sortColumn];
    const bVal = b[sortColumn];

    // Handle nulls
    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return order === "asc" ? -1 : 1;
    if (bVal == null) return order === "asc" ? 1 : -1;

    // Numeric comparison
    if (typeof aVal === "number" && typeof bVal === "number") {
      return order === "asc" ? aVal - bVal : bVal - aVal;
    }

    // String comparison
    const cmp = String(aVal).localeCompare(String(bVal));
    return order === "asc" ? cmp : -cmp;
  });
}

/**
 * Stringify all values in a row for iOS-friendly serialization.
 */
function stringifyRow(row: Row): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value == null) {
      result[key] = null;
    } else if (typeof value === "object") {
      result[key] = JSON.stringify(value);
    } else {
      result[key] = String(value);
    }
  }
  return result;
}

/**
 * GET /api/data-sheets/[id]/rows
 * Returns paginated rows with server-side sort and filter.
 *
 * Query params:
 * - offset (default 0)
 * - limit (default 50, max 200)
 * - sort (column name)
 * - order (asc|desc, default asc)
 * - filter (JSON: {column, operator, value})
 *
 * @openapi
 * /api/data-sheets/{id}/rows:
 *   get:
 *     summary: Get paginated data sheet rows
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *       - in: query
 *         name: sort
 *         schema: { type: string }
 *       - in: query
 *         name: order
 *         schema: { type: string, enum: [asc, desc] }
 *       - in: query
 *         name: filter
 *         schema: { type: string }
 *     responses:
 *       200: { description: Paginated rows }
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const searchParams = request.nextUrl.searchParams;

  const offset = Math.max(0, parseInt(searchParams.get("offset") ?? "0", 10) || 0);
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10) || 50));
  const sortColumn = searchParams.get("sort");
  const order = (searchParams.get("order") ?? "asc") as "asc" | "desc";
  const filterParam = searchParams.get("filter");

  // Verify ownership and load sheet
  const [sheet] = await db
    .select({
      id: dataSheets.id,
      inlineData: dataSheets.inlineData,
      s3DataUrl: dataSheets.s3DataUrl,
    })
    .from(dataSheets)
    .where(and(eq(dataSheets.id, id), eq(dataSheets.userId, auth.userId)));

  if (!sheet) return errorJson("Data sheet not found", 404);

  let rows = await loadAllRows(sheet);

  // Apply filter
  if (filterParam) {
    try {
      const filter = JSON.parse(filterParam);
      if (filter.column && filter.operator) {
        rows = applyFilter(rows, filter);
      }
    } catch {
      // Ignore invalid filter
    }
  }

  const totalAfterFilter = rows.length;

  // Apply sort
  if (sortColumn) {
    rows = applySort(rows, sortColumn, order);
  }

  // Paginate
  const page = rows.slice(offset, offset + limit).map(stringifyRow);

  return paginatedJson(page, totalAfterFilter, limit, offset);
}
