import { NextRequest, NextResponse } from "next/server";

const E2E_GUARD = () =>
  process.env.IS_E2E?.toLowerCase() !== "true"
    ? NextResponse.json({ error: "Not available outside E2E" }, { status: 404 })
    : null;

/**
 * Mock S3 endpoint for E2E testing.
 * PUT: accepts file uploads, returns 200 OK without storing anything.
 * GET: returns a 1x1 transparent PNG stub for download-url previews.
 */
export async function PUT(request: NextRequest) {
  const guard = E2E_GUARD();
  if (guard) return guard;

  await request.arrayBuffer();
  return new NextResponse(null, { status: 200 });
}

const STUB_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
  "base64",
);

export async function GET() {
  const guard = E2E_GUARD();
  if (guard) return guard;

  return new NextResponse(STUB_PNG, {
    status: 200,
    headers: { "Content-Type": "image/png" },
  });
}
