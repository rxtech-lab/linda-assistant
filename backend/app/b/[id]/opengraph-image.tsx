import { ImageResponse } from "next/og";
import { fetchBriefingById } from "@/lib/db/queries/public-briefing";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

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

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const briefing = await fetchBriefingById(id);

  if (!briefing || !briefing.isPublic) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            color: "white",
            fontSize: 56,
            fontWeight: 600,
            fontFamily: "system-ui",
          }}
        >
          Private briefing
        </div>
      ),
      size,
    );
  }

  const date = formatDate(briefing.createdAt);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          background: "#0f172a",
        }}
      >
        {briefing.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={briefing.imageUrl}
            alt=""
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        ) : (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            }}
          />
        )}

        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.35) 55%, rgba(0,0,0,0.05) 100%)",
          }}
        />

        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            padding: "56px 72px",
            display: "flex",
            flexDirection: "column",
            color: "white",
          }}
        >
          {date ? (
            <div
              style={{
                fontSize: 28,
                fontWeight: 500,
                opacity: 0.85,
                marginBottom: 16,
                letterSpacing: "0.01em",
              }}
            >
              {date}
            </div>
          ) : null}
          <div
            style={{
              fontSize: 68,
              fontWeight: 700,
              lineHeight: 1.15,
              letterSpacing: "-0.02em",
              maxWidth: 1000,
              display: "flex",
            }}
          >
            {briefing.title}
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            top: 44,
            left: 72,
            display: "flex",
            alignItems: "center",
            color: "white",
            fontSize: 24,
            fontWeight: 600,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            opacity: 0.9,
          }}
        >
          Linda
        </div>
      </div>
    ),
    size,
  );
}
