import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, inject } from 'vitest';

/**
 * SUS-100: banco próprio para os testes que fazem DDL em tabela real (os de "a guarda funciona": `drop policy`,
 * `create policy`, `drop trigger` dentro de begin/rollback).
 *
 * DDL de política e de gatilho pega AccessExclusiveLock na tabela até o rollback. No banco compartilhado do
 * Testcontainers, os outros arquivos rodam em paralelo e travam as mesmas tabelas em outra ordem: o B-5 segurava
 * `exams` e pedia `contents` enquanto outra transação segurava `contents` e pedia `exams` → 40P01 (CI do PR #54 e um
 * deploy). Travar numa ordem fixa não resolve, porque a ordem dos outros testes não é nossa; aqui a disputa deixa de
 * existir: cada arquivo que chama este helper ganha um banco clonado (`CREATE DATABASE … TEMPLATE`) do modelo que o
 * `test/global-setup.ts` congela logo depois das migrations e das fixtures — o mesmo catálogo (sem ACL nem
 * configurações do nível do banco: `datacl` e `pg_db_role_setting` não são copiados pelo TEMPLATE), nenhuma outra
 * sessão.
 * As travas do Postgres são por banco (o OID do banco faz parte da chave), então nada aqui espera por outro arquivo.
 *
 * Uso: `const owner = bancoProprioParaDdl();` no topo do arquivo e `owner.pool` nos testes (superusuário, como o
 * `ownerDatabaseUrl`). O banco é apagado no `afterAll`.
 */
export function bancoProprioParaDdl(): { readonly pool: Pool } {
  const ownerUrl = inject('ownerDatabaseUrl');
  const modelo = inject('modeloDdlDatabase');
  const nome = `ddl_${randomBytes(6).toString('hex')}`;
  let pool: Pool | undefined;

  const admin = () => {
    const u = new URL(ownerUrl);
    u.pathname = '/postgres';
    return new Pool({ connectionString: u.toString(), max: 1 });
  };

  beforeAll(async () => {
    const a = admin();
    try {
      await a.query(`CREATE DATABASE "${nome}" TEMPLATE "${modelo}"`);
    } finally {
      await a.end();
    }
    const u = new URL(ownerUrl);
    u.pathname = `/${nome}`;
    pool = new Pool({ connectionString: u.toString(), max: 4 });
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
