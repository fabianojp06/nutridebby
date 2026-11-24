import sharp from 'sharp';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { documentoNoBanco, esperarAtrasDe, novoConsultorio, outroDocumento, tenantLivreEnquantoEsperaODocumento } from '../../../test/documentos';
import { emailsNaFila, novoPaciente } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { exams, tenants, type TenantRow } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { PacienteBloqueadoError } from '@/modules/pacientes/base';
import { criarExame } from '@/modules/pacientes/exames';
import { cancelarDocumento } from './cancelamento';
import { MSG_RETIFICACAO } from './constantes';
import { receberDigitalizada } from './digitalizada';
import { montarPdfDigitalizado } from './digitalizada-job';
import { apagarRascunho, lerDocumento, prepararParaAssinatura, salvarRascunhoParecer, salvarRascunhoReceita } from './documentos';
import { DocumentoError, TransicaoInvalidaError } from './erros';
import type { ConteudoParecer } from './parecer';
import { retificarDocumento } from './retificacao';
import { consultarVerificacao } from './verificacao';

const app = makeDb(inject('appDatabaseUrl'));
const dono = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  await dono.pool.end();
});
/**
 * A nota com a justificativa de um documento já emitido — o estado que o fluxo deixa (a justificativa é gravada no
 * rascunho e congela no preparo, 0105). Fixture pelo dono com os gatilhos desligados só nesta transação.
 */
const notaComJustificativa = (tenantId: string, patientId: string, documentoId: string, j: string) =>
  dono.db.transaction(async (tx) => {
    await tx.execute(sql`set local session_replication_role = replica`);
    await tx.execute(sql`insert into signed_document_notes (tenant_id, patient_id, documento_id, justificativa_uso) values (${tenantId}, ${patientId}, ${documentoId}, ${j})`);
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

  it('Plano 22 (RN-397, DEP-E7): solicitação → "Versão 2" do mesmo tipo, com os exames, a indicação, as orientações e orientacoesFormato; a nota nova sem justificativa', async () => {
    const c = await consultorio();
    const p = await novoPaciente(app.db, c.T.ctx);
    const conteudo = {
      versao: 1, tipo: 'solicitacao_exames', exames: [{ nome: 'Glicose' }, { nome: 'Hemograma completo', painel: true }], indicacaoClinica: 'Acompanhar a resposta à dieta.',
      orientacoes: 'Jejum de **8 h**.\n- traga o pedido', orientacoesFormato: 'marcacao', copia: { profissional: {}, paciente: { nome: 'Ana Souza' } }, declaracao: 'x',
    };
    const v1 = await documentoNoBanco(app.db, c.T.ctx, p.id, { status: 'assinado', tipo: 'solicitacao_exames', conteudo });
    // controle: mesmo com uma justificativa na nota da 1 (que a solicitação nunca grava), a 2 nasce sem — a justificativa é só da receita
    await notaComJustificativa(c.T.tenantId, p.id, v1.id, 'J');
    const v2 = await retificarDocumento(c.T.ctx, p.id, v1.id, { db: app.db });
    const d = (await lerDocumento(c.T.ctx, p.id, v2, app.db))!;
    expect(d).toMatchObject({ tipo: 'solicitacao_exames', status: 'rascunho', versao: 2, retificaId: v1.id, justificativa: null });
    expect(d.conteudo).toEqual({
      versao: 1, tipo: 'solicitacao_exames', exames: [{ nome: 'Glicose' }, { nome: 'Hemograma completo', painel: true }], indicacaoClinica: 'Acompanhar a resposta à dieta.',
      orientacoes: 'Jejum de **8 h**.\n- traga o pedido', orientacoesFormato: 'marcacao',
    });
  });

  it('receita: a justificativa de uso da 1 vai para a nota da "Versão 2" (o parecer, não)', async () => {
    const c = await consultorio();
    const p = await novoPaciente(app.db, c.T.ctx);
    const nota = (id: string) => notaComJustificativa(c.T.tenantId, p.id, id, 'Exposição solar baixa');
    const receita = await documentoNoBanco(app.db, c.T.ctx, p.id, { status: 'assinado' });
    await nota(receita.id);
    const r2 = await retificarDocumento(c.T.ctx, p.id, receita.id, { db: app.db });
    expect((await lerDocumento(c.T.ctx, p.id, r2, app.db))!.justificativa).toBe('Exposição solar baixa');
    const parecer = await documentoNoBanco(app.db, c.T.ctx, p.id, { status: 'assinado', tipo: 'parecer' });
    await nota(parecer.id);
    const p2 = await retificarDocumento(c.T.ctx, p.id, parecer.id, { db: app.db });
    expect((await lerDocumento(c.T.ctx, p.id, p2, app.db))!.justificativa).toBeNull();
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

describe('fotos da versão nova × cancelar/retificar a original (code review do PR #27, P13-16 a)', () => {
  it.each(['cancelar', 'retificar'] as const)('%s a original enquanto as fotos da versão nova entram não fecha ciclo: paciente → original → versão nova → tenant', async (acao) => {
    const c = await consultorio();
    const p = await novoPaciente(app.db, c.T.ctx, { nome: 'Ana Souza' });
    const v1 = await documentoNoBanco(app.db, c.T.ctx, p.id, { status: 'assinado' });
    const v2 = await outroDocumento(c, app.db, { paciente: p, retifica: { id: v1.id, versao: 1 } });
    const foto = await sharp({ create: { width: 800, height: 1100, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
    // H segura a cota do tenant: o envio das fotos para na reserva já com as travas que pega antes dela (antes da correção,
    // a original e a versão nova SEM o paciente — que o INSERT em stored_files pede pela FK, FOR KEY SHARE)
    let segurou!: (pid: number) => void;
    let soltar!: () => void;
    const seguro = new Promise<number>((ok) => (segurou = ok));
    const solto = new Promise<void>((ok) => (soltar = ok));
    const h = withTenant(c.T.ctx, async (tx) => {
      const [{ pid }] = (await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)).rows;
      await tx.execute(sql`select 1 from tenants where id = ${c.T.tenantId} for no key update`);
      segurou(Number(pid));
      await solto;
    }, app.db);
    const pid = await seguro;
    const envio = receberDigitalizada(c.acesso, v2.id, [foto], '123456', { db: app.db, dataDir: c.dataDir, headers: new Headers(), confirmar2fa: async () => 'ok' });
    envio.catch(() => undefined);
    await esperarAtrasDe(app.db, pid, 1);
    // o cancelamento/retificação trava o paciente e depois a original: antes da correção, para na original (presa pelo envio)
    // segurando o paciente; depois, para no paciente (preso pelo envio) sem nada
    const outra = acao === 'cancelar' ? cancelarDocumento(c.T.ctx, p.id, v1.id, 'Erro de digitação.', { db: app.db, appUrl: 'https://x' }) : retificarDocumento(c.T.ctx, p.id, v1.id, { db: app.db });
    outra.catch(() => undefined);
    await esperarAtrasDe(app.db, pid, 2);
    soltar();
    await h;
    const [r1, r2] = await Promise.allSettled([envio, outra]);
    expect(r1).toEqual({ status: 'fulfilled', value: undefined });
    if (acao === 'cancelar') expect(r2.status === 'rejected' && r2.reason instanceof DocumentoError ? r2.reason.erros : r2).toEqual({ geral: MSG_RETIFICACAO.emAndamento(2) });
    else expect(r2).toEqual({ status: 'fulfilled', value: v2.id });
    const linhas = (await withTenant(c.T.ctx, (tx) => tx.execute(sql`select id, status, digitalizacao_status from signed_documents where id in (${v1.id}, ${v2.id}) order by versao`), app.db)).rows;
    expect(linhas).toEqual([
      { id: v1.id, status: 'assinado', digitalizacao_status: null },
      { id: v2.id, status: 'aguardando_assinatura', digitalizacao_status: 'pendente' },
    ]);
  }, 30_000);
});
