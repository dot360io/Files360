# syntax=docker/dockerfile:1
# Debian slim rather than alpine: sharp and better-sqlite3 ship prebuilt
# binaries for glibc, and musl would mean compiling libvips.

FROM node:22-slim AS deps
WORKDIR /app
# Only used if a prebuilt better-sqlite3 binary is missing for the platform
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4360 \
    DATA_DIR=/data \
    UV_THREADPOOL_SIZE=4
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p /data && chown node:node /data
USER node
# config.json, secrets.json and the SQLite database: lose this and you lose the install
VOLUME /data
EXPOSE 4360
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/health').then((r) => r.json()).then((j) => process.exit(j.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server.js"]
