FROM node:22-alpine

WORKDIR /app
COPY . .
RUN cd scripts && npm ci --omit=dev

ENV NODE_ENV=production
ENV MANIFEST_MCP_TRANSPORT=http
ENV MANIFEST_MCP_HOST=0.0.0.0
ENV PORT=8080

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health >/dev/null || exit 1

CMD ["node", "tools/manifest-mcp/server.mjs", "--http"]
