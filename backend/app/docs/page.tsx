"use client";

import { RedocStandalone } from "redoc";

export default function DocsPage() {
  return (
    <div style={{ height: "100vh", overflow: "auto" }}>
      <RedocStandalone specUrl="/openapi.json" />
    </div>
  );
}
