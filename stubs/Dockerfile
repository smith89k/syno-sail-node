# ==========================================
# Stage 1: install everything and build
# ==========================================
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install
COPY . .
# Runs your "build" script if package.json has one (Vite, TypeScript, ...),
# then drops the dev-only packages.
RUN npm run build --if-present && npm prune --omit=dev


# ==========================================
# Stage 2: the small image that runs on the NAS
# ==========================================
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

COPY --from=build --chown=node:node /app /app
COPY docker/scripts/entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# (Git on Windows can save scripts with Windows line endings; Linux won't run those)
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh && \
    chmod +x /usr/local/bin/docker-entrypoint.sh && \
    mkdir -p /app/data && chown node:node /app/data

# never run the app as root
USER node

EXPOSE 3000

# "Healthy" means the app answers on its own port. HEALTH_PATH picks the page.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}${HEALTH_PATH:-/}" || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["npm", "start"]
