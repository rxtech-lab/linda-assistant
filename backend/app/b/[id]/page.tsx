import { notFound, unauthorized } from "next/navigation";
import { marked } from "marked";
import { fetchBriefingById } from "@/lib/db/queries/public-briefing";

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

export default async function BriefingSharePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const briefing = await fetchBriefingById(id);
  if (!briefing) notFound();
  if (!briefing.isPublic) unauthorized();

  const contentHtml = await marked.parse(briefing.content, { async: true });
  const date = formatDate(briefing.createdAt);

  return (
    <article
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: "0 0 80px",
        background: "white",
        boxShadow: "0 2px 24px rgba(0,0,0,0.06)",
        minHeight: "100vh",
      }}
    >
      {briefing.imageUrl ? (
        <img
          src={briefing.imageUrl}
          alt={briefing.title}
          style={{
            width: "100%",
            height: 420,
            objectFit: "cover",
            display: "block",
          }}
        />
      ) : (
        <div
          style={{
            width: "100%",
            height: 320,
            background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
          }}
        />
      )}

      <div style={{ padding: "40px 56px 0" }}>
        {date ? (
          <div
            style={{
              fontSize: 14,
              color: "#6b7280",
              marginBottom: 12,
              letterSpacing: "0.02em",
            }}
          >
            {date}
          </div>
        ) : null}
        <h1
          style={{
            fontSize: 40,
            fontWeight: 700,
            margin: "0 0 32px",
            lineHeight: 1.2,
            letterSpacing: "-0.02em",
          }}
        >
          {briefing.title}
        </h1>

        <div
          style={{
            fontSize: 17,
            lineHeight: 1.7,
            color: "#1f2937",
          }}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted server-rendered markdown from our own DB
          dangerouslySetInnerHTML={{ __html: contentHtml }}
        />
      </div>
    </article>
  );
}
