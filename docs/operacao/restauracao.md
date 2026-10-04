# Restauração do backup (RNF-05, P08-04)

Metas: **RPO 24 h, RTO 4 h**. Teste **mensal**, com OK do dono (lê o backup de produção). Registro de cada teste em
`docs/operacao/restauracao-AAAA-MM.md` (data, dump usado, tamanho, duração, contagens, problemas).

## O que precisa estar FORA da VPS (gerenciador de senhas do dono — nunca colar em chat)
`BACKUP_PASSPHRASE` e o salt do rclone crypt; `AUTH_SECRET` (cifra o TOTP), `ENCRYPTION_KEY`, `FILE_URL_SECRET`,
`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`, `EVOLUTION_*`, chaves do R2, do Turnstile e do Resend. Sem eles o backup não
recupera o serviço (o TOTP e os links assinados dependem das chaves).

## Instalação no host (uma vez, e de novo a cada mudança dos scripts — regra 10)
Junto com o `nutri-backup.sh` (Plano 02, Tarefa 14):
`sudo install -m 755 scripts/backup/nutri-backup.sh scripts/backup/nutri-restauracao-teste.sh /usr/local/lib/nutri-backup/`.
O teste de restauração usa a imagem `postgres:16-alpine` (a mesma do `nutri_db`); o host precisa conseguir baixá-la.

## Teste mensal (no host)
1. Snapshot no hPanel não é preciso (nada muda em produção); confirmar com o dono.
2. `sudo -i`, `set -a; . /etc/nutri-backup/backup.env; set +a` (sem exibir). O `NUTRI_DB_USER` dali (padrão `postgres`)
   é também o superusuário do banco descartável: o `db/globais.sql` grava as filiações dos roles com `GRANTED BY` esse
   role, e no PG 16 só o superusuário de instalação as recria.
3. `NUTRI_RESTAURAR_DIA=<ontem> bash /usr/local/lib/nutri-backup/nutri-restauracao-teste.sh` → linha `restauracao: …` com `tabelas_sem_rls=0`, `migrations` maior que 0, `funcoes_definer_superusuario=0` e `roles=ok`, e por último a linha `restauracao ok` (só sai depois de todas as guardas; o script sai 1 se qualquer uma falhar; **nunca** usar `NUTRI_RESTAURAR_PERMITIR_DEFINER_SUPER` no host — é só do teste do CI).
4. Arquivos: `rclone cryptcheck "$NUTRI_DATA_DIR" cripto:data/atual --exclude '/*/exportacao/**'` (só hashes; o mesmo
   `--exclude` do backup — sem ele, um ZIP de exportação das últimas 24 h vira diferença falsa). Restaurar **um** arquivo
   de `logo/` (minimização: nada de dado de saúde fora do servidor) numa pasta privada: `d=$(mktemp -d)` (modo 0700) e
   `rclone copy cripto:data/atual/<tenant>/logo/<arquivo> "$d"`; conferir o tamanho com `stored_files.bytes` (leitura do
   banco de produção → confirmação) e `rm -rf "$d"`.
5. Registrar o resultado. Duração acima de 1 h → avisar o dono (o RTO é 4 h para o serviço inteiro).

## Restauração de verdade (desastre)
1. VPS nova ou a mesma: Easypanel com o projeto `nutri` (serviços `nutri_db`, `nutri_app`, `nutri_worker`; `nutri_evolution` à parte).
2. `nutri_db` vazio; aplicar `db/globais.sql` (roles) **como o superusuário de instalação** (o mesmo nome do backup,
   normalmente `postgres`; ver o passo 2 do teste mensal) e depois `pg_restore -d nutri --exit-on-error` do dump mais recente.
   O backup só troca o `globais.sql` quando o `pg_dumpall` dá certo (grava no `.novo` e promove); numa noite com
   `roles falhou` fica a cópia da última noite boa. Sem `globais.sql`, ou com ele vazio (backup antigo): criar à mão `nutri_app_role` (NOLOGIN), o role dono das migrations (o de `DATABASE_URL_MIGRATOR`,
   sem superusuário) e o role de login do app (o de `DATABASE_URL`, membro de `nutri_app_role`) **antes** do `pg_restore`.
   **Os roles voltam SEM senha** (`--no-role-passwords`). Antes de subir o `nutri_app`, o dono devolve a senha do role
   do migrator (o usuário de `DATABASE_URL_MIGRATOR`): `docker exec -it $(docker ps -q -f name=nutri_db | head -n1) psql -U postgres -d nutri`
   e, dentro do psql, `\password <role do migrator>` — o psql pede a senha duas vezes **sem eco** e manda só o hash (nada vai
   para o histórico do shell nem do psql); o valor vem do gerenciador de senhas e **nunca passa pelo chat**. Sem isso, o
   `docker-entrypoint.sh` roda `scripts/migrate.ts` antes do `next start`, a autenticação SCRAM do migrator falha e o app
   não sobe (o RTO de 4 h fica em risco). A senha do role do app (`DATABASE_URL`) volta sozinha: as migrations a gravam a
   partir do `DATABASE_URL` (`ensureAppLogin`, `src/db/migrate.ts`).
3. `/data`: `rclone copy cripto:data/atual /srv/nutri/data` (alterados/apagados dos últimos 30 dias em `data/historico/<dia>`).
4. Variáveis do Easypanel a partir do gerenciador de senhas; subir `nutri_app` (as migrations conferem a versão e regravam a senha do role do app) e `nutri_worker`.
5. `GET /api/health` = 200; login da nutricionista; abrir um prontuário; conferir um arquivo.
6. O banco `evolution` não está no backup (INT-01): reconectar o WhatsApp pelo QR em "WhatsApp".
7. Exclusões por LGPD feitas depois do dump restaurado: reaplicar (o "Histórico de acessos" e o `audit_log` do período
   perdido não voltam — registrar no relatório de incidente).
