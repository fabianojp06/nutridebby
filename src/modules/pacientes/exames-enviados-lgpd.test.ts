import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { arquivoDeEnvio, envioNoBanco, envioRecebido } from '../../../test/exames-enviados';
import { closeDb } from '@/db/client';
import { examSubmissionFiles, examSubmissions, exams, patients } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { resolverCaminho } from '@/modules/plataforma/armazenamento';
import { montarDados } from './exportacao-job';
import { anexosDoPaciente, anonimizarVencidos, apagarEnviosDoTitular, concluirExclusaoAtendida } from './lgpd';

const app = makeDb(inject('appDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-envio-lgpd-'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});
const worker = (tenantId: string): TenantContext => ({ tenantId, role: 'worker' });

/** Um titular com um envio de cada tipo: aguardando (PDF + páginas), processando (original), recusado e aceito (o exame fica). */
async function titularComEnvios() {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx);
  const recebido = await envioRecebido(app.db, T.ctx, p.id, dataDir, { paginas: 2, dataColeta: '2026-09-28' });
  const processando = await envioNoBanco(app.db, T.ctx, p.id, { status: 'processando' });
  const original = await arquivoDeEnvio(app.db, T.ctx, p.id, 'exame_original', dataDir);
  await withTenant(T.ctx, (tx) => tx.insert(examSubmissionFiles).values({ tenantId: T.tenantId, patientId: p.id, submissionId: processando, arquivoPath: original, papel: 'original', ordem: 1 }), app.db);
  const revisao = { revisadoPor: T.nutriId, revisadoEm: new Date() };
  await envioNoBanco(app.db, T.ctx, p.id, { status: 'recusado', motivoRecusa: 'outro', motivoRecusaTexto: 'Faltou a página 2', observacao: 'pedido na consulta', ...revisao });
  const [ex] = await withTenant(T.ctx, (tx) => tx.insert(exams).values({ tenantId: T.tenantId, patientId: p.id, data: '2026-09-01', titulo: 'Glicemia' }).returning({ id: exams.id }), app.db);
  const aceito = await envioNoBanco(app.db, T.ctx, p.id, { status: 'aceito', examId: ex.id, ...revisao });
  const envios = () => withTenant(T.ctx, (tx) => tx.select({ id: examSubmissions.id, status: examSubmissions.status }).from(examSubmissions).where(eq(examSubmissions.patientId, p.id)), app.db);
  const arquivos = [recebido.pdf, ...recebido.paginas, original];
  return { T, p, recebido, processando, aceito, exame: ex.id, envios, arquivos };
}
const bloquear = (T: Awaited<ReturnType<typeof novoTenant>>, patientId: string, anonimizarApos: string) =>
  withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado', bloqueadoEm: new Date(), anonimizarApos }).where(eq(patients.id, patientId)), app.db);

describe('LGPD e os exames enviados (spec C v0.3 §13.3)', () => {
  it('exportação (US-018/US-046): examesEnviados no dados.json; o PDF limpo de quem aguarda vai para envios/; nunca páginas nem originais', async () => {
    const t = await titularComEnvios();
    const { dados, laudos } = await withTenant(worker(t.T.tenantId), (tx) => montarDados(tx, t.p.id, new Date(), 'America/Sao_Paulo', 'titular'), app.db);
    expect(dados.examesEnviados.map((e) => [e.situacao, e.motivoRecusa])).toEqual(
      expect.arrayContaining([['recebido', null], ['processando', null], ['recusado', 'Faltou a página 2'], ['aceito', null]]),
    );
    expect(dados.examesEnviados.find((e) => e.situacao === 'recusado')).toMatchObject({ observacao: 'pedido na consulta', dataColeta: '2026-09-28', exame: null });
    // revisão do plano (art. 19, II): o aceito diz em qual exame virou e quando foi revisto; o que aguarda, não
    expect(dados.examesEnviados.find((e) => e.situacao === 'aceito')).toMatchObject({ exame: { data: '2026-09-01', titulo: 'Glicemia' }, revisadoEm: expect.any(String) });
    expect(dados.examesEnviados.find((e) => e.situacao === 'recebido')).toMatchObject({ exame: null, revisadoEm: null });
    const doEnvio = laudos.filter((l) => l.nome.startsWith('envios/'));
    expect(doEnvio).toEqual([expect.objectContaining({ tipo: 'envio', caminho: t.recebido.pdf, nome: expect.stringMatching(/^envios\/2026-09-28-\d{2}\.pdf$/) })]);
    for (const c of [...t.recebido.paginas, t.arquivos[3]]) expect(laudos.some((l) => l.caminho === c)).toBe(false);
  });

  it('anexosDoPaciente inclui os arquivos de envio (defesa da anonimização)', async () => {
    const t = await titularComEnvios();
    const anexos = await withTenant(worker(t.T.tenantId), (tx) => anexosDoPaciente(tx, t.p.id), app.db);
    expect(anexos).toEqual(expect.arrayContaining(t.arquivos));
  });

  it('exclusão atendida (job exclusao-atendida): arquivos e linhas dos envios NÃO aceitos saem antes do e-mail; o aceito e o exame ficam', async () => {
    const t = await titularComEnvios();
    await bloquear(t.T, t.p.id, '2046-10-07');
    expect(await concluirExclusaoAtendida({ tenantId: t.T.tenantId, patientId: t.p.id }, { db: app.db, dataDir, ultimaTentativa: false })).toBe('avisado');
    expect(await t.envios()).toEqual([{ id: t.aceito, status: 'aceito' }]);
    for (const c of t.arquivos) expect(existsSync(resolverCaminho(dataDir, c))).toBe(false);
    expect(await withTenant(t.T.ctx, (tx) => tx.select().from(exams).where(eq(exams.id, t.exame)), app.db)).toHaveLength(1);
    expect(await apagarEnviosDoTitular(worker(t.T.tenantId), t.p.id, { db: app.db, dataDir })).toBe(0); // idempotente
  });

  it('anonimização (fim do prazo): nenhuma linha de envio sobra, nem a do aceito; nenhum arquivo de envio', async () => {
    const t = await titularComEnvios();
    await bloquear(t.T, t.p.id, '2020-01-01');
    await anonimizarVencidos(app.db, new Date(), { dataDir });
    const [p] = await withTenant(t.T.ctx, (tx) => tx.select({ anonimizadoEm: patients.anonimizadoEm }).from(patients).where(eq(patients.id, t.p.id)), app.db);
    expect(p.anonimizadoEm).toBeInstanceOf(Date);
    expect(await t.envios()).toEqual([]);
    expect(await withTenant(t.T.ctx, (tx) => tx.select().from(examSubmissionFiles).where(and(eq(examSubmissionFiles.tenantId, t.T.tenantId), eq(examSubmissionFiles.patientId, t.p.id))), app.db)).toEqual([]);
    for (const c of t.arquivos) expect(existsSync(resolverCaminho(dataDir, c))).toBe(false);
  });
});
