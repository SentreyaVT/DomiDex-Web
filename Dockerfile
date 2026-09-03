FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM dependencies AS builder
COPY . .
RUN npm run build

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
COPY --from=builder --chown=node:node /app/dist/standalone ./
COPY --from=builder --chown=node:node /app/.env.production.local ./.env.production.local
USER node
EXPOSE 8080
CMD ["node", "--env-file=.env.production.local", "server.js"]
