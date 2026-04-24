import { notFound, unauthorized } from "next/navigation";
import { marked } from "marked";
import { fetchBriefingById } from "@/lib/db/queries/public-briefing";
import PodcastPlayer from "./PodcastPlayer";
import TocSidebar from "./TocSidebar";

export const dynamic = "force-dynamic";

function formatDate(raw: string | null): string {
  if (!raw) return "";
  const iso = raw.includes("T") ? raw : raw.replace(" ", "T") + "Z";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function slugify(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/[*_`[\]()#]+/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]/g, "");
}

export default async function BriefingSharePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const briefing = await fetchBriefingById(id);
  if (!briefing) notFound();
  if (!briefing.isPublic) unauthorized();

  const date = formatDate(briefing.createdAt);

  // Render markdown then inject IDs into h2/h3
  const rawHtml = await marked.parse(briefing.content, { async: true });
  const slugCount = new Map<string, number>();
  const contentHtml = rawHtml.replace(
    /<h([23])>(.*?)<\/h\1>/gs,
    (_, level, inner) => {
      const base = slugify(inner);
      const count = slugCount.get(base) ?? 0;
      slugCount.set(base, count + 1);
      const slug = count === 0 ? base : `${base}-${count}`;
      return `<h${level} id="${slug}">${inner}</h${level}>`;
    },
  );

  // Extract headings for TOC
  const headings: { id: string; text: string; level: number }[] = [];
  for (const match of contentHtml.matchAll(
    /<h([23]) id="([^"]+)">(.*?)<\/h\1>/gs,
  )) {
    const [, level, headingId, rawText] = match;
    headings.push({
      id: headingId,
      text: rawText.replace(/<[^>]+>/g, ""),
      level: Number(level),
    });
  }

  // Wrap tables in a scrollable container
  const finalHtml = contentHtml
    .replace(/<table/g, '<div class="table-wrapper"><table')
    .replace(/<\/table>/g, "</table></div>");

  return (
    <article className="briefing-article">
      {briefing.imageUrl ? (
        <div className="briefing-hero">
          <img
            src={briefing.imageUrl}
            alt={briefing.title}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        </div>
      ) : (
        <div
          className="briefing-hero"
          style={{
            background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
          }}
        />
      )}

      <div className="briefing-layout">
        <TocSidebar headings={headings} />
        <div className="briefing-body">
          {date ? <div className="briefing-date">{date}</div> : null}
          <h1 className="briefing-title">{briefing.title}</h1>
          {briefing.assignee ? (
            <div className="briefing-author">
              <div className="briefing-author-avatar">
                {briefing.assignee.name.charAt(0).toUpperCase()}
              </div>
              <div className="briefing-author-info">
                <span className="briefing-author-label">Written by</span>
                <span className="briefing-author-name">
                  {briefing.assignee.name}
                </span>
              </div>
            </div>
          ) : null}

          {briefing.podcastUrl ? (
            <PodcastPlayer url={briefing.podcastUrl} />
          ) : null}
          <div
            className="briefing-content"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted server-rendered markdown from our own DB
            dangerouslySetInnerHTML={{ __html: finalHtml }}
          />
        </div>
      </div>
    </article>
  );
}
