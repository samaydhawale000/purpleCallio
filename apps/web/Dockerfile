# ── Stage 1: Dependencies ──────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS deps

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/ ./packages/

RUN npm ci --include=optional --workspace=apps/web

RUN npm install --no-save --package-lock=false \
    lightningcss-linux-arm64-gnu@1.32.0

# ── Stage 2: Build ─────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules

COPY apps/web/ ./apps/web/
COPY packages/ ./packages/
COPY package.json ./

# NEXT_PUBLIC_* vars must be present at build time
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID
ARG NEXT_PUBLIC_RAZORPAY_KEY_ID

ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID
ENV NEXT_PUBLIC_RAZORPAY_KEY_ID=$NEXT_PUBLIC_RAZORPAY_KEY_ID

WORKDIR /app/apps/web
RUN npm run build

# ── Stage 3: Production ────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS production

WORKDIR /app

ENV NODE_ENV=production

# Standalone output includes a minimal server.js + required node_modules
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

EXPOSE 5173

ENV PORT=5173
ENV HOSTNAME=0.0.0.0

CMD ["node", "apps/web/server.js"]
