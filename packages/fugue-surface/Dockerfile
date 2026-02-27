FROM node:20-slim AS base
WORKDIR /app

FROM base AS deps
COPY package*.json ./
COPY packages/fugue-shared/package.json ./packages/fugue-shared/
COPY packages/fugue-core/package.json ./packages/fugue-core/
COPY packages/fugue-surface/package.json ./packages/fugue-surface/
RUN npm install --workspace=@fugue/shared --workspace=@fugue/core --workspace=@fugue/surface --ignore-scripts

FROM deps AS builder
COPY tsconfig.base.json ./
COPY packages/fugue-shared/ ./packages/fugue-shared/
COPY packages/fugue-core/ ./packages/fugue-core/
COPY packages/fugue-surface/ ./packages/fugue-surface/
RUN npm run build --workspace=@fugue/shared && \
	npm run build --workspace=@fugue/core && \
	npm run build --workspace=@fugue/surface

# Serve with a minimal static server
FROM node:20-slim AS runtime
WORKDIR /app
RUN npm install -g serve
COPY --from=builder /app/packages/fugue-surface/dist ./dist
EXPOSE 3000
CMD ["serve", "-s", "dist", "-l", "3000"]
