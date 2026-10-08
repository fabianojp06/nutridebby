import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { asc, eq, sql } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, emailsNaFila, novoPaciente, novoTenant } from '../../../test/pacientes';
import { arquivoDeEnvio, envioNoBanco, esperarNaTrava, jpegDe, ligarExames, pdfComConteudoAtivo } from '../../../test/exames-enviados';
import { pdfDeTeste } from '../../../test/ia';
import { paginasDoPdf, textoDoPdf } from '../../../test/pdf';
import { closeDb } from '@/db/client';
import { examSubmissionFiles, examSubmissions, exams, patients, storedFiles, tenants, user } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { renderEmail } from '@/email/templates';
import { stopBoss } from '@/jobs/boss';
import { COTA_BYTES, resolverCaminho } from '@/modules/plataforma/armazenamento';
import type { AbrirHeic } from '@/modules/portal/diario-foto-job';
import { enviarExame } from '@/modules/portal/exames-enviados';
import { avisarExamesRecebidos } from './exames-enviados-aviso';
import { MSG_REVISAO } from './exames-enviados-constantes';
import { processarEnvio, renderizarPdfLimpo, type DepsProcessar } from './exames-enviados-job';
import { RasterizacaoError } from './rasterizar-pdf';

const app = makeDb(inject('appDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-envio-job-'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});
const SP = { fuso: 'America/Sao_Paulo' };
const APP_URL = 'https://app.exemplo.com';
const deps = (o: Partial<DepsProcessar> = {}): DepsProcessar => ({ db: app.db, dataDir, appUrl: APP_URL, ultimaTentativa: false, ...o });
/** Passa no detectarTipo como HEIC; os pixels vêm do `abrirHeic` simulado (como no teste do diário). */
const HEIC_FALSO = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.from([0, 0, 0, 0]), Buffer.from('mif1heic'), Buffer.alloc(64)]);
const heicDe = (largura: number, altura: number): AbrirHeic => async () => ({
  width: largura,
  height: altura,
  decode: async () => ({ data: new Uint8ClampedArray(largura * altura * 4).fill(180) }),
});
const emailDaNutri = async (nutriId: string) => (await app.db.select({ email: user.email }).from(user).where(eq(user.id, nutriId)))[0].email;
const arquivo = (caminho: string) => readFileSync(resolverCaminho(dataDir, caminho));

async function enviado(arquivos: Buffer[]) {
  const T = await novoTenant(app.db);
  await ligarExames(app.db, T.tenantId);
  const p = await novoPaciente(app.db, T.ctx);
  const bytes = async () => (await app.db.select({ b: tenants.armazenamentoBytes }).from(tenants).where(eq(tenants.id, T.tenantId)))[0].b;
  const inicial = await bytes();
  const { id } = await enviarExame(ctxPaciente(T.tenantId, p.id), SP, { dataColeta: '2026-09-28', nome: 'Hemograma', observacao: '', arquivos }, { db: app.db, dataDir });
  const ler = async () => (await withTenant(T.ctx, (tx) => tx.select().from(examSubmissions).where(eq(examSubmissions.id, id)), app.db))[0];
  const linhas = () =>
    withTenant(T.ctx, (tx) => tx.select().from(examSubmissionFiles).where(eq(examSubmissionFiles.submissionId, id)).orderBy(asc(examSubmissionFiles.papel), asc(examSubmissionFiles.ordem)), app.db);
  return { T, p, id, dados: { tenantId: T.tenantId, envioId: id }, ler, linhas, bytes, inicial };
}

describe('job exame-envio (RN-163, D23 = a)', () => {
  it('US-160 "Enviar um PDF": cada página rasterizada (JPEG ≤ 2000 px, sem EXIF), PDF limpo do tipo exame, original apagado, "recebido" e e-mail', async () => {
    const e = await enviado([await pdfDeTeste({ paginas: 3, textos: ['Glicose 92 mg/dL', 'Colesterol 180 mg/dL', 'Ferritina 50 ng/mL'] })]);
    const [original] = await e.linhas();
    expect(await processarEnvio(e.dados, deps())).toBe('recebido');
    const envio = await e.ler();
    expect(envio).toMatchObject({ status: 'recebido', motivoFalha: null });
    const pdf = arquivo(envio.arquivoPath!);
    expect(paginasDoPdf(pdf)).toBe(3);
    for (const t of ['Glicose', 'Colesterol', 'Ferritina']) expect(textoDoPdf(pdf)).not.toContain(t);
    const linhas = await e.linhas();
    expect(linhas.map((l) => [l.papel, l.ordem])).toEqual([['pagina', 1], ['pagina', 2], ['pagina', 3]]);
    for (const l of linhas) {
      const m = await sharp(arquivo(l.arquivoPath)).metadata();
      expect(m.format).toBe('jpeg');
      expect(Math.max(m.width!, m.height!)).toBe(2000);
      expect(m.exif).toBeUndefined();
    }
    expect(existsSync(resolverCaminho(dataDir, original.arquivoPath))).toBe(false);
    const [f] = await withTenant(e.T.ctx, (tx) => tx.select().from(storedFiles).where(eq(storedFiles.caminho, envio.arquivoPath!)), app.db);
    expect(f).toMatchObject({ tipo: 'exame', patientId: e.p.id, mime: 'application/pdf' });
    const para = await emailDaNutri(e.T.nutriId);
    expect(await emailsNaFila('exames_recebidos', para)).toEqual([{ tipo: 'exames_recebidos', para, link: `${APP_URL}/painel/exames-recebidos`, pendentesAntigos: false }]);
  }, 120_000);

  it('R-170: PDF com JavaScript, link e anexo → o PDF limpo não tem nada disso, nem o texto do original', async () => {
    const e = await enviado([await pdfComConteudoAtivo()]);
    expect(await processarEnvio(e.dados, deps())).toBe('recebido');
    const pdf = arquivo((await e.ler()).arquivoPath!);
    const bruto = pdf.toString('latin1');
    for (const proibido of ['/JavaScript', '/URI', '/EmbeddedFile', '/OpenAction', '/Annots', 'exemplo.invalid', 'conteudo escondido']) expect(bruto, proibido).not.toContain(proibido);
    expect(textoDoPdf(pdf)).not.toContain('Glicose');
  }, 60_000);

  it('US-160 "Enviar fotos": JPEG girado com EXIF, PNG transparente e HEIC → páginas em pé, sem EXIF, fundo branco, ≤ 2000 px, na ordem', async () => {
    const girada = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: '#335577' } })
      .jpeg()
      .withMetadata({ orientation: 6, exif: { IFD0: { Copyright: 'marca-gps' } } })
      .toBuffer();
    const png = await sharp({ create: { width: 1200, height: 800, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const e = await enviado([girada, png, HEIC_FALSO]);
    expect(await processarEnvio(e.dados, deps({ abrirHeic: heicDe(1500, 2000) }))).toBe('recebido');
    const linhas = await e.linhas();
    const dims = await Promise.all(linhas.map(async (l) => {
      const m = await sharp(arquivo(l.arquivoPath)).metadata();
      return [m.width, m.height, m.exif === undefined];
    }));
    expect(dims).toEqual([[1500, 2000, true], [1200, 800, true], [1500, 2000, true]]);
    const { data } = await sharp(arquivo(linhas[1].arquivoPath)).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(240); // transparente vira branco (não preto)
    for (const l of linhas) expect(arquivo(l.arquivoPath).includes('marca-gps')).toBe(false);
    expect(paginasDoPdf(arquivo((await e.ler()).arquivoPath!))).toBe(3);
  }, 60_000);

  it('US-160 "PDF longo": 11 páginas → "falhou" (paginas); arquivos apagados e a cota volta ao que era antes do envio', async () => {
    const e = await enviado([await pdfDeTeste({ paginas: 11 })]);
    expect(await processarEnvio(e.dados, deps())).toBe('falhou');
    expect(await e.ler()).toMatchObject({ status: 'falhou', motivoFalha: 'paginas', arquivoPath: null });
    expect(await e.linhas()).toEqual([]);
    expect(await e.bytes()).toBe(e.inicial);
  }, 60_000);

  it('US-160 "Falha na conversão": foto que não decodifica e HEIC acima de 40 MP → "falhou" (conversao), tudo apagado', async () => {
    const inteira = await sharp({ create: { width: 800, height: 800, channels: 3, background: '#888888' } }).jpeg().toBuffer();
    const quebrada = await enviado([inteira.subarray(0, Math.floor(inteira.length / 2))]);
    expect(await processarEnvio(quebrada.dados, deps())).toBe('falhou');
    expect(await quebrada.ler()).toMatchObject({ status: 'falhou', motivoFalha: 'conversao' });
    expect(await quebrada.bytes()).toBe(quebrada.inicial);
    const heic = await enviado([HEIC_FALSO]);
    expect(await processarEnvio(heic.dados, deps({ abrirHeic: heicDe(8064, 6048) }))).toBe('falhou'); // iPhone "HEIF Max", 48 MP
    expect(await heic.ler()).toMatchObject({ status: 'falhou', motivoFalha: 'conversao' });
    expect(await heic.linhas()).toEqual([]);
  }, 60_000);

  it('US-160 "Espaço esgotado durante o processamento": "falhou" (cota), arquivos apagados e o espaço do original devolvido', async () => {
    const e = await enviado([await pdfDeTeste({ paginas: 2 })]);
    const [original] = await e.linhas();
    const [sf] = await withTenant(e.T.ctx, (tx) => tx.select({ bytes: storedFiles.bytes }).from(storedFiles).where(eq(storedFiles.caminho, original.arquivoPath)), app.db);
    await app.db.update(tenants).set({ armazenamentoBytes: COTA_BYTES - 100 }).where(eq(tenants.id, e.T.tenantId));
    expect(await processarEnvio(e.dados, deps())).toBe('falhou');
    expect(await e.ler()).toMatchObject({ status: 'falhou', motivoFalha: 'cota' });
    expect(await e.linhas()).toEqual([]);
    expect(await e.bytes()).toBe(COTA_BYTES - 100 - sf.bytes);
  }, 60_000);

  it('idempotente: depois de "recebido" não refaz nada; "recebido" com original que sobrou → só apaga o original', async () => {
    const e = await enviado([await jpegDe(2000)]);
    expect(await processarEnvio(e.dados, deps())).toBe('recebido');
    const depois = await e.linhas();
    const pdf = (await e.ler()).arquivoPath;
    expect(await processarEnvio(e.dados, deps())).toBe('ignorado');
    expect(await e.linhas()).toEqual(depois);
    expect((await e.ler()).arquivoPath).toBe(pdf);
    // a queda entre gravar o PDF limpo e apagar o original deixa o original apontado num envio "recebido"
    const original = await arquivoDeEnvio(app.db, e.T.ctx, e.p.id, 'exame_original', dataDir);
    await withTenant(e.T.ctx, (tx) => tx.insert(examSubmissionFiles).values({ tenantId: e.T.tenantId, patientId: e.p.id, submissionId: e.id, arquivoPath: original, papel: 'original', ordem: 1 }), app.db);
    expect(await processarEnvio(e.dados, deps())).toBe('ignorado');
    expect((await e.linhas()).map((l) => l.papel)).toEqual(['pagina']);
    expect(existsSync(resolverCaminho(dataDir, original))).toBe(false);
  }, 60_000);

  it('D12: a nova tentativa de um envio que caiu depois de gravar páginas refaz as páginas (as antigas saem)', async () => {
    const e = await enviado([await pdfDeTeste({ paginas: 2 })]);
    const velha = await arquivoDeEnvio(app.db, e.T.ctx, e.p.id, 'exame_pagina', dataDir);
    await withTenant(e.T.ctx, (tx) => tx.insert(examSubmissionFiles).values({ tenantId: e.T.tenantId, patientId: e.p.id, submissionId: e.id, arquivoPath: velha, papel: 'pagina', ordem: 1 }), app.db);
    expect(await processarEnvio(e.dados, deps())).toBe('recebido');
    expect(existsSync(resolverCaminho(dataDir, velha))).toBe(false);
    expect((await e.linhas()).filter((l) => l.papel === 'pagina')).toHaveLength(2);
  }, 60_000);

  it('RN-163 / §13.3: titular bloqueado → "ignorado", nada gravado (a exclusão atendida apaga os arquivos)', async () => {
    const e = await enviado([await jpegDe(2000)]);
    await withTenant(e.T.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado' }).where(eq(patients.id, e.p.id)), app.db);
    expect(await processarEnvio(e.dados, deps())).toBe('ignorado');
    expect(await e.ler()).toMatchObject({ status: 'processando', arquivoPath: null });
    expect((await e.linhas()).map((l) => l.papel)).toEqual(['original']);
  });

  it('erro de infraestrutura relança (o pg-boss tenta de novo); na última tentativa, "falhou"; recusa da rasterização falha na hora', async () => {
    const e = await enviado([await pdfDeTeste({ paginas: 1 })]);
    const quebra = async (): Promise<never> => {
      throw new Error('ECONNRESET');
    };
    await expect(processarEnvio(e.dados, deps({ rasterizar: quebra }))).rejects.toThrow('ECONNRESET');
    expect((await e.ler()).status).toBe('processando');
    expect(await processarEnvio(e.dados, deps({ rasterizar: quebra, ultimaTentativa: true }))).toBe('falhou');
    expect(await e.ler()).toMatchObject({ status: 'falhou', motivoFalha: 'conversao' });
    const r = await enviado([await pdfDeTeste({ paginas: 1 })]);
    const recusa = async (): Promise<never> => {
      throw new RasterizacaoError('conversao');
    };
    expect(await processarEnvio(r.dados, deps({ rasterizar: recusa }))).toBe('falhou'); // definitiva: sem nova tentativa
  });

  it('D16 = a: no máximo 1 e-mail a cada 6 h por consultório; com envio aguardando há mais de 30 dias, a frase do lembrete vai junto', async () => {
    const T = await novoTenant(app.db);
    await ligarExames(app.db, T.tenantId);
    const p = await novoPaciente(app.db, T.ctx);
    const para = await emailDaNutri(T.nutriId);
    const agora = new Date();
    const enviarE = async () =>
      (await enviarExame(ctxPaciente(T.tenantId, p.id), SP, { dataColeta: '2026-09-28', nome: '', observacao: '', arquivos: [await jpegDe(2000)] }, { db: app.db, dataDir })).id;
    const processar = async (horas: number) => processarEnvio({ tenantId: T.tenantId, envioId: await enviarE() }, deps({ agora: () => new Date(agora.getTime() + horas * 3600_000) }));
    await processar(0);
    await processar(1);
    expect(await emailsNaFila('exames_recebidos', para)).toHaveLength(1);
    await envioNoBanco(app.db, T.ctx, p.id, { status: 'recebido', createdAt: new Date(agora.getTime() - 31 * 86_400_000) });
    await processar(7);
    expect((await emailsNaFila('exames_recebidos', para)).map((m) => m.pendentesAntigos)).toEqual([false, true]);
  }, 60_000);
});

describe('aviso × escrita auditada do mesmo consultório (revisão do plano, D10)', () => {
  it('o aviso relê o tenant em NO KEY UPDATE: uma escrita auditada que já pegou KEY SHARE e espera devolver cota não fecha ciclo', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    let aReservou!: () => void;
    const reservou = new Promise<void>((ok) => (aReservou = ok));
    // A = a transação do "recebido": a reserva de cota já segura o tenant (NO KEY UPDATE); só depois vem o aviso
    const a = withTenant(
      { tenantId: T.tenantId, role: 'worker' },
      async (tx) => {
        await tx.update(tenants).set({ armazenamentoBytes: sql`${tenants.armazenamentoBytes} + 1` }).where(eq(tenants.id, T.tenantId));
        aReservou();
        await esperarNaTrava(app.db, 'armazenamento_bytes'); // B parou esperando o tenant
        return avisarExamesRecebidos(tx, { tenantId: T.tenantId, agora: new Date(), appUrl: APP_URL });
      },
      app.db,
    );
    // B = molde de apagarArquivo: escrita auditada (KEY SHARE no tenant pela FK do audit_log) e depois a devolução da cota
    const b = (async () => {
      await reservou;
      await withTenant(
        T.ctx,
        async (tx) => {
          await tx.insert(exams).values({ tenantId: T.tenantId, patientId: p.id, data: '2026-09-28', titulo: 'Hemograma' });
          await tx.update(tenants).set({ armazenamentoBytes: sql`${tenants.armazenamentoBytes} - 1` }).where(eq(tenants.id, T.tenantId));
        },
        app.db,
      );
    })();
    await expect(Promise.all([a, b])).resolves.toEqual([true, undefined]); // com FOR UPDATE: 40P01 numa das duas
  }, 30_000);
});

describe('PDF limpo e e-mail (RNF-166)', () => {
  it('renderizarPdfLimpo: uma página por imagem, na ordem, sem metadado do paciente', async () => {
    const j = await sharp({ create: { width: 100, height: 140, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
    const pdf = await renderizarPdfLimpo([j, j]);
    expect(paginasDoPdf(pdf)).toBe(2);
    expect(pdf.toString('latin1')).not.toMatch(/Hemograma|Ana Souza/);
  });

  it('o e-mail "exames recebidos" não leva nome de paciente, nome de exame nem arquivo; a frase dos 30 dias só quando há pendente antigo', () => {
    const sem = renderEmail({ tipo: 'exames_recebidos', para: 'n@x.dev', link: `${APP_URL}/painel/exames-recebidos`, pendentesAntigos: false });
    const com = renderEmail({ tipo: 'exames_recebidos', para: 'n@x.dev', link: `${APP_URL}/painel/exames-recebidos`, pendentesAntigos: true });
    expect(sem.text).toContain(MSG_REVISAO.avisoEmail);
    expect(sem.text).not.toContain(MSG_REVISAO.lembrete30);
    expect(com.text).toContain(MSG_REVISAO.lembrete30);
    expect(sem.subject).toBe('Exames enviados por pacientes');
    for (const proibido of ['Hemograma', 'Ana', '.pdf', '.jpg']) expect(`${sem.subject} ${sem.text} ${com.text}`).not.toContain(proibido);
  });
});
