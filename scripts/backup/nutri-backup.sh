#!/usr/bin/env bash
# Backup diário do NutriDebby (RNF-05). Roda NO HOST via systemd (03:00 America/Sao_Paulo).
# Plano 02, Tarefas 12 e 14 (docs/superpowers/plans/2026-09-28-nutridebby-02-plataforma.md).
#  - banco: pg_dump -Fc DENTRO do container nutri_db (superusuário local) → rclone rcat no remoto crypt
#  - arquivos: rclone sync de /data com --backup-dir datado (alterados/apagados ficam 30 dias)
#  - retenção: 7 diários + 4 semanais (domingo); cada etapa grava uma linha em backup_runs
# Segredos só no ambiente (RCLONE_CONFIG_*, de /etc/nutri-backup/backup.env). Nada de segredo no log.
set -uo pipefail

: "${NUTRI_DATA_DIR:?defina NUTRI_DATA_DIR (pasta do volume /data no host)}"
REMOTO="${NUTRI_BACKUP_REMOTE:-cripto:}"
DB_USER="${NUTRI_DB_USER:-postgres}"
DB_NAME="${NUTRI_DB_NAME:-nutri}"
TZ_BACKUP="${NUTRI_BACKUP_TZ:-America/Sao_Paulo}"
HOJE="${NUTRI_BACKUP_TODAY:-$(TZ="$TZ_BACKUP" date +%F)}"
MANTER_DIARIOS=7
MANTER_SEMANAIS=4
HISTORICO_DIAS=30

log() { printf '%s nutri-backup: %s\n' "$(date -u +%FT%TZ)" "$*"; }

DB="${NUTRI_DB_CONTAINER:-$(docker ps -q -f "name=${NUTRI_DB_CONTAINER_FILTER:-nutri_db}" | head -n1)}"
# M20: sem o container, só a etapa do banco é pulada — a cópia de /data não depende dele.
if [ -z "$DB" ]; then
  log "ERRO: container do banco não encontrado; sem backup do banco hoje (os arquivos seguem)"
fi

registrar() { # tipo ok bytes detalhe inicio — falhar aqui conta como etapa falha (quem chama propaga)
  if [ -z "$DB" ]; then
    log "AVISO: sem o container do banco, não registrei em backup_runs"
    return 1
  fi
  docker exec -i "$DB" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -q \
    -v tipo="$1" -v ok="$2" -v bytes="$3" -v detalhe="$4" -v inicio="$5" >/dev/null 2>&1 <<'SQL' || { log "AVISO: não consegui registrar em backup_runs"; return 1; }
insert into backup_runs (tipo, ok, bytes, detalhe, iniciado_em)
values (:'tipo', :'ok'::boolean, nullif(:'bytes', '')::bigint, nullif(:'detalhe', ''), :'inicio'::timestamptz);
SQL
}

# Lista um prefixo do remoto. Pasta inexistente (rclone sai com 3) = lista vazia; qualquer outro erro = falha.
# Sem stderr do rclone no log (pode citar caminhos/endpoint).
listar() { # pasta --files-only|--dirs-only
  local saida rc=0
  saida="$(rclone lsf "$1" "$2" 2>/dev/null)" || rc=$?
  if [ "$rc" -eq 3 ]; then return 0; fi
  if [ "$rc" -ne 0 ]; then return 1; fi
  printf '%s\n' "$saida"
}

podar() { # pasta quantos_manter — nomes nutri-AAAA-MM-DD.dump ordenam como datas
  local lista f rc=0
  lista="$(listar "$1" --files-only)" || return 1
  lista="$(printf '%s\n' "$lista" | { grep -E '^nutri-[0-9]{4}-[0-9]{2}-[0-9]{2}\.dump$' || true; } | sort -r | tail -n +"$(($2 + 1))")"
  # here-string (não pipe): o loop roda no shell atual e rc sobrevive
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    rclone deletefile "$1$f" </dev/null >/dev/null 2>&1 || rc=1
  done <<<"$lista"
  return "$rc"
}

podar_historico() { # limite (AAAA-MM-DD) — apaga pastas datadas anteriores ao limite
  local lista d rc=0
  lista="$(listar "${REMOTO}data/historico/" --dirs-only)" || return 1
  lista="$(printf '%s\n' "$lista" | sed 's#/$##' | { grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' || true; })"
  while IFS= read -r d; do
    [ -n "$d" ] || continue
    if [[ "$d" < "$1" ]]; then rclone purge "${REMOTO}data/historico/${d}" </dev/null >/dev/null 2>&1 || rc=1; fi
  done <<<"$lista"
  return "$rc"
}

backup_banco() {
  local inicio arquivo bytes="" ok=true detalhe=""
  inicio="$(date -u +%FT%TZ)"
  arquivo="nutri-${HOJE}.dump"
  # G2: sem o stderr do pg_dump nem do rclone no log (citam endpoint, bucket, caminhos); só a mensagem fixa
  # shellcheck disable=SC2086 # NUTRI_PG_DUMP_ARGS: só os testes usam, e são várias palavras de propósito
  if docker exec "$DB" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc ${NUTRI_PG_DUMP_ARGS:-} 2>/dev/null \
    | rclone rcat "${REMOTO}db/diario/${arquivo}" >/dev/null 2>&1; then
    bytes="$(rclone lsf --format s "${REMOTO}db/diario/${arquivo}" 2>/dev/null | head -n1)" || bytes=""
    if [ "$(date -d "$HOJE" +%u)" = 7 ]; then
      rclone copyto "${REMOTO}db/diario/${arquivo}" "${REMOTO}db/semanal/${arquivo}" >/dev/null 2>&1 || ok=false
    fi
    podar "${REMOTO}db/diario/" "$MANTER_DIARIOS" || ok=false
    podar "${REMOTO}db/semanal/" "$MANTER_SEMANAIS" || ok=false
    if [ "$ok" = false ]; then detalhe="retenção falhou"; fi
    registrar banco "$ok" "$bytes" "$detalhe" "$inicio" || ok=false
    if [ "$ok" = true ]; then
      log "banco ok (${bytes} bytes)"
    else
      log "ERRO no backup do banco (${detalhe:-registro})"
      return 1
    fi
  else
    rclone deletefile "${REMOTO}db/diario/${arquivo}" >/dev/null 2>&1
    registrar banco false "" "pg_dump ou envio falhou" "$inicio"
    log "ERRO no backup do banco"
    return 1
  fi
}

backup_arquivos() {
  local inicio limite ok=true detalhe=""
  inicio="$(date -u +%FT%TZ)"
  # G2: stderr do rclone fora do log (cita endpoint, bucket e caminhos com o UUID do tenant)
  if rclone sync "$NUTRI_DATA_DIR" "${REMOTO}data/atual" --backup-dir "${REMOTO}data/historico/${HOJE}" >/dev/null 2>&1; then
    limite="$(date -d "$HOJE -${HISTORICO_DIAS} days" +%F)"
    podar_historico "$limite" || { ok=false; detalhe="retenção falhou"; }
    registrar arquivos "$ok" "" "$detalhe" "$inicio" || ok=false
    if [ "$ok" = true ]; then
      log "arquivos ok"
    elif [ -z "$DB" ] && [ -z "$detalhe" ]; then
      # G8: a cópia deu certo; só faltou o registro. Ainda conta como falha no código de saída.
      log "arquivos copiados, mas sem registro (banco indisponível)"
      return 1
    else
      log "ERRO no backup dos arquivos (${detalhe:-registro})"
      return 1
    fi
  else
    registrar arquivos false "" "rclone sync falhou" "$inicio"
    log "ERRO no backup dos arquivos"
    return 1
  fi
}

falhas=0
if [ -n "$DB" ]; then
  backup_banco || falhas=$((falhas + 1))
else
  falhas=$((falhas + 1))
fi
backup_arquivos || falhas=$((falhas + 1))
exit "$falhas"
