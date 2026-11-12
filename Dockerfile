# Production image for the web app and the generation worker (same image; APP_ROLE selects the process).
FROM node:22-bookworm-slim
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && chown -R node:node /app/.next
ENV NODE_ENV=production
USER node
CMD ["sh", "scripts/start.sh"]
