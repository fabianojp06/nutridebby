import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { inject } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { novoTenant } from '../../../test/pacientes';
import { exameComLaudo, IA_TESTE, iaPronta, pacienteAutorizado, pdfDeTeste, prontuarioCompleto } from '../../../test/ia';
import { closeDb } from '@/db/client';
import { tenants, type TenantRow } from '@/db/schema';
import { getBoss, stopBoss } from '@/jobs/boss';
import { logger } from '@/lib/logger';
import { filtrarEvento } from '@/lib/sentry-filtro';
import { erroSemDetalhe } from '@/worker/sem-detalhe';
import { processarTarefaIA, RepetirIaError } from './leitura-job';
import { processarGeracaoModelos } from './modelos-job';
import { pedirModelos } from './modelos-sugeridos';
import { ErroProvedor } from './provedor';
import { finalOk, pedeFerramenta, provedorFake, respostaOk } from './provedor-fake';
import { pedirResumo } from './resumo';
import { processarResumo } from './resumo-job';
import { pedirLeituraExame } from './tarefas';

const app = makeDb(inject('appDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-ia-logs-'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
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
