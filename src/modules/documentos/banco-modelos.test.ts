import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { withConta, withTenant, type TenantContext } from '@/db/tenant';

/**
 * Plano 22 (T10a, spec §9.3, §9.4, RN-393, RN-394): as duas tabelas de prescrição no banco — staff_only (custom
 * `rls_prescricao_modelos`) e os CHECKs, inclusive `prescricao_itens_salvos_tipo_coerente` (M11). Tudo por SQL cru, sem
 * módulo: é o que o banco garante sozinho.
 */
const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

type Row = Record<string, unknown>;
const em = async (ctx: TenantContext, q: SQL): Promise<Row[]> => (await withTenant(ctx, (tx) => tx.execute(q), app.db)).rows as Row[];
const publico = (T: TenantDeTeste): TenantContext => ({ tenantId: T.tenantId, role: 'publico' });
const naConta = (q: SQL) => withConta(randomUUID(), (tx) => tx.execute(q), app.db);

/** O paciente sem sessão de login (app.user_id vazio), montado à mão como em src/modules/exames/banco.test.ts. */
async function semLogin(tenantId: string, patientId: string, texto: string, params: unknown[] = []): Promise<Row[]> {
  const c = await app.pool.connect();
  try {
    await c.query('begin');
    await c.query(
      `select set_config('app.tenant_id', $1, true), set_config('app.role', 'paciente', true), set_config('app.patient_id', $2, true), set_config('app.user_id', '', true)`,
      [tenantId, patientId],
    );
    return (await c.query(texto, params)).rows as Row[];
  } finally {
    await c.query('rollback').catch(() => undefined);
    c.release();
  }
}

const erro = (e: unknown) => {
  const x = e as { code?: string; cause?: { code?: string; constraint?: string }; constraint?: string };
  return { code: x.code ?? x.cause?.code, constraint: x.constraint ?? x.cause?.constraint };
};
const comCodigo = (codigo: string) => (e: unknown) => erro(e).code === codigo;
const restricao = (nome: string) => (e: unknown) => erro(e).constraint === nome;

const SUPLEMENTO = { tipo: 'suplemento', categoria: 'nutriente', composicao: [{ nome: 'Vitamina D3', quantidade: 2000, unidade: 'UI' }], forma: 'Cápsula', via: 'oral', posologia: '1 ao dia', duracao: '', manipulado: false };
const FORMULA = { tipo: 'formula_fitoterapica', compostos: [], formaFarmaceutica: 'Cápsula', via: 'oral', posologia: '1 à noite', duracao: '' };

describe('Plano 22 — itens salvos e modelos de prescrição no banco (spec §9.3, §9.4)', () => {
  it('staff_only: a nutri cria e lê; paciente (com conta e sem login), publico e conta não leem nenhuma linha', async () => {
    const T = await novoTenant(app.db);
    const p = (await novoPaciente(app.db, T.ctx)).id;
    await em(T.ctx, sql`insert into prescricao_itens_salvos (tenant_id, nome, tipo, item) values (${T.tenantId}, 'Vitamina D', 'suplemento', ${JSON.stringify(SUPLEMENTO)}::jsonb)`);
    await em(T.ctx, sql`insert into prescricao_modelos (tenant_id, nome, itens) values (${T.tenantId}, 'Rotina', ${JSON.stringify([SUPLEMENTO])}::jsonb)`);
    for (const t of ['prescricao_itens_salvos', 'prescricao_modelos']) {
      const ler = sql`select 1 from ${sql.identifier(t)}`;
      expect((await em(T.ctx, ler)).length, t).toBe(1);
      expect(await em(ctxPaciente(T.tenantId, p), ler), t).toEqual([]);
      expect(await semLogin(T.tenantId, p, `select 1 from ${t}`), t).toEqual([]);
      expect(await em(publico(T), ler), t).toEqual([]);
      expect((await naConta(ler)).rows, t).toEqual([]);
    }
    // controle positivo do contexto montado à mão: o paciente sem login lê a própria linha de patients
    expect(await semLogin(T.tenantId, p, 'select id from patients')).toEqual([{ id: p }]);
    // outro consultório não lê
    const B = await novoTenant(app.db);
    expect(await em(B.ctx, sql`select 1 from prescricao_itens_salvos`)).toEqual([]);
    expect(await em(B.ctx, sql`select 1 from prescricao_modelos`)).toEqual([]);
  });

  it('CHECKs do item salvo: tipo fora dos cinco, item que não é objeto, tipo incoerente com o item (tipo_coerente), nome vazio ou longo → 23514; nome repetido sem diferença de maiúsculas → 23505', async () => {
    const T = await novoTenant(app.db);
    const ins = (nome: string, tipo: string, item: unknown) =>
      em(T.ctx, sql`insert into prescricao_itens_salvos (tenant_id, nome, tipo, item) values (${T.tenantId}, ${nome}, ${tipo}, ${JSON.stringify(item)}::jsonb)`);
    await expect(ins('Outro', 'outro', { ...SUPLEMENTO, tipo: 'outro' })).rejects.toSatisfy(restricao('prescricao_itens_salvos_tipo_valido'));
    await expect(ins('Lista', 'suplemento', [SUPLEMENTO])).rejects.toSatisfy(comCodigo('23514'));
    await expect(ins('Texto', 'suplemento', 'suplemento')).rejects.toSatisfy(comCodigo('23514'));
    await expect(ins('Formulado', 'suplemento', FORMULA)).rejects.toSatisfy(restricao('prescricao_itens_salvos_tipo_coerente'));
    await expect(ins('Sem tipo', 'suplemento', { ...SUPLEMENTO, tipo: undefined })).rejects.toSatisfy(restricao('prescricao_itens_salvos_tipo_coerente'));
    await expect(ins('', 'suplemento', SUPLEMENTO)).rejects.toSatisfy(restricao('prescricao_itens_salvos_nome_tamanho'));
    await expect(ins('x'.repeat(81), 'suplemento', SUPLEMENTO)).rejects.toSatisfy(restricao('prescricao_itens_salvos_nome_tamanho'));
    // os válidos passam: o suplemento e a fórmula com o tipo dela
    await ins('Vitamina D', 'suplemento', SUPLEMENTO);
    await ins('x'.repeat(80), 'formula_fitoterapica', FORMULA);
    await expect(ins('VITAMINA D', 'suplemento', SUPLEMENTO)).rejects.toSatisfy((e) => comCodigo('23505')(e) && restricao('prescricao_itens_salvos_nome_unico')(e));
    // outro consultório pode ter o mesmo nome
    const B = await novoTenant(app.db);
    await em(B.ctx, sql`insert into prescricao_itens_salvos (tenant_id, nome, tipo, item) values (${B.tenantId}, 'Vitamina D', 'suplemento', ${JSON.stringify(SUPLEMENTO)}::jsonb)`);
  });

  it('CHECKs do modelo: 0 e 21 itens e objeto → 23514 (nunca 22023); orientações acima de 2000 → 23514; nome repetido → 23505', async () => {
    const T = await novoTenant(app.db);
    const ins = (nome: string, itens: string, orientacoes = '') =>
      em(T.ctx, sql`insert into prescricao_modelos (tenant_id, nome, itens, orientacoes) values (${T.tenantId}, ${nome}, ${itens}::jsonb, ${orientacoes})`);
    const n = (k: number) => JSON.stringify(Array.from({ length: k }, () => SUPLEMENTO));
    await expect(ins('Vazio', '[]')).rejects.toSatisfy(restricao('prescricao_modelos_itens'));
    await expect(ins('Muitos', n(21))).rejects.toSatisfy(restricao('prescricao_modelos_itens'));
    await expect(ins('Objeto', '{}')).rejects.toSatisfy(restricao('prescricao_modelos_itens'));
    await expect(ins('Longo', n(1), 'x'.repeat(2001))).rejects.toSatisfy(restricao('prescricao_modelos_orientacoes_tamanho'));
    await expect(ins('', n(1))).rejects.toSatisfy(restricao('prescricao_modelos_nome_tamanho'));
    await ins('Vinte', n(20), 'x'.repeat(2000));
    await ins('Um', n(1));
    await expect(ins('VINTE', n(1))).rejects.toSatisfy((e) => comCodigo('23505')(e) && restricao('prescricao_modelos_nome_unico')(e));
    const [m] = await em(T.ctx, sql`select orientacoes from prescricao_modelos where nome = 'Um'`);
    expect(m).toEqual({ orientacoes: '' });
  });
});
