# -----------------------------------------------------------------------------
# This Dockerfile.bun is specifically configured for projects using Bun
# For npm/pnpm or yarn, refer to the Dockerfile instead
# -----------------------------------------------------------------------------

# Use Bun's official image
FROM oven/bun:1 AS base

WORKDIR /app

# Install dependencies with bun
FROM base AS deps
COPY package.json bun.lock* ./
RUN bun install --no-save --frozen-lockfile

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next.js collects completely anonymous telemetry data about general usage.
# Learn more here: https://nextjs.org/telemetry
# Uncomment the following line in case you want to disable telemetry during the build.
# ENV NEXT_TELEMETRY_DISABLED=1

# Run openapi:generate + next build, skip db:push (handled at deploy time)
RUN bun run openapi:generate && bun next build

# Install the exact Chrome version Puppeteer expects into a known cache directory
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer
RUN npx puppeteer browsers install chrome

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

# Uncomment the following line in case you want to disable telemetry during runtime.
# ENV NEXT_TELEMETRY_DISABLED=1

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME="0.0.0.0"

# Install Chrome runtime dependencies and Chinese fonts (Noto Sans CJK)
RUN apt-get update && apt-get install -y --no-install-recommends \
    fonts-liberation \
    fonts-noto-cjk \
    fontconfig \
    libgbm1 \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libxshmfence1 \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -fv

ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --no-log-init -g nodejs nextjs

COPY --from=builder /app/public ./public

# Copy Chrome browser installed by Puppeteer from the builder stage
COPY --from=builder --chown=nextjs:nodejs /app/.cache/puppeteer /app/.cache/puppeteer

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

CMD ["bun", "./server.js"]

# Target: worker (runs TypeScript directly via Bun, no Next.js build needed)
FROM base AS worker
WORKDIR /app

ENV NODE_ENV=production

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --no-log-init -g nodejs nextjs

COPY --from=deps /app/node_modules ./node_modules
COPY --chown=nextjs:nodejs . .

USER nextjs

EXPOSE 3002

CMD ["bun", "worker/index.ts"]