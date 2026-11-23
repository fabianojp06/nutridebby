import sharp from 'sharp';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { documentoNoBanco, novoConsultorio, outroDocumento } from '../../../test/documentos';
import { novoPaciente } from '../../../test/pacientes';
import { tenants, type TenantRow } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { DECLARACAO_RECEITA, declaracaoDoDocumento, FRASE_FORMULA_FITOTERAPICA } from './constantes';
import { receberDigitalizada } from './digitalizada';
import { criarReceita, lerDocumento, prepararParaAssinatura, salvarRascunhoReceita } from './documentos';
import { DocumentoError, RecusaAssinaturaError } from './erros';
import { TERMO_FITOTERAPIA } from './perfil-profissional';
import { MSG_PRESCRICAO, type ConteudoReceita } from './prescricao';
import { retificarDocumento } from './retificacao';

// Plano 22 (T9, US-378, RN-392, Review Focus 4): a fórmula magistral fitoterápica pelo módulo de documentos — a habilitação
// conferida ao salvar, ao preparar e ao assinar (também retirada entre o preparo e o envio das fotos), a frase da declaração
// e a retificação que conserva a fórmula, as orientações formatadas e a justificativa.
const app = makeDb(inject('appDatabaseUrl'));
const dono = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  await stopBoss(); // o preparo enfileira o PDF
  await app.pool.end();
  await dono.pool.end();
});
/** A nota com a justificativa de um documento já emitido (o estado que o fluxo deixa; 0105), como em `retificacao.test.ts`. */
const notaComJustificativa = (tenantId: string, patientId: string, documentoId: string, j: string) =>
  dono.db.transaction(async (tx) => {
    await tx.execute(sql`set local session_replication_role = replica`);
    await tx.execute(sql`insert into signed_document_notes (tenant_id, patient_id, documento_id, justificativa_uso) values (${tenantId}, ${patientId}, ${documentoId}, ${j})`);
  });
const erroEm = (campo: string, msg: string) => (e: unknown) => e instanceof DocumentoError && e.erros[campo] === msg;
const composto = (nomenclatura: string, extra: Record<string, unknown> = {}) => ({ nomenclatura, parte: 'Folhas', extracao: 'Extrato seco', padronizacao: '', quantidade: '200', unidade: 'mg', ...extra });
const FORMULA = {
  tipo: 'formula_fitoterapica',
  compostos: [composto('Passiflora incarnata L.'), composto('Melissa officinalis L.'), composto('Matricaria chamomilla L.', { parte: 'Flores', padronizacao: '1,2% de apigenina' })],
  formaFarmaceutica: 'Cápsula', via: 'oral', posologia: '1 cápsula à noite', duracao: '30 dias',
};
const VITD = { tipo: 'suplemento', categoria: 'nutriente', composicao: [{ nome: 'Vitamina D3', quantidade: '2000', unidade: 'UI' }], forma: 'Cápsula', via: 'oral', posologia: '1 ao dia' };

/** O consultório do teste com (ou sem) a habilitação em Fitoterapia registrada no perfil (`tenants.fitoterapia_registro`). */
async function consultorio(habilitada: boolean) {
  const c = await novoConsultorio(app.db);
  if (habilitada) await app.db.update(tenants).set({ fitoterapiaRegistro: 'CRN-3 nº 1234/2024', fitoterapiaDeclaradaEm: new Date(), fitoterapiaTermoVersao: TERMO_FITOTERAPIA.versao }).where(eq(tenants.id, c.T.tenantId));
  const [t] = await app.db.select().from(tenants).where(eq(tenants.id, c.T.tenantId));
  return { ...c, tenant: t as TenantRow };
}
const semHabilitacao = (t: TenantRow): TenantRow => ({ ...t, fitoterapiaRegistro: null });

describe('fórmula magistral fitoterápica — habilitação nos três pontos (RN-392, EP-D26)', () => {
  it('com a habilitação: a receita com a fórmula de 3 compostos é salva; sem ela, salvar é recusado com semHabilitacao e nada muda', async () => {
    const c = await consultorio(true);
    const p = await novoPaciente(app.db, c.T.ctx);
    const id = await criarReceita(c.T.ctx, p.id, { db: app.db });
    await salvarRascunhoReceita(c.T.ctx, c.tenant, p.id, id, { conteudo: { itens: [FORMULA], orientacoes: '' }, justificativa: 'Insônia leve' }, { db: app.db });
    const d = (await lerDocumento(c.T.ctx, p.id, id, app.db))!;
    expect((d.conteudo as ConteudoReceita).itens).toEqual([expect.objectContaining({ tipo: 'formula_fitoterapica', compostos: expect.arrayContaining([expect.objectContaining({ nomenclatura: 'Melissa officinalis L.', quantidade: 200 })]) })]);

    const s = await consultorio(false);
    const q = await novoPaciente(app.db, s.T.ctx);
    const outro = await criarReceita(s.T.ctx, q.id, { db: app.db });
    await expect(salvarRascunhoReceita(s.T.ctx, s.tenant, q.id, outro, { conteudo: { itens: [VITD, FORMULA] }, justificativa: '' }, { db: app.db })).rejects.toSatisfy(erroEm('itens.1.tipo', MSG_PRESCRICAO.semHabilitacao));
    expect(((await lerDocumento(s.T.ctx, q.id, outro, app.db))!.conteudo as ConteudoReceita).itens).toEqual([]);
  });

  it('preparar: a habilitação retirada entre o salvar e o preparo → semHabilitacao e o documento continua rascunho', async () => {
    const c = await consultorio(true);
    const p = await novoPaciente(app.db, c.T.ctx);
    const id = await criarReceita(c.T.ctx, p.id, { db: app.db });
    await salvarRascunhoReceita(c.T.ctx, c.tenant, p.id, id, { conteudo: { itens: [FORMULA] }, justificativa: 'Insônia leve' }, { db: app.db });
    await expect(prepararParaAssinatura(c.T.ctx, semHabilitacao(c.tenant), p.id, id, { declaracao: 'on' }, { db: app.db })).rejects.toSatisfy(erroEm('itens.0.tipo', MSG_PRESCRICAO.semHabilitacao));
    expect((await lerDocumento(c.T.ctx, p.id, id, app.db))!.status).toBe('rascunho');
  });

  it('assinar: a habilitação retirada entre o preparo e o envio das fotos → recusa "sem_habilitacao", nada gravado', async () => {
    const c = await consultorio(true);
    const copia = { profissional: { nomeCompleto: 'Débora Silva Santos', crn: 'CRN-3 12345', email: 'd@x.com', telefone: '(11) 91234-5678', endereco: null, fitoterapia: true }, paciente: { nome: 'Ana Souza' } };
    const item = { ...FORMULA, compostos: FORMULA.compostos.map((k) => ({ ...k, quantidade: 200 })) };
    const x = await outroDocumento(c, app.db, { conteudo: { versao: 1, tipo: 'receita', itens: [item], orientacoes: '', orientacoesFormato: 'marcacao', copia } });
    const foto = await sharp({ create: { width: 800, height: 1100, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const deps = { db: app.db, dataDir: x.dataDir, headers: new Headers(), confirmar2fa: async () => 'ok' as const };
    await expect(receberDigitalizada({ ...x.acesso, tenant: semHabilitacao(c.tenant) }, x.id, [foto], '123456', deps)).rejects.toSatisfy(
      (e: unknown) => e instanceof RecusaAssinaturaError && e.codigo === 'sem_habilitacao',
    );
    const [d] = (await withTenant(x.T.ctx, (tx) => tx.execute(sql`select status, digitalizacao, digitalizacao_status from signed_documents where id = ${x.id}`), app.db)).rows;
    expect(d).toEqual({ status: 'aguardando_assinatura', digitalizacao: null, digitalizacao_status: null });
    // controle positivo: com a habilitação, o mesmo envio é aceito
    await receberDigitalizada({ ...x.acesso, tenant: c.tenant }, x.id, [foto], '123456', deps);
    const [depois] = (await withTenant(x.T.ctx, (tx) => tx.execute(sql`select digitalizacao_status from signed_documents where id = ${x.id}`), app.db)).rows;
    expect(depois.digitalizacao_status).toBe('pendente');
  });
});

describe('fórmula magistral fitoterápica — declaração e retificação (RN-392, EP-D56, US-378)', () => {
  it('declaracaoDoDocumento: a frase entra antes do ponto final só com a fórmula; o fitoterápico de uma planta e os outros tipos não mudam', () => {
    const receita = (itens: unknown[]) => ({ versao: 1, tipo: 'receita', itens, orientacoes: '' }) as unknown as ConteudoReceita;
    expect(FRASE_FORMULA_FITOTERAPICA).toBe(', e que a fórmula magistral fitoterápica tem só derivados vegetais, sem vitaminas, minerais, aminoácidos ou substâncias isoladas (Resolução CFN nº 680/2021, art. 9º, II)');
    expect(declaracaoDoDocumento(receita([VITD, FORMULA]))).toBe(`${DECLARACAO_RECEITA.slice(0, -1)}${FRASE_FORMULA_FITOTERAPICA}.`);
    expect(declaracaoDoDocumento(receita([VITD, { tipo: 'fitoterapico' }]))).toBe(DECLARACAO_RECEITA);
    expect(declaracaoDoDocumento(receita([]))).toBe(DECLARACAO_RECEITA);
  });

  it('o preparo grava a declaração com a frase só quando há fórmula (a tela mostra o mesmo texto)', async () => {
    const c = await consultorio(true);
    const p = await novoPaciente(app.db, c.T.ctx);
    const comFormula = await criarReceita(c.T.ctx, p.id, { db: app.db });
    const semFormula = await criarReceita(c.T.ctx, p.id, { db: app.db });
    await salvarRascunhoReceita(c.T.ctx, c.tenant, p.id, comFormula, { conteudo: { itens: [VITD, FORMULA] }, justificativa: 'Insônia leve' }, { db: app.db });
    await salvarRascunhoReceita(c.T.ctx, c.tenant, p.id, semFormula, { conteudo: { itens: [VITD] }, justificativa: 'Exposição solar baixa' }, { db: app.db });
    for (const id of [comFormula, semFormula]) await prepararParaAssinatura(c.T.ctx, c.tenant, p.id, id, { declaracao: 'on' }, { db: app.db });
    const declaracao = async (id: string) => ((await lerDocumento(c.T.ctx, p.id, id, app.db))!.conteudo as ConteudoReceita).declaracao;
    expect(await declaracao(comFormula)).toBe(`${DECLARACAO_RECEITA.slice(0, -1)}${FRASE_FORMULA_FITOTERAPICA}.`);
    expect(await declaracao(semFormula)).toBe(DECLARACAO_RECEITA);
  });

  it('retificar uma receita com fórmula e orientações formatadas → versão 2 com a fórmula, orientacoesFormato e a justificativa', async () => {
    const c = await consultorio(true);
    const p = await novoPaciente(app.db, c.T.ctx);
    const item = { ...FORMULA, compostos: FORMULA.compostos.map((k) => ({ ...k, quantidade: 200 })) };
    const conteudo = { versao: 1, tipo: 'receita', itens: [item], orientacoes: '**Tomar à noite**\n- longe do café', orientacoesFormato: 'marcacao', copia: { profissional: {}, paciente: { nome: 'Ana Souza' } }, declaracao: 'x' };
    const v1 = await documentoNoBanco(app.db, c.T.ctx, p.id, { status: 'assinado', conteudo });
    await notaComJustificativa(c.T.tenantId, p.id, v1.id, 'Insônia leve');
    const v2 = await retificarDocumento(c.T.ctx, p.id, v1.id, { db: app.db });
    const d = (await lerDocumento(c.T.ctx, p.id, v2, app.db))!;
    expect(d).toMatchObject({ tipo: 'receita', versao: 2, status: 'rascunho', justificativa: 'Insônia leve' });
    expect(d.conteudo).toEqual({ versao: 1, tipo: 'receita', itens: [item], orientacoes: '**Tomar à noite**\n- longe do café', orientacoesFormato: 'marcacao' });
    // o editor salva de novo pelo mesmo Zod (a habilitação de novo) e a fórmula continua
    await salvarRascunhoReceita(c.T.ctx, c.tenant, p.id, v2, { conteudo: { itens: [FORMULA], orientacoes: d.conteudo.tipo === 'receita' ? d.conteudo.orientacoes : '' }, justificativa: 'Insônia leve', motivoRetificacao: 'Dose ajustada' }, { db: app.db });
    expect(((await lerDocumento(c.T.ctx, p.id, v2, app.db))!.conteudo as ConteudoReceita).orientacoesFormato).toBe('marcacao');
  });
});
