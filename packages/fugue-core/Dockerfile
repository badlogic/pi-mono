FROM node:20-slim AS base
WORKDIR /app
RUN npm install -g npm@latest

# Install dependencies
FROM base AS deps
COPY package*.json ./
COPY packages/fugue-shared/package.json ./packages/fugue-shared/
COPY packages/fugue-graph/package.json ./packages/fugue-graph/
COPY packages/fugue-events/package.json ./packages/fugue-events/
COPY packages/fugue-core/package.json ./packages/fugue-core/
RUN npm install --workspace=@fugue/shared --workspace=@fugue/graph --workspace=@fugue/events --workspace=@fugue/core --ignore-scripts

# Build
FROM deps AS builder
COPY tsconfig.base.json ./
COPY packages/fugue-shared/ ./packages/fugue-shared/
COPY packages/fugue-graph/ ./packages/fugue-graph/
COPY packages/fugue-events/ ./packages/fugue-events/
COPY packages/fugue-core/ ./packages/fugue-core/
RUN npm run build --workspace=@fugue/shared && \
	npm run build --workspace=@fugue/graph && \
	npm run build --workspace=@fugue/events && \
	npm run build --workspace=@fugue/core

# Runtime
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/packages/fugue-shared/dist ./packages/fugue-shared/dist
COPY --from=builder /app/packages/fugue-shared/package.json ./packages/fugue-shared/
COPY --from=builder /app/packages/fugue-graph/dist ./packages/fugue-graph/dist
COPY --from=builder /app/packages/fugue-graph/package.json ./packages/fugue-graph/
COPY --from=builder /app/packages/fugue-events/dist ./packages/fugue-events/dist
COPY --from=builder /app/packages/fugue-events/package.json ./packages/fugue-events/
COPY --from=builder /app/packages/fugue-core/dist ./packages/fugue-core/dist
COPY --from=builder /app/packages/fugue-core/package.json ./packages/fugue-core/
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

EXPOSE 3001
CMD ["node", "packages/fugue-core/dist/server.js"]
