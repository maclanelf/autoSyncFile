FROM node:20-bookworm-slim AS base

FROM base AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN apt-get update \
    && apt-get install --no-install-recommends -y python3 make g++ \
    && npm ci \
    && rm -rf /var/lib/apt/lists/*

FROM base AS builder
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

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
