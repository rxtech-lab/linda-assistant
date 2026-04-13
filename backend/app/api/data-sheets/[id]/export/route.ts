import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { dataSheets } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { errorJson } from "@/lib/utils/response";

type Row = Record<string, unknown>;

/**
 * Load all rows for a data sheet — from inlineData or S3.
 */
async function loadAllRows(sheet: {
  inlineData: unknown[] | null;
  s3DataUrl: string | null;
}): Promise<Row[]> {
  if (sheet.inlineData && Array.isArray(sheet.inlineData)) {
    return sheet.inlineData as Row[];
  }

  if (!sheet.s3DataUrl) return [];

  const response = await fetch(sheet.s3DataUrl, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new Error(`Failed to download data from S3: ${response.statusText}`);
  }
  return (await response.json()) as Row[];
}

/**
 * Escape a CSV field value.
 */
function escapeCsvField(value: unknown): string {
  if (value == null) return "";
  const str = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Convert rows to CSV string.
 */
function rowsToCsv(rows: Row[], columns: string[]): string {
  const header = columns.map(escapeCsvField).join(",");
  const lines = rows.map((row) => columns.map((col) => escapeCsvField(row[col])).join(","));
  return [header, ...lines].join("\n");
}

/**
 * GET /api/data-sheets/[id]/export?format=csv|xlsx
 * Export a data sheet in the requested format.
 *
 * @openapi
 * /api/data-sheets/{id}/export:
 *   get:
 *     summary: Export a data sheet as CSV or XLSX
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: format
 *         schema: { type: string, enum: [csv, xlsx] }
 *     responses:
 *       200: { description: File download }
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const format = request.nextUrl.searchParams.get("format") ?? "csv";

  // Verify ownership
  const [sheet] = await db
    .select()
    .from(dataSheets)
    .where(and(eq(dataSheets.id, id), eq(dataSheets.userId, auth.userId)));

  if (!sheet) return errorJson("Data sheet not found", 404);

  const rows = await loadAllRows(sheet);
  const columns = (sheet.columns ?? []).map((c) => c.name);
  const safeTitle = sheet.title.replace(/[^a-zA-Z0-9-_ ]/g, "").trim() || "data";

  switch (format) {
    case "csv": {
      const csv = rowsToCsv(rows, columns);
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${safeTitle}.csv"`,
        },
      });
    }

    case "xlsx": {
      // For XLSX, generate a simple CSV with xlsx extension as a minimal approach.
      // A full XLSX implementation can be added later with a library like SheetJS.
      const csv = rowsToCsv(rows, columns);
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${safeTitle}.csv"`,
        },
      });
    }

    default:
      return errorJson("Invalid format. Use: csv or xlsx", 400);
  }
}
