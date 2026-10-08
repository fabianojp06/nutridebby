import { readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import { makeDb } from '../../../test/db';
import { documentoNoBanco } from '../../../test/documentos';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { tenants, type TenantRow } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getBoss, stopBoss } from '@/jobs/boss';
import { PacienteBloqueadoError } from '@/modules/pacientes/base';
import { MSG_COTA_ESGOTADA } from '@/modules/plataforma/armazenamento';
import { DIGITALIZACAO_MAX_MS, podeVoltarAEditar } from './constantes';
import { DocumentoError, TransicaoInvalidaError } from './erros';
import { apagarRascunho, contarAguardandoAssinatura, criarReceita, lerDocumento, listarDocumentos, prepararParaAssinatura, RESET_PREPARO, salvarRascunhoReceita, situacaoNoPainel, voltarAEditar, type ItemLista } from './documentos';
import { MSG_PERFIL_PROF, PerfilIncompletoError } from './perfil-profissional';

/** Item 4 do code review do PR #19: a linha do base em stored_files some — o apagar do base não acha o que apagar. */
const semLinhaDoBase = vi.hoisted(() => ({ ligada: false }));
vi.mock('@/modules/plataforma/armazenamento', async (original) => {
  const m = await original<typeof import('@/modules/plataforma/armazenamento')>();
  return { ...m, apagarArquivo: (...[ctx, filtro, deps]: Parameters<typeof m.apagarArquivo>) => m.apagarArquivo(ctx, semLinhaDoBase.ligada ? { id: crypto.randomUUID() } : filtro, deps) };
});

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await app.pool.end();
});

const vitD = { tipo: 'suplemento', categoria: 'nutriente', composicao: [{ nome: 'Vitamina D3', quantidade: '2000', unidade: 'UI' }], forma: 'Cápsula', via: 'oral', posologia: '1 cápsula ao dia, no almoço' };

async function consultorioCompleto() {
  const T = await novoTenant(app.db);
  await app.db.update(tenants).set({ crn: 'CRN-3 12345', nomeProfissional: 'Débora Silva Santos', contatoEmail: 'debby@consultorio.com', contatoTelefoneE164: '+5511912345678', documentosLiberados: true }).where(eq(tenants.id, T.tenantId));
  const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId));
  return { T, tenant: tenant as TenantRow };
}

describe('ciclo do documento (US-142, US-143)', () => {
  it('cria o rascunho, salva itens e a justificativa ("Rascunho salvo."), lista e lê com auditoria', async () => {
    const { T, tenant } = await consultorioCompleto();
    const p = await novoPaciente(app.db, T.ctx);
    const id = await criarReceita(T.ctx, p.id, { db: app.db });
    await salvarRascunhoReceita(T.ctx, tenant, p.id, id, { conteudo: { itens: [vitD], orientacoes: 'Tomar com água.' }, justificativa: 'Exposição solar baixa' }, { db: app.db });
    const lista = await listarDocumentos(T.ctx, p.id, app.db);
    expect(lista).toMatchObject([{ id, status: 'rascunho', tipo: 'receita' }]);
    // D17 / regra 8 do CLAUDE.md: a lista não audita porque não devolve conteúdo — só estas chaves (Plano 13: + versão; nada de itens, orientações ou justificativa)
    expect(Object.keys(lista[0]).sort()).toEqual(['assinadoEm', 'assinaturaTipo', 'codigo', 'createdAt', 'entregueEm', 'id', 'pdfStatus', 'recibos', 'status', 'tipo', 'versao']);
    const d = await lerDocumento(T.ctx, p.id, id, app.db);
    expect(d).toMatchObject({ status: 'rascunho', justificativa: 'Exposição solar baixa', conteudo: { itens: [{ tipo: 'suplemento' }], orientacoes: 'Tomar com água.' } });
    const audit = await withTenant(T.ctx, (tx) => tx.execute(sql`select acao from audit_log where entidade = 'documentos' and acao = 'ler'`), app.db);
    expect(audit.rows.length).toBe(1);
  });

  it('documento de outro paciente do mesmo consultório: null, sem auditoria (o filtro do paciente vai na própria leitura, antes de notas e recibos)', async () => {
    const { T, tenant } = await consultorioCompleto();
    const p = await novoPaciente(app.db, T.ctx);
    const outro = await novoPaciente(app.db, T.ctx);
    const id = await criarReceita(T.ctx, p.id, { db: app.db });
    await salvarRascunhoReceita(T.ctx, tenant, p.id, id, { conteudo: { itens: [vitD] }, justificativa: 'Exposição solar baixa' }, { db: app.db });
    expect(await lerDocumento(T.ctx, outro.id, id, app.db)).toBeNull();
    const audit = await withTenant(T.ctx, (tx) => tx.execute(sql`select 1 from audit_log where entidade = 'documentos' and acao = 'ler'`), app.db);
    expect(audit.rows).toEqual([]);
  });

  it('paciente bloqueado: nada é criado (texto do MVP)', async () => {
    const { T } = await consultorioCompleto();
    const p = await novoPaciente(app.db, T.ctx, { status: 'bloqueado' });
    await expect(criarReceita(T.ctx, p.id, { db: app.db })).rejects.toThrow(PacienteBloqueadoError);
  });

  it('preparar: exige a declaração, o perfil completo e a justificativa; congela a cópia e enfileira o PDF', async () => {
    const { T, tenant } = await consultorioCompleto();
    const p = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
    const id = await criarReceita(T.ctx, p.id, { db: app.db });
    await salvarRascunhoReceita(T.ctx, tenant, p.id, id, { conteudo: { itens: [vitD] }, justificativa: '' }, { db: app.db });
    await expect(prepararParaAssinatura(T.ctx, tenant, p.id, id, { declaracao: undefined }, { db: app.db })).rejects.toSatisfy((e) => e instanceof DocumentoError && e.erros.declaracao === 'Confirme a declaração para continuar.');
    await expect(prepararParaAssinatura(T.ctx, { ...tenant, nomeProfissional: null }, p.id, id, { declaracao: 'on' }, { db: app.db })).rejects.toSatisfy((e) => e instanceof PerfilIncompletoError && e.message === MSG_PERFIL_PROF.incompleto);
    await expect(prepararParaAssinatura(T.ctx, tenant, p.id, id, { declaracao: 'on' }, { db: app.db })).rejects.toSatisfy((e) => e instanceof DocumentoError && !!e.erros.justificativa);
    await salvarRascunhoReceita(T.ctx, tenant, p.id, id, { conteudo: { itens: [vitD] }, justificativa: 'Exposição solar baixa' }, { db: app.db });
    await prepararParaAssinatura(T.ctx, tenant, p.id, id, { declaracao: 'on' }, { db: app.db, agora: new Date('2026-10-05T13:00:00Z') });
    const d = await lerDocumento(T.ctx, p.id, id, app.db);
    expect(d).toMatchObject({ status: 'preparando', pdfStatus: 'pendente', conteudo: { copia: { paciente: { nome: 'Ana Souza' }, profissional: { nomeCompleto: 'Débora Silva Santos', telefone: '(11) 91234-5678' } } } });
    expect(d!.codigo).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
    const jobs = await (await getBoss()).findJobs<{ documentoId: string }>('documento-pdf');
    expect(jobs.some((j) => j.data.documentoId === id)).toBe(true);
    // depois de preparar, salvar o rascunho é recusado (RN-140)
    await expect(salvarRascunhoReceita(T.ctx, tenant, p.id, id, { conteudo: { itens: [vitD] }, justificativa: 'x' }, { db: app.db })).rejects.toThrow(TransicaoInvalidaError);
  });

  it('voltar a editar: o código deixa de existir e o PDF base e as fotos de um envio que falhou saem do disco e da cota, cada um no seu apagar (RN-140 a, regra 9)', async () => {
    const { T, tenant } = await consultorioCompleto();
    const p = await novoPaciente(app.db, T.ctx);
    const id = await criarReceita(T.ctx, p.id, { db: app.db });
    await salvarRascunhoReceita(T.ctx, tenant, p.id, id, { conteudo: { itens: [vitD] }, justificativa: 'J' }, { db: app.db });
    await prepararParaAssinatura(T.ctx, tenant, p.id, id, { declaracao: 'on' }, { db: app.db });
    const base = `${T.tenantId}/documento_base/${crypto.randomUUID()}.pdf`;
    const foto = `${T.tenantId}/documento_digitalizado/${crypto.randomUUID()}.jpg`;
    await withTenant({ tenantId: T.tenantId, role: 'worker' }, async (tx) => {
      await tx.execute(sql`insert into stored_files (tenant_id, tipo, caminho, bytes, mime, patient_id) values (${T.tenantId}, 'documento_base', ${base}, 10, 'application/pdf', ${p.id}), (${T.tenantId}, 'documento_digitalizado', ${foto}, 10, 'image/jpeg', ${p.id})`);
      await tx.execute(sql`update signed_documents set status = 'aguardando_assinatura', pdf_status = 'pronto', base_pdf_path = ${base}, base_pdf_sha256 = ${'b'.repeat(64)}, base_pdf_bytes = 10, area_assinatura = '{"x1":351,"y1":62,"x2":559,"y2":132}' where id = ${id}`);
      await tx.execute(sql`update signed_documents set digitalizacao = ${JSON.stringify([foto])}::jsonb, digitalizacao_status = 'falhou' where id = ${id}`);
    }, app.db);
    await voltarAEditar(T.ctx, p.id, id, { db: app.db, dataDir: '/tmp' });
    const d = await lerDocumento(T.ctx, p.id, id, app.db);
    expect(d).toMatchObject({ status: 'rascunho', codigo: null });
    const sobrou = await withTenant(T.ctx, (tx) => tx.execute(sql`select caminho from stored_files where caminho in (${base}, ${foto})`), app.db);
    expect(sobrou.rows).toEqual([]);
  });

  /** Um documento preparado e em "Aguardando assinatura" com o base em stored_files (como depois do worker). */
  async function aguardando() {
    const { T, tenant } = await consultorioCompleto();
    const p = await novoPaciente(app.db, T.ctx);
    const id = await criarReceita(T.ctx, p.id, { db: app.db });
    await salvarRascunhoReceita(T.ctx, tenant, p.id, id, { conteudo: { itens: [vitD] }, justificativa: 'J' }, { db: app.db });
    await prepararParaAssinatura(T.ctx, tenant, p.id, id, { declaracao: 'on' }, { db: app.db });
    const base = `${T.tenantId}/documento_base/${crypto.randomUUID()}.pdf`;
    await withTenant({ tenantId: T.tenantId, role: 'worker' }, async (tx) => {
      await tx.execute(sql`insert into stored_files (tenant_id, tipo, caminho, bytes, mime, patient_id) values (${T.tenantId}, 'documento_base', ${base}, 10, 'application/pdf', ${p.id})`);
      await tx.execute(sql`update signed_documents set status = 'aguardando_assinatura', pdf_status = 'pronto', base_pdf_path = ${base}, base_pdf_sha256 = ${'b'.repeat(64)}, base_pdf_bytes = 10, area_assinatura = '{"x1":351,"y1":62,"x2":559,"y2":132}' where id = ${id}`);
    }, app.db);
    return { T, tenant, p, id, base };
  }

  it('code review do PR #19 (item 4): voltar a editar com a volta gravada mas sem a linha do base em stored_files → sucesso, não "transição inválida"', async () => {
    const { T, p, id } = await aguardando();
    semLinhaDoBase.ligada = true;
    try {
      await voltarAEditar(T.ctx, p.id, id, { db: app.db, dataDir: '/tmp' });
    } finally {
      semLinhaDoBase.ligada = false;
    }
    expect(await lerDocumento(T.ctx, p.id, id, app.db)).toMatchObject({ status: 'rascunho', codigo: null, basePdfPath: null });
  });

  it('code review do PR #19 (item 9): voltar a editar é recusado com um envio digitalizado em curso; passado 1 h, ou com o PDF falho no preparo, volta', async () => {
    const { T, tenant, p, id } = await aguardando();
    await withTenant(T.ctx, (tx) => tx.execute(sql`update signed_documents set digitalizacao_status = 'pendente', digitalizacao_em = now() where id = ${id}`), app.db);
    await expect(voltarAEditar(T.ctx, p.id, id, { db: app.db, dataDir: '/tmp' })).rejects.toBeInstanceOf(TransicaoInvalidaError);
    expect(await lerDocumento(T.ctx, p.id, id, app.db)).toMatchObject({ status: 'aguardando_assinatura', digitalizacaoStatus: 'pendente' });
    await withTenant(T.ctx, (tx) => tx.execute(sql`update signed_documents set digitalizacao_em = now() - interval '2 hours' where id = ${id}`), app.db); // o envio expirou
    await voltarAEditar(T.ctx, p.id, id, { db: app.db, dataDir: '/tmp' });
    expect(await lerDocumento(T.ctx, p.id, id, app.db)).toMatchObject({ status: 'rascunho' });
    // "Preparando o PDF" com o PDF falho (ou sem cota): o documento não fica preso
    await prepararParaAssinatura(T.ctx, tenant, p.id, id, { declaracao: 'on' }, { db: app.db });
    await withTenant({ tenantId: T.tenantId, role: 'worker' }, (tx) => tx.execute(sql`update signed_documents set pdf_status = 'sem_cota' where id = ${id}`), app.db);
    await voltarAEditar(T.ctx, p.id, id, { db: app.db, dataDir: '/tmp' });
    expect(await lerDocumento(T.ctx, p.id, id, app.db)).toMatchObject({ status: 'rascunho', pdfStatus: null });
  });

  it('item 9: o botão "Voltar a editar" aparece no PDF falho/sem cota e em "Aguardando assinatura" sem envio em curso', () => {
    const agora = new Date();
    const d = (status: string, pdfStatus: string | null, digitalizacaoStatus: string | null = null, ha = 0) =>
      podeVoltarAEditar({ status: status as never, pdfStatus, digitalizacaoStatus, digitalizacaoEm: digitalizacaoStatus ? new Date(agora.getTime() - ha) : null }, agora);
    expect(d('preparando', 'falhou')).toBe(true);
    expect(d('preparando', 'sem_cota')).toBe(true);
    expect(d('preparando', 'pendente')).toBe(false); // "Preparando o PDF…": o worker está nele
    expect(d('aguardando_assinatura', 'pronto')).toBe(true);
    expect(d('aguardando_assinatura', 'pronto', 'falhou')).toBe(true);
    expect(d('aguardando_assinatura', 'pronto', 'recebendo')).toBe(false);
    expect(d('aguardando_assinatura', 'pronto', 'pendente')).toBe(false);
    expect(d('aguardando_assinatura', 'pronto', 'pendente', DIGITALIZACAO_MAX_MS + 1000)).toBe(true); // esquecido além de 1 h
    for (const s of ['rascunho', 'assinado', 'cancelado', 'substituido']) expect(d(s, null)).toBe(false);
  });

  it('item 8: RESET_PREPARO é a lista única do "Voltar a editar" e da anonimização do não emitido', () => {
    expect(Object.keys(RESET_PREPARO).sort()).toEqual(['areaAssinatura', 'basePdfBytes', 'basePdfPath', 'basePdfSha256', 'codigo', 'declaracaoEm', 'digitalizacao', 'digitalizacaoEm', 'digitalizacaoStatus', 'pdfPedidoEm', 'pdfStatus', 'status']);
    expect(Object.entries(RESET_PREPARO).every(([k, v]) => (k === 'status' ? v === 'rascunho' : v === null))).toBe(true);
    const lgpd = readFileSync('src/modules/documentos/lgpd-documentos.ts', 'utf8');
    expect(lgpd).toContain('RESET_PREPARO');
    expect(lgpd).not.toMatch(/basePdfSha256: null/);
  });

  it('apagar: só o rascunho (com a nota em cascata)', async () => {
    const { T, tenant } = await consultorioCompleto();
    const p = await novoPaciente(app.db, T.ctx);
    const id = await criarReceita(T.ctx, p.id, { db: app.db });
    await salvarRascunhoReceita(T.ctx, tenant, p.id, id, { conteudo: { itens: [vitD] }, justificativa: 'J' }, { db: app.db });
    await apagarRascunho(T.ctx, p.id, id, { db: app.db });
    expect(await listarDocumentos(T.ctx, p.id, app.db)).toEqual([]);
  });

  it('P-B8: o cartão do Início conta o que dá para assinar — arquivado conta (D14); bloqueado e anonimizado não (prontuário só para consulta)', async () => {
    const { T } = await consultorioCompleto();
    const ativo = await novoPaciente(app.db, T.ctx);
    const arquivado = await novoPaciente(app.db, T.ctx, { status: 'arquivado' });
    const bloqueado = await novoPaciente(app.db, T.ctx);
    for (const p of [ativo, arquivado, bloqueado]) await documentoNoBanco(app.db, T.ctx, p.id, { status: 'aguardando_assinatura' });
    await withTenant(T.ctx, (tx) => tx.execute(sql`update patients set status = 'bloqueado' where id = ${bloqueado.id}`), app.db);
    expect(await withTenant(T.ctx, (tx) => contarAguardandoAssinatura(tx), app.db)).toBe(2);
  });
});

describe('situacaoNoPainel (linha da situação na lista)', () => {
  const base: ItemLista = { id: 'x', tipo: 'receita', versao: 1, status: 'rascunho', codigo: null, createdAt: new Date('2026-10-01T12:00:00Z'), assinadoEm: null, assinaturaTipo: null, pdfStatus: null, entregueEm: null, recibos: [] };
  it('preparo com falha ou sem cota tem a mensagem própria; assinado mostra data e hora no fuso; o resto, nada', () => {
    const fuso = 'America/Sao_Paulo';
    expect(situacaoNoPainel(base, fuso)).toBe('');
    expect(situacaoNoPainel({ ...base, status: 'preparando', pdfStatus: 'pendente' }, fuso)).toBe('');
    expect(situacaoNoPainel({ ...base, status: 'preparando', pdfStatus: 'falhou' }, fuso)).toBe('Não foi possível gerar o PDF. Tente de novo.');
    expect(situacaoNoPainel({ ...base, status: 'preparando', pdfStatus: 'sem_cota' }, fuso)).toBe(MSG_COTA_ESGOTADA);
    expect(situacaoNoPainel({ ...base, status: 'assinado', assinadoEm: new Date('2026-10-02T01:30:00Z') }, fuso)).toBe('Assinado em 01/10/2026 às 22:30');
  });
});
