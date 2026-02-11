import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { confirmations } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { selectConfirmationSchema } from "@/lib/schemas";
import { NextResponse } from "next/server";
import { z } from "zod";

const confirmationsListSchema = z.array(selectConfirmationSchema);

/**
 * @openapi
 * @operationId listConfirmations
 * @response confirmationsListSchema
 */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const items = await db
    .select()
    .from(confirmations)
    .where(and(eq(confirmations.userId, auth.userId), eq(confirmations.status, "pending")));

  return NextResponse.json(items);
}
