# Teste de carga (P08-03) — roteiro e modelo de relatório

**Nunca contra produção nem com dado real.** Cada passo com a VPS pede OK do dono. Horário: madrugada (Brasília; a VPS
está em UTC, 3 h à frente). Arquivos: `docker-compose.carga.yml`, `test/carga/` (`gerar-env.sh`, `seed.ts`,
`cenario.js`). Metas: RNF-01 (p95 das APIs < 300 ms, LCP no Slow 4G), RNF-02 (50 consultórios × 300 pacientes) e D4
(p95 das páginas < 800 ms, job `notificacoes` < 20 s).

## Roteiro
1. Snapshot no hPanel (regra do servidor) e OK do dono para subir a pilha `nutridebby-carga`.
2. **Depois do merge do Plano 08 e antes de qualquer paciente real** (o GHCR só tem a imagem do deploy da `main`; a
   RNF-03 proíbe construir na VPS). Na raiz do repositório:
   `(umask 077; bash test/carga/gerar-env.sh > .env.carga)` e
   `echo 'CARGA_IMAGEM=ghcr.io/fabianojp06/nutridebby:<sha completo do merge na main>' >> .env.carga.compose`
   (todo comando `docker compose` da carga lê esse arquivo; sem ele o compose recusa). A imagem já está no host depois
   do deploy (`docker images ghcr.io/fabianojp06/nutridebby`). Subir:
   `docker compose -f docker-compose.carga.yml --env-file .env.carga.compose up -d` (o app aplica as migrations ao
   subir; o worker que subir antes delas cai e volta sozinho).
3. Com o checkout do repositório no mesmo commit da imagem: `CARGA_VENCER_EM_MIN=<minutos até a rodada> pnpm tsx
   --env-file=.env.carga test/carga/seed.ts`. A semente lê o `.env.carga` (nenhum valor na tela nem na linha de
   comando), troca o host `db:5432` dele por `127.0.0.1:54339` e recusa qualquer outro arquivo de ambiente. Leva alguns
   minutos (15 mil pacientes, 50 consultórios) e grava `test/carga/.sessoes.json` (cookies; só o dono lê, fora do git).
4. Em outro terminal, `docker stats` e a CPU livre do host gravando em arquivo a cada 10 s — inclui o `cursoia_crm`
   (em produção no mesmo host: não pode piorar) e os containers da carga: `while :; do date -u +%FT%TZ; docker stats
   --no-stream --format '{{.Name}} {{.CPUPerc}} {{.MemUsage}}'; vmstat 1 2 | tail -1; sleep 10; done >
   /tmp/carga-stats.txt` (no `vmstat`, a coluna `id` é o % ocioso das 8 vCPU: 25% = 2 vCPU livres, o mínimo da D4).
   **Critério de parada** (passos 5 e 6): interromper o k6 (Ctrl+C) se a CPU livre ficar abaixo de 2 vCPU (`id` < 25)
   por mais de 1 min, se o `cursoia_crm` piorar (CPU no teto, resposta lenta ou erro relatado) ou se a memória livre do
   host (`free -m`) cair abaixo de 2 GB; anotar no relatório o momento e o motivo.
5. Fumaça: `docker run --rm -u "$(id -u):$(id -g)" --network host -v "$PWD/test/carga:/carga" grafana/k6:2.3.0 run --vus 3
   --duration 30s /carga/cenario.js` (a linha de comando troca os cenários pelo `default`, que roda os três perfis).
   Esperado: `checks` 100% e nenhuma falha. O `-u` é para o k6 ler o `.sessoes.json` (modo 600). A versão do k6 é fixa (2.3.0, a validada na Tarefa 10): as consultas
   `jq` do relatório dependem do formato do `--summary-export`; trocar a versão pede conferir o relatório de novo.
6. Rodada: `docker run --rm -u "$(id -u):$(id -g)" --network host -v "$PWD/test/carga:/carga" -e
   BASE_URL=http://127.0.0.1:3200 grafana/k6:2.3.0 run --summary-export /carga/resumo.json /carga/cenario.js` (13 min: 2 de
   subida, 10 no alvo, 1 de descida). O resumo (tela e `resumo.json`) traz uma linha por rota (`http_req_duration{nome:…}`),
   o p95 só das páginas `/p/*` (`{tipo:pagina,area:p}`) e as respostas do push por status
   (`http_reqs{nome:/api/p/push,status:204|409|429}`); os números do relatório saem dele (consultas abaixo). Rota nova no
   cenário entra na lista `ROTAS` de `cenario.js` (sem ela, o k6 derruba a iteração e a fumaça já acusa).
7. Worker com o volume: antes da rodada, o total de lembretes (`docker compose -f docker-compose.carga.yml --env-file
   .env.carga.compose exec db psql -U carga_owner -d nutri -c "select status, count(*) from notifications group by
   status"`; esperado: milhares de `pendente`, ~150 por consultório vencendo durante a rodada — com `notifications`
   vazia a meta não está sendo medida, parar e corrigir a semente). Depois, a duração do job `notificacoes` (roda a
   cada minuto; meta D4: < 20 s) pelas colunas `started_on`/`completed_on` da tabela `pgboss.job` do banco **da carga**
   (`select max(completed_on - started_on) from pgboss.job where name = 'notificacoes' and state = 'completed'`) e
   quantas linhas a varredura tratou (`select status, count(*) from notifications where updated_at >= '<início da
   rodada>' group by status` — enviadas, ignoradas e adiadas pelo horário silencioso contam). `retencao-lgpd` (04h) e
   `agenda-limpeza` (04h30) — horários de Brasília, 07h e 07h30 na VPS — entram no relatório se a rodada passar
   desses horários.
8. S-7: anotar o p95 das páginas `/p/*` — a linha `http_req_duration{tipo:pagina,area:p}` do resumo (`jq -r
   '.metrics["http_req_duration{tipo:pagina,area:p}"]["p(95)"]' test/carga/resumo.json`; também tem threshold de 800 ms,
   então aparece como ✓/✗ no fim do k6). A imagem já tem o `cache()` da Tarefa 14 em
   `requireUserComTenant`, que o `requirePaciente` também usa; a parte própria do paciente (`vinculosDaConta`,
   `termoAceito`) **não** ganha `cache()` neste plano — não há "antes/depois". Se o p95 de `/p/*` passar da meta da D4,
   o relatório propõe o `cache()` no `requirePaciente` como tarefa.
9. Lighthouse (LCP, D4), com a pilha no ar e uma sessão de paciente. O cookie vai num arquivo temporário (nunca na
   linha de comando):
   `H="$(mktemp)"; node -e "const fs=require('fs');fs.writeFileSync(process.argv[1],JSON.stringify({cookie:JSON.parse(fs.readFileSync('test/carga/.sessoes.json','utf8')).pacientes[0].cookie}))" "$H"`,
   depois `pnpm dlx lighthouse@12 http://127.0.0.1:3200/p/inicio --preset=perf --form-factor=mobile
   --throttling-method=simulate --extra-headers="$H" --chrome-flags="--headless=new --no-sandbox" --output=json
   --output-path=/tmp/lh-inicio.json` e o mesmo para `/p/plano`; anotar o `largest-contentful-paint` e conferir que o
   `finalDisplayedUrl` é a própria página (não `/entrar`). Sem Chrome no host, `CHROME_PATH` aponta para o Chromium do
   Playwright (`~/.cache/ms-playwright/chromium-*/chrome-linux*/chrome`). No fim, `rm -f "$H"`. (O perfil móvel padrão
   do Lighthouse é o "Slow 4G" da RNF-01.)
10. `docker compose -f docker-compose.carga.yml --env-file .env.carga.compose down -v` e apagar `.env.carga*`,
    `test/carga/.sessoes.json` e `test/carga/resumo.json` (depois de passar os números para o relatório).

## Relatório (copiar para carga-AAAA-MM-DD.md)
Os números do k6 saem do `test/carga/resumo.json` (passo 6), antes do passo 10:
- p95 api / páginas / `/p/*` / push: `http_req_duration{tipo:api}`, `{tipo:pagina}`, `{tipo:pagina,area:p}` e
  `{nome:/api/p/push}`, campo `p(95)` (ms); falhas: `http_req_failed` (`value`); checks: `checks` (`value`).
- Pior rota (p95): `jq -r '.metrics | to_entries[] | select(.key | startswith("http_req_duration{nome:")) |
  "\(.value["p(95)"] | floor) ms \(.key)"' test/carga/resumo.json | sort -n | tail -3` (a última linha é a pior; anotar as três).
- Respostas do push: `jq -r '.metrics | to_entries[] | select(.key | startswith("http_reqs{nome:/api/p/push,")) |
  "\(.key) \(.value.count)"' test/carga/resumo.json` (409 conta como falha: inscrição de outra conta não deveria acontecer
  na carga).

- Commit/imagem: · Limites (app/worker/db, shared_buffers, pool): · Rodada: 1 / 2
- k6: p95 api: · p95 páginas: · falhas: · checks: · pior rota (p95, `nome`):
- Worker: lembretes pendentes antes da rodada: · tratados durante a rodada (por status): · `notificacoes` com 15 mil pacientes (máx.): · `agenda-limpeza`:
- `docker stats`: pico de CPU/memória por container · `cursoia_crm`: sem mudança? · CPU livre mínima:
- Lighthouse: LCP `/p/inicio`: · LCP `/p/plano`:
- B-8 (`app_soltar_endpoint_push` com 50 tenants): p95 do `POST /api/p/push?sincronizar=1` (`http_req_duration{nome:/api/p/push}`): · respostas 204/409/429 (`http_reqs{nome:/api/p/push,status:…}`):
- S-7: p95 das páginas `/p/*` (`http_req_duration{tipo:pagina,area:p}`; acima de 800 ms → tarefa do `cache()` no `requirePaciente`):
- Gargalo e ajuste proposto ao dono (limites no Easypanel, `shared_buffers`, pool):
- Não coberto nesta rodada → backlog: `/painel/conteudos` com 200 conteúdos publicados e o decode de PNG grande na
  capa (Notas do Plano 07 para o P08-03; a semente cria 100 conteúdos e não sobe imagem) · outros:
- Interrupções pelo critério de parada (momento e motivo):
- Resultado contra a D4: aprovado / reprovado (o quê)

## Rodadas
Rodada 1 com os limites atuais (`nutri_app` 1 vCPU/1 GiB, `nutri_db` 1 GiB, `nutri_worker` 1 vCPU/1 GiB, pool 10,
`shared_buffers` 128 MB — os padrões das variáveis `CARGA_*`). Se reprovar, o relatório propõe os limites novos; o dono
muda **no Easypanel** (produção) e nas variáveis `CARGA_*` do `.env.carga.compose` (carga: `CARGA_APP_CPUS`,
`CARGA_APP_MEM`, `CARGA_WORKER_CPUS`, `CARGA_WORKER_MEM`, `CARGA_DB_MEM`, `CARGA_SHARED_BUFFERS`); rodada 2 com Sentry
(`SENTRY_DSN` de um projeto **de teste** no `.env.carga`, para medir o custo do SDK). As duas rodadas usam a imagem do
deploy do merge. Os relatórios entram num **PR curto de docs** (`docs/carga-AAAA-MM-DD`, a partir da `main`); se a
rodada pedir mudança de código, é outro PR, com nova rodada antes do primeiro paciente real.
