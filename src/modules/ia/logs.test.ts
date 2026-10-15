import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { inject } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoTenant } from '../../../test/pacientes';
import { exameComLaudo, IA_TESTE, iaPronta, pacienteAutorizado, pdfDeTeste, prontuarioCompleto } from '../../../test/ia';
import { aceiteNoBanco, iaNutriPronta, liberarNoBanco } from '../../../test/ia-nutri';
import { app as appDaConversa, comoWorker, depsApp, depsDoJob, pronto, TACO_ARROZ } from '../../../test/ia-nutri-conversa';
import { planoPublicado } from '../../../test/plano';
import { pacienteComConta } from '../../../test/portal';
import { closeDb } from '@/db/client';
import { consultations, tenants, type TenantRow } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { EMAIL_FINALIDADE } from '@/email/queue';
import type { EmailJobData } from '@/email/types';
import { getBoss, stopBoss } from '@/jobs/boss';
import { openSecret } from '@/lib/crypto';
import { logger } from '@/lib/logger';
import { filtrarEvento } from '@/lib/sentry-filtro';
import { erroSemDetalhe } from '@/worker/sem-detalhe';
import { processarTarefaIA, RepetirIaError } from './leitura-job';
import { processarGeracaoModelos } from './modelos-job';
import { pedirModelos } from './modelos-sugeridos';
import { desativarNoApp } from './nutri-paciente/consentimento';
import { enviarANutri, perguntar } from './nutri-paciente/conversa';
import { abrirDuvida, marcarComoVista } from './nutri-paciente/duvidas';
import { processarPerguntaIaNutri } from './nutri-paciente/job';
import { processarRevogacaoIaNutri } from './nutri-paciente/revogacao-job';
import { avisarRiscoIaNutri } from './nutri-paciente/risco-job';
import { ErroProvedor } from './provedor';
import { finalOk, pedeFerramenta, provedorFake, respostaOk } from './provedor-fake';
import { pedirRascunhoIa } from './rascunho-ia';
import { processarRascunho } from './rascunho-job';
import { pedirResumo } from './resumo';
import { processarResumo } from './resumo-job';
import { pedirLeituraExame } from './tarefas';

const app = makeDb(inject('appDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-ia-logs-'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  await appDaConversa.pool.end(); // o harness da IA Nutri (test/ia-nutri-conversa.ts) tem o pool dele
  rmSync(dataDir, { recursive: true, force: true });
});
const MARCADOR = 'MARCADOR-SAUDE-123';
const agora = new Date(Math.floor(Date.now() / 1000) * 1000);

describe('RNF-104 / CS-103: nada de dado de saúde em log, fila, saída do job ou Sentry', () => {
  it('leitura com textos marcadores (ok, recusa e erro): o marcador não aparece em nenhum lugar', async () => {
    const espioes = (['info', 'warn', 'error', 'debug'] as const).map((n) => vi.spyOn(logger, n));
    try {
      const T = await novoTenant(app.db);
      await iaPronta(app.db, T.tenantId);
      const p = await pacienteAutorizado(app.db, T.ctx, { nome: `${MARCADOR} Souza` });
      const examId = await exameComLaudo(app.db, T.ctx, T.tenant, p.id, { dataDir, conteudo: await pdfDeTeste({ textos: [`Paciente ${MARCADOR} — Glicose ${MARCADOR}`], titulo: MARCADOR }) });
      const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId));
      const ia = IA_TESTE;
      const tarefaId = await pedirLeituraExame(T.ctx, tenant as TenantRow, p.id, examId, { db: app.db, agora, ia, avisarTeto: async () => 0 });
      const deps = { db: app.db, dataDir, modo: 'fake' as const, geo: 'us' as const, destino: 'teste' as const, retencao: 'zero' as const, tetoGlobalMicroUsd: ia.tetoGlobalMicroUsd, appUrl: 'https://x', agora: () => agora, alertas: { credencial: async () => 0, teto: async () => 0 } };
      const ok = respostaOk({ documento_reconhecido: true, data_coleta: null, marcadores: [{ nome_no_laudo: MARCADOR, valor_texto: MARCADOR, unidade: MARCADOR, referencia: MARCADOR, pagina: 1 }] });
      // linha com valor não numérico é válida na leitura (o "não numérico" é da tela): a tarefa fica pronta
      expect(await processarTarefaIA({ tenantId: T.tenantId, tarefaId }, { ...deps, provedor: provedorFake({ ler: [ok] }), ultimaTentativa: false })).toBe('pronta');
      // erro do provedor e nova tentativa: a saída do job (pg-boss) é só fila e código
      const outroExame = await exameComLaudo(app.db, T.ctx, T.tenant, p.id, { dataDir, conteudo: await pdfDeTeste() });
      const outraTarefa = await pedirLeituraExame(T.ctx, tenant as TenantRow, p.id, outroExame, { db: app.db, agora, ia, avisarTeto: async () => 0 });
      // o request-id do provedor pode ir para o log (spec §5.7): no teste ele é neutro, o marcador fica no conteúdo
      const repetir = await processarTarefaIA({ tenantId: T.tenantId, tarefaId: outraTarefa }, { ...deps, provedor: provedorFake({ ler: [new ErroProvedor('repetir', 529, 'req-neutro')] }), ultimaTentativa: false }).catch((e: unknown) => e);
      expect(repetir).toBeInstanceOf(RepetirIaError);
      expect(erroSemDetalhe('ia', repetir).message).not.toContain(MARCADOR);
      const logs = JSON.stringify(espioes.map((s) => s.mock.calls));
      expect(logs).not.toContain(MARCADOR.replace('-123', '')); // nem pedaço do marcador
      const jobs = await (await getBoss()).findJobs('ia');
      expect(JSON.stringify(jobs.map((j) => j.data))).not.toContain(MARCADOR);
      const evento = filtrarEvento({ message: MARCADOR, extra: { resultado: MARCADOR, parametros: MARCADOR }, tags: { fila: 'ia', motivo: MARCADOR }, exception: { values: [{ type: 'RepetirIaError', value: MARCADOR }] } });
      expect(JSON.stringify(evento)).not.toContain(MARCADOR);
    } finally {
      for (const s of espioes) s.mockRestore();
    }
  });

  it('modelos sugeridos (Plano 14B): título, orientações e pergunta marcadores não vão a log, fila nem à saída do job', async () => {
    const MARCADOR_2 = 'MARCADOR-SAUDE-456';
    const espioes = (['info', 'warn', 'error', 'debug'] as const).map((n) => vi.spyOn(logger, n));
    try {
      const T = await novoTenant(app.db);
      await iaPronta(app.db, T.tenantId);
      const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId));
      const geracaoId = await pedirModelos(T.ctx, tenant as TenantRow, 'diabetes', { db: app.db, agora, ia: IA_TESTE, avisarTeto: async () => 0 });
      const plano = { titulo: MARCADOR, meta_kcal: 1600, orientacoes: MARCADOR, refeicoes: [{ nome: MARCADOR.slice(0, 20), horario: '12:00', itens: [{ alimento: 'A1', gramas: 100, medida: null, substitui: null }] }] };
      const pacote = { planos: [plano, plano], anamnese: { nome: MARCADOR, perguntas: [{ tipo: 'texto_curto', rotulo: MARCADOR_2, obrigatoria: false }] } };
      const deps = {
        db: app.db, modo: 'fake' as const, geo: 'us' as const, destino: 'teste' as const, retencao: null, tetoGlobalMicroUsd: IA_TESTE.tetoGlobalMicroUsd, appUrl: 'https://x',
        agora: () => agora, ultimaTentativa: false, alertas: { credencial: async () => 0, teto: async () => 0 }, modeloAssistente: IA_TESTE.modeloAssistente, tetoRascunhoMicroUsd: IA_TESTE.tetoRascunhoMicroUsd,
      };
      const f = provedorFake({ gerar: [pedeFerramenta('buscar_alimentos', { termo: 'arroz' }), finalOk(pacote)] });
      const saida = await processarGeracaoModelos({ tenantId: T.tenantId, geracaoId }, { ...deps, provedor: f });
      expect(saida).toBe('pronta');
      // a 2ª geração falha com o marcador na resposta (fora do formato) e a 3ª relança ao pg-boss
      const outro = await novoTenant(app.db);
      await iaPronta(app.db, outro.tenantId);
      const [t2] = await app.db.select().from(tenants).where(eq(tenants.id, outro.tenantId));
      const g2 = await pedirModelos(outro.ctx, t2 as TenantRow, 'gestacao', { db: app.db, agora, ia: IA_TESTE, avisarTeto: async () => 0 });
      expect(await processarGeracaoModelos({ tenantId: outro.tenantId, geracaoId: g2 }, { ...deps, provedor: provedorFake({ gerar: [finalOk({ planos: [MARCADOR_2] })] }) })).toBe('falhou');
      const terceiro = await novoTenant(app.db);
      await iaPronta(app.db, terceiro.tenantId);
      const [t3] = await app.db.select().from(tenants).where(eq(tenants.id, terceiro.tenantId));
      const g3 = await pedirModelos(terceiro.ctx, t3 as TenantRow, 'idosos', { db: app.db, agora, ia: IA_TESTE, avisarTeto: async () => 0 });
      const repetir = await processarGeracaoModelos({ tenantId: terceiro.tenantId, geracaoId: g3 }, { ...deps, provedor: provedorFake({ gerar: [new ErroProvedor('repetir', 529, 'req-neutro')] }) }).catch((e: unknown) => e);
      expect(repetir).toBeInstanceOf(RepetirIaError);
      expect(erroSemDetalhe('ia-assistente', repetir).message).not.toContain('MARCADOR');
      const logs = JSON.stringify(espioes.map((s) => s.mock.calls));
      expect(logs).not.toContain('MARCADOR');
      const jobs = await (await getBoss()).findJobs('ia-assistente');
      expect(JSON.stringify(jobs.map((j) => j.data))).not.toContain('MARCADOR');
      expect(JSON.stringify(jobs.map((j) => j.output ?? null))).not.toContain('MARCADOR');
    } finally {
      for (const s of espioes) s.mockRestore();
    }
  });

  it('resumo do histórico (Plano 14B): prontuário e frases da IA marcadores não vão a log, fila nem à saída do job', async () => {
    const DO_PRONTUARIO = 'MARCADOR-SAUDE-790';
    const DA_IA = 'MARCADOR-SAUDE-789';
    const espioes = (['info', 'warn', 'error', 'debug'] as const).map((n) => vi.spyOn(logger, n));
    try {
      const deps = {
        db: app.db, modo: 'fake' as const, geo: 'us' as const, destino: 'teste' as const, retencao: 'zero' as const, tetoGlobalMicroUsd: IA_TESTE.tetoGlobalMicroUsd, appUrl: 'https://x',
        agora: () => agora, ultimaTentativa: false, alertas: { credencial: async () => 0, teto: async () => 0 }, modeloAssistente: IA_TESTE.modeloAssistente, tetoRascunhoMicroUsd: IA_TESTE.tetoRascunhoMicroUsd,
      };
      const umPedido = async () => {
        const T = await novoTenant(app.db);
        await iaPronta(app.db, T.tenantId);
        const p = await pacienteAutorizado(app.db, T.ctx, { nome: `${DO_PRONTUARIO} Souza` });
        await prontuarioCompleto(app.db, T.ctx, p.id, DO_PRONTUARIO);
        const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId));
        const { tarefaId } = await pedirResumo(T.ctx, tenant as TenantRow, p.id, { notasPrivadas: true, gerarDeNovo: false }, { db: app.db, agora, ia: IA_TESTE, avisarTeto: async () => 0 });
        return { tenantId: T.tenantId, tarefaId };
      };
      const frase = { texto: `${DA_IA} pesa 80 kg.`, fontes: ['#1'] };
      // pronta (com uma frase retirada), fora do formato e relançada ao pg-boss
      const ok = await umPedido();
      const f = provedorFake({ gerar: [finalOk({ secoes: [{ secao: 'evolucao', frases: [frase, { texto: DA_IA, fontes: [] }] }] })] });
      expect(await processarResumo(ok, { ...deps, provedor: f })).toBe('pronta');
      expect(f.chamadas.gerar[0].turnos[0]).toBeDefined(); // o pedido saiu ao provedor falso (o conteúdo vai só ao provedor)
      const invalida = await umPedido();
      expect(await processarResumo(invalida, { ...deps, provedor: provedorFake({ gerar: [finalOk({ secoes: DA_IA })] }) })).toBe('falhou');
      const repete = await umPedido();
      const repetir = await processarResumo(repete, { ...deps, provedor: provedorFake({ gerar: [new ErroProvedor('repetir', 529, 'req-neutro')] }) }).catch((e: unknown) => e);
      expect(repetir).toBeInstanceOf(RepetirIaError);
      expect(erroSemDetalhe('ia-assistente', repetir).message).not.toContain('MARCADOR');
      const logs = JSON.stringify(espioes.map((s) => s.mock.calls));
      expect(logs).not.toContain('MARCADOR');
      const jobs = await (await getBoss()).findJobs('ia-assistente');
      expect(JSON.stringify(jobs.map((j) => j.data))).not.toContain('MARCADOR');
      expect(JSON.stringify(jobs.map((j) => j.output ?? null))).not.toContain('MARCADOR');
    } finally {
      for (const s of espioes) s.mockRestore();
    }
  });

  it('rascunho de plano (Plano 14B): restrições e título da IA marcadores não vão a log, fila nem à saída do job', async () => {
    const DAS_METAS = 'MARCADOR-SAUDE-901';
    const DA_IA = 'MARCADOR-SAUDE-902';
    const espioes = (['info', 'warn', 'error', 'debug'] as const).map((n) => vi.spyOn(logger, n));
    try {
      const deps = {
        db: app.db, modo: 'fake' as const, geo: 'us' as const, destino: 'teste' as const, retencao: 'zero' as const, tetoGlobalMicroUsd: IA_TESTE.tetoGlobalMicroUsd, appUrl: 'https://x',
        agora: () => agora, ultimaTentativa: false, alertas: { credencial: async () => 0, teto: async () => 0 }, modeloAssistente: IA_TESTE.modeloAssistente, tetoRascunhoMicroUsd: IA_TESTE.tetoRascunhoMicroUsd,
      };
      const metas = {
        metaKcal: '1800', proteinaPct: '20', carboidratoPct: '50', lipidioPct: '30', refeicoes: [{ nome: `Almoço ${DAS_METAS}`, horario: '12:00' }],
        restricoes: `Sem lactose ${DAS_METAS}.`, considerarAnamnese: true,
      };
      const umPedido = async () => {
        const T = await novoTenant(app.db);
        await iaPronta(app.db, T.tenantId);
        const p = await pacienteAutorizado(app.db, T.ctx);
        await prontuarioCompleto(app.db, T.ctx, p.id, DAS_METAS);
        const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId));
        const tarefaId = await pedirRascunhoIa(T.ctx, tenant as TenantRow, p.id, metas, { db: app.db, agora, ia: IA_TESTE, avisarTeto: async () => 0 });
        return { tenantId: T.tenantId, tarefaId };
      };
      const plano = { titulo: DA_IA, meta_kcal: 1800, orientacoes: DA_IA, refeicoes: [{ nome: DA_IA, horario: '12:00', itens: [{ alimento: 'A1', gramas: 150, medida: null, substitui: null }] }] };
      // pronta, fora do formato, parada no limite de voltas e relançada ao pg-boss
      const ok = await umPedido();
      const f = provedorFake({ gerar: [pedeFerramenta('buscar_alimentos', { termo: 'arroz' }), finalOk(plano)] });
      expect(await processarRascunho(ok, { ...deps, provedor: f })).toBe('pronta');
      expect(JSON.stringify(f.chamadas.gerar[0].turnos)).toContain(DAS_METAS); // as restrições foram ao provedor falso (só a ele)
      const invalida = await umPedido();
      expect(await processarRascunho(invalida, { ...deps, provedor: provedorFake({ gerar: [finalOk({ ...plano, refeicoes: DA_IA })] }) })).toBe('falhou');
      const voltas = await umPedido();
      const muitas = provedorFake({ gerar: Array.from({ length: 13 }, (_, i) => pedeFerramenta('buscar_alimentos', { termo: DA_IA }, `c${i}`)) });
      expect(await processarRascunho(voltas, { ...deps, provedor: muitas })).toBe('falhou');
      const repete = await umPedido();
      const repetir = await processarRascunho(repete, { ...deps, provedor: provedorFake({ gerar: [new ErroProvedor('repetir', 529, 'req-neutro')] }) }).catch((e: unknown) => e);
      expect(repetir).toBeInstanceOf(RepetirIaError);
      expect(erroSemDetalhe('ia-assistente', repetir).message).not.toContain('MARCADOR');
      const logs = JSON.stringify(espioes.map((s) => s.mock.calls));
      expect(logs).not.toContain('MARCADOR');
      const jobs = await (await getBoss()).findJobs('ia-assistente');
      expect(JSON.stringify(jobs.map((j) => j.data))).not.toContain('MARCADOR');
      expect(JSON.stringify(jobs.map((j) => j.output ?? null))).not.toContain('MARCADOR');
    } finally {
      for (const s of espioes) s.mockRestore();
    }
  });

  /** Plano 15: as filas da IA Nutri levam só ids (RNF-165); o e-mail vai selado e é aberto aqui para conferir o conteúdo. */
  const FILAS_DA_IA_NUTRI = ['ia-paciente', 'ia-nutri-risco', 'ia-nutri-revogacao'] as const;
  const jobsDaIaNutri = async (tenantId: string) => {
    const boss = await getBoss();
    const todos = (await Promise.all(FILAS_DA_IA_NUTRI.map(async (f) => (await boss.findJobs(f)).map((j) => ({ fila: f, data: j.data as Record<string, unknown> }))))).flat();
    return todos.filter((j) => j.data.tenantId === tenantId);
  };
  const emailsDoTenant = async (tenantId: string) =>
    (await (await getBoss()).findJobs('email')).map((j) => j.data as EmailJobData).filter((d) => d.tenantId === tenantId).map((d) => openSecret(d.selado, EMAIL_FINALIDADE));

  it('IA Nutri do paciente (RNF-165): nome, orientação de atendimento, observação da refeição e pergunta marcadores vão ao provedor, mas não a log, fila, notificação nem e-mail; o pedido leva [removido] no lugar do nome', async () => {
    const db = appDaConversa.db;
    const espioes = (['info', 'warn', 'error', 'debug'] as const).map((n) => vi.spyOn(logger, n));
    try {
      const T = await novoTenant(db);
      await iaNutriPronta(db, T.tenantId);
      // o marcador no meio do nome (não como primeiro nome): sozinho, a máscara não o apaga, e o dado de saúde do corpo do
      // pedido chega ao provedor com ele — é isso que torna sensível a checagem do log
      const { paciente: p, userId } = await pacienteComConta(db, T, { nome: `Joana ${MARCADOR} Souza` });
      const ctxP = ctxPaciente(T.tenantId, p.id, userId);
      await liberarNoBanco(db, T.ctx, p.id);
      await aceiteNoBanco(db, ctxP);
      await planoPublicado(db, T, p.id, { refeicoes: [{ nome: 'Almoço', horario: '12:30', observacao: `Sem sal ${MARCADOR}`, itens: [{ gramas: 100, taco: TACO_ARROZ }] }] });
      await withTenant(T.ctx, (tx) => tx.insert(consultations).values({ tenantId: T.tenantId, patientId: p.id, data: '2026-09-01', orientacoesPaciente: `Caminhe ${MARCADOR} todo dia, Joana Souza.` }), db);

      // uma resposta montada (o trecho relido traz a observação marcadora, só ao paciente) e um risco percebido pelo modelo
      const fake = provedorFake({ gerar: [finalOk({ categoria: 'plano', tipo_resposta: 'refeicao', fontes: ['#R1'] }), finalOk({ categoria: 'risco', tipo_resposta: 'nenhum', fontes: [] })] });
      const { mensagemId: m1 } = await perguntar(ctxP, `o que tem no almoço? ${MARCADOR}`, depsApp);
      expect(await processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: m1! }, depsDoJob(fake))).toBe('respondida');
      const { mensagemId: m2 } = await perguntar(ctxP, `ando meio desanimada ${MARCADOR}`, depsApp);
      expect(await processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: m2! }, depsDoJob(fake))).toBe('respondida');
      const [resposta] = await comoWorker(T, sql`select texto from ia_nutri_mensagens where responde_a = ${m1}`);
      expect(resposta.texto).toContain(MARCADOR); // conferência do cenário: a observação chegou à resposta montada (no banco)
      // o aviso de risco por e-mail às nutricionistas, a dúvida vista (push neutro ao paciente) e a desativação (estorno)
      expect(await avisarRiscoIaNutri({ tenantId: T.tenantId }, { db, appUrl: 'https://app.teste' })).toBe('enviado');
      expect(await abrirDuvida(T.ctx, m2!, db)).not.toBeNull();
      expect(await marcarComoVista(T.ctx, m2!, { db })).toBe(true);
      expect(await desativarNoApp(ctxP, depsApp)).toBe('desativada');
      const jobs = await jobsDaIaNutri(T.tenantId);
      const revogacao = jobs.find((j) => j.fila === 'ia-nutri-revogacao');
      expect(revogacao).toBeDefined();
      await processarRevogacaoIaNutri(revogacao!.data as { tenantId: string; patientId: string; revogacaoId: string }, { db });

      // o pedido ao provedor: o dado de saúde (pergunta, observação, orientação, histórico) sai com o marcador; o nome
      // ("Joana Souza" na orientação) vira [removido]
      const pedido = JSON.stringify(fake.chamadas.gerar);
      expect(pedido).toContain(MARCADOR);
      expect(pedido).toContain('[removido]');
      expect(pedido).not.toMatch(/Joana|Souza/);
      // log, filas (só ids), notificações e e-mails
      const logs = JSON.stringify(espioes.map((s) => s.mock.calls));
      expect(logs).not.toContain('MARCADOR');
      expect(jobs.map((j) => j.fila).sort()).toEqual(expect.arrayContaining(['ia-nutri-revogacao', 'ia-nutri-risco', 'ia-paciente']));
      for (const j of jobs) {
        expect(Object.keys(j.data).every((k) => ['tenantId', 'mensagemId', 'patientId', 'revogacaoId'].includes(k)), `${j.fila}: ${Object.keys(j.data)}`).toBe(true);
        expect(JSON.stringify(j.data), j.fila).not.toContain('MARCADOR');
      }
      const notificacoes = await comoWorker(T, sql`select row_to_json(n)::text as linha from notifications n where patient_id = ${p.id}`);
      expect(notificacoes.length).toBeGreaterThan(0);
      expect(JSON.stringify(notificacoes)).not.toContain('MARCADOR');
      const emails = await emailsDoTenant(T.tenantId);
      expect(emails.length).toBeGreaterThan(0);
      expect(emails.join('\n')).not.toContain('MARCADOR');
      expect(emails.join('\n')).not.toContain('Souza');
    } finally {
      for (const s of espioes) s.mockRestore();
    }
  });

  it('RN-174 (Review Focus 6): a pergunta barrada pelo filtro de risco nunca vai ao provedor no histórico da pergunta seguinte da mesma sessão', async () => {
    const espioes = (['info', 'warn', 'error', 'debug'] as const).map((n) => vi.spyOn(logger, n));
    try {
      const { T, ctxP } = await pronto();
      const barrada = await perguntar(ctxP, `não aguento mais, quero sumir ${MARCADOR}`, depsApp);
      expect(barrada.codigo).toBe('risco');
      const { mensagemId } = await perguntar(ctxP, 'quanto de arroz no almoço?', depsApp);
      const fake = provedorFake();
      expect(await processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: mensagemId! }, depsDoJob(fake))).toBe('respondida');
      expect(fake.chamadas.gerar).toHaveLength(1);
      expect(JSON.stringify(fake.chamadas.gerar)).not.toContain(MARCADOR);
      expect(JSON.stringify(fake.chamadas.gerar)).not.toContain('quero sumir');
      expect(JSON.stringify(espioes.map((s) => s.mock.calls))).not.toContain('MARCADOR');
      expect(JSON.stringify(await jobsDaIaNutri(T.tenantId))).not.toContain('MARCADOR');
    } finally {
      for (const s of espioes) s.mockRestore();
    }
  });

  it('DP-16: a dúvida enviada direto à nutricionista (sem IA) nunca vai ao provedor no histórico da pergunta seguinte da mesma sessão', async () => {
    const DIRETO = 'MARCADOR-DIRETO-456';
    const espioes = (['info', 'warn', 'error', 'debug'] as const).map((n) => vi.spyOn(logger, n));
    try {
      const { T, ctxP } = await pronto();
      const direta = await enviarANutri(ctxP, `posso trocar o jantar de dia? ${DIRETO}`, depsApp);
      expect(direta.codigo).toBe('encaminhada');
      const { mensagemId } = await perguntar(ctxP, 'quanto de arroz no almoço?', depsApp);
      const fake = provedorFake();
      expect(await processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: mensagemId! }, depsDoJob(fake))).toBe('respondida');
      expect(fake.chamadas.gerar).toHaveLength(1);
      expect(JSON.stringify(fake.chamadas.gerar)).not.toContain(DIRETO);
      expect(JSON.stringify(fake.chamadas.gerar)).not.toContain('trocar o jantar');
      expect(JSON.stringify(espioes.map((s) => s.mock.calls))).not.toContain('MARCADOR');
      // conferência do cenário: a dúvida está na fila da nutricionista com o texto
      const [linha] = await comoWorker(T, sql`select texto, encaminhada_em from ia_nutri_mensagens where id = ${direta.mensagemId}`);
      expect(linha.texto).toContain(DIRETO);
      expect(linha.encaminhada_em).not.toBeNull();
    } finally {
      for (const s of espioes) s.mockRestore();
    }
  });

  it('Sentry: a tag motivo só passa com cara de código (letras, dígitos e _), nunca com texto livre', () => {
    expect(filtrarEvento({ tags: { fila: 'ia', motivo: 'ECONNREFUSED' } }).tags).toEqual({ fila: 'ia', motivo: 'ECONNREFUSED' });
    expect(filtrarEvento({ tags: { fila: 'ia', motivo: 'resultado_incerto' } }).tags).toEqual({ fila: 'ia', motivo: 'resultado_incerto' });
    expect(filtrarEvento({ tags: { fila: 'ia', motivo: MARCADOR } }).tags).toEqual({ fila: 'ia' });
  });

  it('o pino tira apiKey, x-api-key, parametros e resultado de qualquer objeto logado', async () => {
    const { redactPaths } = await import('@/lib/logger');
    for (const chave of ['apiKey', 'parametros', 'resultado']) expect(redactPaths()).toContain(chave);
    // chave com hífen: o fast-redact só aceita com colchetes (o comportamento é provado em src/lib/logger.test.ts)
    expect(redactPaths()).toEqual(expect.arrayContaining(['["x-api-key"]', '*["x-api-key"]', '*.*["x-api-key"]']));
  });
});
