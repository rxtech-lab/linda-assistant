import { NextResponse } from "next/server";

export function successJson<T>(data: T, status = 200) {
  return NextResponse.json({ ...data }, { status });
}

export function errorJson(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

export function paginatedJson<T>(
  data: T[],
  total: number,
  limit: number,
  offset: number,
) {
  return NextResponse.json({
    data,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    },
  });
}
