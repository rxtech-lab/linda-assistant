import { db } from "@/lib/db";
import { extensions } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

const SYSTEM_EXTENSIONS = [
  {
    slug: "invoice",
    title: "Invoice",
    description: "Create and manage invoices",
    prefix: "invoice_",
    envVar: "INVOICE_MCP_URL",
  },
  {
    slug: "files",
    title: "Files",
    description: "Upload and manage files",
    prefix: "files_",
    envVar: "FILES_MCP_URL",
  },
  {
    slug: "firecrawl",
    title: "Firecrawl",
    description: "Web scraping and crawling",
    prefix: "firecrawl_",
    envVar: "FIRECRAWL_MCP_URL",
  },
  {
    slug: "transport",
    title: "Transport",
    description: "Transportation and logistics",
    prefix: "transport_",
    envVar: "TRANSPORT_MCP_URL",
  },
  {
    slug: "e2e_test",
    title: "E2E Test",
    description: "Mock MCP server for e2e testing",
    prefix: "e2e_test_",
    envVar: "E2E_MCP_URL",
  },
] as const;

export async function ensureSystemExtensions(): Promise<void> {
  for (const ext of SYSTEM_EXTENSIONS) {
    const mcpUrl = process.env[ext.envVar];
    if (!mcpUrl) continue;

    const existing = await db
      .select()
      .from(extensions)
      .where(and(eq(extensions.type, "system"), eq(extensions.slug, ext.slug)));

    if (existing.length === 0) {
      await db.insert(extensions).values({
        userId: "system",
        type: "system",
        slug: ext.slug,
        title: ext.title,
        description: ext.description,
        prefix: ext.prefix,
        mcpUrl,
        authType: "rxauth",
      });
    } else {
      // Update URL if changed
      await db
        .update(extensions)
        .set({ mcpUrl, updatedAt: new Date().toISOString().replace("T", " ").slice(0, 19) })
        .where(eq(extensions.id, existing[0].id));
    }
  }
}
