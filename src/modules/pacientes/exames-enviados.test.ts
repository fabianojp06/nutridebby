import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { arquivoDeEnvio, envioNoBanco, envioRecebido, JPEG_MINIMO } from '../../../test/exames-enviados';
import { closeDb, type Db } from '@/db/client';
import { auditLog, examSubmissionFiles, examSubmissions, exams, notifications, patients, storedFiles, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { resolverCaminho } from '@/modules/plataforma/armazenamento';
import { PacienteBloqueadoError } from './base';
import { MSG_EXAME } from './exames-constantes';
import { MSG_REVISAO } from './exames-enviados-constantes';
import { abrirEnvio, aceitarEnvio, contarEnviosDoPaciente, contarEnviosRecebidos, examesEnviadosPeloPaciente, filaDeEnvios, recusarEnvio, RevisaoError } from './exames-enviados';

const app = makeDb(inject('appDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-revisao-'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});
const SP = { fuso: 'America/Sao_Paulo' };
const deps = { db: app.db, dataDir };
const erros = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof RevisaoError) return e.erros;
    throw e;
  }
  throw new Error('esperava RevisaoError');
};
async function cenario() {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx);
  const bytes = async () => (await app.db.select({ b: tenants.armazenamentoBytes }).from(tenants).where(eq(tenants.id, T.tenantId)))[0].b;
  const ler = async (id: string) => (await withTenant(T.ctx, (tx) => tx.select().from(examSubmissions).where(eq(examSubmissions.id, id)), app.db))[0];
  const pushes = () => withTenant(T.ctx, (tx) => tx.select({ tipo: notifications.tipo, canal: notifications.canal }).from(notifications).where(eq(notifications.patientId, p.id)), app.db);
  return { T, p, bytes, ler, pushes };
}
const aceitar = { titulo: 'Hemograma', data: '2026-09-28' };
/** O mesmo Db, mas `entre` roda logo depois do commit da 1ª transação: injeta um commit de outra conexão no intervalo. */
function depoisDaPrimeiraTransacao(db: Db, entre: () => Promise<void>): Db {
  let primeira = true;
  const transaction: Db['transaction'] = async (...args) => {
    const r = await db.transaction(...args);
    if (primeira) {
      primeira = false;
      await entre();
    }
    return r;
  };
  return new Proxy(db, { get: (alvo, prop, rec) => (prop === 'transaction' ? transaction : Reflect.get(alvo, prop, rec)) });
}

describe('revisão do exame enviado (US-162 a US-164, RN-164, RN-165, §6.5)', () => {
  it('US-163 "Aceitar": exame com o PDF limpo (sem cópia), envio "aceito" com quem e quando, páginas apagadas, push neutro e trilha', async () => {
    const { T, p, bytes, ler, pushes } = await cenario();
    const e = await envioRecebido(app.db, T.ctx, p.id, dataDir, { paginas: 2 });
    const antes = await bytes();
    const { examId, patientId } = await aceitarEnvio(T.ctx, SP, e.id, aceitar, deps);
    expect(patientId).toBe(p.id);
    const [ex] = await withTenant(T.ctx, (tx) => tx.select().from(exams).where(eq(exams.id, examId)), app.db);
    expect(ex).toMatchObject({ patientId: p.id, titulo: 'Hemograma', data: '2026-09-28', arquivoPath: e.pdf, valores: [] });
    const envio = await ler(e.id);
    expect(envio).toMatchObject({ status: 'aceito', examId, revisadoPor: T.nutriId, arquivoPath: null });
    expect(envio.revisadoEm).toBeInstanceOf(Date);
    for (const c of e.paginas) expect(existsSync(resolverCaminho(dataDir, c))).toBe(false);
    expect(existsSync(resolverCaminho(dataDir, e.pdf))).toBe(true);
    expect(await bytes()).toBe(antes - 2 * JPEG_MINIMO.length); // só as páginas saíram; o PDF não foi copiado
    expect(await pushes()).toEqual([{ tipo: 'exame_revisado', canal: 'push' }]);
    const trilha = await withTenant(
      T.ctx,
      (tx) =>
        tx
          .select({ acao: auditLog.acao, entidade: auditLog.entidade, ator: auditLog.actorUserId })
          .from(auditLog)
          .where(and(eq(auditLog.patientId, p.id), inArray(auditLog.entidade, ['exames', 'exames_enviados']), inArray(auditLog.acao, ['criar', 'alterar']))),
      app.db,
    );
    expect(trilha).toEqual(expect.arrayContaining([{ acao: 'criar', entidade: 'exames', ator: T.nutriId }, { acao: 'alterar', entidade: 'exames_enviados', ator: T.nutriId }]));
    expect(await examesEnviadosPeloPaciente(T.ctx, p.id, app.db)).toEqual(new Set([examId]));
  });

  it('as regras da US-015: título obrigatório (cortado em 120, como criarExame), data válida e não futura; nada gravado', async () => {
    const { T, p, ler } = await cenario();
    const e = await envioRecebido(app.db, T.ctx, p.id, dataDir);
    expect(await erros(aceitarEnvio(T.ctx, SP, e.id, { titulo: '   ', data: '2026-09-28' }, deps))).toEqual({ titulo: MSG_EXAME.titulo });
    expect(await erros(aceitarEnvio(T.ctx, SP, e.id, { titulo: 'Hemograma', data: '2999-01-01' }, deps))).toEqual({ data: MSG_EXAME.futuro });
    expect(await erros(aceitarEnvio(T.ctx, SP, e.id, { titulo: 'Hemograma', data: 'ontem' }, deps))).toEqual({ data: MSG_EXAME.data });
    expect((await ler(e.id)).status).toBe('recebido');
    const { examId } = await aceitarEnvio(T.ctx, SP, e.id, { titulo: 'x'.repeat(130), data: '2026-09-28' }, deps);
    const [ex] = await withTenant(T.ctx, (tx) => tx.select({ titulo: exams.titulo }).from(exams).where(eq(exams.id, examId)), app.db);
    expect(ex.titulo).toHaveLength(120);
  });

  it('US-163 corridas: cancelado pelo paciente → "Este envio foi cancelado pelo paciente."; aceito em outra aba → "Este envio já foi revisado."', async () => {
    const { T, p } = await cenario();
    const c = await envioRecebido(app.db, T.ctx, p.id, dataDir);
    await withTenant(ctxPaciente(T.tenantId, p.id), (tx) => tx.update(examSubmissions).set({ status: 'cancelado' }).where(eq(examSubmissions.id, c.id)), app.db);
    expect(await erros(aceitarEnvio(T.ctx, SP, c.id, aceitar, deps))).toEqual({ geral: MSG_REVISAO.cancelado });
    expect(await erros(recusarEnvio(T.ctx, c.id, { motivo: 'ilegivel', texto: '' }, deps))).toEqual({ geral: MSG_REVISAO.cancelado });
    const a = await envioRecebido(app.db, T.ctx, p.id, dataDir);
    await aceitarEnvio(T.ctx, SP, a.id, aceitar, deps);
    expect(await erros(aceitarEnvio(T.ctx, SP, a.id, aceitar, deps))).toEqual({ geral: MSG_REVISAO.jaRevisado });
    expect(await erros(recusarEnvio(T.ctx, a.id, { motivo: 'repetido', texto: '' }, deps))).toEqual({ geral: MSG_REVISAO.jaRevisado });
    expect(await withTenant(T.ctx, (tx) => tx.select().from(exams).where(eq(exams.patientId, p.id)), app.db)).toHaveLength(1);
    expect(await erros(aceitarEnvio(T.ctx, SP, '00000000-0000-4000-8000-000000000000', aceitar, deps))).toEqual({ geral: MSG_REVISAO.naoEncontrado });
  });

  it('§6.3: paciente arquivado → aceita normalmente; bloqueado → PacienteBloqueadoError e nada gravado', async () => {
    const { T, p } = await cenario();
    const e1 = await envioRecebido(app.db, T.ctx, p.id, dataDir);
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'arquivado' }).where(eq(patients.id, p.id)), app.db);
    await aceitarEnvio(T.ctx, SP, e1.id, aceitar, deps);
    const e2 = await envioRecebido(app.db, T.ctx, p.id, dataDir);
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado' }).where(eq(patients.id, p.id)), app.db);
    await expect(aceitarEnvio(T.ctx, SP, e2.id, aceitar, deps)).rejects.toBeInstanceOf(PacienteBloqueadoError);
    await expect(recusarEnvio(T.ctx, e2.id, { motivo: 'ilegivel', texto: '' }, deps)).rejects.toBeInstanceOf(PacienteBloqueadoError);
    expect(await withTenant(T.ctx, (tx) => tx.select().from(exams).where(eq(exams.patientId, p.id)), app.db)).toHaveLength(1);
  });

  it('US-164 "Recusar" (D20 = a): o PDF limpo sai na mesma transação que marca "recusado"; as páginas logo depois; cota devolvida; push neutro', async () => {
    const { T, p, bytes, ler, pushes } = await cenario();
    const inicial = await bytes();
    const e = await envioRecebido(app.db, T.ctx, p.id, dataDir);
    await recusarEnvio(T.ctx, e.id, { motivo: 'outra_pessoa', texto: 'ignorado fora de "outro"' }, deps);
    expect(await ler(e.id)).toMatchObject({ status: 'recusado', motivoRecusa: 'outra_pessoa', motivoRecusaTexto: null, revisadoPor: T.nutriId, arquivoPath: null });
    for (const c of [e.pdf, ...e.paginas]) expect(existsSync(resolverCaminho(dataDir, c))).toBe(false);
    expect(await bytes()).toBe(inicial);
    expect(await pushes()).toEqual([{ tipo: 'exame_revisado', canal: 'push' }]);
  });

  it('US-164 corrida (regra 9, um dono só): o worker grava o PDF limpo entre a leitura e a trava da recusa → a recusa apaga o PDF da linha travada, nada órfão', async () => {
    const { T, p, bytes, ler } = await cenario();
    const inicial = await bytes();
    const id = await envioNoBanco(app.db, T.ctx, p.id, { status: 'processando' });
    let pdf = '';
    // o commit "processando → recebido" do worker cai logo depois da 1ª transação da recusa (a leitura sem trava do envio)
    const db = depoisDaPrimeiraTransacao(app.db, async () => {
      pdf = await arquivoDeEnvio(app.db, T.ctx, p.id, 'exame', dataDir);
      await withTenant({ tenantId: T.tenantId, role: 'worker' }, (tx) => tx.update(examSubmissions).set({ status: 'recebido', arquivoPath: pdf }).where(eq(examSubmissions.id, id)), app.db);
    });
    await recusarEnvio(T.ctx, id, { motivo: 'ilegivel', texto: '' }, { db, dataDir });
    expect(pdf).not.toBe('');
    expect(await ler(id)).toMatchObject({ status: 'recusado', motivoRecusa: 'ilegivel', arquivoPath: null });
    expect(existsSync(resolverCaminho(dataDir, pdf))).toBe(false);
    expect(await withTenant(T.ctx, (tx) => tx.select().from(storedFiles).where(eq(storedFiles.caminho, pdf)), app.db)).toEqual([]);
    expect(await bytes()).toBe(inicial);
  });

  it('US-164 "Outro motivo": texto obrigatório de 1 a 300 — "Escreva o motivo para o paciente"; motivo fora da lista → "Escolha o motivo."', async () => {
    const { T, p, ler } = await cenario();
    const e = await envioRecebido(app.db, T.ctx, p.id, dataDir);
    expect(await erros(recusarEnvio(T.ctx, e.id, { motivo: 'outro', texto: '   ' }, deps))).toEqual({ texto: MSG_REVISAO.motivoObrigatorio });
    expect(await erros(recusarEnvio(T.ctx, e.id, { motivo: 'outro', texto: 'x'.repeat(301) }, deps))).toEqual({ texto: MSG_REVISAO.motivoObrigatorio });
    expect(await erros(recusarEnvio(T.ctx, e.id, { motivo: 'qualquer', texto: '' }, deps))).toEqual({ motivo: MSG_REVISAO.escolhaMotivo });
    await recusarEnvio(T.ctx, e.id, { motivo: 'outro', texto: 'Faltou a página 2' }, deps);
    expect(await ler(e.id)).toMatchObject({ motivoRecusa: 'outro', motivoRecusaTexto: 'Faltou a página 2' });
  });

  it('US-162 "Fila": só "recebido", de todos os pacientes, mais antigos primeiro, sem auditoria; contadores; abrir audita e traz as páginas em ordem', async () => {
    const { T, p } = await cenario();
    const p2 = await novoPaciente(app.db, T.ctx, { nome: 'Bruno Lima' });
    const novo = await envioRecebido(app.db, T.ctx, p.id, dataDir, { criadoEm: new Date('2026-10-05T12:00:00Z') });
    const velho = await envioRecebido(app.db, T.ctx, p2.id, dataDir, { criadoEm: new Date('2026-09-20T12:00:00Z'), nome: null });
    await envioNoBanco(app.db, T.ctx, p.id, { status: 'processando' });
    const fila = await filaDeEnvios(T.ctx, app.db);
    expect(fila.map((f) => [f.id, f.paciente, f.nome])).toEqual([[velho.id, 'Bruno Lima', null], [novo.id, 'Ana Souza', 'Hemograma']]);
    expect(await contarEnviosRecebidos(T.ctx, app.db)).toBe(2);
    expect(await contarEnviosDoPaciente(T.ctx, p.id, app.db)).toBe(1);
    const lidas = () => withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.acao, 'ler'), eq(auditLog.entidade, 'exames_enviados'))), app.db);
    expect(await lidas()).toEqual([]);
    const aberto = await abrirEnvio(T.ctx, novo.id, app.db);
    expect(aberto).toMatchObject({ id: novo.id, status: 'recebido', pdf: novo.pdf, paginas: novo.paginas, nome: 'Hemograma', dataColeta: '2026-09-28' });
    expect(aberto?.paciente.id).toBe(p.id);
    expect((await lidas()).map((l) => [l.entidadeId, l.actorUserId])).toEqual([[novo.id, T.nutriId]]);
    const outro = await novoTenant(app.db);
    expect(await abrirEnvio(outro.ctx, novo.id, app.db)).toBeNull();
    expect(await abrirEnvio(T.ctx, 'nao-e-uuid', app.db)).toBeNull();
  });

  it('code review (P12-22 b): fora de "recebido" o envio abre só com a situação — sem PDF, páginas, observação nem auditRead', async () => {
    const { T, p } = await cenario();
    const lidas = () => withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.acao, 'ler'), eq(auditLog.entidade, 'exames_enviados'))), app.db);
    // cada envio com o PDF limpo (onde a situação ainda o aponta) e uma imagem de página que a limpeza ainda não apagou
    const criar = async (status: 'processando' | 'falhou' | 'cancelado' | 'aceito' | 'recusado' | 'expirado' | 'recebido') => {
      const temPdf = status === 'recebido' || status === 'cancelado';
      const pdf = temPdf ? await arquivoDeEnvio(app.db, T.ctx, p.id, 'exame', dataDir) : null;
      const id = await envioNoBanco(app.db, T.ctx, p.id, { status, arquivoPath: pdf, observacao: 'jejum de 12 h', ...(status === 'recusado' ? { motivoRecusa: 'ilegivel' } : {}), ...(status === 'falhou' ? { motivoFalha: 'conversao' } : {}) });
      const pagina = await arquivoDeEnvio(app.db, T.ctx, p.id, 'exame_pagina', dataDir);
      await withTenant(T.ctx, (tx) => tx.insert(examSubmissionFiles).values({ tenantId: T.tenantId, patientId: p.id, submissionId: id, arquivoPath: pagina, papel: 'pagina', ordem: 1 }), app.db);
      return { id, pdf, pagina };
    };
    for (const status of ['processando', 'falhou', 'cancelado', 'aceito', 'recusado', 'expirado'] as const) {
      const e = await criar(status);
      expect(await abrirEnvio(T.ctx, e.id, app.db), status).toMatchObject({ id: e.id, status, pdf: null, paginas: [], observacao: null });
    }
    expect(await lidas()).toEqual([]); // nada do conteúdo saiu: sem "Visualizou"
    const recebido = await criar('recebido');
    expect(await abrirEnvio(T.ctx, recebido.id, app.db)).toMatchObject({ status: 'recebido', pdf: recebido.pdf, paginas: [recebido.pagina], observacao: 'jejum de 12 h' });
    expect((await lidas()).map((l) => l.entidadeId)).toEqual([recebido.id]);
  });

  it('revisão do plano (LGPD art. 16): titular bloqueado sai da fila e dos contadores, e o envio não abre (nem audita)', async () => {
    const { T, p } = await cenario();
    const e = await envioRecebido(app.db, T.ctx, p.id, dataDir);
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado' }).where(eq(patients.id, p.id)), app.db);
    expect((await filaDeEnvios(T.ctx, app.db)).map((f) => f.id)).not.toContain(e.id);
    expect(await contarEnviosRecebidos(T.ctx, app.db)).toBe(0);
    expect(await contarEnviosDoPaciente(T.ctx, p.id, app.db)).toBe(0);
    expect(await abrirEnvio(T.ctx, e.id, app.db)).toBeNull();
  });
});
