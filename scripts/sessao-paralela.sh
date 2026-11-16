#!/usr/bin/env bash
# Prepara uma sessão paralela do Claude Code no NutriDebby (docs/operacao/sessoes-paralelas.md, PD-01).
#
# Uso: scripts/sessao-paralela.sh <a|b|c> <branch> [--novo]
#
#   a → worktree ../nutridebby-a, porta 3101, banco nutri_dev_a
#   b → worktree ../nutridebby-b, porta 3102, banco nutri_dev_b
#   c → worktree ../nutridebby-c, porta 3103, banco nutri_dev_c
#
#   --novo  cria o branch a partir de origin/main (sem a opção, usa um branch que já existe, local ou em origin)
#
# O que faz (idempotente: rodar de novo só completa o que faltou):
#   1. cria o worktree ../nutridebby-<x> ao lado do worktree principal (recusa se ele existe com outro branch);
#   2. copia o .env.local do worktree principal trocando APP_URL para a porta da sessão e o banco de DATABASE_URL e
#      DATABASE_URL_MIGRATOR para nutri_dev_<x> (se o worktree já tem .env.local, só reaplica as trocas nele);
#   3. cria o banco nutri_dev_<x> no Postgres do docker-compose.dev.yml (serviço `db`, dono `nutri_owner`), se faltar;
#   4. roda `pnpm install --frozen-lockfile` e `pnpm db:migrate` no worktree;
#   5. imprime os comandos para subir o dev, o worker e o E2E na porta da sessão.
#
# Só dev: recusa se DATABASE_URL ou DATABASE_URL_MIGRATOR saírem do Postgres do compose de dev (localhost/127.0.0.1,
# porta 54329, sem host/porta/usuário na query; o migrator é nutri_owner) e se alguma das variáveis do .env.local
# estiver exportada no shell (ela venceria o arquivo no db:migrate, no worker e no next dev).
# Nunca imprime senha nem o conteúdo do .env.local.

set -euo pipefail

# --- constantes (conferir com docker-compose.dev.yml) ---------------------------------------------------------------
COMPOSE_ARQUIVO='docker-compose.dev.yml'
COMPOSE_SERVICO='db'            # services.db
COMPOSE_DONO='nutri_owner'      # POSTGRES_USER: superusuário do cluster de dev e role exigido no DATABASE_URL_MIGRATOR
COMPOSE_BANCO_BASE='nutri'      # POSTGRES_DB: só para conectar e criar os outros bancos
COMPOSE_PORTA='54329'           # ports: 127.0.0.1:54329:5432

falhar() {
  echo "sessao-paralela: $*" >&2
  exit 1
}

uso() {
  echo "Uso: scripts/sessao-paralela.sh <a|b|c> <branch> [--novo]" >&2
  exit 2
}

# --- argumentos ------------------------------------------------------------------------------------------------------
[[ $# -ge 2 && $# -le 3 ]] || uso
SESSAO="$1"
BRANCH="$2"
NOVO=0
if [[ $# -eq 3 ]]; then
  [[ "$3" == '--novo' ]] || uso
  NOVO=1
fi

case "$SESSAO" in
  a) PORTA=3101 ;;
  b) PORTA=3102 ;;
  c) PORTA=3103 ;;
  *) echo "sessao-paralela: sessão inválida: '$SESSAO' (use a, b ou c)" >&2; uso ;;
esac
BANCO="nutri_dev_${SESSAO}"

# O nome tem de sair igual do check-ref-format (recusa @{-1} e afins, que ele expande) e não pode ser um caminho de ref
# (heads/main, refs/heads/main, origin/main...), que o git resolveria para a main ou criaria um branch esquisito.
[[ "$(git check-ref-format --branch "$BRANCH" 2>/dev/null)" == "$BRANCH" ]] || falhar "nome de branch inválido: '$BRANCH'"
[[ ! "$BRANCH" =~ ^(refs|heads|remotes|origin)/ ]] ||
  falhar "use o nome curto do branch, sem refs/, heads/, remotes/ ou origin/: '$BRANCH'"
[[ "$BRANCH" != 'main' ]] || falhar 'não use a main numa sessão paralela: cada sessão trabalha no próprio branch'

# Variável exportada no shell vence o .env.local (tsx --env-file, next dev, pnpm worker): a trava abaixo, que olha o
# arquivo, não serviria. Recusa e diz só o nome.
for v in DATABASE_URL DATABASE_URL_MIGRATOR APP_URL DATA_DIR; do
  [[ -z "${!v+x}" ]] || falhar "$v está exportada no shell e venceria o .env.local da sessão; rode com: env -u $v scripts/sessao-paralela.sh ..."
done

# --- onde estamos ----------------------------------------------------------------------------------------------------
# O worktree principal é o dono do .git comum (vale também se o script rodar de dentro de outro worktree).
GIT_COMUM="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" ||
  falhar 'rode dentro do repositório do NutriDebby'
PRINCIPAL="$(dirname "$GIT_COMUM")"
DESTINO="$(dirname "$PRINCIPAL")/nutridebby-${SESSAO}"
ENV_ORIGEM="$PRINCIPAL/.env.local"

[[ -f "$PRINCIPAL/$COMPOSE_ARQUIVO" ]] || falhar "não achei $COMPOSE_ARQUIVO em $PRINCIPAL"
[[ -f "$ENV_ORIGEM" ]] || falhar "não achei o .env.local do worktree principal ($ENV_ORIGEM)"
command -v node >/dev/null || falhar 'node não encontrado'
command -v pnpm >/dev/null || falhar 'pnpm não encontrado'
command -v docker >/dev/null || falhar 'docker não encontrado'

# --- trava de produção (antes de criar qualquer coisa) ---------------------------------------------------------------
# Lê o .env com node só para validar destino; a saída é um código de erro e o nome da variável, nunca o valor.
# O pg (pg-connection-string) deixa a query sobrescrever host, porta e usuário: por isso só `sslmode` é aceito nela.
conferir_hosts() {
  node - "$1" "$COMPOSE_PORTA" "$COMPOSE_DONO" <<'JS'
const fs = require('node:fs');
const [arquivo, porta, dono] = process.argv.slice(2);
const recusar = (msg) => { console.error(msg); process.exit(3); };
const linhas = fs.readFileSync(arquivo, 'utf8').split('\n');
const vistos = new Set();
for (const linha of linhas) {
  const m = linha.match(/^\s*(?:export\s+)?(DATABASE_URL|DATABASE_URL_MIGRATOR)\s*=\s*(.*)$/);
  if (!m) continue;
  const valor = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  let url;
  try { url = new URL(valor); } catch { recusar(`${m[1]} não é uma URL válida`); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) recusar(`${m[1]} não é uma URL do Postgres`);
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
    recusar(`${m[1]} aponta para um host que não é localhost/127.0.0.1: recusado (só banco de dev)`);
  }
  if (url.port !== porta) recusar(`${m[1]} não usa a porta ${porta} do Postgres de dev (docker-compose.dev.yml): recusado`);
  for (const chave of url.searchParams.keys()) {
    if (chave !== 'sslmode') recusar(`${m[1]} tem o parâmetro '${chave}' na query (só sslmode é aceito): recusado`);
  }
  if (m[1] === 'DATABASE_URL_MIGRATOR' && decodeURIComponent(url.username) !== dono) {
    recusar(`DATABASE_URL_MIGRATOR não usa o role ${dono} (dono dos bancos de dev, CLAUDE.md regra 7): recusado`);
  }
  vistos.add(m[1]);
}
for (const v of ['DATABASE_URL', 'DATABASE_URL_MIGRATOR']) {
  if (!vistos.has(v)) { console.error(`${v} ausente em ${arquivo}`); process.exit(3); }
}
JS
}
conferir_hosts "$ENV_ORIGEM" || falhar "trava de produção: confira $ENV_ORIGEM"

# --- 1. worktree -----------------------------------------------------------------------------------------------------
# Branch do worktree em DESTINO, se ele estiver registrado (vazio se não estiver).
branch_do_worktree() {
  git -C "$PRINCIPAL" worktree list --porcelain | awk -v alvo="worktree $1" '
    $0 == alvo { achou = 1; next }
    achou && /^branch / { sub(/^branch refs\/heads\//, ""); print; exit }
    achou && /^detached/ { print "(HEAD destacado)"; exit }
    achou && /^$/ { exit }
  '
}

ATUAL="$(branch_do_worktree "$DESTINO")"
if [[ -n "$ATUAL" && ! -d "$DESTINO" ]]; then
  falhar "o worktree $DESTINO está registrado mas a pasta sumiu; rode: git worktree prune (e de novo este script)"
elif [[ -n "$ATUAL" ]]; then
  [[ "$ATUAL" == "$BRANCH" ]] ||
    falhar "o worktree $DESTINO já existe com o branch '$ATUAL' (pedido: '$BRANCH'); feche aquela sessão antes"
  echo "Worktree $DESTINO já existe no branch $BRANCH."
elif [[ -e "$DESTINO" ]]; then
  falhar "$DESTINO existe mas não é worktree deste repositório; recusado"
elif [[ $NOVO -eq 1 ]]; then
  if git -C "$PRINCIPAL" show-ref --verify --quiet "refs/heads/$BRANCH"; then
    falhar "o branch '$BRANCH' já existe; rode sem --novo para usá-lo"
  fi
  # Também em origin: criar de novo a partir da main faria o primeiro push ser recusado (ou, forçado, apagar o remoto).
  RC_REMOTO=0
  git -C "$PRINCIPAL" ls-remote --exit-code --heads origin "refs/heads/$BRANCH" >/dev/null 2>&1 || RC_REMOTO=$?
  case "$RC_REMOTO" in
    0) falhar "o branch '$BRANCH' já existe em origin; rode sem --novo para usá-lo" ;;
    2) ;;
    *) falhar 'não consegui consultar origin para conferir se o branch já existe' ;;
  esac
  echo "Buscando origin/main..."
  git -C "$PRINCIPAL" fetch --quiet origin main
  git -C "$PRINCIPAL" worktree add -b "$BRANCH" "$DESTINO" origin/main
  # Sem upstream: o primeiro push define (git push -u origin <branch>), para não empurrar na main por engano.
  git -C "$DESTINO" branch --unset-upstream >/dev/null 2>&1 || true
else
  if ! git -C "$PRINCIPAL" show-ref --verify --quiet "refs/heads/$BRANCH"; then
    git -C "$PRINCIPAL" fetch --quiet origin "$BRANCH" 2>/dev/null ||
      falhar "o branch '$BRANCH' não existe nem localmente nem em origin; use --novo para criá-lo"
  fi
  # Com o branch só em origin, o git cria o local rastreando origin/<branch>.
  git -C "$PRINCIPAL" worktree add "$DESTINO" "$BRANCH"
fi

# --- 2. .env.local da sessão -----------------------------------------------------------------------------------------
ENV_DESTINO="$DESTINO/.env.local"
if [[ -f "$ENV_DESTINO" ]]; then
  echo "Reaplicando porta e banco no .env.local que já existe em $DESTINO."
  BASE_ENV="$ENV_DESTINO"
else
  echo "Copiando o .env.local do worktree principal (porta $PORTA, banco $BANCO)."
  BASE_ENV="$ENV_ORIGEM"
fi
conferir_hosts "$BASE_ENV" || falhar "trava de produção: confira $BASE_ENV"

TEMP_ENV="$(mktemp "$DESTINO/.env.local.XXXXXX")"
trap 'rm -f "$TEMP_ENV"' EXIT
chmod 600 "$TEMP_ENV"
# Troca só o caminho (nome do banco) das duas URLs e a APP_URL; usuário, senha, host e query ficam como estão.
node - "$BASE_ENV" "$TEMP_ENV" "$PORTA" "$BANCO" <<'JS'
const fs = require('node:fs');
const [origem, destino, porta, banco] = process.argv.slice(2);
let temAppUrl = false;
const saida = fs.readFileSync(origem, 'utf8').split('\n').map((linha) => {
  const m = linha.match(/^(\s*(?:export\s+)?)([A-Z_]+)(\s*=\s*)(.*)$/);
  if (!m) return linha;
  const [, pre, nome, igual, bruto] = m;
  if (nome === 'APP_URL') { temAppUrl = true; return `${pre}APP_URL${igual}http://localhost:${porta}`; }
  if (nome !== 'DATABASE_URL' && nome !== 'DATABASE_URL_MIGRATOR') return linha;
  const aspas = bruto.trim().match(/^(['"])(.*)\1$/);
  let url;
  // O erro do Node mostraria a URL inteira (com a senha): só o nome da variável vai para a tela.
  try { url = new URL(aspas ? aspas[2] : bruto.trim()); } catch { console.error(`${nome} não é uma URL válida`); process.exit(3); }
  url.pathname = `/${banco}`;
  const valor = aspas ? `${aspas[1]}${url.toString()}${aspas[1]}` : url.toString();
  return `${pre}${nome}${igual}${valor}`;
});
if (!temAppUrl) saida.push(`APP_URL=http://localhost:${porta}`);
fs.writeFileSync(destino, saida.join('\n'));
JS
conferir_hosts "$TEMP_ENV" || falhar 'trava de produção: o .env.local gerado não passou'
mv "$TEMP_ENV" "$ENV_DESTINO"
trap - EXIT

# DATA_DIR relativo (./data) fica dentro de cada worktree; absoluto seria compartilhado entre as sessões.
if grep -Eq '^\s*(export\s+)?DATA_DIR\s*=\s*["'"'"']?/' "$ENV_DESTINO"; then
  echo "AVISO: DATA_DIR é um caminho absoluto: as sessões vão dividir a pasta de arquivos. Prefira ./data." >&2
fi

# --- 3. banco nutri_dev_<x> ------------------------------------------------------------------------------------------
compose() { docker compose -f "$PRINCIPAL/$COMPOSE_ARQUIVO" "$@"; }

[[ -n "$(compose ps --status running -q "$COMPOSE_SERVICO" 2>/dev/null)" ]] ||
  falhar "o Postgres de dev não está no ar; rode: docker compose -f $COMPOSE_ARQUIVO up -d (no worktree principal)"

psql_dev() { compose exec -T "$COMPOSE_SERVICO" psql -U "$COMPOSE_DONO" -d "$COMPOSE_BANCO_BASE" -v ON_ERROR_STOP=1 -tA "$@"; }

if [[ "$(psql_dev -c "select 1 from pg_database where datname = '$BANCO'")" == '1' ]]; then
  echo "Banco $BANCO já existe."
else
  echo "Criando o banco $BANCO (dono $COMPOSE_DONO)."
  # Dono = role do DATABASE_URL_MIGRATOR (a trava confere), como em produção. Em dev o nutri_owner também é o
  # superusuário do cluster (POSTGRES_USER), então o REVOKE TEMPORARY do db:migrate funcionaria de qualquer jeito.
  psql_dev -c "CREATE DATABASE \"$BANCO\" OWNER \"$COMPOSE_DONO\"" >/dev/null
fi

# --- 4. dependências e migrations ------------------------------------------------------------------------------------
echo 'pnpm install --frozen-lockfile...'
(cd "$DESTINO" && pnpm install --frozen-lockfile)
echo "pnpm db:migrate no banco $BANCO..."
(cd "$DESTINO" && pnpm db:migrate)

# --- 5. pronto -------------------------------------------------------------------------------------------------------
if command -v ss >/dev/null && ss -ltn "sport = :$PORTA" 2>/dev/null | grep -q LISTEN; then
  echo "AVISO: a porta $PORTA já está em uso (outra sessão $SESSAO no ar?)." >&2
fi

cat <<FIM

Sessão $SESSAO pronta: worktree $DESTINO, branch $BRANCH, banco $BANCO.
Subir o app:     cd $DESTINO && pnpm exec next dev -p $PORTA
Subir o worker:  cd $DESTINO && pnpm worker
Abrir:           http://localhost:$PORTA
E2E (pare antes o worker da sessão; um E2E por vez entre as sessões):
                 cd $DESTINO && pnpm e2e:seed && pnpm build && APP_URL=http://localhost:$PORTA pnpm test:e2e
FIM
