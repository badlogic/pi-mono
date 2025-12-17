# Pi Discord Bot - Production Docker Container
# Multi-stage build for minimal image size

# Stage 1: Build
FROM node:20-slim AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy package files and install ALL dependencies (including dev)
COPY package*.json ./
RUN npm install

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Stage 2: Production
FROM node:20-slim AS production

# Install runtime dependencies only
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Create non-root user for security
RUN groupadd -r pibot && useradd -r -g pibot pibot

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm install --omit=dev && npm cache clean --force

# Copy built files from builder stage
COPY --from=builder /app/dist ./dist

# Create data directory with proper permissions
RUN mkdir -p /data && chown -R pibot:pibot /data /app

# Switch to non-root user
USER pibot

# Environment defaults
ENV NODE_ENV=production
ENV WEBHOOK_PORT=3001
ENV METRICS_PORT=9090

# Expose ports
EXPOSE 3001 9090

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

# Run the bot
CMD ["node", "dist/main.js", "/data"]
