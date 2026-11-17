import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, inject } from 'vitest';
import { urlDoBanco } from './postgres-teste';

/**
 * SUS-100: banco próprio para os testes que fazem DDL em tabela real (os de "a guarda funciona": `drop policy`,
 * `create policy`, `drop trigger` dentro de begin/rollback).
 *
 * DDL de política e de gatilho pega AccessExclusiveLock na tabela até o rollback. No banco compartilhado do
 * Testcontainers, os outros arquivos rodam em paralelo e travam as mesmas tabelas em outra ordem: o B-5 segurava
 * `exams` e pedia `contents` enquanto outra transação segurava `contents` e pedia `exams` → 40P01 (CI do PR #54 e um
 * deploy). Travar numa ordem fixa não resolve, porque a ordem dos outros testes não é nossa; aqui a disputa deixa de
 * existir: cada arquivo que chama este helper ganha um banco clonado (`CREATE DATABASE … TEMPLATE`) do modelo que o
 * `test/global-setup.ts` congela logo depois das migrations e das fixtures — o mesmo catálogo, nenhuma outra sessão.
 * O `TEMPLATE` não copia o que é do nível do banco (`datacl`, `pg_db_role_setting`): o clone nasceria com o TEMPORARY
 * padrão de PUBLIC e sem o CONNECT do role da aplicação. Por isso o `beforeAll` reaplica o que o `ensureAppLogin`
 * (`src/db/migrate.ts`) faz no banco compartilhado — `GRANT CONNECT` ao role da aplicação e `REVOKE TEMPORARY … FROM
 * PUBLIC` —, e os privilégios do nível do banco ficam iguais aos dele. Configurações por banco (`ALTER DATABASE … SET`)
 * o projeto não usa.
 * As travas do Postgres são por banco (o OID do banco faz parte da chave), então nada aqui espera por outro arquivo.
 *
 * Uso: `const owner = bancoProprioParaDdl();` no topo do arquivo e `owner.pool` nos testes (superusuário, como o
 * `ownerDatabaseUrl`). O banco é apagado no `afterAll`.
 */
export function bancoProprioParaDdl(): { readonly pool: Pool } {
  const ownerUrl = inject('ownerDatabaseUrl');
  const modelo = inject('modeloDdlDatabase');
  const appRole = decodeURIComponent(new URL(inject('appDatabaseUrl')).username);
  const nome = `ddl_${randomBytes(6).toString('hex')}`;
  let pool: Pool | undefined;

  const admin = () => new Pool({ connectionString: urlDoBanco(ownerUrl, 'postgres'), max: 1 });

  beforeAll(async () => {
    const a = admin();
    try {
      await a.query(`CREATE DATABASE "${nome}" TEMPLATE "${modelo}"`);
      await a.query(`GRANT CONNECT ON DATABASE "${nome}" TO "${appRole}"`);
      await a.query(`REVOKE TEMPORARY ON DATABASE "${nome}" FROM PUBLIC`);
    } finally {
      await a.end();
    }
    pool = new Pool({ connectionString: urlDoBanco(ownerUrl, nome), max: 4 });
  });

  afterAll(async () => {
    await pool?.end();
    const a = admin();
    try {
      await a.query(`DROP DATABASE IF EXISTS "${nome}" WITH (FORCE)`);
    } finally {
      await a.end();
    }
  });

  return {
    get pool() {
      if (!pool) throw new Error('bancoProprioParaDdl: o banco só existe dentro dos testes (beforeAll)');
      return pool;
    },
  };
}
