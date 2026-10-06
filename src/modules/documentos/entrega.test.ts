import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { documentoNoBanco, liberarDocumentos, novoConsultorio, outroDocumento, pdfDeTeste } from '../../../test/documentos';
import { emailsNaFila, novoPaciente, novoTenant } from '../../../test/pacientes';
import { pacienteComConta } from '../../../test/portal';
import { closeDb } from '@/db/client';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { salvarArquivo } from '@/modules/plataforma/armazenamento';
import { entregarDocumento, reenviarLink, situacaoDaEntrega } from './entrega';
import { TransicaoInvalidaError } from './erros';
import { listarDocumentos } from './documentos';
import { assinarLinkDocumento, lerLinkDocumento } from './link-documento';
import { marcarEntreguePessoalmente } from './recebimento';
import { registrarAssinatura } from './registrar-assinatura';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
const entregar = (T: { tenantId: string; ctx: Parameters<typeof withTenant>[0] }, patientId: string, documentoId: string) =>
  withTenant(T.ctx, (tx) => entregarDocumento(tx, { tenantId: T.tenantId, patientId, documentoId, agora: new Date(), appUrl: 'https://nutri.exemplo.com' }), app.db);

describe('entrega (US-145, RN-152, RN-153)', () => {
  it('com conta: push documento_novo e e-mail neutro com o primeiro nome e o link do portal (?v=)', async () => {
    const T = await novoTenant(app.db, 'Consultório Debby');
    await liberarDocumentos(app.db, T.tenantId);
    const { paciente, email } = await pacienteComConta(app.db, T, { nome: 'Ana Souza' });
    const d = await documentoNoBanco(app.db, T.ctx, paciente.id, { status: 'assinado' });
    expect(await entregar(T, paciente.id, d.id)).toBe('portal');
    const [m] = await emailsNaFila('documento_novo', email);
    expect(m).toMatchObject({ nome: 'Ana', consultorio: 'Consultório Debby' });
    expect(m.link).toMatch(/\/p\/documentos\?v=/);
    const n = await withTenant(T.ctx, (tx) => tx.execute(sql`select canal, tipo from notifications where patient_id = ${paciente.id}`), app.db);
    expect(n.rows).toEqual([{ canal: 'push', tipo: 'documento_novo' }]);
  });

  it('sem conta e com e-mail: e-mail com o link de uso único (o token confere com o e-mail atual); arquivado: nada', async () => {
    const T = await novoTenant(app.db);
    await liberarDocumentos(app.db, T.tenantId);
    const p = await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' });
    const d = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    expect(await entregar(T, p.id, d.id)).toBe('link');
    const [m] = await emailsNaFila('documento_link', p.email);
    expect(m).toMatchObject({ nome: 'Bia' });
    const token = m.link.split('/documento/')[1];
    const lido = await lerLinkDocumento(token, new Date(), async () => ({ email: p.email }));
    expect(lido?.ids).toEqual({ tenantId: T.tenantId, patientId: p.id, documentoId: d.id });
    expect(lido?.expirado).toBe(false);
    expect(await lerLinkDocumento(token, new Date(), async () => ({ email: 'outro@ex.com' }))).toBeNull(); // e-mail corrigido → link morto
    const arq = await novoPaciente(app.db, T.ctx, { status: 'arquivado' });
    const d2 = await documentoNoBanco(app.db, T.ctx, arq.id, { status: 'assinado' });
    expect(await entregar(T, arq.id, d2.id)).toBe('nenhuma');
    expect(await emailsNaFila('documento_link', arq.email)).toEqual([]);
  });

  it('R13: interruptor D20 desligado → nenhuma entrega, nenhum e-mail nem push na fila', async () => {
    const T = await novoTenant(app.db); // nasce com documentos_liberados = false
    const { paciente, email } = await pacienteComConta(app.db, T);
    const d = await documentoNoBanco(app.db, T.ctx, paciente.id, { status: 'assinado' });
    expect(await entregar(T, paciente.id, d.id)).toBe('nenhuma');
    expect(await emailsNaFila('documento_novo', email)).toEqual([]);
    const n = await withTenant(T.ctx, (tx) => tx.execute(sql`select 1 from notifications where patient_id = ${paciente.id}`), app.db);
    expect(n.rows).toEqual([]);
  });

  it('"Entregue pessoalmente" conta como recebido, uma vez; a situação na lista segue a D4', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const d = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    let [item] = await listarDocumentos(T.ctx, p.id, app.db);
    expect(situacaoDaEntrega(item, 'America/Sao_Paulo')).toMatch(/^Enviado em \d{2}\/\d{2}\/\d{4} · ainda não aberto$/);
    expect(await marcarEntreguePessoalmente(T.ctx, p.id, d.id, { db: app.db })).toBe(true);
    expect(await marcarEntreguePessoalmente(T.ctx, p.id, d.id, { db: app.db })).toBe(false);
    [item] = await listarDocumentos(T.ctx, p.id, app.db);
    expect(situacaoDaEntrega(item, 'America/Sao_Paulo')).toMatch(/^Entregue pessoalmente em \d{2}\/\d{2}\/\d{4}$/);
  });

  it('a situação da D4: aberto sem recebido; recebido pelo portal ou pelo link', () => {
    const base = { id: randomUUID(), tipo: 'receita' as const, status: 'assinado' as const, codigo: 'X', createdAt: new Date(), assinadoEm: new Date(), assinaturaTipo: 'digitalizada' as const, pdfStatus: null, entregueEm: new Date('2026-10-05T15:00:00Z') };
    const em = new Date('2026-10-06T13:30:00Z');
    expect(situacaoDaEntrega({ ...base, recibos: [{ evento: 'aberto', via: 'link_email', em }] }, 'America/Sao_Paulo')).toBe('Aberto em 06/10/2026 · recebimento não confirmado');
    expect(situacaoDaEntrega({ ...base, recibos: [{ evento: 'aberto', via: 'portal', em }, { evento: 'recebido', via: 'portal', em }] }, 'America/Sao_Paulo')).toBe('Recebido pelo paciente em 06/10/2026 às 10:30');
  });

  it('Minor: entregue_em só quando houve entrega — assinado de paciente arquivado fica sem "Enviado em"', async () => {
    const x = await outroDocumento(await novoConsultorio(app.db), app.db);
    await withTenant(x.T.ctx, (tx) => tx.execute(sql`update patients set status = 'arquivado' where id = ${x.p.id}`), app.db);
    const pdf = pdfDeTeste('assinado');
    const copia = { nomeCompleto: 'Débora Silva Santos', crn: 'CRN-3 12345', email: 'd@x.com', telefone: '(11) 91234-5678', endereco: null, fitoterapia: false };
    await salvarArquivo(x.T.ctx, {
      tipo: 'documento_assinado', conteudo: pdf, permitidos: ['pdf'], patientId: x.p.id, substitui: x.base,
      registrar: (tx, arq) => registrarAssinatura(tx, {
        documentoId: x.id, codigo: x.codigo, patientId: x.p.id, tenantId: x.T.tenantId, caminho: arq.caminho, sha256: createHash('sha256').update(pdf).digest('hex'),
        tipo: 'digitalizada', emissor: null, assinanteNome: null, userId: x.T.nutriId, agora: new Date(), copia, base: x.base,
        versao: { codigo: x.codigo, baseSha256: x.baseSha256 }, appUrl: 'https://x',
      }),
    }, { db: app.db, dataDir: x.dataDir });
    let [item] = await listarDocumentos(x.T.ctx, x.p.id, app.db);
    expect(item).toMatchObject({ status: 'assinado', entregueEm: null });
    expect(situacaoDaEntrega(item, 'America/Sao_Paulo')).toBe('');
    expect(await emailsNaFila('documento_link', x.p.email)).toEqual([]);
    // arquivado: "Reenviar link" não vale; reativado, o reenvio é o primeiro envio (entregue_em sai de nulo)
    await expect(reenviarLink(x.T.ctx, x.p.id, x.id, { db: app.db, appUrl: 'https://x' })).rejects.toBeInstanceOf(TransicaoInvalidaError);
    await withTenant(x.T.ctx, (tx) => tx.execute(sql`update patients set status = 'ativo' where id = ${x.p.id}`), app.db);
    await reenviarLink(x.T.ctx, x.p.id, x.id, { db: app.db, appUrl: 'https://x' });
    [item] = await listarDocumentos(x.T.ctx, x.p.id, app.db);
    expect(situacaoDaEntrega(item, 'America/Sao_Paulo')).toMatch(/^Enviado em \d{2}\/\d{2}\/\d{4} · ainda não aberto$/);
    expect(await emailsNaFila('documento_link', x.p.email)).toHaveLength(1);
  });

  it('"Reenviar link": token novo a cada envio, entregue_em não muda; paciente com conta ou documento fora de "assinado" → TransicaoInvalidaError', async () => {
    const T = await novoTenant(app.db);
    await liberarDocumentos(app.db, T.tenantId);
    const p = await novoPaciente(app.db, T.ctx);
    const d = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    const [antes] = await listarDocumentos(T.ctx, p.id, app.db);
    await reenviarLink(T.ctx, p.id, d.id, { db: app.db, appUrl: 'https://x', agora: new Date(Date.now() + 1000) });
    await reenviarLink(T.ctx, p.id, d.id, { db: app.db, appUrl: 'https://x', agora: new Date(Date.now() + 3000) });
    const ms = await emailsNaFila('documento_link', p.email);
    expect(ms).toHaveLength(2);
    expect(ms[0].link).not.toBe(ms[1].link);
    const [depois] = await listarDocumentos(T.ctx, p.id, app.db);
    expect(depois.entregueEm).toEqual(antes.entregueEm);
    const rascunho = await documentoNoBanco(app.db, T.ctx, p.id);
    await expect(reenviarLink(T.ctx, p.id, rascunho.id, { db: app.db, appUrl: 'https://x' })).rejects.toBeInstanceOf(TransicaoInvalidaError);
    const { paciente: comConta } = await pacienteComConta(app.db, T);
    const d2 = await documentoNoBanco(app.db, T.ctx, comConta.id, { status: 'assinado' });
    await expect(reenviarLink(T.ctx, comConta.id, d2.id, { db: app.db, appUrl: 'https://x' })).rejects.toBeInstanceOf(TransicaoInvalidaError);
  });

  it('assinatura de paciente ativo sem conta: entregue_em gravado e o e-mail com o link na fila (mesma transação)', async () => {
    const x = await outroDocumento(await novoConsultorio(app.db), app.db);
    const pdf = pdfDeTeste('assinado');
    const copia = { nomeCompleto: 'Débora Silva Santos', crn: 'CRN-3 12345', email: 'd@x.com', telefone: '(11) 91234-5678', endereco: null, fitoterapia: false };
    await salvarArquivo(x.T.ctx, {
      tipo: 'documento_assinado', conteudo: pdf, permitidos: ['pdf'], patientId: x.p.id, substitui: x.base,
      registrar: (tx, arq) => registrarAssinatura(tx, {
        documentoId: x.id, codigo: x.codigo, patientId: x.p.id, tenantId: x.T.tenantId, caminho: arq.caminho, sha256: createHash('sha256').update(pdf).digest('hex'),
        tipo: 'digitalizada', emissor: null, assinanteNome: null, userId: x.T.nutriId, agora: new Date(), copia, base: x.base,
        versao: { codigo: x.codigo, baseSha256: x.baseSha256 }, appUrl: 'https://x',
      }),
    }, { db: app.db, dataDir: x.dataDir });
    const [item] = await listarDocumentos(x.T.ctx, x.p.id, app.db);
    expect(item.entregueEm).toBeInstanceOf(Date);
    const [m] = await emailsNaFila('documento_link', x.p.email);
    expect(m.link).toMatch(/^https:\/\/x\/documento\/[A-Za-z0-9_-]{92}$/);
  });

  it('Minor 8: link com e-mail vazio no cadastro → null (nunca 500)', async () => {
    const token = assinarLinkDocumento({ tenantId: randomUUID(), patientId: randomUUID(), documentoId: randomUUID(), emitidoEm: new Date(), email: 'a@b.com' });
    expect(await lerLinkDocumento(token, new Date(), async () => ({ email: '' }))).toBeNull();
  });

  it('link: token adulterado, de outro formato ou vencido (30 dias)', async () => {
    const emitidoEm = new Date('2026-09-01T12:00:00Z');
    const token = assinarLinkDocumento({ tenantId: randomUUID(), patientId: randomUUID(), documentoId: randomUUID(), emitidoEm, email: 'A@B.com ' });
    const carregar = async () => ({ email: 'a@b.com' }); // normalizado: maiúsculas e espaços não mudam o endereço
    expect((await lerLinkDocumento(token, new Date(emitidoEm.getTime() + 29 * 86_400_000), carregar))?.expirado).toBe(false);
    expect((await lerLinkDocumento(token, new Date(emitidoEm.getTime() + 31 * 86_400_000), carregar))?.expirado).toBe(true);
    const adulterado = `${token.slice(0, 10)}${token[10] === 'A' ? 'B' : 'A'}${token.slice(11)}`;
    expect(await lerLinkDocumento(adulterado, new Date(), carregar)).toBeNull();
    for (const t of [undefined, '', 'x'.repeat(91), `${token}A`, token.replace(/.$/, '!')]) expect(await lerLinkDocumento(t, new Date(), carregar)).toBeNull();
  });
});
