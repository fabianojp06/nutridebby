import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novoConsultorio, novoPreparoNoBanco, outroDocumento } from '../../../test/documentos';
import { tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { receberDigitalizada } from './digitalizada';
import { montarPdfDigitalizado, renderizarDigitalizada } from './digitalizada-job';
import { TransicaoInvalidaError } from './erros';
import { registrarAssinatura } from './registrar-assinatura';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await app.pool.end();
});

describe('PDF da digitalizada no worker (RN-157)', () => {
  it('monta um PDF NOVO (sem ação nem anexo), assina como "digitalizada", sem "Assinado por"; apaga as fotos e o base', async () => {
    const x = await outroDocumento(await novoConsultorio(app.db), app.db);
    const foto = await sharp({ create: { width: 800, height: 1100, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
    await receberDigitalizada(x.acesso, x.id, [foto], '123456', { db: app.db, dataDir: x.dataDir, headers: new Headers(), confirmar2fa: async () => 'ok' });
    expect(await montarPdfDigitalizado({ tenantId: x.T.tenantId, documentoId: x.id, userId: x.T.nutriId }, { db: app.db, dataDir: x.dataDir, appUrl: 'https://x', ultimaTentativa: false })).toBe('pronto');
    const [d] = (await withTenant(x.T.ctx, (tx) => tx.execute(sql`select status, assinatura_tipo, assinante_nome, pdf_path, pdf_sha256, digitalizacao, codigo from signed_documents where id = ${x.id}`), app.db)).rows as Record<string, string | null>[];
    expect(d).toMatchObject({ status: 'assinado', assinatura_tipo: 'digitalizada', assinante_nome: null, digitalizacao: null });
    const arquivo = await readFile(path.join(x.dataDir, d.pdf_path!));
    expect(createHash('sha256').update(arquivo).digest('hex')).toBe(d.pdf_sha256);
    // PDF NOVO, sem ação nem anexo (o react-pdf escreve os dicionários em texto); a conferência estrutural, com o leitor
    // limitado, entra no Plano 10B (Tarefa 1)
    for (const chave of ['/OpenAction', '/JavaScript', '/JS ', '/EmbeddedFile', '/Launch', '/AA ']) expect(arquivo.includes(chave), chave).toBe(false);
    const v = (await app.db.execute(sql`select assinatura_tipo, assinante_nome from document_verifications where codigo = ${d.codigo}`)).rows[0];
    expect(v).toEqual({ assinatura_tipo: 'digitalizada', assinante_nome: null });
    const sobra = await withTenant(x.T.ctx, (tx) => tx.execute(sql`select tipo from stored_files where tipo in ('documento_digitalizado', 'documento_base') and patient_id = ${x.p.id}`), app.db);
    expect(sobra.rows).toEqual([]);
  });

  it('a foto do celular com EXIF e GPS sai no PDF sem metadados (normalizada pelo paraJpegSemMetadados, orientação aplicada)', async () => {
    const x = await outroDocumento(await novoConsultorio(app.db), app.db);
    const foto = await sharp({ create: { width: 1100, height: 800, channels: 3, background: '#ffffff' } })
      .jpeg()
      .withExif({ IFD0: { Make: 'CelularTeste', Model: 'Serie-XYZ-123', Orientation: '6' }, IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '23/1 33/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '46/1 38/1 0/1' } })
      .toBuffer();
    expect(foto.includes('Exif')).toBe(true);
    await receberDigitalizada(x.acesso, x.id, [foto], '123456', { db: app.db, dataDir: x.dataDir, headers: new Headers(), confirmar2fa: async () => 'ok' });
    expect(await montarPdfDigitalizado({ tenantId: x.T.tenantId, documentoId: x.id, userId: x.T.nutriId }, { db: app.db, dataDir: x.dataDir, appUrl: 'https://x', ultimaTentativa: false })).toBe('pronto');
    const [d] = (await withTenant(x.T.ctx, (tx) => tx.execute(sql`select pdf_path from signed_documents where id = ${x.id}`), app.db)).rows as { pdf_path: string }[];
    const arquivo = await readFile(path.join(x.dataDir, d.pdf_path));
    for (const marca of ['Exif', 'CelularTeste', 'Serie-XYZ-123']) expect(arquivo.includes(marca), marca).toBe(false); // o bloco APP1 inteiro (com o GPS) some
  });

  it('US-004 / RN-15: consultório suspenso com o job na fila → não assina nem cria a verificação pública; o envio vira "falhou"', async () => {
    const x = await outroDocumento(await novoConsultorio(app.db), app.db);
    const foto = await sharp({ create: { width: 80, height: 110, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
    await receberDigitalizada(x.acesso, x.id, [foto], '123456', { db: app.db, dataDir: x.dataDir, headers: new Headers(), confirmar2fa: async () => 'ok' });
    await app.db.update(tenants).set({ status: 'suspensa' }).where(eq(tenants.id, x.T.tenantId)); // o admin suspende
    expect(await montarPdfDigitalizado({ tenantId: x.T.tenantId, documentoId: x.id, userId: x.T.nutriId }, { db: app.db, dataDir: x.dataDir, appUrl: 'https://x', ultimaTentativa: false })).toBe('ignorado');
    const [d] = (await withTenant({ tenantId: x.T.tenantId, role: 'worker' }, (tx) => tx.execute(sql`select status, digitalizacao_status, pdf_path from signed_documents where id = ${x.id}`), app.db)).rows;
    expect(d).toEqual({ status: 'aguardando_assinatura', digitalizacao_status: 'falhou', pdf_path: null });
    expect((await app.db.execute(sql`select 1 from document_verifications where documento_id = ${x.id}`)).rows).toEqual([]);
  });

  it('versão lida: "Voltar a editar" + novo preparo + envio novo enquanto o job velho monta → o job velho não assina nem marca "falhou" o envio novo', async () => {
    const x = await outroDocumento(await novoConsultorio(app.db), app.db);
    const foto = await sharp({ create: { width: 80, height: 110, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
    const receber = () => receberDigitalizada(x.acesso, x.id, [foto], '123456', { db: app.db, dataDir: x.dataDir, headers: new Headers(), confirmar2fa: async () => 'ok' });
    await receber();
    const r = await montarPdfDigitalizado({ tenantId: x.T.tenantId, documentoId: x.id, userId: x.T.nutriId }, {
      db: app.db, dataDir: x.dataDir, appUrl: 'https://x', ultimaTentativa: false,
      renderizar: async (d) => {
        await novoPreparoNoBanco(x, app.db); // outra aba: outro código, outro base
        await receber(); // e um envio novo, "pendente" na versão nova
        return renderizarDigitalizada(d);
      },
    });
    expect(r).toBe('ignorado');
    const [d] = (await withTenant(x.T.ctx, (tx) => tx.execute(sql`select status, digitalizacao_status, codigo, pdf_path from signed_documents where id = ${x.id}`), app.db)).rows as Record<string, string | null>[];
    expect(d).toMatchObject({ status: 'aguardando_assinatura', digitalizacao_status: 'pendente', pdf_path: null }); // o envio novo continua de pé para o job dele
    expect(d.codigo).not.toBe(x.codigo);
  });

  it('versão lida (code review do PR #19): job das fotos A + envio novo depois de 1 h (fotos B, MESMO código) → não assina com A nem marca "falhou" o B', async () => {
    const x = await outroDocumento(await novoConsultorio(app.db), app.db);
    const foto = () => sharp({ create: { width: 80, height: 110, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
    await receberDigitalizada(x.acesso, x.id, [await foto()], '123456', { db: app.db, dataDir: x.dataDir, headers: new Headers(), confirmar2fa: async () => 'ok' });
    const depois = new Date(Date.now() + 2 * 3_600_000); // o envio A passou do prazo de 1 h (envioEmCurso falso)
    let fotosB: string[] = [];
    const r = await montarPdfDigitalizado({ tenantId: x.T.tenantId, documentoId: x.id, userId: x.T.nutriId }, {
      db: app.db, dataDir: x.dataDir, appUrl: 'https://x', ultimaTentativa: false,
      renderizar: async (d) => {
        await receberDigitalizada(x.acesso, x.id, [await foto(), await foto()], '123456', { db: app.db, dataDir: x.dataDir, headers: new Headers(), confirmar2fa: async () => 'ok', agora: depois });
        fotosB = ((await withTenant(x.T.ctx, (tx) => tx.execute(sql`select digitalizacao from signed_documents where id = ${x.id}`), app.db)).rows[0] as { digitalizacao: string[] }).digitalizacao;
        return renderizarDigitalizada(d);
      },
    });
    expect(r).toBe('ignorado');
    const [d] = (await withTenant(x.T.ctx, (tx) => tx.execute(sql`select status, digitalizacao_status, digitalizacao, codigo, pdf_path from signed_documents where id = ${x.id}`), app.db)).rows as Record<string, unknown>[];
    expect(d).toMatchObject({ status: 'aguardando_assinatura', digitalizacao_status: 'pendente', pdf_path: null, codigo: x.codigo }); // o envio B segue para o job dele
    expect(fotosB).toHaveLength(2);
    expect(d.digitalizacao).toEqual(fotosB);
    expect((await app.db.execute(sql`select 1 from document_verifications where documento_id = ${x.id}`)).rows).toEqual([]);
  });

  it('registrarAssinatura da digitalizada com a versão antiga (outro código) → TransicaoInvalidaError', async () => {
    const x = await outroDocumento(await novoConsultorio(app.db), app.db);
    await receberDigitalizada(x.acesso, x.id, [await sharp({ create: { width: 80, height: 110, channels: 3, background: '#ffffff' } }).jpeg().toBuffer()], '123456', { db: app.db, dataDir: x.dataDir, headers: new Headers(), confirmar2fa: async () => 'ok' });
    const copia = { nomeCompleto: 'Débora Silva Santos', crn: 'CRN-3 12345', email: 'd@x.com', telefone: '(11) 91234-5678', endereco: null, fitoterapia: false };
    await expect(withTenant({ tenantId: x.T.tenantId, role: 'worker' }, (tx) => registrarAssinatura(tx, {
      documentoId: x.id, codigo: 'ZZZZZZZZZZZZ', patientId: x.p.id, tenantId: x.T.tenantId, caminho: x.base, sha256: 'x', tipo: 'digitalizada', emissor: null,
      assinanteNome: null, userId: x.T.nutriId, agora: new Date(), copia, base: x.base, versao: { codigo: 'ZZZZZZZZZZZZ', digitalizacao: [] }, appUrl: 'https://x',
    }), app.db)).rejects.toBeInstanceOf(TransicaoInvalidaError);
  });
});
