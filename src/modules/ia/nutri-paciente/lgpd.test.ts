import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { IA_TESTE } from '../../../../test/ia';
import { mensagemNoBanco } from '../../../../test/ia-nutri';
import { app, comoWorker, depsApp, depsDoJob, fecharHarnessDaConversa, finalOk, pronto } from '../../../../test/ia-nutri-conversa';
import type { TenantDeTeste } from '../../../../test/pacientes';
import { iaNutriMensagens, patients } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { DESTINO_ROTULO } from '../constantes';
import { reservar } from '../cota';
import { provedorFake } from '../provedor-fake';
import { MSG_IA_NUTRI, ROTULO_CATEGORIA } from './constantes';
import { avaliar, encaminhar, perguntar } from './conversa';
import { processarPerguntaIaNutri } from './job';
import { apagarIaNutriDoTitular, iaNutriParaExportacao, limparIaNutriNaAnonimizacao } from './lgpd';
import { expurgarIaNutriDoTenant } from './retencao';
import { TEXTOS_FIXOS } from './textos';

// Plano 15 (P15-10): o que a exclusão atendida, a anonimização e a exportação fazem com a IA Nutri (§7.6, §13.3, D22,
// Review Focus 7). O pedido de exclusão é simulado pelo bloqueio (o job exclusao-atendida roda com o titular bloqueado).
afterAll(fecharHarnessDaConversa);

const BANANA = 'o que posso comer no lugar da banana à tarde?';
const SUBSTITUICAO = { categoria: 'plano', tipo_resposta: 'substituicao', fontes: ['#S1'] };
const RISCO = 'depois do jantar eu vomito pra não engordar';
const worker = (T: TenantDeTeste): TenantContext => ({ tenantId: T.tenantId, role: 'worker' });

async function perguntaRespondida(T: TenantDeTeste, ctxP: TenantContext) {
  const { mensagemId } = await perguntar(ctxP, BANANA, depsApp);
  expect(await processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: mensagemId! }, depsDoJob(provedorFake({ gerar: [finalOk(SUBSTITUICAO)] })))).toBe('respondida');
  return mensagemId!;
}
const bloquear = (T: TenantDeTeste, patientId: string) =>
  withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado', anonimizarApos: '2046-09-30' }).where(eq(patients.id, patientId)), app.db);
const mensagens = (T: TenantDeTeste, patientId: string) =>
  comoWorker(T, sql`select id, autor, texto, risco, revogada_em, expira_em <= now() + interval '30 days' as ate_30 from ia_nutri_mensagens where patient_id = ${patientId} order by created_at, autor desc`);
const contar = async (T: TenantDeTeste, tabela: 'ia_nutri_participacoes' | 'ia_nutri_consentimentos', patientId: string) =>
  (await comoWorker(T, sql`select count(*)::int as n from ${sql.identifier(tabela)} where patient_id = ${patientId}`))[0].n;

describe('apagarIaNutriDoTitular (§7.6 pedido de exclusão atendido, D22)', () => {
  it('apaga mensagens e participação, menos a pergunta com risco não aberta (revogada, até 30 dias); o consentimento fica; a nutricionista abre e ela sai', async () => {
    const { T, p, ctxP } = await pronto();
    await perguntaRespondida(T, ctxP);
    const risco = (await perguntar(ctxP, RISCO, depsApp)).mensagemId!; // a pergunta + a mensagem `sistema` que aponta para ela
    const riscoAberto = (await perguntar(ctxP, RISCO, depsApp)).mensagemId!;
    await withTenant(T.ctx, (tx) => tx.update(iaNutriMensagens).set({ abertaPelaNutriEm: new Date() }).where(eq(iaNutriMensagens.id, riscoAberto)), app.db);
    expect(await contar(T, 'ia_nutri_consentimentos', p.id)).toBe(1);
    expect(await contar(T, 'ia_nutri_participacoes', p.id)).toBe(1);

    await bloquear(T, p.id);
    await apagarIaNutriDoTitular(worker(T), p.id, app.db);
    const ficou = await mensagens(T, p.id);
    expect(ficou).toEqual([expect.objectContaining({ id: risco, autor: 'paciente', texto: RISCO, risco: 'transtorno_alimentar', ate_30: true })]);
    expect(ficou[0].revogada_em).not.toBeNull();
    expect(await contar(T, 'ia_nutri_participacoes', p.id)).toBe(0);
    expect(await contar(T, 'ia_nutri_consentimentos', p.id)).toBe(1); // a prova do consentimento fica até a anonimização
    // idempotente (nova tentativa do job exclusao-atendida)
    await apagarIaNutriDoTitular(worker(T), p.id, app.db);
    expect(await mensagens(T, p.id)).toHaveLength(1);

    // Review Focus 7 (T11 abrirDuvida): a nutricionista lê o texto e a linha é apagada na sessão dela, sem erro
    const lido = await withTenant(
      T.ctx,
      async (tx) => {
        const [m] = await tx.select({ texto: iaNutriMensagens.texto }).from(iaNutriMensagens).where(eq(iaNutriMensagens.id, risco));
        await tx.update(iaNutriMensagens).set({ abertaPelaNutriEm: new Date() }).where(eq(iaNutriMensagens.id, risco));
        await tx.delete(iaNutriMensagens).where(eq(iaNutriMensagens.id, risco));
        return m.texto;
      },
      app.db,
    );
    expect(lido).toBe(RISCO);
    expect(await mensagens(T, p.id)).toEqual([]);
  });

  it('sem abertura, depois dos 30 dias a retenção deixa só o aviso mínimo (texto nulo, risco fica); a anonimização apaga o que restou', async () => {
    const { T, p, ctxP } = await pronto();
    const risco = (await perguntar(ctxP, RISCO, depsApp)).mensagemId!;
    await bloquear(T, p.id);
    await apagarIaNutriDoTitular(worker(T), p.id, app.db);
    await comoWorker(T, sql`update ia_nutri_mensagens set expira_em = now() - interval '1 second' where id = ${risco}`);
    await expurgarIaNutriDoTenant(app.db, T.tenantId, new Date());
    expect(await mensagens(T, p.id)).toEqual([expect.objectContaining({ id: risco, texto: null, risco: 'transtorno_alimentar' })]);
    await withTenant(
      worker(T),
      async (tx) => {
        await tx.update(patients).set({ anonimizadoEm: new Date() }).where(eq(patients.id, p.id));
        await limparIaNutriNaAnonimizacao(tx, p.id);
      },
      app.db,
    );
    expect(await mensagens(T, p.id)).toEqual([]);
  });

  it('a pergunta ainda no job (ou que falhou antes da conciliação): a reserva da cota é devolvida (não saiu) ou fica incerta (saiu) antes de a linha sair', async () => {
    const { T, p, ctxP } = await pronto();
    const naoSaiu = (await perguntar(ctxP, BANANA, depsApp)).mensagemId!;
    // a que saiu e falhou antes de a varredura conciliar (uma pergunta em andamento por paciente: ia_nutri_mensagens_uma_por_vez)
    const saiu = await mensagemNoBanco(app.db, T.tenantId, p.id, { status: 'falhou', motivoTecnico: 'resultado_incerto', enviadoEm: new Date() });
    for (const id of [naoSaiu, saiu])
      await withTenant(worker(T), (tx) => reservar(tx, { tenantId: T.tenantId, tarefaId: id, tipo: 'conversa_paciente', modelo: 'claude-haiku-5-5', promptVersao: 't', microUsd: 1_000, agora: new Date(), tetoGlobalMicroUsd: IA_TESTE.tetoGlobalMicroUsd }), app.db);
    await bloquear(T, p.id);
    await apagarIaNutriDoTitular(worker(T), p.id, app.db);
    expect(await mensagens(T, p.id)).toEqual([]);
    const usos = await comoWorker(T, sql`select tarefa_id, situacao from ia_uso where tarefa_id in (${naoSaiu}, ${saiu})`);
    expect(Object.fromEntries(usos.map((u) => [u.tarefa_id, u.situacao]))).toEqual({ [naoSaiu]: 'estornado', [saiu]: 'incerto' });
  });

  it('com o paciente ativo, o gatilho de DELETE recusa (só depois do bloqueio do pedido atendido)', async () => {
    const { T, p, ctxP } = await pronto();
    await perguntaRespondida(T, ctxP);
    await expect(apagarIaNutriDoTitular(worker(T), p.id, app.db)).rejects.toMatchObject({ cause: expect.objectContaining({ code: '42501' }) });
    expect(await mensagens(T, p.id)).toHaveLength(2);
  });
});

describe('iaNutriParaExportacao (§7.6 "Exportação", US-018, US-046, RN-109)', () => {
  it('consentimentos e mensagens com rótulos legíveis; o texto fixo traduzido; a avaliação e a dúvida enviada à nutricionista (art. 19, § 3º); nunca fontes, motivo técnico, modelo ou reserva', async () => {
    const { T, p, ctxP } = await pronto();
    const pergunta = await perguntaRespondida(T, ctxP);
    const [resposta] = await comoWorker(T, sql`select id from ia_nutri_mensagens where responde_a = ${pergunta}`);
    expect(await avaliar(ctxP, resposta.id as string, 'ajudou', app.db)).toBe(true);
    expect(await encaminhar(ctxP, pergunta, app.db)).toBe('encaminhada');
    await perguntar(ctxP, RISCO, depsApp);
    const d = await withTenant(T.ctx, (tx) => iaNutriParaExportacao(tx, p.id), app.db);
    const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    expect(d.consentimentos).toEqual([{ evento: 'Autorizou', versao: '1.0', destino: DESTINO_ROTULO.teste, data: expect.stringMatching(ISO), ip: null, userAgent: null }]);
    expect(d.mensagens.map((m) => [m.autor, m.categoria, m.risco])).toEqual([
      [MSG_IA_NUTRI.autorPaciente, null, null],
      [MSG_IA_NUTRI.autorIa, ROTULO_CATEGORIA.plano, null],
      [MSG_IA_NUTRI.autorPaciente, null, 'Sinal de risco (alimentação)'],
      [MSG_IA_NUTRI.autorSistema, null, null],
    ]);
    expect(d.mensagens[0]).toMatchObject({ texto: BANANA, data: expect.stringMatching(ISO), enviadaEm: expect.stringMatching(ISO), destino: DESTINO_ROTULO.teste });
    expect(d.mensagens[0]).toMatchObject({ enviadaANutricionistaEm: expect.stringMatching(ISO), situacaoDaDuvida: 'Aguardando a nutricionista' });
    expect(d.mensagens[0]).not.toHaveProperty('avaliacao');
    expect(d.mensagens[1].texto).toMatch(/^No seu plano, as opções de substituição são:/);
    expect(d.mensagens[1]).toMatchObject({ avaliacao: MSG_IA_NUTRI.ajudou });
    expect(MSG_IA_NUTRI.ajudou).toBe('Ajudou');
    expect(d.mensagens[1]).not.toHaveProperty('enviadaEm');
    expect(d.mensagens[1]).not.toHaveProperty('situacaoDaDuvida');
    expect(d.mensagens[2]).toMatchObject({ texto: RISCO });
    expect(d.mensagens[2]).not.toHaveProperty('enviadaEm'); // a pergunta com risco nunca sai ao provedor
    expect(d.mensagens[3].texto).toBe(TEXTOS_FIXOS.risco_transtorno);
    const json = JSON.stringify(d);
    for (const proibido of ['#S1', 'fontes', 'motivo', 'modelo', 'claude', 'reserva', 'Micro', 'prompt']) expect(json).not.toContain(proibido);
  });

  it('a revogação aparece (com o canal); o esqueleto sem conteúdo fica de fora', async () => {
    const { T, p, ctxP } = await pronto();
    await perguntaRespondida(T, ctxP);
    await withTenant(ctxP, (tx) => tx.execute(sql`select * from app_ia_nutri_revogar('203.0.113.9', 'Mozilla/5.0')`), app.db);
    const d = await withTenant(T.ctx, (tx) => iaNutriParaExportacao(tx, p.id), app.db);
    expect(d.consentimentos.map((c) => c.evento)).toEqual(['Autorizou', 'Desativou']);
    expect(d.consentimentos[1]).toMatchObject({ versao: null, destino: null, ip: '203.0.113.9', userAgent: 'Mozilla/5.0' }); // a prova do titular (art. 19, § 3º)
    expect(d.mensagens).toEqual([]);
  });
});
