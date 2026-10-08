import sharp from 'sharp';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { documentoNoBanco, novoConsultorio, outroDocumento, tenantLivreEnquantoEsperaODocumento } from '../../../test/documentos';
import { emailsNaFila, novoPaciente } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { exams, tenants, type TenantRow } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { PacienteBloqueadoError } from '@/modules/pacientes/base';
import { criarExame } from '@/modules/pacientes/exames';
import { receberDigitalizada } from './digitalizada';
import { montarPdfDigitalizado } from './digitalizada-job';
import { apagarRascunho, lerDocumento, prepararParaAssinatura, salvarRascunhoParecer, salvarRascunhoReceita } from './documentos';
import { DocumentoError, TransicaoInvalidaError } from './erros';
import type { ConteudoParecer } from './parecer';
import { retificarDocumento } from './retificacao';
import { consultarVerificacao } from './verificacao';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
const erroEm = (campo: string, msg: string) => (e: unknown) => e instanceof DocumentoError && e.erros[campo] === msg;
const contar = async (ctx: Parameters<typeof withTenant>[0], original: string) =>
  Number((await withTenant(ctx, (tx) => tx.execute(sql`select count(*)::int as n from signed_documents where retifica_id = ${original}`), app.db)).rows[0].n);

async function consultorio() {
  const c = await novoConsultorio(app.db);
  const [t] = await app.db.select().from(tenants).where(eq(tenants.id, c.T.tenantId));
  return { ...c, tenant: t as TenantRow };
}

describe('retificar (US-148, RN-146, SBIS NGS1.12.01/02)', () => {
  it('receita: abre a "Versão 2" com os itens, as orientações e a justificativa da 1 (sem a cópia do perfil); a 1 continua "Assinado"', async () => {
    const c = await consultorio();
    const p = await novoPaciente(app.db, c.T.ctx);
    const itens = [{ tipo: 'suplemento', categoria: 'nutriente', composicao: [{ nome: 'Vitamina D3', quantidade: 2000, unidade: 'UI' }], forma: 'Cápsula', via: 'oral', posologia: '1 ao dia', duracao: '', manipulado: false }];
    const v1 = await documentoNoBanco(app.db, c.T.ctx, p.id, { status: 'assinado', conteudo: { versao: 1, tipo: 'receita', itens, orientacoes: 'Com água.', copia: { profissional: {}, paciente: { nome: 'Ana Souza' } }, declaracao: 'x' } });
    await withTenant(c.T.ctx, (tx) => tx.execute(sql`insert into signed_document_notes (tenant_id, patient_id, documento_id) values (${c.T.tenantId}, ${p.id}, ${v1.id})`), app.db);
    const v2 = await retificarDocumento(c.T.ctx, p.id, v1.id, { db: app.db });
    const d = (await lerDocumento(c.T.ctx, p.id, v2, app.db))!;
    expect(d).toMatchObject({ tipo: 'receita', status: 'rascunho', versao: 2, retificaId: v1.id, motivoRetificacao: null, conteudo: { tipo: 'receita', itens, orientacoes: 'Com água.' } });
    expect(d.conteudo).not.toHaveProperty('copia');
    expect(d.conteudo).not.toHaveProperty('declaracao');
    expect(d.versoes.anterior).toMatchObject({ id: v1.id, versao: 1, codigo: v1.codigo });
    const original = (await lerDocumento(c.T.ctx, p.id, v1.id, app.db))!;
    expect(original).toMatchObject({ status: 'assinado', versoes: { anterior: null, seguinte: { id: v2, versao: 2, status: 'rascunho' } } });
  });

  it('parecer: copia a seleção e os textos; o primeiro salvar refaz a cópia pelos exames atuais (o caso de uso principal)', async () => {
    const c = await consultorio();
    const p = await novoPaciente(app.db, c.T.ctx);
    const e = await criarExame(c.T.ctx, { fuso: 'America/Sao_Paulo' }, p.id, { titulo: 'Hemograma', data: '2026-09-01', valores: [{ nome: 'Hemoglobina', valor: '13,5', unidade: 'g/dL', referencia: '12 a 16' }], arquivo: null }, { db: app.db, now: new Date('2026-10-01T15:00:00Z') });
    const copia = [{ id: e, data: '2026-09-01', titulo: 'Hemograma', valores: [{ nome: 'Hemoglobina', valor: 13.5, unidade: 'g/dL', referencia: '12 a 16' }] }];
    const v1 = await documentoNoBanco(app.db, c.T.ctx, p.id, { status: 'assinado', tipo: 'parecer', conteudo: { versao: 1, tipo: 'parecer', exames: copia, avaliacao: 'A.', conduta: 'C.', encaminhamentos: 'E.' } });
    await withTenant(c.T.ctx, (tx) => tx.update(exams).set({ valores: sql`valores || '[{"nome":"Ferritina","valor":12,"unidade":"ng/mL","referencia":null}]'::jsonb` }).where(eq(exams.id, e)), app.db);
    const v2 = await retificarDocumento(c.T.ctx, p.id, v1.id, { db: app.db });
    expect((await lerDocumento(c.T.ctx, p.id, v2, app.db))!.conteudo).toMatchObject({ tipo: 'parecer', exames: copia, avaliacao: 'A.', conduta: 'C.', encaminhamentos: 'E.' });
    await salvarRascunhoParecer(c.T.ctx, p.id, v2, { conteudo: { exameIds: [e], avaliacao: 'A.', conduta: 'C.', encaminhamentos: 'E.' }, motivoRetificacao: 'Ferritina lançada depois' }, { db: app.db });
    const d = (await lerDocumento(c.T.ctx, p.id, v2, app.db))!;
    expect((d.conteudo as ConteudoParecer).exames[0].valores.map((v) => v.nome)).toEqual(['Hemoglobina', 'Ferritina']);
    expect(d.motivoRetificacao).toBe('Ferritina lançada depois');
  });

  it('uma por vez: "Retificar" de novo (ou dois cliques ao mesmo tempo) abre a mesma; apagada, nasce outra "Versão 2"', async () => {
    const c = await consultorio();
    const p = await novoPaciente(app.db, c.T.ctx);
    const v1 = await documentoNoBanco(app.db, c.T.ctx, p.id, { status: 'assinado' });
    const [a, b] = await Promise.all([retificarDocumento(c.T.ctx, p.id, v1.id, { db: app.db }), retificarDocumento(c.T.ctx, p.id, v1.id, { db: app.db })]);
    expect(a).toBe(b);
    expect(await retificarDocumento(c.T.ctx, p.id, v1.id, { db: app.db })).toBe(a);
    expect(await contar(c.T.ctx, v1.id)).toBe(1);
    await apagarRascunho(c.T.ctx, p.id, a, { db: app.db });
    const nova = await retificarDocumento(c.T.ctx, p.id, v1.id, { db: app.db });
    expect(nova).not.toBe(a);
    expect((await lerDocumento(c.T.ctx, p.id, nova, app.db))!.versao).toBe(2);
  });

  it('só a versão em vigor: rascunho, substituído e cancelado recusam; paciente bloqueado também (só consulta)', async () => {
    const c = await consultorio();
    const p = await novoPaciente(app.db, c.T.ctx);
    for (const status of ['rascunho', 'cancelado', 'substituido'] as const) {
      const d = await documentoNoBanco(app.db, c.T.ctx, p.id, { status });
      await expect(retificarDocumento(c.T.ctx, p.id, d.id, { db: app.db })).rejects.toBeInstanceOf(TransicaoInvalidaError);
    }
    const b = await novoPaciente(app.db, c.T.ctx, { status: 'bloqueado' });
    const d = await documentoNoBanco(app.db, c.T.ctx, b.id, { status: 'assinado' });
    await expect(retificarDocumento(c.T.ctx, b.id, d.id, { db: app.db })).rejects.toBeInstanceOf(PacienteBloqueadoError);
  });

  it('Q13-1 ★: preparar a versão nova exige o motivo (até 500); o preparo congela "Versão 2 — substitui o documento {código}"', async () => {
    const c = await consultorio();
    const p = await novoPaciente(app.db, c.T.ctx);
    const itens = [{ tipo: 'suplemento', categoria: 'nutriente', composicao: [{ nome: 'Vitamina D3', quantidade: 2000, unidade: 'UI' }], forma: 'Cápsula', via: 'oral', posologia: '1 ao dia' }];
    const v1 = await documentoNoBanco(app.db, c.T.ctx, p.id, { status: 'assinado' });
    const v2 = await retificarDocumento(c.T.ctx, p.id, v1.id, { db: app.db });
    const salvar = (motivo: unknown) => salvarRascunhoReceita(c.T.ctx, c.tenant, p.id, v2, { conteudo: { itens }, justificativa: 'Exposição solar baixa', motivoRetificacao: motivo }, { db: app.db });
    await expect(salvar('x'.repeat(501))).rejects.toSatisfy(erroEm('motivoRetificacao', 'Escreva o motivo da retificação (até 500 caracteres).'));
    await salvar('  ');
    await expect(prepararParaAssinatura(c.T.ctx, c.tenant, p.id, v2, { declaracao: 'on' }, { db: app.db })).rejects.toSatisfy(erroEm('motivoRetificacao', 'Escreva o motivo da retificação (até 500 caracteres).'));
    await salvar('Dose corrigida');
    await prepararParaAssinatura(c.T.ctx, c.tenant, p.id, v2, { declaracao: 'on' }, { db: app.db });
    expect((await lerDocumento(c.T.ctx, p.id, v2, app.db))!.conteudo.copia?.retificacao).toEqual({ versao: 2, substitui: v1.codigo });
  });
});

describe('assinar a versão nova (US-148, RN-146, Q13-3 ★)', () => {
  async function versaoNovaAguardando() {
    const c = await consultorio();
    const p = await novoPaciente(app.db, c.T.ctx, { nome: 'Ana Souza' });
    const v1 = await documentoNoBanco(app.db, c.T.ctx, p.id, { status: 'assinado' });
    await app.db.execute(sql`insert into document_verifications (codigo, tenant_id, documento_id, tipo, assinado_em, emissor_nome, emissor_crn, assinatura_tipo, pdf_sha256)
      values (${v1.codigo}, ${c.T.tenantId}, ${v1.id}, 'receita', now(), 'Débora', 'CRN-3 12345', 'digitalizada', ${'a'.repeat(64)})`);
    const v2 = await outroDocumento(c, app.db, { paciente: p, retifica: { id: v1.id, versao: 1 } });
    const foto = await sharp({ create: { width: 800, height: 1100, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
    await receberDigitalizada(c.acesso, v2.id, [foto], '123456', { db: app.db, dataDir: c.dataDir, headers: new Headers(), confirmar2fa: async () => 'ok' });
    const assinar = () => montarPdfDigitalizado({ tenantId: c.T.tenantId, documentoId: v2.id, userId: c.T.nutriId }, { db: app.db, dataDir: c.dataDir, appUrl: 'https://x', ultimaTentativa: false });
    return { c, p, v1, v2, assinar };
  }

  it('assinada a 2, a 1 vira "Substituído" na mesma transação, também na verificação; a 2 tem o código próprio "válido"; só o e-mail de documento novo', async () => {
    const { c, p, v1, v2, assinar } = await versaoNovaAguardando();
    expect(await assinar()).toBe('pronto');
    const [d1] = (await withTenant(c.T.ctx, (tx) => tx.execute(sql`select status, substituido_em is not null as em from signed_documents where id = ${v1.id}`), app.db)).rows;
    expect(d1).toEqual({ status: 'substituido', em: true });
    expect(await consultarVerificacao(v1.codigo, { db: app.db, ipDoLimite: '192.0.2.131' })).toMatchObject({ tipo: 'ok', v: { situacao: 'substituido' } });
    expect(await consultarVerificacao(v2.codigo, { db: app.db, ipDoLimite: '192.0.2.132' })).toMatchObject({ tipo: 'ok', v: { situacao: 'valido', tipo: 'Receita' } });
    expect(await emailsNaFila('documento_atualizado', p.email)).toEqual([]); // Q13-3 ★: um e-mail só
    expect((await emailsNaFila('documento_link', p.email)).length).toBe(1); // paciente sem conta: o link da versão nova
  });

  it('ordem de travas (D-P1): a assinatura da 2 espera a ORIGINAL (presa por um cancelamento noutra conexão) com a cota do tenant livre', async () => {
    const { c, v1, assinar } = await versaoNovaAguardando();
    const r = await tenantLivreEnquantoEsperaODocumento(app.db, c.T.ctx, v1.id, assinar);
    expect(r).toEqual({ tenantLivre: true, resultado: 'pronto' });
  });
});
