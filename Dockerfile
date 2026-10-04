FROM node:22-bookworm-slim AS dependencies
# Keep the build root distinct from the App Router's app/ directory. With /app,
# Vite can resolve /app/app/layout.tsx as app/app/layout.tsx instead of the root layout.
WORKDIR /srv/domidex
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM dependencies AS builder
COPY . .
RUN npm run build && npm run firebase:package-private

FROM node:22-bookworm-slim AS private-dependencies
WORKDIR /private
COPY backend/security/package.json backend/security/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
ENV VINEXT_TRUST_PROXY=1
ENV VINEXT_TRUSTED_HOSTS=domidex.web.app,domidex.firebaseapp.com
ENV FIREBASE_ADMIN_PROJECT_ID=cardvault-715ac
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=builder --chown=node:node /srv/domidex/dist/standalone ./
COPY --from=private-dependencies --chown=node:node /private/node_modules ./backend/security/node_modules
COPY --from=builder --chown=node:node /srv/domidex/.env.production.local ./.env.production.local
USER node
EXPOSE 8080
CMD ["node", "--env-file=.env.production.local", "server.js"]
