# Stage 1: Build
FROM node:20-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
COPY bin/ ./bin/

RUN npm run build
RUN npm prune --omit=dev

# Stage 2: Runtime
FROM node:20-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates ripgrep && \
    rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash || true

RUN useradd -m -u 1000 -s /bin/bash atlas

WORKDIR /workspace

COPY --from=builder /app/dist /opt/atlas-agent/dist
COPY --from=builder /app/node_modules /opt/atlas-agent/node_modules
COPY --from=builder /app/bin /opt/atlas-agent/bin
COPY --from=builder /app/package.json /opt/atlas-agent/package.json

RUN chmod +x /opt/atlas-agent/bin/atlas-agent.js && \
    ln -s /opt/atlas-agent/bin/atlas-agent.js /usr/local/bin/atlas-agent

USER atlas

ENTRYPOINT ["atlas-agent"]
