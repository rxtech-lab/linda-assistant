import { NextResponse } from "next/server";
import { pingRedis } from "@/lib/redis";

export async function GET() {
  try {
    const redisConnected = await pingRedis();
    return NextResponse.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      redis: redisConnected ? "connected" : "in-memory fallback",
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "degraded",
        timestamp: new Date().toISOString(),
        redis: "error",
      },
      { status: 503 },
    );
  }
}
