import { afterAll, describe, expect, inject, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeDb } from '../../../../test/db';
import { cobrancasDoPaciente, dbQueContaConsultas } from '../../../../test/financeiro';
import { novoPaciente, novoTenant, type TenantDeTeste } from '../../../../test/pacientes';
import { auditLog, patients } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { listarCategorias } from '@/modules/financeiro/configuracoes';
import { criarLancamento } from '@/modules/financeiro/lancamentos';
import { hojeNoFuso } from '@/modules/pacientes/datas';
import { montarAdicionar } from '../adicionar';
import { secoesDoInicio, type SecaoNoInicio } from '../inicio';
import type { PacienteDaSecao, TenantDaSecao } from '../tipos';
import { SECOES_DA_FICHA } from '.';
import { secaoFinanceiro } from './financeiro';

// Plano 20 (US-308, RN-329, RN-318): a seção "Financeiro" no Início da ficha, pelo contrato estendido do registro do Plano 18
// (RN-277): só rótulo, data de referência e situação (sem valor nem descrição), "Ver todos" na lista filtrada, "Nova entrada"
// no grupo "Outros" e UM "ler" (entidade financeiro) por abertura do Início, gravado por inicio.ts, só quando há lançamento.
const app = makeDb(inject('appDatabaseUrl'));
const contador = dbQueContaConsultas(inject('appDatabaseUrl'));
afterAll(async () => {
  await app.pool.end();
  await contador.pool.end();
});

const FUSO = 'America/Sao_Paulo';
const TENANT: TenantDaSecao = { fuso: FUSO, documentosLiberados: true, examesPacienteAtivadoEm: null };
const comoPaciente = (p: { id: string; status: string; anonimizadoEm: Date | null }): PacienteDaSecao => ({ id: p.id, status: p.status, anonimizadoEm: p.anonimizadoEm });
const financeiro = (r: SecaoNoInicio[]) => r.find((s) => s.id === 'financeiro');
const lancamentos = (id: string) => `/painel/financeiro/lancamentos/${id}`;

/** Os "Visualizou — Financeiro" do consultório. */
const lidas = (T: TenantDeTeste) =>
  withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.tenantId, T.tenantId), eq(auditLog.entidade, 'financeiro'), eq(auditLog.acao, 'ler'))), app.db);

/** Dia 'AAAA-MM-DD' a `dias` de hoje no fuso. */
function diaDaqui(dias: number): string {
  const d = new Date(`${hojeNoFuso(FUSO)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** As três cobranças de `cobrancasDoPaciente` (recebida 10/09, cancelada 15/09, aberta 20/09) e uma prevista daqui a 30 dias. */
async function quatroLancamentos(T: TenantDeTeste, patientId: string) {
  const c = await cobrancasDoPaciente(app.db, T, patientId, new Date());
  const consultas = (await listarCategorias(T.ctx, { db: app.db })).find((x) => x.chave === 'consultas')!.id;
  const futura = await criarLancamento(T.ctx, T.tenant, { tipo: 'entrada', valor: '321,00', categoriaId: consultas, vencimento: diaDaqui(30), pacienteId: patientId, descricao: 'Pacote trimestral' }, { db: app.db });
  return { ...c, futura: futura.id };
}

describe('seção "Financeiro" no Início (US-308, RN-329)', () => {
  it('no registro: última linha, título "Financeiro", sempre disponível, leitura auditada pela entidade financeiro, "Ver todos" e "Nova entrada" com o paciente', () => {
    expect(SECOES_DA_FICHA.at(-1)).toBe(secaoFinanceiro);
    expect(secaoFinanceiro.id).toBe('financeiro');
    expect(secaoFinanceiro.titulo).toBe('Financeiro');
    expect(secaoFinanceiro.leitura).toEqual({ entidade: 'financeiro' });
    expect(secaoFinanceiro.noApp).toBeUndefined(); // o paciente não vê o Financeiro (RN-300)
    const p = '0b6c3c9e-8a3f-4a1d-9a54-6f7c2a1e9d11';
    expect(secaoFinanceiro.verTodos?.(p)).toBe(`/painel/financeiro/lancamentos?paciente=${p}`);
    // disponível sempre, sem depender da configuração do Financeiro nem da situação do paciente (o bloqueio tira só o "Nova entrada")
    for (const t of [TENANT, { ...TENANT, documentosLiberados: false }])
      for (const status of ['ativo', 'arquivado', 'bloqueado']) for (const total of [0, 1, Number.POSITIVE_INFINITY]) expect(secaoFinanceiro.disponivel(t, { id: p, status, anonimizadoEm: null }, total)).toBe(true);
    expect(secaoFinanceiro.adicionar).toHaveLength(1);
    expect(montarAdicionar(p, [{ id: 'financeiro', podeAdicionar: true }])).toEqual([
      { grupo: 'outros', titulo: 'Outros', itens: [{ rotulo: 'Nova entrada', href: `/painel/financeiro/lancamentos/novo?tipo=entrada&paciente=${p}` }] },
    ]);
  });

  it('chaves exatas; total de todas as situações e os 3 mais recentes pela data de referência; rótulo "Entrada — {categoria}" e a situação; sem valor nem descrição', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const outro = await novoPaciente(app.db, T.ctx, { nome: 'Bruno Lima' });
    const ids = await quatroLancamentos(T, p.id);
    // lançamentos de outro paciente e saídas do consultório não entram
    await cobrancasDoPaciente(app.db, T, outro.id, new Date(), new Date('2026-09-11T13:00:00Z'));
    const s = financeiro(await secoesDoInicio(T.ctx, TENANT, comoPaciente(p), { db: app.db }))!;
    expect(Object.keys(s).sort()).toEqual(['aba', 'id', 'podeAdicionar', 'resumo', 'titulo', 'verTodos']);
    expect(s).toMatchObject({ titulo: 'Financeiro', verTodos: `/painel/financeiro/lancamentos?paciente=${p.id}`, podeAdicionar: true });
    expect(s.resumo.total).toBe(4);
    for (const item of s.resumo.ultimos) expect(Object.keys(item).sort()).toEqual(['data', 'href', 'id', 'noApp', 'rotulo', 'situacao']);
    expect(s.resumo.ultimos).toEqual([
      { id: ids.futura, rotulo: 'Entrada — Consultas', data: diaDaqui(30), situacao: 'Previsto', noApp: false, href: lancamentos(ids.futura) },
      { id: ids.aberta, rotulo: 'Entrada — Consultas', data: '2026-09-20', situacao: 'Em atraso', noApp: false, href: lancamentos(ids.aberta) },
      { id: ids.cancelada, rotulo: 'Entrada — Consultas', data: '2026-09-15', situacao: 'Cancelado', noApp: false, href: lancamentos(ids.cancelada) },
    ]);
    const json = JSON.stringify(s);
    for (const texto of ['Pacote', 'Cobrança em dobro', 'Lançada duas vezes', '321', '180', '250', 'Bruno']) expect(json).not.toContain(texto);
  });

  it('recebido: a data de referência é a do recebimento (RN-306)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const { recebida } = await cobrancasDoPaciente(app.db, T, p.id, new Date());
    const ultimos = financeiro(await secoesDoInicio(T.ctx, TENANT, comoPaciente(p), { db: app.db }))!.resumo.ultimos;
    expect(ultimos.at(-1)).toEqual({ id: recebida, rotulo: 'Entrada — Consultas', data: '2026-09-10', situacao: 'Recebido', noApp: false, href: lancamentos(recebida) });
  });

  it('sem lançamento (e sem o Financeiro configurado): "Financeiro (0)", "Nova entrada" disponível e nenhum "ler"', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const s = financeiro(await secoesDoInicio(T.ctx, TENANT, comoPaciente(p), { db: app.db }))!;
    expect(s.resumo).toEqual({ total: 0, ultimos: [] });
    expect(s.podeAdicionar).toBe(true); // sem configuração, a rota do "Nova entrada" leva às Configurações (RN-301)
    expect(await lidas(T)).toEqual([]);
  });

  it('com lançamento: exatamente um "ler" da entidade financeiro por abertura do Início (RN-318), sem entidadeId, em nome da nutricionista', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await quatroLancamentos(T, p.id);
    await secoesDoInicio(T.ctx, TENANT, comoPaciente(p), { db: app.db });
    const uma = await lidas(T);
    expect(uma).toHaveLength(1);
    expect(uma[0]).toMatchObject({ acao: 'ler', entidade: 'financeiro', entidadeId: null, patientId: p.id, actorUserId: T.nutriId });
    await secoesDoInicio(T.ctx, TENANT, comoPaciente(p), { db: app.db });
    expect(await lidas(T)).toHaveLength(2);
  });

  it('paciente bloqueado: os lançamentos continuam na seção, sem "Nova entrada"; anonimizado também sem', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await quatroLancamentos(T, p.id);
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado', bloqueadoEm: new Date() }).where(eq(patients.id, p.id)), app.db);
    const bloqueado = comoPaciente({ ...p, status: 'bloqueado' });
    const r = await secoesDoInicio(T.ctx, TENANT, bloqueado, { db: app.db });
    const s = financeiro(r)!;
    expect(s.resumo.total).toBe(4);
    expect(s.resumo.ultimos).toHaveLength(3);
    expect(s.podeAdicionar).toBe(false);
    expect(montarAdicionar(p.id, r).flatMap((g) => g.itens).map((i) => i.rotulo)).not.toContain('Nova entrada');

    const anonimizado = await novoPaciente(app.db, T.ctx, { status: 'arquivado', anonimizadoEm: new Date() });
    expect(financeiro(await secoesDoInicio(T.ctx, TENANT, comoPaciente(anonimizado), { db: app.db }))!.podeAdicionar).toBe(false);
  });

  it('outro consultório não vê: paciente de B pelo ctx de A → "Financeiro (0)", sem "ler" e sem "Nova entrada"', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const pb = await novoPaciente(app.db, B.ctx);
    await quatroLancamentos(B, pb.id);
    const s = financeiro(await secoesDoInicio(A.ctx, TENANT, comoPaciente(pb), { db: app.db }))!;
    expect(s.resumo).toEqual({ total: 0, ultimos: [] });
    expect(s.podeAdicionar).toBe(false);
    expect(await lidas(A)).toEqual([]);
  });

  it('RNF-260 do Plano 18 e RNF-301: a seção roda na transação única do Início, com uma consulta ao Financeiro', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await quatroLancamentos(T, p.id);
    contador.consultas.length = 0;
    await secoesDoInicio(T.ctx, TENANT, comoPaciente(p), { db: contador.db });
    expect(contador.consultas.filter((q) => /^\s*begin\b/i.test(q))).toHaveLength(1);
    expect(contador.consultas.filter((q) => q.includes('"fin_lancamentos"'))).toHaveLength(1);
    expect(contador.consultas.filter((q) => /insert into public\.audit_log/i.test(q))).toHaveLength(1);
  });
});
