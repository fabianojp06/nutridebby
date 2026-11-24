import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { auditLog } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { criarExame } from '@/modules/pacientes/exames';
import { comparativo, type Comparativo } from './comparativo';
import { salvarNota } from './interpretacao';

/**
 * Plano 22 (T5b, US-374, RN-384, EP-D20): o comparativo — 2 a 6 exames do paciente, a data mais antiga à esquerda, as linhas
 * por `agruparMarcadores` (nome normalizado + unidade), a neutra por célula, sem categoria nem nota; um `auditRead` por exame
 * mostrado. Ids de outro paciente são ignorados (e nunca ganham um `ler`).
 */
const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await app.pool.end();
});
const deps = { db: app.db };

type Linha = { nome: string; valor: string; unidade?: string; referencia?: string; refMin?: string; refMax?: string };
async function exame(T: TenantDeTeste, patientId: string, data: string, valores: Linha[], criadoEm = new Date(`${data}T12:00:00Z`)) {
  return criarExame(T.ctx, T.tenant, patientId, { titulo: `Exame ${data}`, data, valores, arquivo: null }, { db: app.db, now: criadoEm });
}
/** As leituras gravadas para estes exames, lidas na sessão da nutricionista do consultório (a RLS do `audit_log` deixa). */
const leituras = (T: TenantDeTeste, ids: string[]) =>
  withTenant(
    T.ctx,
    (tx) =>
      tx
        .select({ entidade: auditLog.entidade, entidadeId: auditLog.entidadeId, actor: auditLog.actorUserId, patientId: auditLog.patientId })
        .from(auditLog)
        .where(and(eq(auditLog.acao, 'ler'), inArray(auditLog.entidadeId, ids))),
    app.db,
  );
const ok = (r: Comparativo | { erro: 'quantidade' }): Comparativo => {
  if ('erro' in r) throw new Error('esperava o comparativo');
  return r;
};

describe('comparativo (US-374, RN-384)', () => {
  it('"Comparar": 3 de 4 exames, a mais antiga à esquerda, "—" (null) sem o marcador, mg/dL e mmol/L em linhas separadas; três ler', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const jan = await exame(T, p.id, '2026-01-10', [
      { nome: 'Glicemia de jejum', valor: '90', unidade: 'mg/dL', refMin: '70', refMax: '99' },
      { nome: 'Ferritina', valor: '50', unidade: 'ng/mL' },
    ]);
    const fev = await exame(T, p.id, '2026-02-10', [{ nome: 'glicemia  de jejum', valor: '5,5', unidade: 'mmol/L' }]);
    const mar = await exame(T, p.id, '2026-03-10', [{ nome: 'Glicemia de jejum', valor: '105', unidade: 'MG/DL', refMin: '70', refMax: '99' }]);
    const abr = await exame(T, p.id, '2026-04-01', [{ nome: 'Glicemia de jejum', valor: '80', unidade: 'mg/dL' }]);

    const c = ok(await comparativo(T.ctx, p.id, [mar, jan, fev], deps));
    expect(c.exames).toEqual([
      { id: jan, titulo: 'Exame 2026-01-10', data: '2026-01-10' },
      { id: fev, titulo: 'Exame 2026-02-10', data: '2026-02-10' },
      { id: mar, titulo: 'Exame 2026-03-10', data: '2026-03-10' },
    ]);
    expect(c.linhas).toEqual([
      { marcador: 'Ferritina', unidade: 'ng/mL', celulas: [{ valor: 50, unidade: 'ng/mL', neutra: null }, null, null] },
      {
        marcador: 'Glicemia de jejum',
        unidade: 'mg/dL',
        celulas: [{ valor: 90, unidade: 'mg/dL', neutra: 'dentro' }, null, { valor: 105, unidade: 'MG/DL', neutra: 'acima' }],
      },
      // o lançamento já guarda o nome com um espaço só (normalizarTexto): o "  " digitado não sobra
      { marcador: 'glicemia de jejum', unidade: 'mmol/L', celulas: [null, { valor: 5.5, unidade: 'mmol/L', neutra: null }, null] },
    ]);
    expect(c.unidadesSeparadas).toBe(true);

    const lidas = await leituras(T, [jan, fev, mar, abr]);
    expect(lidas.map((l) => l.entidadeId).sort()).toEqual([jan, fev, mar].sort());
    for (const l of lidas) expect(l).toMatchObject({ entidade: 'exames', actor: T.nutriId, patientId: p.id });
  });

  it('empate de data: a ordem é a da criação; sem unidades diferentes, unidadesSeparadas = false', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const depois = await exame(T, p.id, '2026-05-02', [{ nome: 'TSH', valor: '2', unidade: 'mUI/L' }], new Date('2026-05-02T15:00:00Z'));
    const antes = await exame(T, p.id, '2026-05-02', [{ nome: 'TSH', valor: '3', unidade: 'mUI/L' }], new Date('2026-05-02T09:00:00Z'));
    const c = ok(await comparativo(T.ctx, p.id, [depois, antes], deps));
    expect(c.exames.map((e) => e.id)).toEqual([antes, depois]);
    expect(c.linhas).toEqual([{ marcador: 'TSH', unidade: 'mUI/L', celulas: [{ valor: 3, unidade: 'mUI/L', neutra: null }, { valor: 2, unidade: 'mUI/L', neutra: null }] }]);
    expect(c.unidadesSeparadas).toBe(false);
  });

  it('0, 1 e 7 exames → erro de quantidade, sem nenhum ler; ids repetidos e malformados não contam', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const ids: string[] = [];
    for (let d = 1; d <= 7; d++) ids.push(await exame(T, p.id, `2026-06-0${d}`, [{ nome: 'TSH', valor: String(d), unidade: 'mUI/L' }]));
    expect(await comparativo(T.ctx, p.id, [], deps)).toEqual({ erro: 'quantidade' });
    expect(await comparativo(T.ctx, p.id, [ids[0]], deps)).toEqual({ erro: 'quantidade' });
    expect(await comparativo(T.ctx, p.id, [ids[0], ids[0], 'nao-uuid'], deps)).toEqual({ erro: 'quantidade' });
    expect(await comparativo(T.ctx, p.id, ids, deps)).toEqual({ erro: 'quantidade' });
    expect(await leituras(T, ids)).toEqual([]);
    // controle positivo: com 6, as seis leituras aparecem na mesma consulta
    expect(ok(await comparativo(T.ctx, p.id, ids.slice(0, 6), deps)).exames).toHaveLength(6);
    expect((await leituras(T, ids)).map((l) => l.entidadeId).sort()).toEqual(ids.slice(0, 6).sort());
  });

  it('id de outro paciente é ignorado (e só os do paciente contam para o mínimo); nenhum ler para ele nem para o outro titular', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const outro = await novoPaciente(app.db, T.ctx);
    const a = await exame(T, p.id, '2026-07-01', [{ nome: 'TSH', valor: '1', unidade: 'mUI/L' }]);
    const b = await exame(T, p.id, '2026-07-02', [{ nome: 'TSH', valor: '2', unidade: 'mUI/L' }]);
    const doOutro = await exame(T, outro.id, '2026-07-03', [{ nome: 'TSH', valor: '9', unidade: 'mUI/L' }]);

    expect(await comparativo(T.ctx, p.id, [a, doOutro], deps)).toEqual({ erro: 'quantidade' });
    expect(await comparativo(T.ctx, p.id, [a, randomUUID()], deps)).toEqual({ erro: 'quantidade' });
    expect(await leituras(T, [a, b, doOutro])).toEqual([]);

    const c = ok(await comparativo(T.ctx, p.id, [a, doOutro, b], deps));
    expect(c.exames.map((e) => e.id)).toEqual([a, b]);
    expect(c.linhas.flatMap((l) => l.celulas.map((x) => x?.valor))).toEqual([1, 2]);
    const lidas = await leituras(T, [a, b, doOutro]);
    // controle positivo: as do paciente estão lá; a do outro, não
    expect(lidas.map((l) => l.entidadeId).sort()).toEqual([a, b].sort());
    expect(lidas.every((l) => l.patientId === p.id)).toBe(true);
    const doOutroTitular = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.patientId, outro.id), eq(auditLog.acao, 'ler'))), app.db);
    expect(doOutroTitular).toEqual([]);
  });

  it('nenhuma chave de categoria ou nota no retorno (mesmo com a nota salva)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const a = await exame(T, p.id, '2026-08-01', [{ nome: 'Ferritina', valor: '8', unidade: 'ng/mL', refMin: '15', refMax: '150' }]);
    const b = await exame(T, p.id, '2026-08-20', [{ nome: 'Ferritina', valor: '20', unidade: 'ng/mL', refMin: '15', refMax: '150' }]);
    await salvarNota(T.ctx, p.id, a, 'Texto da nota que não pode sair.', deps);
    const c = ok(await comparativo(T.ctx, p.id, [a, b], deps));
    const chaves = new Set<string>();
    const andar = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(andar);
      else if (v && typeof v === 'object')
        for (const [k, x] of Object.entries(v)) {
          chaves.add(k);
          andar(x);
        }
    };
    andar(c);
    expect([...chaves].sort()).toEqual(['celulas', 'data', 'exames', 'id', 'linhas', 'marcador', 'neutra', 'titulo', 'unidade', 'unidadesSeparadas', 'valor'].sort());
    expect(JSON.stringify(c)).not.toContain('Texto da nota');
    expect(c.linhas[0].celulas).toEqual([{ valor: 8, unidade: 'ng/mL', neutra: 'abaixo' }, { valor: 20, unidade: 'ng/mL', neutra: 'dentro' }]);
  });

  it('sessão de paciente → erro do assert de papel, antes da transação', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await expect(comparativo(ctxPaciente(T.tenantId, p.id), p.id, [randomUUID(), randomUUID()], deps)).rejects.toThrow('exames: só a sessão nutri');
  });
});
