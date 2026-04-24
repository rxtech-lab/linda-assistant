import "server-only";
import { db } from "@/lib/db";
import { briefings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export type PublicBriefingRow = typeof briefings.$inferSelect;

export async function fetchBriefingById(id: string): Promise<PublicBriefingRow | null> {
  const [row] = await db.select().from(briefings).where(eq(briefings.id, id));
  return row ?? null;
}
