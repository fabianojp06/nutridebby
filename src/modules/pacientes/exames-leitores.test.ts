import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { exams } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { mesmoExame } from '@/modules/documentos/parecer';
import { copiarExames } from '@/modules/documentos/parecer-exames';
import { jaLancado, nomeDaSerie } from '@/modules/ia/correspondencia';
import { montarPedidoDoResumo } from '@/modules/ia/resumo-dados';
import { evolucaoDoPaciente } from './evolucao';
import { agruparMarcadores, marcadoresDoPaciente } from './exames';
import { montarDados } from './exportacao-job';

/**
 * Plano 22 (T4, DEP-E1, R-371): `exams.valores` só ganha as chaves opcionais `refMin`/`refMax` (C-378). Cada leitor de
 * hoje lê uma linha antiga (sem faixa) e uma nova (com faixa) e não muda de saída: a faixa nunca vira série, cópia do
 * parecer, "valores mudaram", dado enviado à IA nem gráfico; na exportação, sai como gravada.
 */
const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

const ANTIGA = { nome: 'Glicemia de jejum', valor: 95, unidade: 'mg/dL', referencia: '70 a 99' };
const NOVA = { nome: 'Ferritina', valor: 80, unidade: 'ng/mL', referencia: '15 a 150', refMin: 15, refMax: 150 };
const NOVA_SEM_FAIXA = { nome: 'Ferritina', valor: 80, unidade: 'ng/mL', referencia: '15 a 150' };

async function cenario() {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx);
  const [e] = await withTenant(
    T.ctx,
    (tx) => tx.insert(exams).values({ tenantId: T.tenantId, patientId: p.id, data: '2026-09-01', titulo: 'Rotina', valores: [ANTIGA, NOVA] }).returning(),
    app.db,
  );
  return { T, p, e };
}

describe('leitores de exams.valores com a linha antiga e a nova (R-371)', () => {
  it('agruparMarcadores e marcadoresDoPaciente: a faixa não entra na série', async () => {
    const { T, p } = await cenario();
    const series = await marcadoresDoPaciente(T.ctx, p.id, app.db);
    expect(series).toEqual([
      { nome: 'Ferritina', unidade: 'ng/mL', pontos: [{ data: '2026-09-01', valor: 80 }] },
      { nome: 'Glicemia de jejum', unidade: 'mg/dL', pontos: [{ data: '2026-09-01', valor: 95 }] },
    ]);
    expect(agruparMarcadores([{ data: '2026-09-01', valores: [ANTIGA, NOVA] }])).toEqual(agruparMarcadores([{ data: '2026-09-01', valores: [ANTIGA, NOVA_SEM_FAIXA] }]));
  });

  it('copiarExames (parecer): a cópia NÃO leva refMin/refMax; mesmoExame: mudar só a faixa não conta como "valores mudaram"', async () => {
    const { T, p, e } = await cenario();
    const [copia] = await withTenant(T.ctx, (tx) => copiarExames(tx, p.id, [e.id]), app.db);
    expect(copia.valores).toEqual([ANTIGA, NOVA_SEM_FAIXA]);
    for (const v of copia.valores) {
      expect(v).not.toHaveProperty('refMin');
      expect(v).not.toHaveProperty('refMax');
    }
    // a linha gravada com outra faixa (o tipo da cópia não tem refMin/refMax; o objeto do banco tem)
    const outraFaixa = { ...NOVA, refMin: 10, refMax: 200 } as (typeof copia.valores)[number];
    expect(mesmoExame(copia, { data: e.data, titulo: e.titulo, valores: [ANTIGA, outraFaixa] })).toBe(true);
    expect(mesmoExame(copia, { data: e.data, titulo: e.titulo, valores: [ANTIGA, { ...NOVA, valor: 81 }] })).toBe(false);
  });

  it('nomeDaSerie e jaLancado (conferência da IA): mesma saída com e sem faixa', () => {
    const series = agruparMarcadores([{ data: '2026-09-01', valores: [ANTIGA, NOVA] }]);
    expect(nomeDaSerie('Glicose de jejum', 'mg/dL', series)).toBe('Glicemia de jejum');
    expect(nomeDaSerie('Ferritina', 'ng/mL', series)).toBeNull();
    expect(jaLancado([ANTIGA, NOVA], 'Ferritina', 80, 'ng/mL')).toBe(true);
    expect(jaLancado([ANTIGA, NOVA], 'Ferritina', 81, 'ng/mL')).toBe(false);
  });

  it('resumo da IA (resumo-dados): as linhas campo a campo — marcador, valor e unidade —, sem faixa nem referência', async () => {
    const { T, p } = await cenario();
    const pedido = await withTenant({ tenantId: T.tenantId, role: 'worker' }, (tx) => montarPedidoDoResumo(tx, p, { notasPrivadas: false, agora: new Date('2026-10-01T12:00:00Z'), fuso: 'America/Sao_Paulo' }), app.db);
    const [exame] = pedido.dados.exames as { valores: unknown[] }[];
    expect(exame.valores).toEqual([
      { marcador: 'Glicemia de jejum', valor: 95, unidade: 'mg/dL' },
      { marcador: 'Ferritina', valor: 80, unidade: 'ng/mL' },
    ]);
    expect(JSON.stringify(pedido.dados)).not.toMatch(/refMin|refMax|15 a 150/);
  });

  it('evolucao.ts: os marcadores da aba Evolução, sem a faixa', async () => {
    const { T, p } = await cenario();
    const ev = await evolucaoDoPaciente(T.ctx, p.id, app.db);
    expect(ev.marcadores.map((m) => [m.nome, m.pontos])).toEqual([
      ['Ferritina', [{ data: '2026-09-01', valor: 80 }]],
      ['Glicemia de jejum', [{ data: '2026-09-01', valor: 95 }]],
    ]);
    expect(JSON.stringify(ev.marcadores)).not.toMatch(/refMin|refMax/);
  });

  it('montarDados (exportação): as duas linhas como gravadas — a antiga sem faixa, a nova com refMin/refMax', async () => {
    const { T, p } = await cenario();
    for (const escopo of ['equipe', 'titular'] as const) {
      const { dados } = await withTenant(T.ctx, (tx) => montarDados(tx, p.id, new Date('2026-10-01T12:00:00Z'), 'America/Sao_Paulo', escopo), app.db);
      expect(dados.exames[0].valores, escopo).toEqual([ANTIGA, NOVA]);
    }
  });
});
