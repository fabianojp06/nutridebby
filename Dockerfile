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
    TRUSTED_PROXIES=192.0.2.0/24 \
    FILE_URL_SECRET=build-only-file-url-secret-build-only-00 \
    DATA_DIR=/tmp/build-data \
    TURNSTILE_SITE_KEY=build-only \
    TURNSTILE_SECRET_KEY=build-only
RUN pnpm build && pnpm prune --prod && rm -rf .next/cache
# Plano 11 (revisão final; orçamento de 260 MB do job image): o pdf-lib e o SDK da Anthropic só rodam no worker — o
# pdf-lib pelo `main` (cjs/) e o SDK pelo `exports` (.mjs/.js na raiz). Saem os bundles de navegador e ES do pdf-lib
# (dist/, es/), os fontes TS (src/, ts3.4/), as declarações de tipo e os source maps (~5 MB comprimidos). Se o caminho
# mudar (versão nova), o `find` falha e o build para. O job image confere que o worker ainda os carrega na imagem.
# Plano 12: do `@hyzyla/pdfium` só ficam o `index.esm.js` (que carrega o WASM pelo caminho) e o `pdfium.wasm`; saem as
# cópias em base64, os bundles de navegador, de CDN e de worker, o CJS e as declarações (≈ 2,8 MB comprimidos; ficam
# ≈ 2,1 MB comprimidos, quase todo o `pdfium.wasm`). Os `test -f` param o build se a versão nova mudar os nomes.
# Plano 14A: o SDK do Bedrock (só no worker) e as dependências da AWS: saem os fontes, as declarações e os mapas; ficam
# `dist-cjs` e `dist-es` (o Node escolhe pelo `exports`).
RUN set -eu; \
    for d in node_modules/.pnpm/pdf-lib@*/node_modules/pdf-lib; do \
      rm -rf "$d/dist" "$d/es" "$d/src" "$d/ts3.4"; find "$d" \( -name '*.map' -o -name '*.d.ts' \) -delete; \
    done; \
    for d in node_modules/.pnpm/@anthropic-ai+sdk@*/node_modules/@anthropic-ai/sdk; do \
      rm -rf "$d/src"; find "$d" \( -name '*.map' -o -name '*.d.ts' -o -name '*.d.mts' \) -delete; \
    done; \
    for d in node_modules/.pnpm/@anthropic-ai+bedrock-sdk@*/node_modules/@anthropic-ai/bedrock-sdk; do \
      test -f "$d/index.js"; rm -rf "$d/src"; find "$d" \( -name '*.map' -o -name '*.d.ts' -o -name '*.d.mts' \) -delete; \
    done; \
    for d in node_modules/.pnpm/@aws-sdk+*/node_modules/@aws-sdk/* node_modules/.pnpm/@smithy+*/node_modules/@smithy/*; do \
      rm -rf "$d/dist-types"; find "$d" -name '*.map' -delete; \
    done; \
    for d in node_modules/.pnpm/@hyzyla+pdfium@*/node_modules/@hyzyla/pdfium; do \
      test -f "$d/dist/index.esm.js"; test -f "$d/dist/pdfium.wasm"; \
      find "$d/dist" -type f ! -name 'index.esm.js' ! -name 'pdfium.wasm' -delete; \
      find "$d/dist" -mindepth 1 -type d -empty -delete; \
    done

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
# Ponto de montagem do volume de arquivos (§4): o app e o worker rodam como node
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
