import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { auditLog, type AnthropometryRow } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { entradaDoFormulario, registrarAntropometria } from './antropometria';
import {
  casasDoMarcador,
  diferencas,
  evolucaoDoPaciente,
  formatarDiferenca,
  seriesDasAvaliacoes,
} from './evolucao';
import { criarExame } from './exames';

const app = makeDb(inject('appDatabaseUrl'));
const now = new Date('2026-10-01T15:00:00Z');
const deps = { db: app.db, now };
afterAll(() => app.pool.end());

const av = (
  data: string,
  pesoKg: number,
  extra: Partial<AnthropometryRow> = {},
): AnthropometryRow => ({
  id: data,
  tenantId: 't',
  patientId: 'p',
  consultationId: null,
  data,
  pesoKg,
  alturaCm: 165,
  imc: Math.round((pesoKg / 1.65 ** 2) * 100) / 100,
  circunferencias: {},
  dobrasMm: {},
  protocolo: 'nenhum',
  densidade: null,
  percGordura: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...extra,
});

describe('evolução (US-017)', () => {
  it('valor de exame mostra as casas que foram digitadas (até 3): 0,85 não vira 0,9, nem 5,95 vira 6,0', () => {
    const pts = (...v: number[]) => v.map((valor, i) => ({ data: `2026-0${i + 1}-01`, valor }));
    expect(casasDoMarcador(pts(110, 95))).toBe(0);
    expect(casasDoMarcador(pts(0.85, 1.2))).toBe(2);
    expect(casasDoMarcador(pts(5.95, 6))).toBe(2);
    expect(casasDoMarcador(pts(0.12345))).toBe(3);
  });

  it('séries em ordem cronológica: peso, IMC, %G (só onde houve) e cada circunferência medida', () => {
    const s = seriesDasAvaliacoes([
      av('2026-09-01', 69.2, { percGordura: 26.1, circunferencias: { cintura: 80 } }),
      av('2026-06-01', 72.4, { percGordura: 28.4, circunferencias: { cintura: 84, quadril: 100 } }),
      av('2026-07-01', 71, { circunferencias: {} }),
      av('2026-08-01', 70.1, { circunferencias: { cintura: 82 } }),
    ]);
    expect(s.map((x) => x.id)).toEqual([
      'peso',
      'imc',
      'perc_gordura',
      'circ_cintura',
      'circ_quadril',
    ]);
    expect(s[0].pontos.map((p) => p.data)).toEqual([
      '2026-06-01',
      '2026-07-01',
      '2026-08-01',
      '2026-09-01',
    ]);
    expect(s[2].pontos).toEqual([
      { data: '2026-06-01', valor: 28.4 },
      { data: '2026-09-01', valor: 26.1 },
    ]);
    const d = diferencas(s);
    expect(d.find((x) => x.rotulo === 'Peso')?.texto).toBe('−3,2 kg');
    expect(d.find((x) => x.rotulo === 'Cintura')?.texto).toBe('−4,0 cm');
    expect(d.find((x) => x.rotulo === 'Quadril')).toBeUndefined(); // um ponto só não tem diferença
  });

  it('formatarDiferenca: sinal de menos tipográfico, mais explícito, zero sem sinal', () => {
    expect(formatarDiferenca(-3.2, 1, 'kg')).toBe('−3,2 kg');
    expect(formatarDiferenca(1, 1, 'kg')).toBe('+1,0 kg');
    expect(formatarDiferenca(0, 2, '')).toBe('0,00');
    expect(formatarDiferenca(-0.004, 2, '%')).toBe('0,00 %');
  });

  it('formatarDiferenca arredonda o módulo (simétrico): −3,25 → −3,3 e +3,25 → +3,3', () => {
    expect(formatarDiferenca(-3.25, 1, 'kg')).toBe('−3,3 kg');
    expect(formatarDiferenca(3.25, 1, 'kg')).toBe('+3,3 kg');
    expect(formatarDiferenca(-2.5, 0, 'cm')).toBe('−3 cm');
  });

  it('do banco: avaliações e marcadores do paciente, com a leitura auditada; outro tenant não vê nada', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const p = await novoPaciente(app.db, A.ctx);
    for (const [data, pesoKg] of [
      ['2026-06-01', '72,4'],
      ['2026-09-01', '69,2'],
    ] as const) {
      await registrarAntropometria(
        A.ctx,
        A.tenant,
        p.id,
        entradaDoFormulario({ data, pesoKg, alturaCm: '165', protocolo: 'nenhum' }),
        deps,
      );
    }
    await criarExame(
      A.ctx,
      A.tenant,
      p.id,
      {
        titulo: 'Rotina',
        data: '2026-06-01',
        valores: [{ nome: 'Glicemia de jejum', valor: '110', unidade: 'mg/dL' }],
        arquivo: null,
      },
      deps,
    );
    const e = await evolucaoDoPaciente(A.ctx, p.id, app.db);
    expect(e.avaliacoes).toBe(2);
    expect(e.diferencas.find((d) => d.rotulo === 'Peso')?.texto).toBe('−3,2 kg');
    expect(e.marcadores.map((m) => m.nome)).toEqual(['Glicemia de jejum']);
    const leituras = await withTenant(
      A.ctx,
      (tx) =>
        tx
          .select()
          .from(auditLog)
          .where(and(eq(auditLog.patientId, p.id), eq(auditLog.acao, 'ler'))),
      app.db,
    );
    expect(new Set(leituras.map((l) => l.entidade))).toEqual(new Set(['antropometria', 'exames']));
    expect(await evolucaoDoPaciente(B.ctx, p.id, app.db)).toEqual({
      avaliacoes: 0,
      series: [],
      diferencas: [],
      marcadores: [],
    });
  });
});
