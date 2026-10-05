import { readFileSync } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novoConsultorio, novoPreparoNoBanco, outroDocumento, pdfDeTeste } from '../../../test/documentos';
import { caminhoAte, grafoDeImports } from '../../../test/grafo-de-imports';
import { signedDocuments } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { salvarArquivo } from '@/modules/plataforma/armazenamento';
import { soltarArquivosDoPreparo } from './arquivos-do-preparo';
import { EMITIDOS } from './constantes';
import { RecusaAssinaturaError, TransicaoInvalidaError } from './erros';
import { exigirHabilitacaoAtual, registrarAssinatura, type VersaoLida } from './registrar-assinatura';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
const COPIA = { nomeCompleto: 'Débora Silva Santos', crn: 'CRN-3 12345', email: 'd@x.com', telefone: '(11) 91234-5678', endereco: null, fitoterapia: false };

/** O que a digitalizada (T9) e o envio do 10B fazem: o PDF final por salvarArquivo, com a transição no registrar. */
async function assinarNoBanco(x: Awaited<ReturnType<typeof outroDocumento>>, versao: VersaoLida, agora = new Date()) {
  const pdf = pdfDeTeste('assinado');
  await salvarArquivo(x.T.ctx, {
    tipo: 'documento_assinado', conteudo: pdf, permitidos: ['pdf'], patientId: x.p.id, substitui: x.base,
    registrar: (tx, arq) => registrarAssinatura(tx, {
      documentoId: x.id, codigo: x.codigo, patientId: x.p.id, tenantId: x.T.tenantId, caminho: arq.caminho, sha256: createHash('sha256').update(pdf).digest('hex'),
      tipo: 'digitalizada', emissor: null, assinanteNome: null, userId: x.T.nutriId, agora, copia: COPIA, base: x.base, versao,
    }),
  }, { db: app.db, dataDir: x.dataDir });
  return pdf;
}

describe('registrarAssinatura (RN-140 b, RN-143, RN-156)', () => {
  it('leva a "assinado" e grava a verificação "valido" com o emissor da cópia, sem "Assinado por"; o base continua apontado até o próprio apagar (regra 9)', async () => {
    const x = await outroDocumento(await novoConsultorio(app.db), app.db);
    const pdf = await assinarNoBanco(x, { codigo: x.codigo, baseSha256: x.baseSha256 });
    const [d] = (await withTenant(x.T.ctx, (tx) => tx.execute(sql`select status, pdf_sha256, base_pdf_path, assinatura_tipo, assinante_nome from signed_documents where id = ${x.id}`), app.db)).rows;
    expect(d).toEqual({ status: 'assinado', pdf_sha256: createHash('sha256').update(pdf).digest('hex'), base_pdf_path: x.base, assinatura_tipo: 'digitalizada', assinante_nome: null });
    const v = (await app.db.execute(sql`select situacao, pdf_sha256, emissor_nome, emissor_crn, assinante_nome from document_verifications where codigo = ${x.codigo}`)).rows[0];
    expect(v).toEqual({ situacao: 'valido', pdf_sha256: d.pdf_sha256, emissor_nome: 'Débora Silva Santos', emissor_crn: 'CRN-3 12345', assinante_nome: null });
  });

  it('regra 9: soltarArquivosDoPreparo apaga o base e as fotos do documento emitido, cada um com o ponteiro no naMesmaTransacao do próprio apagar; antes de emitido, nada sai', async () => {
    const x = await outroDocumento(await novoConsultorio(app.db), app.db);
    const jpeg = await sharp({ create: { width: 80, height: 110, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
    const foto = await salvarArquivo(x.T.ctx, {
      tipo: 'documento_digitalizado', conteudo: jpeg, permitidos: ['jpg'], patientId: x.p.id,
      registrar: async (tx, arq) => {
        await tx.update(signedDocuments).set({ digitalizacao: [arq.caminho], digitalizacaoStatus: 'pendente', digitalizacaoEm: new Date() }).where(eq(signedDocuments.id, x.id));
      },
    }, { db: app.db, dataDir: x.dataDir });
    const soltar = () => soltarArquivosDoPreparo(x.T.ctx, x.id, EMITIDOS, { db: app.db, dataDir: x.dataDir });
    expect(await soltar()).toBe(0); // ainda "aguardando_assinatura": nada sai
    await assinarNoBanco(x, { codigo: x.codigo, digitalizacaoPendente: true });
    expect(await soltar()).toBe(2);
    const [d] = (await withTenant(x.T.ctx, (tx) => tx.execute(sql`select status, base_pdf_path, digitalizacao from signed_documents where id = ${x.id}`), app.db)).rows;
    expect(d).toEqual({ status: 'assinado', base_pdf_path: null, digitalizacao: null });
    const sobra = await withTenant(x.T.ctx, (tx) => tx.execute(sql`select tipo from stored_files where caminho in (${x.base}, ${foto.caminho})`), app.db);
    expect(sobra.rows).toEqual([]);
    for (const c of [x.base, foto.caminho]) await expect(access(path.join(x.dataDir, c))).rejects.toThrow();
    expect(await soltar()).toBe(0); // idempotente
  });

  it('versão lida: "Voltar a editar" + novo preparo no meio → TransicaoInvalidaError e nada muda (nem arquivo, nem verificação)', async () => {
    const x = await outroDocumento(await novoConsultorio(app.db), app.db);
    const lida = { codigo: x.codigo, baseSha256: x.baseSha256 };
    await novoPreparoNoBanco(x, app.db);
    await expect(assinarNoBanco(x, lida)).rejects.toBeInstanceOf(TransicaoInvalidaError);
    const [d] = (await withTenant(x.T.ctx, (tx) => tx.execute(sql`select status, pdf_path from signed_documents where id = ${x.id}`), app.db)).rows;
    expect(d).toEqual({ status: 'aguardando_assinatura', pdf_path: null });
    expect((await app.db.execute(sql`select 1 from document_verifications where documento_id = ${x.id}`)).rows).toEqual([]);
    const assinados = await withTenant(x.T.ctx, (tx) => tx.execute(sql`select 1 from stored_files where tipo = 'documento_assinado' and patient_id = ${x.p.id}`), app.db);
    expect(assinados.rows).toEqual([]); // o salvarArquivo desfez a reserva e o arquivo
  });

  it('a variante da digitalizada exige digitalizacao_status "pendente"; já assinado → TransicaoInvalidaError', async () => {
    const x = await outroDocumento(await novoConsultorio(app.db), app.db);
    await expect(assinarNoBanco(x, { codigo: x.codigo, digitalizacaoPendente: true })).rejects.toBeInstanceOf(TransicaoInvalidaError);
    await assinarNoBanco(x, { codigo: x.codigo, baseSha256: x.baseSha256 });
    await expect(assinarNoBanco(x, { codigo: x.codigo, baseSha256: x.baseSha256 })).rejects.toBeInstanceOf(TransicaoInvalidaError);
  });

  it('Minor 9: fitoterápico formulado com a habilitação retirada depois do preparo → recusa "sem_habilitacao"', () => {
    const fito = { versao: 1, tipo: 'receita', orientacoes: '', itens: [{ tipo: 'fitoterapico', nomenclatura: 'Passiflora incarnata L.', parte: 'Folhas', extracao: 'Extrato seco', formaFarmaceutica: 'Cápsula', dose: '300 mg', via: 'oral', posologia: '1 à noite', nomePopular: '', duracao: '', padronizacao: '' }] } as const;
    expect(() => exigirHabilitacaoAtual({ fitoterapiaRegistro: null }, fito as never)).toThrow(RecusaAssinaturaError);
    expect(() => exigirHabilitacaoAtual({ fitoterapiaRegistro: 'CRN-3 nº 1/2024' }, fito as never)).not.toThrow();
    expect(() => exigirHabilitacaoAtual({ fitoterapiaRegistro: null }, { versao: 1, tipo: 'receita', orientacoes: '', itens: [] })).not.toThrow();
  });

  it('D23: registrar-assinatura.ts não puxa sessão, nem pelos imports dos imports (o worker da digitalizada o importa)', () => {
    const fonte = readFileSync('src/modules/documentos/registrar-assinatura.ts', 'utf8');
    expect(fonte).not.toMatch(/@\/lib\/auth|confirmar-2fa|tenant-session|from 'next\//);
    const g = grafoDeImports(['src/modules/documentos/registrar-assinatura.ts']);
    for (const proibido of ['src/lib/auth.ts', 'src/lib/confirmar-2fa.ts', 'src/lib/tenant-session.ts'])
      expect(g.arquivos.has(proibido), `${proibido} alcançado por: ${caminhoAte(g, proibido).join(' → ')}`).toBe(false);
  });
});
