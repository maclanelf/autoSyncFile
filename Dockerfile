# syntax=docker/dockerfile:1.7
FROM node:20-bookworm-slim AS base

FROM base AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    --mount=type=cache,target=/root/.npm,sharing=locked \
    apt-get update \
    && apt-get install --no-install-recommends -y python3 make g++ \
    && npm ci --no-audit --no-fund

FROM base AS builder
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN --mount=type=cache,target=/app/.next/cache,sharing=locked npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=9223
ENV HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

RUN mkdir /app/data && chown nextjs:nodejs /app/data
USER nextjs

EXPOSE 9223
CMD ["node", "server.js"]
