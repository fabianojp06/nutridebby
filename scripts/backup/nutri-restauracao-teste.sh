#!/usr/bin/env bash
# Teste de restauração do NutriDebby (RNF-05, P08-04). Roda NO HOST, uma vez por mês, com OK do dono (lê o backup
# de produção). Banco descartável: container sem rede, dados em tmpfs, apagado no fim (é dado de saúde, LGPD).
# Imprime só contagens. Segredos só no ambiente (RCLONE_CONFIG_* de /etc/nutri-backup/backup.env). Ver docs/operacao/restauracao.md.
set -uo pipefail

REMOTO="${NUTRI_BACKUP_REMOTE:-cripto:}"
DIA="${NUTRI_RESTAURAR_DIA:?defina NUTRI_RESTAURAR_DIA (AAAA-MM-DD do dump)}"
IMAGEM="${NUTRI_RESTAURAR_IMAGEM:-postgres:16-alpine}"
NOME="nutri_restauracao_teste_$$"
# D6: o mesmo superusuário de instalação do banco de origem (o do backup.env). O pg_dumpall grava as filiações com
# "GRANTED BY <ele>" e, no PG 16, só o superusuário de instalação concede em nome de quem não tem ADMIN OPTION:
# com outro nome, o "GRANT nutri_app_role TO <role do app>" falha e o roles= sai "faltando".
SU="${NUTRI_DB_USER:-postgres}"

log() { printf '%s nutri-restauracao: %s\n' "$(date -u +%FT%TZ)" "$*"; }
limpar() { docker rm -f "$NOME" >/dev/null 2>&1 || true; }
trap limpar EXIT

[[ "$DIA" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { log "ERRO: dia inválido"; exit 1; }
[[ "$SU" =~ ^[a-z_][a-z0-9_]*$ ]] || { log "ERRO: NUTRI_DB_USER inválido"; exit 1; }
if ! rclone lsf "${REMOTO}db/diario/nutri-${DIA}.dump" >/dev/null 2>&1 || [ -z "$(rclone lsf "${REMOTO}db/diario/nutri-${DIA}.dump" 2>/dev/null)" ]; then
  log "ERRO: dump do dia não encontrado"
  exit 1
fi

inicio=$(date +%s)
# Senha descartável só no ambiente (docker run/exec -e NOME, sem o valor na linha de comando)
POSTGRES_PASSWORD="$(openssl rand -hex 16)"; PGPASSWORD="$POSTGRES_PASSWORD"; export POSTGRES_PASSWORD PGPASSWORD
docker run -d --rm --name "$NOME" --network none --tmpfs /var/lib/postgresql/data:rw \
  -e POSTGRES_PASSWORD -e POSTGRES_USER="$SU" -e POSTGRES_DB=nutri "$IMAGEM" >/dev/null 2>&1 \
  || { log "ERRO: não subiu o banco descartável"; exit 1; }
# A imagem oficial sobe antes um servidor TEMPORÁRIO só por socket (listen_addresses=''), cria o banco, desliga e sobe o
# definitivo. Por socket, o pg_isready já responde no temporário e o psql/pg_restore seriam derrubados quando ele para.
# Só o definitivo escuta TCP: esperar e conectar por 127.0.0.1 (o loopback existe mesmo com --network none).
pronto=false
for _ in $(seq 1 60); do
  if docker exec "$NOME" pg_isready -h 127.0.0.1 -U "$SU" -d nutri >/dev/null 2>&1; then pronto=true; break; fi
  sleep 1
done
[ "$pronto" = true ] || { log "ERRO: o banco descartável não ficou pronto em 60 s"; exit 1; }
PG=(docker exec -i -e PGPASSWORD "$NOME")
# D6: roles antes do dump (o "role <superusuário> já existe" e afins são esperados: ON_ERROR_STOP=0). Vazio ou sem
# CREATE ROLE conta como ausente: o psql com entrada vazia sai 0 e diria "roles aplicados" sem role nenhum.
globais="$(rclone cat "${REMOTO}db/globais.sql" 2>/dev/null)" || globais=""
if [[ "$globais" == *"CREATE ROLE"* ]] \
  && printf '%s\n' "$globais" | "${PG[@]}" psql -h 127.0.0.1 -U "$SU" -d postgres -v ON_ERROR_STOP=0 -q >/dev/null 2>&1; then
  log "roles aplicados"
else
  log "AVISO: sem db/globais.sql (ou vazio) — criar os roles à mão (docs/operacao/restauracao.md)"
fi
# Sem o stderr do pg_restore no log (cita nomes de objetos e, em erro de dado, valores)
if ! rclone cat "${REMOTO}db/diario/nutri-${DIA}.dump" 2>/dev/null | "${PG[@]}" pg_restore -h 127.0.0.1 -U "$SU" -d nutri --exit-on-error >/dev/null 2>&1; then
  log "ERRO: pg_restore falhou"
  exit 1
fi
duracao=$(( $(date +%s) - inicio ))

q() { "${PG[@]}" psql -h 127.0.0.1 -U "$SU" -d nutri -At -v ON_ERROR_STOP=1 -c "$1" 2>/dev/null; }
sem_rls=$(q "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  where c.relkind in ('r','p') and c.relname not in ('user','consents','invites')
    and exists (select 1 from information_schema.columns k where k.table_schema = 'public' and k.table_name = c.relname and k.column_name = 'tenant_id')
    and not (c.relrowsecurity and c.relforcerowsecurity)")
migrations=$(q "select count(*) from drizzle.__drizzle_migrations")
tenants=$(q "select count(*) from tenants")
pacientes=$(q "select count(*) from patients")
definer=$(q "select count(*) from pg_proc p join pg_roles r on r.oid = p.proowner where p.prosecdef and r.rolsuper")
# D6: os roles voltaram — nutri_app_role sem login, ao menos um membro dele com login (o role do app) e todo dono de
# tabela do public com login (o migrator: é ele que roda as migrations no deploy)
roles=$(q "select case when exists (select 1 from pg_roles where rolname = 'nutri_app_role' and not rolcanlogin)
  and exists (select 1 from pg_auth_members m join pg_roles r on r.oid = m.member
              where m.roleid = (select oid from pg_roles where rolname = 'nutri_app_role') and r.rolcanlogin)
  and not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
                  join pg_roles r on r.oid = c.relowner where c.relkind in ('r','p') and not r.rolcanlogin)
  then 'ok' else 'faltando' end")

# As contagens saem antes das guardas (o dono vê o que veio); "restauracao ok" só depois de todas passarem
echo "restauracao: duracao=${duracao}s tabelas_sem_rls=${sem_rls:-?} migrations=${migrations:-?} tenants=${tenants:-?} pacientes=${pacientes:-?} funcoes_definer_superusuario=${definer:-?} roles=${roles:-?}"
num() { [[ "${1:-}" =~ ^[0-9]+$ ]]; }
# Dump sem as tabelas do app (outro banco, dump vazio): as consultas falham, as contagens saem vazias e o resto passaria
# sem testar nada
{ num "$migrations" && [ "$migrations" -gt 0 ]; } || { log "ERRO: nenhuma migration no banco restaurado (dump sem as tabelas do app?)"; exit 1; }
{ num "$tenants" && num "$pacientes"; } || { log "ERRO: contagem de tenants/pacientes ilegível no banco restaurado"; exit 1; }
[ "${sem_rls:-1}" = 0 ] || { log "ERRO: tabela com tenant_id sem RLS forçada depois da restauração"; exit 1; }
[ "${roles:-}" = ok ] || { log "ERRO: roles faltando ou sem login depois da restauração (docs/operacao/restauracao.md)"; exit 1; }
if [ "${definer:-1}" != 0 ] && [ "${NUTRI_RESTAURAR_PERMITIR_DEFINER_SUPER:-}" != 1 ]; then
  log "ERRO: função SECURITY DEFINER com dono superusuário depois da restauração (o migrator de produção não é superusuário)"
  exit 1
fi
echo "restauracao ok"
exit 0
