import { afterAll, describe, expect, inject, it } from 'vitest';
import { cobrancasDoPaciente } from '../../../test/financeiro';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { withTenant, type TenantContext } from '@/db/tenant';
import { financeiroParaExportacao, temLancamentos } from './titular';

/**
 * US-307 (Plano 20, T9; spec §10, F-D22): a seção `financeiro` do `dados.json` — os campos da spec, a situação no dia da
 * exportação e nunca quem lançou nem quem cancelou (dado da equipe). Roda no contexto `worker` (o job da exportação).
 */
const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await app.pool.end();
});

const agora = new Date('2026-10-01T15:00:00Z');
const CHAVES = [
  'vencimento',
  'pagoEm',
  'valorCentavos',
  'valor',
  'formaDePagamento',
  'formaDePagamentoRotulo',
  'situacao',
  'situacaoRotulo',
  'categoria',
  'descricao',
  'consultaInicio',
  'canceladoEm',
  'motivoCancelamento',
];

async function cenario() {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx);
  const outro = await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' });
  const ids = await cobrancasDoPaciente(app.db, T, p.id, agora);
  await cobrancasDoPaciente(app.db, T, outro.id, agora, new Date('2026-09-11T13:00:00Z'));
  const worker: TenantContext = { tenantId: T.tenantId, role: 'worker' };
  const exportar = (hoje: string, paciente = p.id) => withTenant(worker, (tx) => financeiroParaExportacao(tx, paciente, hoje), app.db);
  return { T, p, ids, exportar };
}

describe('financeiroParaExportacao (US-307, spec §10)', () => {
  it('os campos da spec, nesta ordem, do mais antigo ao mais novo; só os lançamentos do titular', async () => {
    const { ids, exportar } = await cenario();
    const linhas = await exportar('2026-10-01');
    expect(linhas).toHaveLength(3);
    for (const l of linhas) expect(Object.keys(l)).toEqual(CHAVES);
    const [recebida, cancelada, aberta] = linhas;
    expect(recebida).toEqual({
      vencimento: '2026-09-10',
      pagoEm: '2026-09-10',
      valorCentavos: 25_000,
      valor: 'R$\u00a0250,00', // formatarReais: o mesmo texto da tela (espaço não separável do Intl)
      formaDePagamento: 'pix',
      formaDePagamentoRotulo: 'Pix',
      situacao: 'recebido',
      situacaoRotulo: 'Recebido',
      categoria: 'Consultas',
      descricao: 'Consulta de retorno',
      consultaInicio: ids.consultaInicio.toISOString(),
      canceladoEm: null,
      motivoCancelamento: null,
    });
    expect(cancelada).toMatchObject({
      vencimento: '2026-09-15',
      pagoEm: null,
      valorCentavos: 18_000,
      valor: 'R$\u00a0180,00',
      formaDePagamento: null,
      formaDePagamentoRotulo: null,
      situacao: 'cancelado',
      situacaoRotulo: 'Cancelado',
      descricao: 'Cobrança em dobro',
      consultaInicio: null,
      canceladoEm: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
      motivoCancelamento: 'Lançada duas vezes',
    });
    expect(aberta).toMatchObject({ vencimento: '2026-09-20', situacao: 'em_atraso', situacaoRotulo: 'Em atraso', descricao: 'Pacote mensal', canceladoEm: null });
  });

  it('a situação é a do dia da exportação: vence hoje = Previsto; vencido antes de hoje = Em atraso', async () => {
    const { exportar } = await cenario();
    expect((await exportar('2026-09-20'))[2]).toMatchObject({ situacao: 'previsto', situacaoRotulo: 'Previsto' });
    expect((await exportar('2026-09-21'))[2]).toMatchObject({ situacao: 'em_atraso', situacaoRotulo: 'Em atraso' });
  });

  it('F-D22: nunca quem lançou nem quem cancelou (dado da equipe)', async () => {
    const { T, exportar } = await cenario();
    const json = JSON.stringify(await exportar('2026-10-01'));
    expect(json).not.toContain(T.nutriId);
    expect(json).not.toMatch(/criadoPor|canceladoPor|criado_por|cancelado_por/);
  });

  it('paciente sem lançamento: lista vazia', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    expect(await withTenant({ tenantId: T.tenantId, role: 'worker' }, (tx) => financeiroParaExportacao(tx, p.id, '2026-10-01'), app.db)).toEqual([]);
  });
});

describe('temLancamentos (RN-316, a conferência de lgpd.ts antes de app_anonimizar_financeiro)', () => {
  it('no contexto worker: true para o titular com lançamento, false para o paciente sem', async () => {
    const { T, p } = await cenario();
    const sem = await novoPaciente(app.db, T.ctx, { nome: 'Caio Reis' });
    const worker: TenantContext = { tenantId: T.tenantId, role: 'worker' };
    const tem = (paciente: string) => withTenant(worker, (tx) => temLancamentos(tx, paciente), app.db);
    expect(await tem(p.id)).toBe(true);
    expect(await tem(sem.id)).toBe(false);
  });
});
