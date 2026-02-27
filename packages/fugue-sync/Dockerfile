FROM node:20-slim AS base
WORKDIR /app

FROM base AS deps
COPY package*.json ./
COPY packages/fugue-shared/package.json ./packages/fugue-shared/
COPY packages/fugue-sync/package.json ./packages/fugue-sync/
RUN npm install --workspace=@fugue/shared --workspace=@fugue/sync --ignore-scripts

FROM deps AS builder
COPY tsconfig.base.json ./
COPY packages/fugue-shared/ ./packages/fugue-shared/
COPY packages/fugue-sync/ ./packages/fugue-sync/
RUN npm run build --workspace=@fugue/shared && npm run build --workspace=@fugue/sync

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/packages/fugue-shared/dist ./packages/fugue-shared/dist
COPY --from=builder /app/packages/fugue-shared/package.json ./packages/fugue-shared/
COPY --from=builder /app/packages/fugue-sync/dist ./packages/fugue-sync/dist
COPY --from=builder /app/packages/fugue-sync/package.json ./packages/fugue-sync/
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

EXPOSE 3002
CMD ["node", "packages/fugue-sync/dist/server.js"]
