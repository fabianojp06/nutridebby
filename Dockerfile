# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# Valores só para o build (nenhuma conexão é aberta no build); não vão para a imagem final
ENV APP_URL=http://build.invalid \
    DATABASE_URL=postgres://build_app:x@127.0.0.1:1/build \
    AUTH_SECRET=build-only-secret-build-only-secret-00 \
    ENCRYPTION_KEY=YnVpbGQtb25seS1rZXktYnVpbGQtb25seS1rZXktMDA= \
    TRUSTED_PROXIES=192.0.2.0/24
RUN pnpm build && pnpm prune --prod && rm -rf .next/cache

FROM base AS runner
ENV NODE_ENV=production PORT=3000
# Cópia explícita do que cada modo (app/worker/admin:criar) precisa em runtime —
# em vez de copiar /app inteiro — para não levar fontes de build/dev para a imagem.
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /app/next.config.ts ./next.config.ts
COPY --from=build --chown=node:node /app/tsconfig.json ./tsconfig.json
COPY --from=build --chown=node:node /app/docker-entrypoint.sh ./docker-entrypoint.sh
USER node
EXPOSE 3000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
