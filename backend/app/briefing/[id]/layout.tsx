import type { Metadata } from "next";
import { fetchBriefingById } from "@/lib/db/queries/public-briefing";
import "./briefing.css";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const briefing = await fetchBriefingById(id);
  if (!briefing || !briefing.isPublic) {
    return { title: "Briefing" };
  }

  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
  const shareUrl = `${base}/briefing/${briefing.id}`;
  const ogImage = `${shareUrl}/opengraph-image`;

  return {
    title: briefing.title,
    openGraph: {
      title: briefing.title,
      type: "article",
      url: shareUrl,
      images: [{ url: ogImage, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: briefing.title,
      images: [ogImage],
    },
  };
}

export default function BriefingShareLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="briefing-root">
      {children}
    </div>
  );
}
