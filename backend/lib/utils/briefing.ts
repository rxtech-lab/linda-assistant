export function briefingShareUrl(id: string, isPublic: boolean | null): string | null {
  if (isPublic !== true) return null;
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (!base) return null;
  return `${base}/b/${id}`;
}

export function withShareUrl<T extends { id: string; isPublic: boolean | null }>(
  briefing: T,
): T & { shareUrl: string | null } {
  return { ...briefing, shareUrl: briefingShareUrl(briefing.id, briefing.isPublic) };
}
