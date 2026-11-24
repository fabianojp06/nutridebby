import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { espiarErrosDoBanco } from '../../../test/erros-do-banco';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { lembretesRotina } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { salvarLembrete } from './equipe';

/**
 * SUS-110 (regra 3): o NUL e o surrogate UTF-16 sem par no texto do lembrete (nome do suplemento, texto livre) saem em
 * silêncio — antes o NUL era recusado com "Formulário inválido." e o surrogate virava U+FFFD no banco. O espião anota o
 * SQLSTATE de todo erro do banco.
 */
const app = makeDb(inject('appDatabaseUrl'));
const errosDoBanco = espiarErrosDoBanco(app.pool);
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
const SP = { fuso: 'America/Sao_Paulo' };
const TODOS = [0, 1, 2, 3, 4, 5, 6];

const INVALIDOS = [
  ['NUL', '\u0000'],
  ['surrogate alto sem par', '\ud800'],
  ['surrogate baixo sem par', '\udc00'],
] as const;

async function semErroDoBanco<T>(f: () => Promise<T>): Promise<T> {
  errosDoBanco.length = 0;
  const r = await f().then(
    (v) => ({ ok: true as const, v }),
    (e: unknown) => ({ ok: false as const, e }),
  );
  expect(errosDoBanco).toEqual([]);
  if (!r.ok) throw r.e;
  return r.v;
}

describe('SUS-110: texto com NUL ou surrogate sem par nos lembretes', () => {
  it.each(INVALIDOS)('suplemento e texto livre com %s vão limpos', async (_nome, ch) => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    for (const [tipo, texto, esperado] of [
      ['suplemento', `Vitamina${ch} D 🙂`, 'Vitamina D 🙂'],
      ['livre', `Tomar${ch} sol 🙂`, 'Tomar sol 🙂'],
    ] as const) {
      const { id } = await semErroDoBanco(() => salvarLembrete(T.ctx, p.id, { tipo, texto, config: { horarios: ['09:00'], dias: TODOS } }, SP, { db: app.db }));
      const [l] = await withTenant(T.ctx, (tx) => tx.select({ texto: lembretesRotina.texto }).from(lembretesRotina).where(eq(lembretesRotina.id, id)), app.db);
      expect(l.texto).toBe(esperado);
    }
  });
});
