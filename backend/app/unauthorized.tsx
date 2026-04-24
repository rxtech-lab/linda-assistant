export default function Unauthorized() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
        color: "white",
        padding: "20px",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 520 }}>
        <div
          style={{
            fontSize: 96,
            fontWeight: 700,
            marginBottom: 8,
            letterSpacing: "-0.02em",
          }}
        >
          401
        </div>
        <div
          style={{
            fontSize: 24,
            fontWeight: 500,
            opacity: 0.95,
            marginBottom: 16,
          }}
        >
          This briefing is private
        </div>
        <p style={{ fontSize: 16, opacity: 0.85, margin: 0, lineHeight: 1.5 }}>
          The person who shared this link has made it private. Ask them to re-enable sharing if
          you need access.
        </p>
      </div>
    </div>
  );
}
