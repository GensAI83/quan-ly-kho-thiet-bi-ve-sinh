FROM oven/bun:1.3.12 AS build
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile
COPY client ./client
COPY server ./server
COPY scripts/build-cloud.ts ./scripts/build-cloud.ts
COPY drizzle ./drizzle
RUN bun run build:cloud

FROM oven/bun:1.3.12-slim
WORKDIR /app
COPY --from=build /app/dist/cloud ./
ENV NODE_ENV=production PORT=10000 KHO_DATA_DIR=/var/lib/quan-ly-kho
EXPOSE 10000
CMD ["bun", "server.js"]
