import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { tenants, type TenantRow } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getBoss, stopBoss } from '@/jobs/boss';
import { PacienteBloqueadoError } from '@/modules/pacientes/base';
import { DocumentoError, TransicaoInvalidaError } from './erros';
import { apagarRascunho, criarReceita, lerDocumento, listarDocumentos, prepararParaAssinatura, salvarRascunhoReceita, voltarAEditar } from './documentos';
import { MSG_PERFIL_PROF, PerfilIncompletoError } from './perfil-profissional';

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
    // D17 / regra 8 do CLAUDE.md: a lista não audita porque não devolve conteúdo — só estas chaves (nada de itens, orientações ou justificativa)
    expect(Object.keys(lista[0]).sort()).toEqual(['assinadoEm', 'assinaturaTipo', 'codigo', 'createdAt', 'entregueEm', 'id', 'pdfStatus', 'recibos', 'status', 'tipo']);
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

  it('apagar: só o rascunho (com a nota em cascata)', async () => {
    const { T, tenant } = await consultorioCompleto();
    const p = await novoPaciente(app.db, T.ctx);
    const id = await criarReceita(T.ctx, p.id, { db: app.db });
    await salvarRascunhoReceita(T.ctx, tenant, p.id, id, { conteudo: { itens: [vitD] }, justificativa: 'J' }, { db: app.db });
    await apagarRascunho(T.ctx, p.id, id, { db: app.db });
    expect(await listarDocumentos(T.ctx, p.id, app.db)).toEqual([]);
  });
});
