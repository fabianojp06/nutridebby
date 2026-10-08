import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { envioNoBanco } from '../../../test/exames-enviados';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { exams, tenants, type TenantRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { PacienteBloqueadoError } from '@/modules/pacientes/base';
import { criarExame, excluirExame } from '@/modules/pacientes/exames';
import { DECLARACAO_PARECER } from './constantes';
import { criarParecer, criarReceita, lerDocumento, listarDocumentos, prepararParaAssinatura, salvarRascunhoParecer, salvarRascunhoReceita } from './documentos';
import { DocumentoError, TransicaoInvalidaError } from './erros';
import { situacaoDosExames } from './parecer-exames';
import type { ConteudoParecer } from './parecer';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss(); // prepararParaAssinatura enfileira o PDF
  await app.pool.end();
});
const FUSO = { fuso: 'America/Sao_Paulo' };
const erroEm = (campo: string, msg: string) => (e: unknown) => e instanceof DocumentoError && e.erros[campo] === msg;

async function consultorio() {
  const T = await novoTenant(app.db);
  await app.db.update(tenants).set({ crn: 'CRN-3 12345', nomeProfissional: 'Débora Silva Santos', contatoEmail: 'debby@consultorio.com', contatoTelefoneE164: '+5511912345678', documentosLiberados: true }).where(eq(tenants.id, T.tenantId));
  const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId));
  return { T, tenant: tenant as TenantRow };
}
const hemograma = (ctx: TenantContext, patientId: string, valores: unknown[] = [{ nome: 'Hemoglobina', valor: '13,5', unidade: 'g/dL', referencia: '12 a 16' }]) =>
  criarExame(ctx, FUSO, patientId, { titulo: 'Hemograma', data: '2026-09-01', valores, arquivo: null }, { db: app.db, now: new Date('2026-10-01T15:00:00Z') });
const conteudo = async (ctx: TenantContext, patientId: string, id: string) => (await lerDocumento(ctx, patientId, id, app.db))!.conteudo as ConteudoParecer;

describe('parecer nutricional — rascunho (US-141, RN-148)', () => {
  it('"Novo parecer nutricional": rascunho do tipo parecer, versão 1; a lista só com as chaves de ItemLista (sem exames nem avaliação)', async () => {
    const { T } = await consultorio();
    const p = await novoPaciente(app.db, T.ctx);
    const id = await criarParecer(T.ctx, p.id, { db: app.db });
    const lista = await listarDocumentos(T.ctx, p.id, app.db);
    expect(lista).toMatchObject([{ id, tipo: 'parecer', versao: 1, status: 'rascunho' }]);
    expect(Object.keys(lista[0]).sort()).toEqual(['assinadoEm', 'assinaturaTipo', 'codigo', 'createdAt', 'entregueEm', 'id', 'pdfStatus', 'recibos', 'status', 'tipo', 'versao']);
  });

  it('salvar copia os exames escolhidos (id, data, título e linhas, com a origem só na cópia — Q13-2 ★); nada do laudo', async () => {
    const { T } = await consultorio();
    const p = await novoPaciente(app.db, T.ctx);
    const comValores = await hemograma(T.ctx, p.id);
    const soLaudo = await criarExame(T.ctx, FUSO, p.id, { titulo: 'Perfil lipídico', data: '2026-08-20', valores: [], arquivo: null }, { db: app.db, now: new Date('2026-10-01T15:00:00Z') });
    await envioNoBanco(app.db, T.ctx, p.id, { status: 'aceito', examId: soLaudo });
    const ia = randomUUID();
    await withTenant(T.ctx, (tx) => tx.update(exams).set({ valores: sql`valores || ${JSON.stringify([{ nome: 'Ferritina', valor: 12, unidade: 'ng/mL', referencia: null, iaTarefaId: ia }])}::jsonb` }).where(eq(exams.id, comValores)), app.db);
    const id = await criarParecer(T.ctx, p.id, { db: app.db });
    await salvarRascunhoParecer(T.ctx, p.id, id, { conteudo: { exameIds: [comValores, soLaudo], avaliacao: 'Baixa reserva de ferro.' } }, { db: app.db });
    const c = await conteudo(T.ctx, p.id, id);
    expect(c.exames).toEqual([
      { id: comValores, data: '2026-09-01', titulo: 'Hemograma', valores: [
        { nome: 'Hemoglobina', valor: 13.5, unidade: 'g/dL', referencia: '12 a 16' },
        { nome: 'Ferritina', valor: 12, unidade: 'ng/mL', referencia: null, iaTarefaId: ia },
      ] },
      { id: soLaudo, data: '2026-08-20', titulo: 'Perfil lipídico', valores: [], enviadoPeloPaciente: true },
    ]);
    expect(JSON.stringify(c)).not.toContain('arquivo');
  });

  it('a cópia é refeita a cada salvamento (linhas acrescentadas pela IA entram no rascunho)', async () => {
    const { T } = await consultorio();
    const p = await novoPaciente(app.db, T.ctx);
    const e = await hemograma(T.ctx, p.id);
    const id = await criarParecer(T.ctx, p.id, { db: app.db });
    const salvar = () => salvarRascunhoParecer(T.ctx, p.id, id, { conteudo: { exameIds: [e], avaliacao: 'x' } }, { db: app.db });
    await salvar();
    await withTenant(T.ctx, (tx) => tx.update(exams).set({ valores: sql`valores || '[{"nome":"Ferritina","valor":12,"unidade":"ng/mL","referencia":null}]'::jsonb` }).where(eq(exams.id, e)), app.db);
    await salvar();
    expect((await conteudo(T.ctx, p.id, id)).exames[0].valores.map((v) => v.nome)).toEqual(['Hemoglobina', 'Ferritina']);
  });

  it('exame de outro paciente, de outro consultório ou excluído: "Um dos exames selecionados foi excluído. Revise a seleção." e nada gravado', async () => {
    const { T } = await consultorio();
    const p = await novoPaciente(app.db, T.ctx);
    const outro = await novoPaciente(app.db, T.ctx);
    const doOutro = await hemograma(T.ctx, outro.id);
    const B = await consultorio();
    const pb = await novoPaciente(app.db, B.T.ctx);
    const deOutroConsultorio = await hemograma(B.T.ctx, pb.id);
    const id = await criarParecer(T.ctx, p.id, { db: app.db });
    for (const alheio of [doOutro, deOutroConsultorio, randomUUID()])
      await expect(salvarRascunhoParecer(T.ctx, p.id, id, { conteudo: { exameIds: [alheio], avaliacao: 'x' } }, { db: app.db })).rejects.toSatisfy(erroEm('exames', 'Um dos exames selecionados foi excluído. Revise a seleção.'));
    expect((await conteudo(T.ctx, p.id, id)).exames).toEqual([]);
  });

  it('receita e parecer não se misturam: o salvar de um tipo recusa o documento do outro', async () => {
    const { T, tenant } = await consultorio();
    const p = await novoPaciente(app.db, T.ctx);
    const r = await criarReceita(T.ctx, p.id, { db: app.db });
    const pa = await criarParecer(T.ctx, p.id, { db: app.db });
    await expect(salvarRascunhoParecer(T.ctx, p.id, r, { conteudo: {} }, { db: app.db })).rejects.toBeInstanceOf(TransicaoInvalidaError);
    await expect(salvarRascunhoReceita(T.ctx, tenant, p.id, pa, { conteudo: {}, justificativa: '' }, { db: app.db })).rejects.toBeInstanceOf(TransicaoInvalidaError);
  });

  it('paciente bloqueado: "Paciente bloqueado por pedido de exclusão…" (nada é criado)', async () => {
    const { T } = await consultorio();
    const p = await novoPaciente(app.db, T.ctx, { status: 'bloqueado' });
    await expect(criarParecer(T.ctx, p.id, { db: app.db })).rejects.toBeInstanceOf(PacienteBloqueadoError);
  });
});

describe('parecer nutricional — preparar e congelar (US-141, US-143, RN-148, RN-154)', () => {
  it('preparar exige exame e avaliação; congela a cópia com a declaração do parecer; depois disso a situação dos exames aparece', async () => {
    const { T, tenant } = await consultorio();
    const p = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
    const e = await hemograma(T.ctx, p.id);
    const id = await criarParecer(T.ctx, p.id, { db: app.db });
    await expect(prepararParaAssinatura(T.ctx, tenant, p.id, id, { declaracao: 'on' }, { db: app.db })).rejects.toSatisfy(erroEm('exames', 'Selecione ao menos um exame.'));
    await salvarRascunhoParecer(T.ctx, p.id, id, { conteudo: { exameIds: [e], avaliacao: '' } }, { db: app.db });
    await expect(prepararParaAssinatura(T.ctx, tenant, p.id, id, { declaracao: 'on' }, { db: app.db })).rejects.toSatisfy(erroEm('avaliacao', 'Escreva a avaliação nutricional (até 5000 caracteres).'));
    await salvarRascunhoParecer(T.ctx, p.id, id, { conteudo: { exameIds: [e], avaliacao: 'Baixa reserva de ferro.' } }, { db: app.db });
    // a IA acrescenta uma linha entre o salvar e o preparar: a cópia do preparo é a última (RN-148, "por último, ao preparar")
    await withTenant(T.ctx, (tx) => tx.update(exams).set({ valores: sql`valores || '[{"nome":"Ferritina","valor":12,"unidade":"ng/mL","referencia":null}]'::jsonb` }).where(eq(exams.id, e)), app.db);
    await prepararParaAssinatura(T.ctx, tenant, p.id, id, { declaracao: 'on' }, { db: app.db });
    const d = (await lerDocumento(T.ctx, p.id, id, app.db))!;
    const c = d.conteudo as ConteudoParecer;
    expect(d.status).toBe('preparando');
    expect(c.declaracao).toBe(DECLARACAO_PARECER);
    expect(c.copia).toMatchObject({ paciente: { nome: 'Ana Souza' }, profissional: { nomeCompleto: 'Débora Silva Santos' } });
    expect(c.exames[0].valores.map((v) => v.nome)).toEqual(['Hemoglobina', 'Ferritina']);
    expect(await situacaoDosExames(T.ctx, p.id, c.exames, app.db)).toEqual({ [e]: 'igual' });
    // depois do preparo: o exame muda (data trocada pela IA) → "mudou"; a cópia não muda (gatilho)
    await withTenant(T.ctx, (tx) => tx.update(exams).set({ data: '2026-09-02' }).where(eq(exams.id, e)), app.db);
    expect(await situacaoDosExames(T.ctx, p.id, c.exames, app.db)).toEqual({ [e]: 'mudou' });
    expect(((await lerDocumento(T.ctx, p.id, id, app.db))!.conteudo as ConteudoParecer).exames[0].data).toBe('2026-09-01');
    // o exame excluído → "excluido"; o parecer continua com a cópia
    expect(await excluirExame(T.ctx, p.id, e, { db: app.db })).toBe(true);
    expect(await situacaoDosExames(T.ctx, p.id, c.exames, app.db)).toEqual({ [e]: 'excluido' });
  });

  it('situacaoDosExames não grava auditoria nem devolve valores (D-P2); de outro paciente, o exame aparece como excluído', async () => {
    const { T } = await consultorio();
    const p = await novoPaciente(app.db, T.ctx);
    const outro = await novoPaciente(app.db, T.ctx);
    const e = await hemograma(T.ctx, p.id);
    const copia = [{ id: e, data: '2026-09-01', titulo: 'Hemograma', valores: [{ nome: 'Hemoglobina', valor: 13.5, unidade: 'g/dL', referencia: '12 a 16' }] }];
    expect(await situacaoDosExames(T.ctx, outro.id, copia, app.db)).toEqual({ [e]: 'excluido' });
    const audit = await withTenant(T.ctx, (tx) => tx.execute(sql`select 1 from audit_log where acao = 'ler' and entidade = 'exames' and patient_id = ${p.id}`), app.db);
    expect(audit.rows).toEqual([]);
  });
});
