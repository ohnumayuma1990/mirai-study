# syntax=docker/dockerfile:1

FROM node:24-slim AS builder
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

FROM node:24-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NITRO_HOST=0.0.0.0
ENV PORT=8080

COPY --from=builder --chown=node:node /app/.output ./.output

USER node
EXPOSE 8080

CMD ["node", ".output/server/index.mjs"]
