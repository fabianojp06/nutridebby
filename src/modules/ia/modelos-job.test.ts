import { and, eq, isNotNull } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import { makeDb } from '../../../test/db';
import { IA_TESTE, iaPronta } from '../../../test/ia';
import { novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { anamnesisTemplates, iaGeracoesModelos, iaUso, mealItems, mealPlans, tenants, type TenantRow } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { processarJobAssistente } from './assistente-job';
import { buscaDoTenant } from './ferramentas-alimentos';
import { expirarGeracoesDoTenant, processarGeracaoModelos, type DepsJobAssistente } from './modelos-job';
import { pedirModelos } from './modelos-sugeridos';
import { ErroProvedor, finalOk, pedeFerramenta, provedorFake, USO_FAKE } from './provedor-fake';
import type { ProvedorIA } from './provedor';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
const agora = new Date(Math.floor(Date.now() / 1000) * 1000);
const plano = (titulo: string) => ({
  titulo,
  meta_kcal: 1600,
  orientacoes: 'Prefira alimentos in natura.',
  refeicoes: [{ nome: 'Almoço', horario: '12:00', itens: [{ alimento: 'A1', gramas: 120, medida: null, substitui: null }, { alimento: 'A77', gramas: 50, medida: null, substitui: null }] }],
});
const pacote = { planos: [plano('Plano A'), plano('Plano B')], anamnese: { nome: 'Anamnese de diabetes', perguntas: [{ tipo: 'sim_nao', rotulo: 'Usa insulina?', obrigatoria: false }] } };
async function pedido() {
  const T = await novoTenant(app.db);
  await iaPronta(app.db, T.tenantId);
  const [t] = await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId));
  const geracaoId = await pedirModelos(T.ctx, t as TenantRow, 'diabetes', { db: app.db, agora, ia: IA_TESTE, avisarTeto: async () => 0 });
  return { T, d: { tenantId: T.tenantId, geracaoId } };
}
const deps = (provedor: ProvedorIA | null, extra: Partial<DepsJobAssistente> = {}): DepsJobAssistente => ({
  db: app.db,
  modo: 'fake',
  provedor,
  geo: 'us',
  destino: 'teste',
  retencao: null,
  tetoGlobalMicroUsd: IA_TESTE.tetoGlobalMicroUsd,
  appUrl: 'https://x',
  agora: () => agora,
  ultimaTentativa: false,
  alertas: { credencial: vi.fn(async () => 0), teto: vi.fn(async () => 0) },
  modeloAssistente: 'claude-sonnet-5-5',
  tetoRascunhoMicroUsd: 1_000_000,
  ...extra,
});
type Pedido = Awaited<ReturnType<typeof pedido>>;
const geracao = async (P: Pedido) => (await withTenant(P.T.ctx, (tx) => tx.select().from(iaGeracoesModelos).where(eq(iaGeracoesModelos.id, P.d.geracaoId)), app.db))[0];
const uso = async (P: Pedido) => (await withTenant(P.T.ctx, (tx) => tx.select().from(iaUso).where(eq(iaUso.tarefaId, P.d.geracaoId)), app.db))[0];
const modelosDoPacote = async (P: Pedido) => ({
  planos: await withTenant(P.T.ctx, (tx) => tx.select().from(mealPlans).where(and(eq(mealPlans.isTemplate, true), isNotNull(mealPlans.iaGeracaoId))), app.db),
  anamneses: await withTenant(P.T.ctx, (tx) => tx.select().from(anamnesisTemplates).where(isNotNull(anamnesisTemplates.iaGeracaoId)), app.db),
});

describe('processarGeracaoModelos (US-123, RN-124, D6)', () => {
  it('busca na TACO, valida, grava os 2 planos e a anamnese juntos, sem aprovação, com a origem; acerto pela soma', async () => {
    const P = await pedido();
    const f = provedorFake({ gerar: [pedeFerramenta('buscar_alimentos', { termo: 'arroz cozido' }), finalOk(pacote)] });
    expect(await processarGeracaoModelos(P.d, deps(f))).toBe('pronta');
    expect(f.chamadas.gerar[0]).toMatchObject({ finalidade: 'modelos', modelo: 'claude-sonnet-5-5', esforco: 'medium' });
    expect(JSON.stringify(f.chamadas.gerar[0].turnos)).toContain('Diabetes'); // a área, e nada de paciente (não há paciente)
    const planos = await withTenant(P.T.ctx, (tx) => tx.select().from(mealPlans).where(eq(mealPlans.iaGeracaoId, P.d.geracaoId)), app.db);
    expect(planos.map((p) => p.titulo).sort()).toEqual(['Diabetes: Plano A', 'Diabetes: Plano B']);
    expect(planos.every((p) => p.isTemplate && p.aprovadoEm === null && p.patientId === null)).toBe(true);
    const itens = await withTenant(P.T.ctx, (tx) => tx.select().from(mealItems).where(eq(mealItems.planId, planos[0].id)), app.db);
    expect(itens).toHaveLength(1); // o A77 (não buscado) foi descartado
    const [a] = await withTenant(P.T.ctx, (tx) => tx.select().from(anamnesisTemplates).where(eq(anamnesisTemplates.iaGeracaoId, P.d.geracaoId)), app.db);
    expect(a).toMatchObject({ nome: 'Diabetes: Anamnese de diabetes', padrao: false, aprovadoEm: null });
    const g = await geracao(P);
    expect(g).toMatchObject({ status: 'pronta', itensDescartados: 2, voltas: 2 });
    const u = await uso(P);
    expect(u.situacao).toBe('confirmado');
    expect(u.custoMicroUsd).toBe(g.custoMicroUsd);
    expect(u.tokensEntrada).toBe(2 * USO_FAKE.entrada); // as duas voltas somadas
    // o mesmo job de novo (pg-boss repetido) não grava outro pacote
    expect(await processarGeracaoModelos(P.d, deps(provedorFake()))).toBe('ignorada');
    expect((await modelosDoPacote(P)).planos).toHaveLength(2);
  });

  it('o roteador da fila ia-assistente manda a geração ao job dos modelos e ignora tarefa sem processador', async () => {
    const P = await pedido();
    const f = provedorFake({ gerar: [pedeFerramenta('buscar_alimentos', { termo: 'arroz' }), finalOk(pacote)] });
    expect(await processarJobAssistente(P.d, deps(f))).toBe('pronta');
    expect(await processarJobAssistente({ tenantId: P.T.tenantId, tarefaId: P.d.geracaoId }, deps(provedorFake()))).toBe('ignorada');
  });

  it('resposta fora do formato → falhou, nenhum modelo criado (gravados juntos, no fim)', async () => {
    const P = await pedido();
    expect(await processarGeracaoModelos(P.d, deps(provedorFake({ gerar: [finalOk({ planos: [] })] })))).toBe('falhou');
    expect(await geracao(P)).toMatchObject({ status: 'falhou', erro: 'resposta_invalida', voltas: 1 });
    expect(await modelosDoPacote(P)).toEqual({ planos: [], anamneses: [] });
    expect((await uso(P)).situacao).toBe('confirmado'); // a volta saiu: cobra o que custou
  });

  it('um plano sem refeição válida ou a anamnese inválida → nenhum dos três é gravado', async () => {
    const semItem = { ...pacote, planos: [plano('Plano A'), { ...plano('Plano B'), refeicoes: [{ nome: 'Almoço', horario: '12:00', itens: [{ alimento: 'A77', gramas: 50, medida: null, substitui: null }] }] }] };
    const semPergunta = { ...pacote, anamnese: { nome: 'Anamnese', perguntas: [] } };
    for (const resposta of [semItem, semPergunta]) {
      const P = await pedido();
      const f = provedorFake({ gerar: [pedeFerramenta('buscar_alimentos', { termo: 'arroz' }), finalOk(resposta)] });
      expect(await processarGeracaoModelos(P.d, deps(f))).toBe('falhou');
      expect(await geracao(P)).toMatchObject({ status: 'falhou', erro: 'resposta_invalida' });
      expect(await modelosDoPacote(P)).toEqual({ planos: [], anamneses: [] });
    }
  });

  it('§5.8 (camada 3): a anamnese sai sem link, controle (\\u0000) e invisível, e o pacote é gravado (revisão final)', async () => {
    const P = await pedido();
    const anamnese = {
      nome: 'Anamnese\u0000 de diabetes www.exemplo.com',
      perguntas: [
        { tipo: 'sim_nao', rotulo: 'Usa in​sulina?‮ veja https://exemplo.com', obrigatoria: true },
        { tipo: 'numero', rotulo: 'Peso\u0000 habitual', obrigatoria: false, unidade: 'kg​ www.x.io' },
        { tipo: 'escolha_unica', rotulo: 'Pratica atividade física?', obrigatoria: false, opcoes: ['Sim‮', 'Não\u0000', 'www.exemplo.com', 'Às vezes ht​tps://x.y'] },
      ],
    };
    const f = provedorFake({ gerar: [pedeFerramenta('buscar_alimentos', { termo: 'arroz' }), finalOk({ ...pacote, anamnese })] });
    expect(await processarGeracaoModelos(P.d, deps(f))).toBe('pronta');
    const [a] = await withTenant(P.T.ctx, (tx) => tx.select().from(anamnesisTemplates).where(eq(anamnesisTemplates.iaGeracaoId, P.d.geracaoId)), app.db);
    expect(a.nome).toBe('Diabetes: Anamnese de diabetes');
    expect((a.schema as { perguntas: unknown[] }).perguntas).toEqual([
      expect.objectContaining({ tipo: 'sim_nao', rotulo: 'Usa insulina? veja', obrigatoria: true }),
      expect.objectContaining({ tipo: 'numero', rotulo: 'Peso habitual', unidade: 'kg' }),
      expect.objectContaining({ tipo: 'escolha_unica', rotulo: 'Pratica atividade física?', opcoes: ['Sim', 'Não', 'Às vezes'] }),
    ]); // a opção que só tinha o link ficou vazia e saiu
  });

  it('nome ou pergunta da anamnese que fica vazio depois da limpeza (só link) → resposta_invalida, nada gravado', async () => {
    const pergunta = { tipo: 'sim_nao', rotulo: 'Usa insulina?', obrigatoria: false };
    const soLinkNoNome = { nome: 'www.exemplo.com​', perguntas: [pergunta] };
    const soLinkNaPergunta = { nome: 'Anamnese', perguntas: [pergunta, { ...pergunta, rotulo: 'https://exemplo.com\u0000' }] };
    for (const anamnese of [soLinkNoNome, soLinkNaPergunta]) {
      const P = await pedido();
      const f = provedorFake({ gerar: [pedeFerramenta('buscar_alimentos', { termo: 'arroz' }), finalOk({ ...pacote, anamnese })] });
      expect(await processarGeracaoModelos(P.d, deps(f))).toBe('falhou');
      expect(await geracao(P)).toMatchObject({ status: 'falhou', erro: 'resposta_invalida' });
      expect(await modelosDoPacote(P)).toEqual({ planos: [], anamneses: [] });
    }
  });

  it('recusa do provedor → falhou recusa, com o acerto e a categoria', async () => {
    const P = await pedido();
    const recusa = { tipo: 'recusa' as const, categoria: 'cyber', bruto: [], uso: USO_FAKE, requestId: 'fake-req' };
    expect(await processarGeracaoModelos(P.d, deps(provedorFake({ gerar: [recusa] })))).toBe('falhou');
    expect(await geracao(P)).toMatchObject({ erro: 'recusa', voltas: 1 });
    expect(await uso(P)).toMatchObject({ situacao: 'confirmado', recusaCategoria: 'cyber' });
  });

  it('1ª volta com 529: relança (nova tentativa) e volta a contar o início; da 2ª em diante, termina sem repetir e cobra só o que saiu (D4)', async () => {
    const P = await pedido();
    await expect(processarGeracaoModelos(P.d, deps(provedorFake({ gerar: [new ErroProvedor('repetir', 529, null)] })))).rejects.toMatchObject({ name: 'RepetirIaError' });
    // R14: a varredura não conta o tempo da tentativa anterior (o passo (1) da nova tentativa grava o novo início)
    expect(await geracao(P)).toMatchObject({ status: 'processando', enviadoEm: null, iniciadoEm: null });
    const fim = await processarGeracaoModelos(P.d, deps(provedorFake({ gerar: [pedeFerramenta('buscar_alimentos', { termo: 'arroz' }), new ErroProvedor('repetir', 529, null)] })));
    expect(fim).toBe('falhou');
    expect(await geracao(P)).toMatchObject({ status: 'falhou', erro: 'provedor_indisponivel', voltas: 1 });
    const u = await uso(P);
    expect(u).toMatchObject({ situacao: 'confirmado' });
    expect(u.tokensEntrada).toBe(USO_FAKE.entrada);
  });

  it('1ª volta com 529 na última tentativa → falhou provedor_indisponivel com estorno (nada saiu)', async () => {
    const P = await pedido();
    expect(await processarGeracaoModelos(P.d, deps(provedorFake({ gerar: [new ErroProvedor('repetir', 529, null)] }), { ultimaTentativa: true }))).toBe('falhou');
    expect(await geracao(P)).toMatchObject({ erro: 'provedor_indisponivel' });
    expect((await uso(P)).situacao).toBe('estornado');
  });

  it('tempo esgotado depois do envio → resultado_incerto com a reserva mantida; nova tentativa com envio gravado não reenvia', async () => {
    const P = await pedido();
    expect(await processarGeracaoModelos(P.d, deps(provedorFake({ gerar: [new ErroProvedor('incerto', null, null)] })))).toBe('falhou');
    expect(await geracao(P)).toMatchObject({ erro: 'resultado_incerto' });
    expect((await uso(P)).situacao).toBe('incerto');
    const Q = await pedido();
    await withTenant({ tenantId: Q.T.tenantId, role: 'worker' }, (tx) => tx.update(iaGeracoesModelos).set({ status: 'processando', iniciadoEm: agora, enviadoEm: agora }).where(eq(iaGeracoesModelos.id, Q.d.geracaoId)), app.db);
    const f = provedorFake();
    expect(await processarGeracaoModelos(Q.d, deps(f))).toBe('falhou');
    expect(f.chamadas.gerar).toHaveLength(0);
    expect(await geracao(Q)).toMatchObject({ erro: 'resultado_incerto' });
    expect((await uso(Q)).situacao).toBe('incerto');
  });

  it('credencial recusada na 1ª volta → credencial_invalida, estorno e alerta aos admins', async () => {
    const P = await pedido();
    const d = deps(provedorFake({ gerar: [new ErroProvedor('credencial', 401, null)] }));
    expect(await processarGeracaoModelos(P.d, d)).toBe('falhou');
    expect(await geracao(P)).toMatchObject({ erro: 'credencial_invalida' });
    expect((await uso(P)).situacao).toBe('estornado');
    expect(d.alertas!.credencial).toHaveBeenCalledOnce();
  });

  it('limite de custo antes da 1ª volta → limite_custo sem chamar o provedor, com estorno (nada saiu)', async () => {
    const P = await pedido();
    await withTenant({ tenantId: P.T.tenantId, role: 'worker' }, (tx) => tx.update(iaGeracoesModelos).set({ reservaMicroUsd: 1 }).where(eq(iaGeracoesModelos.id, P.d.geracaoId)), app.db);
    const f = provedorFake();
    expect(await processarGeracaoModelos(P.d, deps(f))).toBe('falhou');
    expect(f.chamadas.gerar).toHaveLength(0);
    expect(await geracao(P)).toMatchObject({ erro: 'limite_custo', voltas: 0 });
    expect((await uso(P)).situacao).toBe('estornado');
  });

  it('IA desativada entre o pedido e o job: falhou ia_desligada sem chamar o provedor, com estorno', async () => {
    const P = await pedido();
    await app.db.update(tenants).set({ iaAtivadaEm: null }).where(eq(tenants.id, P.T.tenantId));
    const f = provedorFake();
    expect(await processarGeracaoModelos(P.d, deps(f))).toBe('falhou');
    expect(f.chamadas.gerar).toHaveLength(0);
    expect(await geracao(P)).toMatchObject({ erro: 'ia_desligada' });
    expect((await uso(P)).situacao).toBe('estornado');
  });

  it('IA desativada durante o laço: nada é gravado (ia_desligada) e o custo das voltas é cobrado', async () => {
    const P = await pedido();
    const f = provedorFake({ gerar: [pedeFerramenta('buscar_alimentos', { termo: 'arroz' }), finalOk(pacote)] });
    const buscar = (tenantId: string) => async (termo: string) => {
      const achados = await buscaDoTenant(tenantId, app.db)(termo);
      await app.db.update(tenants).set({ iaAtivadaEm: null }).where(eq(tenants.id, tenantId));
      return achados;
    };
    expect(await processarGeracaoModelos(P.d, deps(f, { buscar }))).toBe('falhou');
    expect(await geracao(P)).toMatchObject({ erro: 'ia_desligada', voltas: 2 });
    expect(await modelosDoPacote(P)).toEqual({ planos: [], anamneses: [] });
    expect((await uso(P)).situacao).toBe('confirmado');
  });

  it('o worker sem provedor: ia_desligada no modo de teste, credencial_invalida no modo real', async () => {
    const P = await pedido();
    expect(await processarGeracaoModelos(P.d, deps(null))).toBe('falhou');
    expect(await geracao(P)).toMatchObject({ erro: 'ia_desligada' });
    const Q = await pedido();
    expect(await processarGeracaoModelos(Q.d, deps(null, { modo: 'anthropic' }))).toBe('falhou');
    expect(await geracao(Q)).toMatchObject({ erro: 'credencial_invalida' });
  });
});

describe('expirarGeracoesDoTenant (D20)', () => {
  const worker = (P: Pedido) => ({ tenantId: P.T.tenantId, role: 'worker' as const });
  const mudar = (P: Pedido, set: Partial<typeof iaGeracoesModelos.$inferInsert>) =>
    withTenant(worker(P), (tx) => tx.update(iaGeracoesModelos).set(set).where(eq(iaGeracoesModelos.id, P.d.geracaoId)), app.db);

  it('processando há mais de 15 min → interrompida (estorno sem envio; reserva incerta com envio)', async () => {
    const P = await pedido();
    await mudar(P, { status: 'processando', iniciadoEm: new Date(agora.getTime() - 16 * 60_000) });
    const r = await withTenant(worker(P), (tx) => expirarGeracoesDoTenant(tx, P.T.tenantId, agora), app.db);
    expect(r.interrompidas).toBe(1);
    expect(await geracao(P)).toMatchObject({ status: 'falhou', erro: 'interrompida' });
    expect((await uso(P)).situacao).toBe('estornado');
    const Q = await pedido();
    await mudar(Q, { status: 'processando', iniciadoEm: new Date(agora.getTime() - 16 * 60_000), enviadoEm: new Date(agora.getTime() - 15 * 60_000) });
    await withTenant(worker(Q), (tx) => expirarGeracoesDoTenant(tx, Q.T.tenantId, agora), app.db);
    expect(await geracao(Q)).toMatchObject({ status: 'falhou', erro: 'interrompida' });
    expect((await uso(Q)).situacao).toBe('incerto');
  });

  it('na fila há mais de 30 min → interrompida com estorno; as recentes ficam', async () => {
    const velha = await pedido();
    // criado_em é coluna fixa (gatilho): a geração "velha" é a varredura rodando 31 min depois do pedido
    const r = await withTenant(worker(velha), (tx) => expirarGeracoesDoTenant(tx, velha.T.tenantId, new Date(agora.getTime() + 31 * 60_000)), app.db);
    expect(r.interrompidas).toBe(1);
    expect(await geracao(velha)).toMatchObject({ status: 'falhou', erro: 'interrompida' });
    expect((await uso(velha)).situacao).toBe('estornado');
    const nova = await pedido();
    expect((await withTenant(worker(nova), (tx) => expirarGeracoesDoTenant(tx, nova.T.tenantId, new Date(agora.getTime() + 29 * 60_000)), app.db)).interrompidas).toBe(0);
    expect((await geracao(nova)).status).toBe('na_fila');
  });

  it('R14: a relançada (início limpo) só é varrida 15 min depois do relançamento, nunca pelo início da tentativa anterior', async () => {
    const P = await pedido();
    await mudar(P, { status: 'processando', iniciadoEm: null, updatedAt: new Date(agora.getTime() - 5 * 60_000) });
    expect((await withTenant(worker(P), (tx) => expirarGeracoesDoTenant(tx, P.T.tenantId, agora), app.db)).interrompidas).toBe(0);
    await mudar(P, { updatedAt: new Date(agora.getTime() - 16 * 60_000) });
    expect((await withTenant(worker(P), (tx) => expirarGeracoesDoTenant(tx, P.T.tenantId, agora), app.db)).interrompidas).toBe(1);
    expect(await geracao(P)).toMatchObject({ status: 'falhou', erro: 'interrompida' });
  });
});
