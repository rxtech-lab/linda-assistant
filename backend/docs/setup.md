# Setup Guide

## Prerequisites

- Node.js 22+ or Bun 1.3+
- Turso account (database)
- Upstash account (Redis)
- AWS account (S3)
- Resend account (email)
- Anthropic API key
- Apple Developer account (push notifications)

## Environment Variables

Copy `.env.example` to `.env.local` and fill in all values:

```bash
cp .env.example .env.local
```

| Variable | Description |
|----------|-------------|
| `TURSO_DATABASE_URL` | Turso database URL (`libsql://...`) |
| `TURSO_AUTH_TOKEN` | Turso auth token |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token |
| `AWS_ACCESS_KEY_ID` | AWS access key for S3 |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key for S3 |
| `AWS_REGION` | AWS region (e.g., `us-east-1`) |
| `S3_API_URL` | Custom S3-compatible endpoint (optional, e.g., Cloudflare R2, MinIO) |
| `S3_BUCKET_NAME` | S3 bucket for file uploads |
| `RESEND_API_KEY` | Resend API key |
| `RESEND_WEBHOOK_SECRET` | Svix webhook signing secret from Resend |
| `RESEND_DOMAIN` | Email domain (e.g., `assistant.rxlab.io`) |
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude |
| `APNS_KEY_ID` | APNs authentication key ID |
| `APNS_TEAM_ID` | Apple Developer Team ID |
| `APNS_BUNDLE_ID` | iOS app bundle ID |
| `APNS_KEY_BASE64` | Base64-encoded APNs `.p8` key contents |
| `APNS_ENVIRONMENT` | `development` or `production` |

## Install Dependencies

```bash
bun install
```

## Database Setup

Push schema to Turso:

```bash
bun run db:push
```

Or generate and apply migrations:

```bash
bun run db:generate
bun run db:migrate
```

## Development

```bash
bun run dev
```

Server starts at `http://localhost:3000`.

## Available Scripts

| Script | Description |
|--------|-------------|
| `bun run dev` | Start dev server |
| `bun run build` | Production build |
| `bun run start` | Start production server |
| `bun run lint` | Run ESLint |
| `bun run db:generate` | Generate Drizzle migrations |
| `bun run db:migrate` | Apply migrations |
| `bun run db:push` | Push schema directly (no migrations) |
| `bun run db:studio` | Open Drizzle Studio |
| `bun run openapi:generate` | Regenerate OpenAPI spec |
| `bun run test:e2e` | Run Playwright E2E tests |

## Resend Webhook Setup

1. In Resend dashboard, go to Webhooks
2. Add endpoint: `https://your-domain.com/api/webhooks/resend`
3. Subscribe to `email.received` event
4. Copy the signing secret to `RESEND_WEBHOOK_SECRET`

## APNs Setup

1. Create an APNs authentication key in Apple Developer portal
2. Download the `.p8` file
3. Base64-encode it: `base64 -i AuthKey_XXXXX.p8` and set as `APNS_KEY_BASE64`
4. Set `APNS_KEY_ID` and `APNS_TEAM_ID` from the portal

## OpenAPI / API Docs

Regenerate the spec after changing routes:

```bash
bun run openapi:generate
```

Interactive API docs are available at `/api-docs` when the server is running.

The generated spec is at `public/openapi.json` and can be used for mobile SDK generation.
