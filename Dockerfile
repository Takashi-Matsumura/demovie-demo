# syntax=docker/dockerfile:1

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS builder
WORKDIR /app
# NEXT_PUBLIC_* はビルド時にブラウザ向けコードへ埋め込まれる。
# 空文字のままだとアプリの既定値（127.0.0.1 の各ポート）が効かないので、空なら unset してからビルドする。
ARG NEXT_PUBLIC_LLM_URL
ARG NEXT_PUBLIC_VISION_URL
ARG NEXT_PUBLIC_VOICEVOX_URL
ARG NEXT_PUBLIC_WHISPER_URL
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN for v in NEXT_PUBLIC_LLM_URL NEXT_PUBLIC_VISION_URL NEXT_PUBLIC_VOICEVOX_URL NEXT_PUBLIC_WHISPER_URL; do \
      eval "[ -n \"\${$v}\" ] || unset $v"; \
    done; \
    npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
