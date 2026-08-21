# Bygg-steget installerar alla beroenden och producerar Nitros node-server.
FROM node:22-alpine AS build
WORKDIR /app
ENV NODE_ENV=development
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY . .
# VITE_-variabler bakas in i klientbunten och måste därför sättas vid bygget.
ARG VITE_DEMO=""
ENV VITE_DEMO=$VITE_DEMO
RUN npm run build

# Körsteget innehåller bara den byggda servern och dess statiska filer.
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.output ./.output
# Migreringarna läses från disk vid körning och måste följa med imagen.
COPY --from=build --chown=app:app /app/db/migrations ./db/migrations
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", ".output/server/index.mjs"]
