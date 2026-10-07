import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { inject } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { novoTenant } from '../../../test/pacientes';
import { exameComLaudo, iaPronta, pacienteInformado, pdfDeTeste } from '../../../test/ia';
import { closeDb } from '@/db/client';
import { tenants, type TenantRow } from '@/db/schema';
import { getBoss, stopBoss } from '@/jobs/boss';
import { logger } from '@/lib/logger';
import { filtrarEvento } from '@/lib/sentry-filtro';
import { erroSemDetalhe } from '@/worker/sem-detalhe';
import { processarTarefaIA, RepetirIaError } from './leitura-job';
import { ErroProvedor } from './provedor';
import { provedorFake, respostaOk } from './provedor-fake';
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
      const p = await pacienteInformado(app.db, T.ctx, { nome: `${MARCADOR} Souza` });
      const examId = await exameComLaudo(app.db, T.ctx, T.tenant, p.id, { dataDir, conteudo: await pdfDeTeste({ textos: [`Paciente ${MARCADOR} — Glicose ${MARCADOR}`], titulo: MARCADOR }) });
      const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId));
      const ia = { modo: 'fake' as const, modelo: 'claude-opus-5-5' as const, geo: 'us' as const, tetoGlobalMicroUsd: 50_000_000_000 };
      const tarefaId = await pedirLeituraExame(T.ctx, tenant as TenantRow, p.id, examId, { db: app.db, agora, ia, avisarTeto: async () => 0 });
      const deps = { db: app.db, dataDir, modo: 'fake' as const, geo: 'us' as const, tetoGlobalMicroUsd: ia.tetoGlobalMicroUsd, appUrl: 'https://x', agora: () => agora, alertas: { credencial: async () => 0, teto: async () => 0 } };
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

  it('Sentry: a tag motivo só passa com cara de código (letras, dígitos e _), nunca com texto livre', () => {
    expect(filtrarEvento({ tags: { fila: 'ia', motivo: 'ECONNREFUSED' } }).tags).toEqual({ fila: 'ia', motivo: 'ECONNREFUSED' });
    expect(filtrarEvento({ tags: { fila: 'ia', motivo: 'resultado_incerto' } }).tags).toEqual({ fila: 'ia', motivo: 'resultado_incerto' });
    expect(filtrarEvento({ tags: { fila: 'ia', motivo: MARCADOR } }).tags).toEqual({ fila: 'ia' });
  });

  it('o pino tira apiKey, parametros e resultado de qualquer objeto logado', async () => {
    const { redactPaths } = await import('@/lib/logger');
    for (const chave of ['apiKey', 'parametros', 'resultado']) expect(redactPaths()).toContain(chave);
  });
});
