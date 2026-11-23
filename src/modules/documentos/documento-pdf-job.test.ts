import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { paginasDoPdf, textoDoPdf } from '../../../test/pdf';
import { codigoAleatorio, tenantLivreEnquantoEsperaODocumento } from '../../../test/documentos';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { COTA_BYTES } from '@/modules/plataforma/armazenamento';
import { AREA_ASSINATURA } from './constantes';
import { renderizarDocumento, type DadosPdfDocumento } from './documento-pdf';
import { expirarPdfsDeDocumentoPendentes, gerarPdfDoDocumento, limparArquivosOrfaosDeDocumentos } from './documento-pdf-job';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

const conteudo = {
  versao: 1, tipo: 'receita', orientacoes: 'Tomar com água.',
  itens: [{ tipo: 'suplemento', categoria: 'nutriente', composicao: [{ nome: 'Vitamina D3', quantidade: 2000, unidade: 'UI' }], forma: 'Cápsula', via: 'oral', posologia: '1 cápsula ao dia', duracao: '', manipulado: false }],
  copia: { profissional: { nomeCompleto: 'Débora Silva Santos', crn: 'CRN-3 12345', email: 'debby@consultorio.com', telefone: '(11) 91234-5678', endereco: null, fitoterapia: false }, paciente: { nome: 'Ana Souza' } },
};

/** O código é UNIQUE no banco inteiro: cada documento do teste ganha um aleatório (um fixo colidiria no 2º emPreparo). */
async function emPreparo() {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx);
  const id = randomUUID();
  const codigo = codigoAleatorio();
  await withTenant(T.ctx, (tx) => tx.execute(sql`insert into signed_documents (id, tenant_id, patient_id, status, codigo, conteudo, declaracao_em, pdf_status, pdf_pedido_em)
    values (${id}, ${T.tenantId}, ${p.id}, 'preparando', ${codigo}, ${JSON.stringify(conteudo)}::jsonb, now(), 'pendente', now())`), app.db);
  return { T, p, id, codigo };
}

/** "Voltar a editar" + novo preparo noutra aba, direto no banco (o caminho que o gatilho aceita): outro código, PDF pendente. */
const novoPreparo = (T: Awaited<ReturnType<typeof emPreparo>>['T'], id: string) =>
  withTenant(T.ctx, async (tx) => {
    await tx.execute(sql`update signed_documents set status = 'rascunho', codigo = null, declaracao_em = null, pdf_status = null, pdf_pedido_em = null where id = ${id}`);
    await tx.execute(sql`update signed_documents set status = 'preparando', codigo = ${codigoAleatorio()}, declaracao_em = now(), pdf_status = 'pendente', pdf_pedido_em = now() where id = ${id}`);
  }, app.db);

describe('PDF preparado (US-143)', () => {
  it('ordem de travas (code review do PR #19, I2): o documento é travado ANTES da cota do tenant, como no soltarArquivosDoPreparo', async () => {
    const { T, id } = await emPreparo();
    const dataDir = await mkdtemp(path.join(tmpdir(), 'docpdf-'));
    const r = await tenantLivreEnquantoEsperaODocumento(app.db, T.ctx, id, () =>
      gerarPdfDoDocumento({ tenantId: T.tenantId, documentoId: id }, { db: app.db, dataDir, appUrl: 'https://x', ultimaTentativa: false }));
    expect(r).toEqual({ tenantLivre: true, resultado: 'pronto' });
  });

  it('gera o PDF com o código, o QR e o quadro; grava SHA-256, bytes e área; leva a "Aguardando assinatura"', async () => {
    const { T, id, codigo } = await emPreparo();
    const dataDir = await mkdtemp(path.join(tmpdir(), 'docpdf-'));
    let recebido: DadosPdfDocumento | undefined;
    const r = await gerarPdfDoDocumento({ tenantId: T.tenantId, documentoId: id }, {
      db: app.db, dataDir, appUrl: 'https://nutri.exemplo.com', ultimaTentativa: false,
      renderizar: async (d) => ((recebido = d), renderizarDocumento(d)),
    });
    expect(r).toBe('pronto');
    expect(recebido).toMatchObject({ codigo, urlVerificacao: `https://nutri.exemplo.com/v/${codigo}` });
    const [d] = (await withTenant(T.ctx, (tx) => tx.execute(sql`select status, pdf_status, base_pdf_path, base_pdf_sha256, base_pdf_bytes, area_assinatura from signed_documents where id = ${id}`), app.db)).rows as Record<string, unknown>[];
    expect(d).toMatchObject({ status: 'aguardando_assinatura', pdf_status: 'pronto', area_assinatura: AREA_ASSINATURA });
    const arquivo = await readFile(path.join(dataDir, String(d.base_pdf_path)));
    expect(createHash('sha256').update(arquivo).digest('hex')).toBe(d.base_pdf_sha256);
    expect(arquivo.length).toBe(d.base_pdf_bytes);
    // a premissa do leitor (uma revisão, xref clássica, nenhum /ObjStm) é conferida no Plano 10B, Tarefa 1, com o leitor de PDF
    expect(arquivo.toString('latin1').match(/%%EOF/g)).toHaveLength(1);
  });

  it('RNF-143: cota esgotada → "sem_cota" (a tela mostra "Espaço de armazenamento esgotado…"), sem nova tentativa', async () => {
    const { T, id } = await emPreparo();
    await app.db.update(tenants).set({ armazenamentoBytes: COTA_BYTES }).where(eq(tenants.id, T.tenantId));
    const dataDir = await mkdtemp(path.join(tmpdir(), 'docpdf-'));
    expect(await gerarPdfDoDocumento({ tenantId: T.tenantId, documentoId: id }, { db: app.db, dataDir, appUrl: 'https://x', ultimaTentativa: false })).toBe('falhou');
    const [d] = (await withTenant(T.ctx, (tx) => tx.execute(sql`select status, pdf_status from signed_documents where id = ${id}`), app.db)).rows;
    expect(d).toEqual({ status: 'preparando', pdf_status: 'sem_cota' });
  });

  it('idempotente; paciente bloqueado → falhou; tenant suspenso → ignorado e falhou', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'docpdf-'));
    // idempotente (R16): a segunda entrega do mesmo job num documento já "Aguardando assinatura" não grava outro base
    const pronto = await emPreparo();
    const job = () => gerarPdfDoDocumento({ tenantId: pronto.T.tenantId, documentoId: pronto.id }, { db: app.db, dataDir, appUrl: 'https://x', ultimaTentativa: false });
    expect(await job()).toBe('pronto');
    const base = async () => (await withTenant(pronto.T.ctx, (tx) => tx.execute(sql`select status, base_pdf_path from signed_documents where id = ${pronto.id}`), app.db)).rows[0];
    const antes = await base();
    expect(antes).toMatchObject({ status: 'aguardando_assinatura' });
    expect(await job()).toBe('ignorado');
    expect(await base()).toEqual(antes);
    const arquivos = await withTenant(pronto.T.ctx, (tx) => tx.execute(sql`select 1 from stored_files where tipo = 'documento_base'`), app.db);
    expect(arquivos.rows).toHaveLength(1);
    const { T, p, id } = await emPreparo();
    await withTenant(T.ctx, (tx) => tx.execute(sql`update patients set status = 'bloqueado' where id = ${p.id}`), app.db);
    expect(await gerarPdfDoDocumento({ tenantId: T.tenantId, documentoId: id }, { db: app.db, dataDir, appUrl: 'https://x', ultimaTentativa: false })).toBe('ignorado');
    const [d] = (await withTenant(T.ctx, (tx) => tx.execute(sql`select pdf_status from signed_documents where id = ${id}`), app.db)).rows;
    expect(d.pdf_status).toBe('falhou');
    const outro = await emPreparo();
    await app.db.update(tenants).set({ status: 'suspensa' }).where(eq(tenants.id, outro.T.tenantId));
    expect(await gerarPdfDoDocumento({ tenantId: outro.T.tenantId, documentoId: outro.id }, { db: app.db, dataDir, appUrl: 'https://x', ultimaTentativa: false })).toBe('ignorado');
  });

  it('versão lida: "Voltar a editar" + novo preparo no meio → o job velho não grava o base na versão nova nem a marca como "falhou"', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'docpdf-'));
    const estado = async (T: Awaited<ReturnType<typeof emPreparo>>['T'], id: string) =>
      (await withTenant(T.ctx, (tx) => tx.execute(sql`select status, pdf_status, codigo, base_pdf_path from signed_documents where id = ${id}`), app.db)).rows[0] as Record<string, unknown>;
    const a = await emPreparo();
    expect(await gerarPdfDoDocumento({ tenantId: a.T.tenantId, documentoId: a.id }, {
      db: app.db, dataDir, appUrl: 'https://x', ultimaTentativa: false,
      renderizar: async (d) => (await novoPreparo(a.T, a.id), renderizarDocumento(d)), // o PDF sai com o código VELHO
    })).toBe('ignorado');
    const da = await estado(a.T, a.id);
    expect(da).toMatchObject({ status: 'preparando', pdf_status: 'pendente', base_pdf_path: null });
    expect(da.codigo).not.toBe(a.codigo);
    const bases = await withTenant(a.T.ctx, (tx) => tx.execute(sql`select 1 from stored_files where tipo = 'documento_base'`), app.db);
    expect(bases.rows).toEqual([]); // o salvarArquivo desfez a reserva e o arquivo
    // a última tentativa do job velho falha DEPOIS do novo preparo: o marcarFalhou não casa com a versão nova
    const b = await emPreparo();
    expect(await gerarPdfDoDocumento({ tenantId: b.T.tenantId, documentoId: b.id }, {
      db: app.db, dataDir, appUrl: 'https://x', ultimaTentativa: true,
      renderizar: async () => {
        await novoPreparo(b.T, b.id);
        throw new Error('falha de render');
      },
    })).toBe('falhou');
    expect(await estado(b.T, b.id)).toMatchObject({ status: 'preparando', pdf_status: 'pendente' });
  });

  it('expira o pendente esquecido (> 1 h) e apaga PDF base sem referência (> 1 h) — varredura só no tenant do teste', async () => {
    const { T, p, id } = await emPreparo();
    const agora = new Date(Date.now() + 2 * 3600_000);
    // { tenantId }: o banco de teste é compartilhado — varrer todos os tenants com o relógio + 2 h mexeria nos outros testes
    expect(await expirarPdfsDeDocumentoPendentes(app.db, agora, { tenantId: T.tenantId })).toBe(1);
    const [d] = (await withTenant(T.ctx, (tx) => tx.execute(sql`select pdf_status from signed_documents where id = ${id}`), app.db)).rows;
    expect(d.pdf_status).toBe('falhou');
    const orfao = `${T.tenantId}/documento_base/${randomUUID()}.pdf`;
    await withTenant(T.ctx, (tx) => tx.execute(sql`insert into stored_files (tenant_id, tipo, caminho, bytes, mime, patient_id, created_at) values (${T.tenantId}, 'documento_base', ${orfao}, 10, 'application/pdf', ${p.id}, now() - interval '2 hours')`), app.db);
    expect(await limparArquivosOrfaosDeDocumentos(app.db, new Date(), '/tmp', { tenantId: T.tenantId })).toBe(1);
    const sobrou = await withTenant(T.ctx, (tx) => tx.execute(sql`select 1 from stored_files where caminho = ${orfao}`), app.db);
    expect(sobrou.rows).toEqual([]);
  });

  it('D24: envio digitalizado "recebendo" esquecido (> 1 h) → falhou; o recente fica', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const aguardando = async (digitalizacaoEm: string) => {
      const id = randomUUID();
      await withTenant(T.ctx, (tx) => tx.execute(sql`insert into signed_documents (id, tenant_id, patient_id, status, codigo, conteudo, declaracao_em, pdf_status, digitalizacao_status, digitalizacao_em)
        values (${id}, ${T.tenantId}, ${p.id}, 'aguardando_assinatura', ${codigoAleatorio()}, ${JSON.stringify(conteudo)}::jsonb, now(), 'pronto', 'recebendo', ${digitalizacaoEm}::timestamptz)`), app.db);
      return id;
    };
    const velho = await aguardando(new Date(Date.now() - 2 * 3600_000).toISOString());
    const recente = await aguardando(new Date().toISOString());
    expect(await expirarPdfsDeDocumentoPendentes(app.db, new Date(), { tenantId: T.tenantId })).toBe(1);
    const st = (await withTenant(T.ctx, (tx) => tx.execute(sql`select id, digitalizacao_status from signed_documents`), app.db)).rows;
    expect(Object.fromEntries(st.map((r) => [r.id, r.digitalizacao_status]))).toEqual({ [velho]: 'falhou', [recente]: 'recebendo' });
  });

  it('regra 9: o PDF base que a assinatura deixou apontado num documento emitido sai pelo soltarArquivosDoPreparo da varredura', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const id = randomUUID();
    const base = `${T.tenantId}/documento_base/${randomUUID()}.pdf`;
    const assinado = `${T.tenantId}/documento_assinado/${randomUUID()}.pdf`;
    await withTenant(T.ctx, async (tx) => {
      await tx.execute(sql`insert into stored_files (tenant_id, tipo, caminho, bytes, mime, patient_id) values (${T.tenantId}, 'documento_base', ${base}, 10, 'application/pdf', ${p.id}), (${T.tenantId}, 'documento_assinado', ${assinado}, 10, 'application/pdf', ${p.id})`);
      await tx.execute(sql`insert into signed_documents (id, tenant_id, patient_id, status, codigo, conteudo, base_pdf_path, pdf_path, pdf_sha256, assinado_em, assinatura_tipo)
        values (${id}, ${T.tenantId}, ${p.id}, 'assinado', ${codigoAleatorio()}, ${JSON.stringify(conteudo)}::jsonb, ${base}, ${assinado}, ${'a'.repeat(64)}, now(), 'digitalizada')`);
    }, app.db);
    expect(await limparArquivosOrfaosDeDocumentos(app.db, new Date(), '/tmp', { tenantId: T.tenantId })).toBe(1);
    const [d] = (await withTenant(T.ctx, (tx) => tx.execute(sql`select status, base_pdf_path, pdf_path from signed_documents where id = ${id}`), app.db)).rows;
    expect(d).toEqual({ status: 'assinado', base_pdf_path: null, pdf_path: assinado });
    const arquivos = (await withTenant(T.ctx, (tx) => tx.execute(sql`select caminho from stored_files`), app.db)).rows;
    expect(arquivos).toEqual([{ caminho: assinado }]);
  });
});

const IA_ID = randomUUID();
const parecer = {
  versao: 1, tipo: 'parecer', avaliacao: 'Marcadores compatíveis com baixa reserva de ferro.', conduta: '', encaminhamentos: 'Sugiro avaliação médica.',
  exames: [
    { id: randomUUID(), data: '2026-09-01', titulo: 'Hemograma', valores: [{ nome: 'Hemoglobina', valor: 13.5, unidade: 'g/dL', referencia: '12 a 16', iaTarefaId: IA_ID }] },
    { id: randomUUID(), data: '2026-08-20', titulo: 'Perfil lipídico', valores: [], enviadoPeloPaciente: true },
  ],
  copia: conteudo.copia,
};

describe('PDF do parecer (US-141, RN-148, D5)', () => {
  it('título, exames com a tabela ou "(laudo no prontuário, sem valores lançados)", avaliação, encaminhamentos e a ressalva; sem conduta vazia, sem a origem da IA (Q13-2 ★)', async () => {
    const pdf = await renderizarDocumento({ conteudo: parecer as never, codigo: 'ABCDEFGHJKMN', urlVerificacao: 'https://x/v/ABCDEFGHJKMN', data: '01/10/2026', cor: '#0f766e', logo: null, nomeConsultorio: 'Consultório Debby' });
    const t = textoDoPdf(pdf);
    for (const trecho of ['Parecer nutricional', 'Paciente: Ana Souza', 'Data de emissão: 01/10/2026', 'Exames considerados', 'Hemograma', '01/09/2026',
      'Hemoglobina · 13,5 · g/dL · 12 a 16', '(laudo no prontuário, sem valores lançados)', 'Avaliação nutricional', 'Marcadores compatíveis com baixa reserva de ferro.',
      'Encaminhamentos', 'Sugiro avaliação médica.', 'Este parecer trata do estado nutricional', 'não constitui diagnóstico de doença',
      'Assinatura digital', 'Código de verificação: ABCD-EFGH-JKMN'])
      expect(t, trecho).toContain(trecho); // trechos curtos: uma linha quebrada pelo react-pdf perde o espaço no textoDoPdf
    expect(t).not.toContain('Conduta e orientações');
    expect(t).not.toContain(IA_ID); // a origem fica só na cópia (Q13-2 ★)
    expect(t).not.toContain('Receita');
  });

  it('versão nova (copia.retificacao): "Versão 2" e o código da versão anterior abaixo do título (Q13-5 ★, NGS1.01.01)', async () => {
    const pdf = await renderizarDocumento({
      conteudo: { ...parecer, copia: { ...conteudo.copia, retificacao: { versao: 2, substitui: 'ABCDEFGHJKMN' } } } as never,
      codigo: 'NMKJHGFEDCBA', urlVerificacao: 'https://x/v/NMKJHGFEDCBA', data: '02/10/2026', cor: '#0f766e', logo: null, nomeConsultorio: 'Consultório Debby',
    });
    const t = textoDoPdf(pdf);
    expect(t).toContain('Versão 2');
    expect(t).toContain('substitui o documento ABCD-EFGH-JKMN');
  });

  it('exame grande (50 linhas longas, MAX_LINHAS de exames.ts) quebra entre páginas sem perder linha nem invadir o rodapé (revisão do plano)', async () => {
    const valores = Array.from({ length: 50 }, (_, i) => ({ nome: `Marcador ${i + 1} ${'x'.repeat(60)}`, valor: i + 1, unidade: 'mg/dL', referencia: `${'y'.repeat(70)} ${i + 1}` }));
    const grande = { ...parecer, exames: [{ id: randomUUID(), data: '2026-09-01', titulo: 'Painel extenso', valores }] };
    const pdf = await renderizarDocumento({ conteudo: grande as never, codigo: 'ABCDEFGHJKMN', urlVerificacao: 'https://x/v/ABCDEFGHJKMN', data: '01/10/2026', cor: '#0f766e', logo: null, nomeConsultorio: 'Consultório Debby' });
    expect(paginasDoPdf(pdf)).toBeGreaterThanOrEqual(2);
    const t = textoDoPdf(pdf);
    expect(t).toContain('Marcador 1 ');
    expect(t).toContain('Marcador 50');
    expect(t).toContain('Código de verificação: ABCD-EFGH-JKMN');
  });

  it('o job gera o PDF do parecer em preparo e leva a "Aguardando assinatura"', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const id = randomUUID();
    await withTenant(T.ctx, (tx) => tx.execute(sql`insert into signed_documents (id, tenant_id, patient_id, tipo, status, codigo, conteudo, declaracao_em, pdf_status, pdf_pedido_em)
      values (${id}, ${T.tenantId}, ${p.id}, 'parecer', 'preparando', ${codigoAleatorio()}, ${JSON.stringify(parecer)}::jsonb, now(), 'pendente', now())`), app.db);
    const dataDir = await mkdtemp(path.join(tmpdir(), 'docpdf-'));
    expect(await gerarPdfDoDocumento({ tenantId: T.tenantId, documentoId: id }, { db: app.db, dataDir, appUrl: 'https://x', ultimaTentativa: false })).toBe('pronto');
    const [d] = (await withTenant(T.ctx, (tx) => tx.execute(sql`select status, base_pdf_path from signed_documents where id = ${id}`), app.db)).rows as { status: string; base_pdf_path: string }[];
    expect(d.status).toBe('aguardando_assinatura');
    expect(textoDoPdf(await readFile(path.join(dataDir, d.base_pdf_path)))).toContain('Parecer nutricional');
  });
});

const dadosFixos = { codigo: 'ABCDEFGHJKMN', urlVerificacao: 'https://x/v/ABCDEFGHJKMN', data: '01/10/2026', cor: '#0f766e', logo: null, nomeConsultorio: 'Consultório Debby' };
const solicitacao = {
  versao: 1, tipo: 'solicitacao_exames', exames: [{ nome: 'Glicose' }, { nome: 'Hemograma completo', painel: true }, { nome: 'Vitamina D (25-OH)' }],
  indicacaoClinica: 'Acompanhar a resposta à dieta.', orientacoes: 'Jejum de 8 horas.', orientacoesFormato: 'marcacao', copia: conteudo.copia,
};

describe('PDF da solicitação de exames (Plano 22, RN-389, EP-D2) e os de hoje intactos (T7)', () => {
  it('título fixo, os exames (o painel com o nome dele), a indicação, as orientações, o carimbo, o código e o QR; sem campo de laboratório', async () => {
    const pdf = await renderizarDocumento({ conteudo: solicitacao as never, ...dadosFixos });
    const t = textoDoPdf(pdf);
    for (const trecho of ['Solicitação de exames laboratoriais', 'Paciente: Ana Souza', 'Data de emissão: 01/10/2026', 'Exames solicitados', '1. Glicose', '2. Hemograma completo',
      '3. Vitamina D (25-OH)', 'Indicação clínica', 'Acompanhar a resposta à dieta.', 'Orientações', 'Jejum de 8 horas.', 'Débora Silva Santos', 'Assinatura digital',
      'Código de verificação: ABCD-EFGH-JKMN'])
      expect(t, trecho).toContain(trecho);
    expect(t).not.toMatch(/Laborat[óo]rio/);
    expect(t).not.toContain('Receita');
    expect(t).not.toContain('Orientações gerais'); // o texto da receita não cai aqui
    expect(pdf.toString('latin1')).toMatch(/\/Subtype\s*\/Image/); // o QR (imagem) no rodapé
  });

  it('indicação clínica só quando preenchida; orientações vazias também somem', async () => {
    const t = textoDoPdf(await renderizarDocumento({ conteudo: { ...solicitacao, indicacaoClinica: null, orientacoes: '' } as never, ...dadosFixos }));
    expect(t).toContain('Glicose');
    expect(t).not.toContain('Indicação clínica');
    expect(t).not.toContain('Orientações');
  });

  it('o job gera o PDF da solicitação em preparo e leva a "Aguardando assinatura"', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const id = randomUUID();
    await withTenant(T.ctx, (tx) => tx.execute(sql`insert into signed_documents (id, tenant_id, patient_id, tipo, status, codigo, conteudo, declaracao_em, pdf_status, pdf_pedido_em)
      values (${id}, ${T.tenantId}, ${p.id}, 'solicitacao_exames', 'preparando', ${codigoAleatorio()}, ${JSON.stringify(solicitacao)}::jsonb, now(), 'pendente', now())`), app.db);
    const dataDir = await mkdtemp(path.join(tmpdir(), 'docpdf-'));
    expect(await gerarPdfDoDocumento({ tenantId: T.tenantId, documentoId: id }, { db: app.db, dataDir, appUrl: 'https://x', ultimaTentativa: false })).toBe('pronto');
    const [d] = (await withTenant(T.ctx, (tx) => tx.execute(sql`select status, base_pdf_path from signed_documents where id = ${id}`), app.db)).rows as { status: string; base_pdf_path: string }[];
    expect(d.status).toBe('aguardando_assinatura');
    expect(textoDoPdf(await readFile(path.join(dataDir, d.base_pdf_path)))).toContain('Solicitação de exames laboratoriais');
  });

  it('a receita e o parecer saem iguais aos de antes da T7 (texto do PDF)', async () => {
    expect(textoDoPdf(await renderizarDocumento({ conteudo: conteudo as never, ...dadosFixos }))).toMatchInlineSnapshot(`
      "Consultório DebbyReceitaPaciente: Ana SouzaData de emissão: 01/10/20261. Vitamina D3 2000 UISuplemento alimentar (Nutriente) · CápsulaVia: OralPosologia: 1 cápsula ao diaOrientações gerais: Tomar com água.Débora Silva Santos · Nutricionista · CRN-3 12345 · debby@consultorio.com · (11) 91234-5678Assinatura digitalCódigo de verificação: ABCD-EFGH-JKMN · Verifique em https://x/v/ABCDEFGHJKMN


      "
    `);
    expect(textoDoPdf(await renderizarDocumento({ conteudo: parecer as never, ...dadosFixos }))).toMatchInlineSnapshot(`
      "Consultório DebbyParecer nutricionalPaciente: Ana SouzaData de emissão: 01/10/2026Exames consideradosHemograma  01/09/2026Marcador · Valor · Unidade · ReferênciaHemoglobina · 13,5 · g/dL · 12 a 16Perfil lipídico  20/08/2026(laudo no prontuário, sem valores lançados)Avaliação nutricionalMarcadores compatíveis com baixa reserva de ferro.EncaminhamentosSugiro avaliação médica.Este parecer trata do estado nutricional e não constitui diagnóstico de doença nem substitui avaliação médica.Débora Silva Santos · Nutricionista · CRN-3 12345 · debby@consultorio.com · (11) 91234-5678Assinatura digitalCódigo de verificação: ABCD-EFGH-JKMN · Verifique em https://x/v/ABCDEFGHJKMN


      "
    `);
  });
});
