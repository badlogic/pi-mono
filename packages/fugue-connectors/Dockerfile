FROM node:20-slim AS base
WORKDIR /app

FROM base AS deps
COPY package*.json ./
COPY packages/fugue-shared/package.json ./packages/fugue-shared/
COPY packages/fugue-events/package.json ./packages/fugue-events/
COPY packages/fugue-connectors/package.json ./packages/fugue-connectors/
RUN npm install --workspace=@fugue/shared --workspace=@fugue/events --workspace=@fugue/connectors --ignore-scripts

FROM deps AS builder
COPY tsconfig.base.json ./
COPY packages/fugue-shared/ ./packages/fugue-shared/
COPY packages/fugue-events/ ./packages/fugue-events/
COPY packages/fugue-connectors/ ./packages/fugue-connectors/
RUN npm run build --workspace=@fugue/shared && \
	npm run build --workspace=@fugue/events && \
	npm run build --workspace=@fugue/connectors

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/packages/fugue-shared/dist ./packages/fugue-shared/dist
COPY --from=builder /app/packages/fugue-shared/package.json ./packages/fugue-shared/
COPY --from=builder /app/packages/fugue-events/dist ./packages/fugue-events/dist
COPY --from=builder /app/packages/fugue-events/package.json ./packages/fugue-events/
COPY --from=builder /app/packages/fugue-connectors/dist ./packages/fugue-connectors/dist
COPY --from=builder /app/packages/fugue-connectors/package.json ./packages/fugue-connectors/
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

EXPOSE 4002
CMD ["node", "packages/fugue-connectors/dist/server.js"]
