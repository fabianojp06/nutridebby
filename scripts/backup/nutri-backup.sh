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
if [ -z "$DB" ]; then
  log "ERRO: container do banco não encontrado"
  exit 2
fi

registrar() { # tipo ok bytes detalhe inicio
  docker exec -i "$DB" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -q \
    -v tipo="$1" -v ok="$2" -v bytes="$3" -v detalhe="$4" -v inicio="$5" >/dev/null <<'SQL' || log "AVISO: não consegui registrar em backup_runs"
insert into backup_runs (tipo, ok, bytes, detalhe, iniciado_em)
values (:'tipo', :'ok'::boolean, nullif(:'bytes', '')::bigint, nullif(:'detalhe', ''), :'inicio'::timestamptz);
SQL
}

podar() { # pasta quantos_manter — nomes nutri-AAAA-MM-DD.dump ordenam como datas
  rclone lsf "$1" --files-only 2>/dev/null | grep -E '^nutri-[0-9]{4}-[0-9]{2}-[0-9]{2}\.dump$' | sort -r |
    tail -n +"$(($2 + 1))" | while read -r f; do rclone deletefile "$1$f" </dev/null; done
}

backup_banco() {
  local inicio arquivo bytes
  inicio="$(date -u +%FT%TZ)"
  arquivo="nutri-${HOJE}.dump"
  # shellcheck disable=SC2086 # NUTRI_PG_DUMP_ARGS: só os testes usam, e são várias palavras de propósito
  if docker exec "$DB" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc ${NUTRI_PG_DUMP_ARGS:-} | rclone rcat "${REMOTO}db/diario/${arquivo}"; then
    bytes="$(rclone lsf --format s "${REMOTO}db/diario/${arquivo}" | head -n1)"
    if [ "$(date -d "$HOJE" +%u)" = 7 ]; then
      rclone copyto "${REMOTO}db/diario/${arquivo}" "${REMOTO}db/semanal/${arquivo}"
    fi
    podar "${REMOTO}db/diario/" "$MANTER_DIARIOS"
    podar "${REMOTO}db/semanal/" "$MANTER_SEMANAIS"
    registrar banco true "$bytes" "" "$inicio"
    log "banco ok (${bytes} bytes)"
  else
    rclone deletefile "${REMOTO}db/diario/${arquivo}" 2>/dev/null
    registrar banco false "" "pg_dump ou envio falhou" "$inicio"
    log "ERRO no backup do banco"
    return 1
  fi
}

backup_arquivos() {
  local inicio limite
  inicio="$(date -u +%FT%TZ)"
  if rclone sync "$NUTRI_DATA_DIR" "${REMOTO}data/atual" --backup-dir "${REMOTO}data/historico/${HOJE}"; then
    limite="$(date -d "$HOJE -${HISTORICO_DIAS} days" +%F)"
    rclone lsf "${REMOTO}data/historico/" --dirs-only 2>/dev/null | sed 's#/$##' | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' |
      while read -r d; do
        if [[ "$d" < "$limite" ]]; then rclone purge "${REMOTO}data/historico/${d}" </dev/null; fi
      done
    registrar arquivos true "" "" "$inicio"
    log "arquivos ok"
  else
    registrar arquivos false "" "rclone sync falhou" "$inicio"
    log "ERRO no backup dos arquivos"
    return 1
  fi
}

falhas=0
backup_banco || falhas=$((falhas + 1))
backup_arquivos || falhas=$((falhas + 1))
exit "$falhas"
