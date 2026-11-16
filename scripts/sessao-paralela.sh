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
#   5. imprime o comando para subir o dev na porta da sessão.
#
# Só dev: recusa se DATABASE_URL ou DATABASE_URL_MIGRATOR apontarem para host que não seja localhost/127.0.0.1.
# Nunca imprime senha nem o conteúdo do .env.local.

set -euo pipefail

# --- constantes (conferir com docker-compose.dev.yml) ---------------------------------------------------------------
COMPOSE_ARQUIVO='docker-compose.dev.yml'
COMPOSE_SERVICO='db'            # services.db
COMPOSE_DONO='nutri_owner'      # POSTGRES_USER: dono do cluster de dev e role do DATABASE_URL_MIGRATOR
COMPOSE_BANCO_BASE='nutri'      # POSTGRES_DB: só para conectar e criar os outros bancos

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

git check-ref-format --branch "$BRANCH" >/dev/null 2>&1 || falhar "nome de branch inválido: '$BRANCH'"
[[ "$BRANCH" != 'main' ]] || falhar 'não use a main numa sessão paralela: cada sessão trabalha no próprio branch'

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
# Lê o .env com node só para validar host; a saída é um código de erro e o nome da variável, nunca o valor.
conferir_hosts() {
  node - "$1" <<'JS'
const fs = require('node:fs');
const arquivo = process.argv[2];
const linhas = fs.readFileSync(arquivo, 'utf8').split('\n');
const vistos = new Set();
for (const linha of linhas) {
  const m = linha.match(/^\s*(?:export\s+)?(DATABASE_URL|DATABASE_URL_MIGRATOR)\s*=\s*(.*)$/);
  if (!m) continue;
  const valor = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  let host;
  try { host = new URL(valor).hostname; } catch { console.error(`${m[1]} não é uma URL válida`); process.exit(3); }
  if (!['localhost', '127.0.0.1'].includes(host)) {
    console.error(`${m[1]} aponta para um host que não é localhost/127.0.0.1: recusado (só banco de dev)`);
    process.exit(3);
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
if [[ -n "$ATUAL" ]]; then
  [[ "$ATUAL" == "$BRANCH" ]] ||
    falhar "o worktree $DESTINO já existe com o branch '$ATUAL' (pedido: '$BRANCH'); feche aquela sessão antes"
  echo "Worktree $DESTINO já existe no branch $BRANCH."
elif [[ -e "$DESTINO" ]]; then
  falhar "$DESTINO existe mas não é worktree deste repositório; recusado"
elif [[ $NOVO -eq 1 ]]; then
  if git -C "$PRINCIPAL" show-ref --verify --quiet "refs/heads/$BRANCH"; then
    falhar "o branch '$BRANCH' já existe; rode sem --novo para usá-lo"
  fi
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
  # Dono = role do DATABASE_URL_MIGRATOR: o db:migrate precisa ser dono do banco (REVOKE TEMPORARY, src/db/migrate.ts).
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
FIM
