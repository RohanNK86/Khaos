# One image for every MCPify service (api, mcp-server, portals, dashboard, voice).
# The service is chosen with the command, see docker-compose.prod.yml.
FROM mcr.microsoft.com/playwright:v1.65.1-noble
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @mcpify/agent-ready build \
 && pnpm --filter @mcpify/dashboard build
ENV NODE_ENV=production HEADLESS=1
EXPOSE 3000 3100 4000 4100 5101 5102 5103
