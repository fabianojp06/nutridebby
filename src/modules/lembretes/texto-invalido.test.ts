import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { espiarErrosDoBanco, INVALIDOS, semErroDoBanco } from '../../../test/erros-do-banco';
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

describe('SUS-110: texto com NUL ou surrogate sem par nos lembretes', () => {
  it.each(INVALIDOS)('suplemento e texto livre com %s vão limpos', async (_nome, ch) => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    for (const [tipo, texto, esperado] of [
      ['suplemento', `Vitamina${ch} D 🙂`, 'Vitamina D 🙂'],
      ['livre', `Tomar${ch} sol 🙂`, 'Tomar sol 🙂'],
    ] as const) {
      const { id } = await semErroDoBanco(errosDoBanco, () => salvarLembrete(T.ctx, p.id, { tipo, texto, config: { horarios: ['09:00'], dias: TODOS } }, SP, { db: app.db }));
      const [l] = await withTenant(T.ctx, (tx) => tx.select({ texto: lembretesRotina.texto }).from(lembretesRotina).where(eq(lembretesRotina.id, id)), app.db);
      expect(l.texto).toBe(esperado);
    }
  });
});
