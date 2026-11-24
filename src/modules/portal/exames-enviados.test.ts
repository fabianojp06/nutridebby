import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { envioNoBanco, envioRecebido, JPEG_MINIMO, jpegDe, jpegQueDeclara, ligarExames } from '../../../test/exames-enviados';
import { PDF_MINIMO, pdfDeTeste } from '../../../test/ia';
import { closeDb } from '@/db/client';
import { auditLog, examSubmissionFiles, examSubmissions, patients, storedFiles, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getBoss, stopBoss } from '@/jobs/boss';
import { MSG_ENVIO } from '@/modules/pacientes/exames-enviados-constantes';
import { COTA_BYTES } from '@/modules/plataforma/armazenamento';
import { cancelarMeuEnvio, classificarArquivos, enviarExame, EnvioError, examesVisiveis, meusEnvios, pdfDoMeuEnvio, temEnvioVisivel } from './exames-enviados';

const app = makeDb(inject('appDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-envio-pac-'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});
const MB = 1024 * 1024;
const SP = { fuso: 'America/Sao_Paulo' };
const AGORA = new Date('2026-10-07T15:00:00Z'); // 12:00 em Brasília
const deps = { db: app.db, dataDir, agora: AGORA };
/** Passa no detectarTipo como HEIC (caixa ftyp); o conteúdo de verdade só o worker decodifica. */
const HEIC_FALSO = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.from([0, 0, 0, 0]), Buffer.from('mif1heic'), Buffer.alloc(64)]);
const erroDe = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof EnvioError) return { status: e.status, erros: e.erros };
    throw e;
  }
  throw new Error('esperava EnvioError');
};
async function cenario(o: { ligado?: boolean; nascimento?: string } = {}) {
  const T = await novoTenant(app.db);
  if (o.ligado !== false) await ligarExames(app.db, T.tenantId);
  const p = await novoPaciente(app.db, T.ctx, o.nascimento ? { dataNascimento: o.nascimento } : {});
  return { T, p, ctx: ctxPaciente(T.tenantId, p.id) };
}
const entrada = (arquivos: Buffer[], extra: Record<string, unknown> = {}) => ({ dataColeta: '2026-09-28', nome: 'Hemograma', observacao: '', arquivos, ...extra });
const envios = (T: Awaited<ReturnType<typeof novoTenant>>, patientId: string) =>
  withTenant(T.ctx, (tx) => tx.select().from(examSubmissions).where(eq(examSubmissions.patientId, patientId)), app.db);
const bytes = async (tenantId: string) => (await app.db.select({ b: tenants.armazenamentoBytes }).from(tenants).where(eq(tenants.id, tenantId)))[0].b;

describe('envio de exame pelo paciente (US-160, US-161, RN-160 a RN-162, RN-166, RN-169)', () => {
  it('US-160 "Enviar um PDF": envio "processando" do paciente, original com dono, linha "original" e o job na mesma transação; auditado', async () => {
    const { T, p, ctx } = await cenario();
    const { id } = await enviarExame(ctx, SP, entrada([await pdfDeTeste({ paginas: 2 })]), deps);
    const [e] = await envios(T, p.id);
    expect(e).toMatchObject({ id, status: 'processando', enviadoPor: ctx.actorUserId, dataColeta: '2026-09-28', nome: 'Hemograma', observacao: null, arquivoPath: null });
    const arquivos = await withTenant(T.ctx, (tx) => tx.select().from(examSubmissionFiles).where(eq(examSubmissionFiles.submissionId, id)), app.db);
    expect(arquivos.map((a) => [a.papel, a.ordem])).toEqual([['original', 1]]);
    const [f] = await withTenant(T.ctx, (tx) => tx.select().from(storedFiles).where(eq(storedFiles.caminho, arquivos[0].arquivoPath)), app.db);
    expect(f).toMatchObject({ tipo: 'exame_original', patientId: p.id, mime: 'application/pdf' });
    const jobs = await (await getBoss()).findJobs('exame-envio');
    expect(jobs.some((j) => (j.data as { envioId: string }).envioId === id)).toBe(true);
    const [a] = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.entidade, 'exames_enviados'), eq(auditLog.entidadeId, id))), app.db);
    expect(a).toMatchObject({ acao: 'criar', actorUserId: ctx.actorUserId });
  });

  it('US-160 "Enviar fotos" (D13 = b): JPEG, PNG e HEIC na ordem das páginas → 3 originais, ordem 1 a 3', async () => {
    const { T, ctx } = await cenario();
    const png = await sharp({ create: { width: 40, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const { id } = await enviarExame(ctx, SP, entrada([await jpegDe(2000), png, HEIC_FALSO]), deps);
    const arquivos = await withTenant(T.ctx, (tx) => tx.select().from(examSubmissionFiles).where(eq(examSubmissionFiles.submissionId, id)).orderBy(examSubmissionFiles.ordem), app.db);
    expect(arquivos.map((a) => [a.ordem, a.arquivoPath.split('.').pop()])).toEqual([[1, 'jpg'], [2, 'png'], [3, 'heic']]);
    expect(await classificarArquivos([await jpegDe(2000)])).toEqual({ tipo: 'fotos' });
    expect(await classificarArquivos([PDF_MINIMO])).toEqual({ tipo: 'pdf' });
  });

  it('US-160 "Arquivo inválido" e "PDF e fotos juntos, ou mais de 5 fotos": a mesma mensagem e nada gravado', async () => {
    const { T, p, ctx } = await cenario();
    const foto = await jpegDe(2000);
    const casos: [string, Buffer[]][] = [
      ['docx (zip)', [Buffer.from('PK\u0003\u0004docx')]],
      ['foto de 15 MB', [await jpegDe(15 * MB)]],
      ['PDF de 25 MB', [Buffer.concat([PDF_MINIMO, Buffer.alloc(25 * MB)])]],
      ['4 fotos de 9 MB', [await jpegDe(9 * MB), await jpegDe(9 * MB), await jpegDe(9 * MB), await jpegDe(9 * MB)]],
      ['JPEG de 50 MP', [await jpegQueDeclara(8000, 6250)]],
      ['PDF e foto', [PDF_MINIMO, foto]],
      ['6 fotos', Array.from({ length: 6 }, () => foto)],
      ['foto que não abre', [JPEG_MINIMO]],
      ['nenhum arquivo', []],
    ];
    for (const [nome, arquivos] of casos) {
      expect(await erroDe(enviarExame(ctx, SP, entrada(arquivos), deps)), nome).toEqual({ status: 400, erros: { arquivos: MSG_ENVIO.arquivos } });
    }
    expect(await envios(T, p.id)).toEqual([]);
  });

  it('US-160 "Data inválida" (ECF.17.05): futura, mais de 10 anos, antes do nascimento, vazia ou impossível', async () => {
    const { ctx } = await cenario({ nascimento: '2020-01-01' });
    const foto = await jpegDe(2000);
    const erros = async (dataColeta: string) => (await erroDe(enviarExame(ctx, SP, entrada([foto], { dataColeta }), deps))).erros;
    expect(await erros('2026-10-08')).toEqual({ dataColeta: MSG_ENVIO.dataFutura });
    expect(await erros('2016-10-06')).toEqual({ dataColeta: MSG_ENVIO.dataConfira });
    expect(await erros('2019-12-31')).toEqual({ dataColeta: MSG_ENVIO.dataConfira }); // antes do nascimento, dentro dos 10 anos
    expect(await erros('')).toEqual({ dataColeta: MSG_ENVIO.dataObrigatoria });
    expect(await erros('2026-02-30')).toEqual({ dataColeta: MSG_ENVIO.dataObrigatoria });
  });

  it('nome ≤ 120 e observação ≤ 500 caracteres (code points, como o CHECK); NUL → formulário inválido; a observação guarda as quebras de linha', async () => {
    const { T, p, ctx } = await cenario();
    const foto = await jpegDe(2000);
    expect((await erroDe(enviarExame(ctx, SP, entrada([foto], { nome: 'x'.repeat(121), observacao: 'y'.repeat(501) }), deps))).erros).toEqual({ nome: MSG_ENVIO.nome, observacao: MSG_ENVIO.observacao });
    expect((await erroDe(enviarExame(ctx, SP, entrada([foto], { nome: 'a\u0000b' }), deps))).erros).toEqual({ geral: MSG_ENVIO.formulario });
    await enviarExame(ctx, SP, entrada([foto], { nome: '🧪'.repeat(120), observacao: '  exame pedido\nna consulta de setembro  ' }), deps);
    const [e] = await envios(T, p.id);
    expect(e).toMatchObject({ nome: '🧪'.repeat(120), observacao: 'exame pedido\nna consulta de setembro' });
  });

  it('US-160 "Limites por paciente" (D14 = a): 10 aguardando; 5 no dia, no fuso do tenant', async () => {
    const foto = await jpegDe(2000);
    const A = await cenario();
    for (let i = 0; i < 10; i++) await envioNoBanco(app.db, A.T.ctx, A.p.id, { status: i % 2 ? 'recebido' : 'processando', createdAt: new Date('2026-09-01T12:00:00Z') });
    expect(await erroDe(enviarExame(A.ctx, SP, entrada([foto]), deps))).toEqual({ status: 409, erros: { geral: MSG_ENVIO.pendentes } });
    const B = await cenario();
    for (let i = 0; i < 4; i++) await envioNoBanco(app.db, B.T.ctx, B.p.id, { status: 'cancelado', createdAt: new Date('2026-10-07T12:00:00Z') });
    await envioNoBanco(app.db, B.T.ctx, B.p.id, { status: 'cancelado', createdAt: new Date('2026-10-07T02:30:00Z') }); // 06/10 23:30 em Brasília
    await enviarExame(B.ctx, SP, entrada([foto]), deps); // o 5º de hoje passa
    expect(await erroDe(enviarExame(B.ctx, SP, entrada([foto]), deps))).toEqual({ status: 409, erros: { geral: MSG_ENVIO.porDia } });
  });

  it('US-160 "Espaço do consultório esgotado": 10 MB livres e 3 fotos de 6 MB → 507 com o texto da spec; nada gravado', async () => {
    const { T, p, ctx } = await cenario();
    await app.db.update(tenants).set({ armazenamentoBytes: COTA_BYTES - 10 * MB }).where(eq(tenants.id, T.tenantId));
    const foto = await jpegDe(6 * MB);
    expect(await erroDe(enviarExame(ctx, SP, entrada([foto, foto, foto]), deps))).toEqual({ status: 507, erros: { geral: MSG_ENVIO.cota } });
    expect(await envios(T, p.id)).toEqual([]);
    expect(await bytes(T.tenantId)).toBe(COTA_BYTES - 10 * MB);
  });

  it('RN-160: recebimento desligado → 404; paciente arquivado → "Conta temporariamente indisponível"', async () => {
    const foto = await jpegDe(2000);
    const desligado = await cenario({ ligado: false });
    expect((await erroDe(enviarExame(desligado.ctx, SP, entrada([foto]), deps))).status).toBe(404);
    const { T, p, ctx } = await cenario();
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'arquivado' }).where(eq(patients.id, p.id)), app.db);
    expect(await erroDe(enviarExame(ctx, SP, entrada([foto]), deps))).toEqual({ status: 409, erros: { geral: MSG_ENVIO.indisponivel } });
  });

  it('US-161 "Lista": só os próprios, sem os cancelados, com o texto da §6.2; download só em "recebido"; a lista é auditada (D22)', async () => {
    const { T, p, ctx } = await cenario();
    const rec = await envioRecebido(app.db, T.ctx, p.id, dataDir, { nome: null });
    const revisao = { revisadoPor: T.nutriId, revisadoEm: new Date() };
    await envioNoBanco(app.db, T.ctx, p.id, { status: 'recusado', motivoRecusa: 'outro', motivoRecusaTexto: 'Faltou a página 2', ...revisao });
    await envioNoBanco(app.db, T.ctx, p.id, { status: 'falhou', motivoFalha: 'paginas' });
    await envioNoBanco(app.db, T.ctx, p.id, { status: 'cancelado' });
    await envioNoBanco(app.db, T.ctx, p.id, { status: 'processando' });
    const outro = await novoPaciente(app.db, T.ctx);
    await envioNoBanco(app.db, T.ctx, outro.id, { status: 'recebido' });
    const lista = await meusEnvios(ctx, { db: app.db });
    expect(lista.map((e) => e.situacao).sort()).toEqual(
      ['Aguardando sua nutricionista', 'Não aceito: Faltou a página 2', 'O PDF tem mais de 10 páginas. Envie só as páginas com os resultados.', 'Processando…'].sort(),
    );
    expect(lista.find((e) => e.id === rec.id)).toMatchObject({ nome: null, status: 'recebido', podeBaixar: true, mostraCancelar: true });
    expect(lista.filter((e) => e.podeBaixar)).toHaveLength(1);
    expect(lista.find((e) => e.status === 'processando')).toMatchObject({ podeBaixar: false, mostraCancelar: true });
    expect(lista.find((e) => e.status === 'recusado')).toMatchObject({ mostraCancelar: false });
    for (const e of lista) expect(Object.keys(e).sort()).toEqual(['dataColeta', 'enviadoEm', 'id', 'mostraCancelar', 'nome', 'podeBaixar', 'situacao', 'status']);
    const lidas = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.acao, 'ler'), eq(auditLog.entidade, 'exames_enviados'), eq(auditLog.patientId, p.id))), app.db);
    expect(lidas).toHaveLength(1);
  });

  it('D17 = a: baixa o próprio PDF limpo só em "recebido" (auditado); aceito, de outro paciente ou id inválido → null', async () => {
    const { T, p, ctx } = await cenario();
    const rec = await envioRecebido(app.db, T.ctx, p.id, dataDir);
    expect(await pdfDoMeuEnvio(ctx, rec.id, app.db)).toBe(rec.pdf);
    const [lida] = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.acao, 'ler'), eq(auditLog.entidadeId, rec.id))), app.db);
    expect(lida).toMatchObject({ entidade: 'exames_enviados', patientId: p.id, actorUserId: ctx.actorUserId });
    const aceito = await envioNoBanco(app.db, T.ctx, p.id, { status: 'aceito', revisadoPor: T.nutriId, revisadoEm: new Date() });
    expect(await pdfDoMeuEnvio(ctx, aceito, app.db)).toBeNull();
    const outro = await novoPaciente(app.db, T.ctx);
    const doOutro = await envioRecebido(app.db, T.ctx, outro.id, dataDir);
    expect(await pdfDoMeuEnvio(ctx, doOutro.id, app.db)).toBeNull();
    expect(await pdfDoMeuEnvio(ctx, 'nao-e-uuid', app.db)).toBeNull();
  });

  it('US-161 "Cancelar": recebido → cancelado + job de limpeza; processando → "Aguarde…"; revisado ou de outro paciente → 404 e nada muda', async () => {
    const { T, p, ctx } = await cenario();
    const rec = await envioRecebido(app.db, T.ctx, p.id, dataDir);
    await cancelarMeuEnvio(ctx, rec.id, { db: app.db });
    expect((await envios(T, p.id)).find((e) => e.id === rec.id)?.status).toBe('cancelado');
    const jobs = await (await getBoss()).findJobs('exame-envio-limpar');
    expect(jobs.some((j) => (j.data as { envioId: string }).envioId === rec.id)).toBe(true);
    const proc = await envioNoBanco(app.db, T.ctx, p.id, { status: 'processando' });
    expect(await erroDe(cancelarMeuEnvio(ctx, proc, { db: app.db }))).toEqual({ status: 409, erros: { geral: MSG_ENVIO.aguarde } });
    const aceito = await envioNoBanco(app.db, T.ctx, p.id, { status: 'aceito', revisadoPor: T.nutriId, revisadoEm: new Date() });
    expect((await erroDe(cancelarMeuEnvio(ctx, aceito, { db: app.db }))).status).toBe(404);
    // US-161 "Isolamento": B não vê, não baixa e não cancela os envios de A
    const outro = await novoPaciente(app.db, T.ctx);
    const doOutro = await envioRecebido(app.db, T.ctx, outro.id, dataDir);
    expect((await erroDe(cancelarMeuEnvio(ctx, doOutro.id, { db: app.db }))).status).toBe(404);
    expect((await meusEnvios(ctx, { db: app.db })).map((e) => e.id)).not.toContain(doOutro.id);
    expect((await envios(T, outro.id))[0].status).toBe('recebido');
  });

  it('US-161 "Cancelar" com a tela ainda em "Processando…" (soConferir): nunca cancela; processando → "Aguarde…"; recebido fica recebido, sem job', async () => {
    const { T, p, ctx } = await cenario();
    const rec = await envioRecebido(app.db, T.ctx, p.id, dataDir);
    await cancelarMeuEnvio(ctx, rec.id, { db: app.db, soConferir: true });
    expect((await envios(T, p.id)).find((e) => e.id === rec.id)?.status).toBe('recebido');
    const jobs = await (await getBoss()).findJobs('exame-envio-limpar');
    expect(jobs.some((j) => (j.data as { envioId: string }).envioId === rec.id)).toBe(false);
    const proc = await envioNoBanco(app.db, T.ctx, p.id, { status: 'processando' });
    expect(await erroDe(cancelarMeuEnvio(ctx, proc, { db: app.db, soConferir: true }))).toEqual({ status: 409, erros: { geral: MSG_ENVIO.aguarde } });
    const aceito = await envioNoBanco(app.db, T.ctx, p.id, { status: 'aceito', revisadoPor: T.nutriId, revisadoEm: new Date() });
    expect((await erroDe(cancelarMeuEnvio(ctx, aceito, { db: app.db, soConferir: true }))).status).toBe(404);
    const outro = await novoPaciente(app.db, T.ctx);
    const doOutro = await envioRecebido(app.db, T.ctx, outro.id, dataDir);
    expect((await erroDe(cancelarMeuEnvio(ctx, doOutro.id, { db: app.db, soConferir: true }))).status).toBe(404);
  });
});

describe('temEnvioVisivel (Plano 16, RN-192)', () => {
  it('false sem envio ou só com cancelado; true com qualquer outro; nunca enxerga o envio de outro paciente', async () => {
    const T = await novoTenant(app.db);
    const [p, outro] = [await novoPaciente(app.db, T.ctx), await novoPaciente(app.db, T.ctx)];
    const ctx = ctxPaciente(T.tenantId, p.id);
    expect(await temEnvioVisivel(ctx, app.db)).toBe(false);
    await envioNoBanco(app.db, T.ctx, outro.id, { status: 'recebido' });
    expect(await temEnvioVisivel(ctx, app.db)).toBe(false);
    await envioNoBanco(app.db, T.ctx, p.id, { status: 'cancelado' });
    expect(await temEnvioVisivel(ctx, app.db)).toBe(false);
    await envioNoBanco(app.db, T.ctx, p.id, { status: 'recusado', motivoRecusa: 'ilegivel', revisadoPor: T.nutriId });
    expect(await temEnvioVisivel(ctx, app.db)).toBe(true);
  });

  it('só em sessão de paciente', async () => {
    const T = await novoTenant(app.db);
    await expect(temEnvioVisivel(T.ctx, app.db)).rejects.toThrow(/sessão de paciente/);
  });
});

describe('examesVisiveis (Plano 16, RN-192; Plano 22, RN-386, EP-D23)', () => {
  const ligado = { examesPacienteAtivadoEm: new Date() };
  const desligado = { examesPacienteAtivadoEm: null };
  const sim = () => Promise.resolve(true);
  const nao = () => Promise.resolve(false);
  const proibido = () => Promise.reject(new Error('não devia consultar'));

  it('as quatro combinações: recebimento ligado; desligado com envio; desligado sem envio com exame liberado; desligado sem nada → false', async () => {
    expect(await examesVisiveis(ligado, proibido, proibido)).toBe(true);
    expect(await examesVisiveis(desligado, sim, proibido)).toBe(true);
    expect(await examesVisiveis(desligado, nao, sim)).toBe(true);
    expect(await examesVisiveis(desligado, nao, nao)).toBe(false);
  });

  it('`temLiberado` é o último termo: não é chamado quando o recebimento ou o envio já deram true; o envio antes do liberado', async () => {
    const chamadas: string[] = [];
    const anota = (nome: string, r: boolean) => () => (chamadas.push(nome), Promise.resolve(r));
    await examesVisiveis(ligado, anota('envio', true), anota('liberado', true));
    expect(chamadas).toEqual([]);
    await examesVisiveis(desligado, anota('envio', true), anota('liberado', true));
    expect(chamadas).toEqual(['envio']);
    chamadas.length = 0;
    await examesVisiveis(desligado, anota('envio', false), anota('liberado', true));
    expect(chamadas).toEqual(['envio', 'liberado']);
  });
});
