FROM node:20-slim

RUN apt-get update && apt-get install -y \
    fd-find \
    ripgrep \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

RUN mkdir -p /app/repo

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "dist/server.js"]
