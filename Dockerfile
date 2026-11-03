FROM oven/bun:1 AS build
WORKDIR /repo
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/mock-ha/package.json apps/mock-ha/
COPY apps/simulator/package.json apps/simulator/
RUN bun install --frozen-lockfile
COPY apps/web apps/web
WORKDIR /repo/apps/web
RUN bun run build
WORKDIR /repo

FROM oven/bun:1 AS deps
WORKDIR /deps
COPY apps/server/package.json ./
RUN bun install --production

FROM oven/bun:1-slim
WORKDIR /app
ENV NODE_ENV=production DB_PATH=/data/app.db WEB_DIR=/app/web
COPY apps/server /app/server
COPY --from=deps /deps/node_modules /app/server/node_modules
COPY --from=build /repo/apps/web/build /app/web
WORKDIR /app/server
RUN mkdir -p /data && chown bun:bun /data
USER bun
EXPOSE 3000
CMD ["bun", "src/index.ts"]
