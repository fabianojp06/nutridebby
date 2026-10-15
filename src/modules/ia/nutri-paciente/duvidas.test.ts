import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { mensagemNoBanco } from '../../../../test/ia-nutri';
import { app, depsApp, fecharHarnessDaConversa, pronto } from '../../../../test/ia-nutri-conversa';
import { novoPaciente, novoTenant, type TenantDeTeste } from '../../../../test/pacientes';
import { iaNutriMensagens, notifications, patients } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { desativarNoApp } from './consentimento';
import { ROTULO_CATEGORIA } from './constantes';
import { perguntar } from './conversa';
import { abrirDuvida, contadorDeDuvidas, conversaNaFicha, filaDeDuvidas, marcarComoVista } from './duvidas';
import { apagarIaNutriDoTitular } from './lgpd';

// Plano 15 (P15-11): o lado da equipe — a fila "Dúvidas dos pacientes", abrir, marcar como vista, a conversa na ficha e o
// contador (spec F3-02 v0.4 US-175, §7.5, D22, D24 = b, RN-183, RNF-166; Review Focus 7).
afterAll(fecharHarnessDaConversa);

const RISCO = 'depois do jantar eu vomito pra não engordar';
const HORA = 3_600_000;
const encaminhada = (o: Partial<typeof iaNutriMensagens.$inferInsert> = {}) => ({ status: 'respondida', encaminhadaEm: new Date(), ...o });
const linha = (T: { ctx: TenantContext }, id: string) =>
  withTenant(T.ctx, async (tx) => (await tx.select().from(iaNutriMensagens).where(eq(iaNutriMensagens.id, id)))[0] ?? null, app.db);
const leituras = async (T: TenantDeTeste, entidadeId: string | null) =>
  (
    await withTenant(
      T.ctx,
      (tx) => tx.execute(sql`select acao, entidade, entidade_id, actor_user_id from audit_log where entidade = 'ia_nutri' and acao = 'ler' and entidade_id is not distinct from ${entidadeId}`),
      app.db,
    )
  ).rows;
const contarAuditoria = async (T: TenantDeTeste) =>
  Number((await withTenant(T.ctx, (tx) => tx.execute(sql`select count(*)::int as n from audit_log where tenant_id = ${T.tenantId}`), app.db)).rows[0].n);
const avisos = (T: TenantDeTeste, patientId: string) =>
  withTenant(T.ctx, (tx) => tx.select({ canal: notifications.canal, tipo: notifications.tipo }).from(notifications).where(and(eq(notifications.patientId, patientId), eq(notifications.tipo, 'duvida_vista'))), app.db);

async function consultorio() {
  const T = await novoTenant(app.db);
  const bia = await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' });
  const caio = await novoPaciente(app.db, T.ctx, { nome: 'Caio Reis' });
  return { T, bia, caio };
}

describe('filaDeDuvidas e contadorDeDuvidas (US-175 "Fila")', () => {
  it('só as abertas; o risco primeiro e depois as mais antigas; os três selos; não grava audit_log', async () => {
    const { T, bia, caio } = await consultorio();
    const agora = Date.now();
    const antiga = await mensagemNoBanco(app.db, T.tenantId, bia.id, encaminhada({ createdAt: new Date(agora - 5 * HORA) }));
    const nova = await mensagemNoBanco(app.db, T.tenantId, caio.id, encaminhada({ createdAt: new Date(agora - 1 * HORA) }));
    const risco = await mensagemNoBanco(app.db, T.tenantId, caio.id, encaminhada({ createdAt: new Date(agora - 2 * HORA), risco: 'emergencia', texto: 'quero sumir' }));
    const riscoRevogado = await mensagemNoBanco(app.db, T.tenantId, bia.id, encaminhada({ createdAt: new Date(agora - 4 * HORA), risco: 'transtorno_alimentar', revogadaEm: new Date(), texto: RISCO }));
    const avisoMinimo = await mensagemNoBanco(app.db, T.tenantId, bia.id, encaminhada({ createdAt: new Date(agora - 3 * HORA), risco: 'modelo', revogadaEm: new Date(), texto: null }));
    // fora da fila: resolvida, não encaminhada, e a resposta da IA
    await mensagemNoBanco(app.db, T.tenantId, bia.id, encaminhada({ resolvidaEm: new Date(), resolvidaPor: T.nutriId, resolucao: 'vista' }));
    await mensagemNoBanco(app.db, T.tenantId, bia.id, { status: 'respondida' });
    await mensagemNoBanco(app.db, T.tenantId, bia.id, { autor: 'ia', status: null, texto: 'No seu plano está assim:', contouNoLimite: false });

    const antes = await contarAuditoria(T);
    const fila = await filaDeDuvidas(T.ctx, app.db);
    expect(fila.map((f) => [f.id, f.selo])).toEqual([
      [riscoRevogado, 'risco_revogado'], // -4 h
      [avisoMinimo, 'aviso_minimo'], // -3 h
      [risco, 'risco'], // -2 h
      [antiga, null], // -5 h: sem risco, depois de todas as de risco
      [nova, null],
    ]);
    expect(fila[0]).toEqual({ id: riscoRevogado, patientId: bia.id, paciente: 'Bia Lima', criadaEm: expect.any(Date), selo: 'risco_revogado' });
    expect(await contadorDeDuvidas(T.ctx, app.db)).toBe(5);
    expect(await contarAuditoria(T)).toBe(antes); // só lista, como "Exames recebidos"

    // outro consultório não vê nada
    const outro = await novoTenant(app.db);
    expect(await filaDeDuvidas(outro.ctx, app.db)).toEqual([]);
    expect(await contadorDeDuvidas(outro.ctx, app.db)).toBe(0);
  });
});

describe('abrirDuvida (US-175, D22)', () => {
  it('devolve a pergunta e a resposta montada, grava aberta_pela_nutri_em uma vez e um "ler" (ia_nutri) por abertura', async () => {
    const { T, bia } = await consultorio();
    const q = await mensagemNoBanco(app.db, T.tenantId, bia.id, encaminhada({ texto: 'Posso trocar o arroz?' }));
    await mensagemNoBanco(app.db, T.tenantId, bia.id, { autor: 'ia', status: null, texto: 'No seu plano está assim: arroz 100 g', categoria: 'plano', tipoResposta: 'quantidade', respondeA: q, contouNoLimite: false });

    const d = await abrirDuvida(T.ctx, q, app.db);
    expect(d).toEqual({
      id: q, patientId: bia.id, paciente: 'Bia Lima', criadaEm: expect.any(Date), texto: 'Posso trocar o arroz?',
      resposta: { texto: 'No seu plano está assim: arroz 100 g', textoFixo: null, categoria: ROTULO_CATEGORIA.plano },
      selo: null, resolvida: false,
    });
    const aberta = (await linha(T, q))!.abertaPelaNutriEm;
    expect(aberta).not.toBeNull();
    expect(await leituras(T, q)).toEqual([{ acao: 'ler', entidade: 'ia_nutri', entidade_id: q, actor_user_id: T.nutriId }]);
    await abrirDuvida(T.ctx, q, app.db);
    expect((await linha(T, q))!.abertaPelaNutriEm).toEqual(aberta);
    expect(await leituras(T, q)).toHaveLength(2);
  });

  it('a resposta de texto fixo volta como o código; sem resposta → null', async () => {
    const { T, bia } = await consultorio();
    const q = await mensagemNoBanco(app.db, T.tenantId, bia.id, encaminhada());
    await mensagemNoBanco(app.db, T.tenantId, bia.id, { autor: 'ia', status: null, texto: null, textoFixo: 'nao_encontrei', respondeA: q, contouNoLimite: false });
    expect((await abrirDuvida(T.ctx, q, app.db))?.resposta).toEqual({ texto: null, textoFixo: 'nao_encontrei', categoria: null });
    const semResposta = await mensagemNoBanco(app.db, T.tenantId, bia.id, encaminhada());
    expect((await abrirDuvida(T.ctx, semResposta, app.db))?.resposta).toBeNull();
  });

  it('id de outro consultório, pergunta não encaminhada, resposta da IA ou id inválido → null, sem gravar nada', async () => {
    const { T, bia } = await consultorio();
    const outro = await consultorio();
    const deOutro = await mensagemNoBanco(app.db, outro.T.tenantId, outro.bia.id, encaminhada());
    const naoEncaminhada = await mensagemNoBanco(app.db, T.tenantId, bia.id, { status: 'respondida' });
    const daIa = await mensagemNoBanco(app.db, T.tenantId, bia.id, { autor: 'ia', status: null, texto: 'x', contouNoLimite: false });
    for (const id of [deOutro, naoEncaminhada, daIa, 'abc', randomUUID()]) expect(await abrirDuvida(T.ctx, id, app.db), id).toBeNull();
    expect((await linha(outro.T, deOutro))!.abertaPelaNutriEm).toBeNull();
    expect((await linha(T, naoEncaminhada))!.abertaPelaNutriEm).toBeNull();
    expect(await leituras(T, deOutro)).toEqual([]);
  });

  it('D22: a pergunta com risco de quem revogou é devolvida e apagada na mesma transação; o aviso mínimo (sem texto) fica', async () => {
    const { T, bia } = await consultorio();
    const r = await mensagemNoBanco(app.db, T.tenantId, bia.id, encaminhada({ risco: 'transtorno_alimentar', revogadaEm: new Date(), texto: RISCO }));
    const d = await abrirDuvida(T.ctx, r, app.db);
    expect(d).toMatchObject({ id: r, texto: RISCO, selo: 'risco_revogado' });
    expect(await linha(T, r)).toBeNull();
    expect(await leituras(T, r)).toHaveLength(1);
    expect(await abrirDuvida(T.ctx, r, app.db)).toBeNull(); // só uma vez

    const minimo = await mensagemNoBanco(app.db, T.tenantId, bia.id, encaminhada({ risco: 'emergencia', revogadaEm: new Date(), texto: null }));
    expect(await abrirDuvida(T.ctx, minimo, app.db)).toMatchObject({ texto: null, selo: 'aviso_minimo' });
    expect(await linha(T, minimo)).not.toBeNull();
  });
});

describe('Review Focus 7 — o caso real da D22 (T1, T2, T10 e T11)', () => {
  it('risco gravado por perguntar → desativarNoApp → abrirDuvida na sessão nutri: o texto volta, a pergunta some e a mensagem `sistema` fica com responde_a nulo', async () => {
    const { T, p, ctxP } = await pronto();
    const { mensagemId } = await perguntar(ctxP, RISCO, depsApp);
    const [sistema] = await withTenant(T.ctx, (tx) => tx.select().from(iaNutriMensagens).where(and(eq(iaNutriMensagens.patientId, p.id), eq(iaNutriMensagens.autor, 'sistema'))), app.db);
    expect(sistema.respondeA).toBe(mensagemId);
    expect(await desativarNoApp(ctxP, depsApp)).toBe('desativada');
    expect((await filaDeDuvidas(T.ctx, app.db)).map((f) => [f.id, f.selo])).toEqual([[mensagemId, 'risco_revogado']]);

    const d = await abrirDuvida(T.ctx, mensagemId!, app.db);
    expect(d).toMatchObject({ id: mensagemId, texto: RISCO, selo: 'risco_revogado' });
    expect(await linha(T, mensagemId!)).toBeNull();
    expect((await linha(T, sistema.id))?.respondeA).toBeNull();
    expect(await filaDeDuvidas(T.ctx, app.db)).toEqual([]);
  });

  it('o mesmo depois do pedido de exclusão atendido (apagarIaNutriDoTitular)', async () => {
    const { T, p, ctxP } = await pronto();
    const { mensagemId } = await perguntar(ctxP, RISCO, depsApp);
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado', anonimizarApos: '2046-09-30' }).where(eq(patients.id, p.id)), app.db);
    await apagarIaNutriDoTitular({ tenantId: T.tenantId, role: 'worker' }, p.id, app.db);
    expect(await abrirDuvida(T.ctx, mensagemId!, app.db)).toMatchObject({ texto: RISCO, selo: 'risco_revogado' });
    expect(await linha(T, mensagemId!)).toBeNull();
  });
});

describe('marcarComoVista (US-175, D24 = b)', () => {
  it('grava a resolução em nome da nutricionista e o push neutro duvida_vista; de novo → false; sai da fila e do contador', async () => {
    const { T, bia } = await consultorio();
    const q = await mensagemNoBanco(app.db, T.tenantId, bia.id, encaminhada());
    expect(await contadorDeDuvidas(T.ctx, app.db)).toBe(1);
    const agora = new Date();
    expect(await marcarComoVista(T.ctx, q, { db: app.db, agora })).toBe(true);
    expect(await linha(T, q)).toMatchObject({ resolvidaEm: agora, resolucao: 'vista', resolvidaPor: T.nutriId, abertaPelaNutriEm: expect.any(Date) });
    expect(await avisos(T, bia.id)).toEqual([{ canal: 'push', tipo: 'duvida_vista' }]);
    expect(await marcarComoVista(T.ctx, q, { db: app.db })).toBe(false);
    expect(await avisos(T, bia.id)).toHaveLength(1);
    expect(await filaDeDuvidas(T.ctx, app.db)).toEqual([]);
    expect(await contadorDeDuvidas(T.ctx, app.db)).toBe(0);
  });

  it('a dúvida risco_revogado (apagada ao abrir) → false, sem notificação; o aviso mínimo resolve sem push (o paciente desativou)', async () => {
    const { T, bia } = await consultorio();
    const r = await mensagemNoBanco(app.db, T.tenantId, bia.id, encaminhada({ risco: 'transtorno_alimentar', revogadaEm: new Date(), texto: RISCO }));
    await abrirDuvida(T.ctx, r, app.db);
    expect(await marcarComoVista(T.ctx, r, { db: app.db })).toBe(false);
    const minimo = await mensagemNoBanco(app.db, T.tenantId, bia.id, encaminhada({ risco: 'emergencia', revogadaEm: new Date(), texto: null }));
    expect(await marcarComoVista(T.ctx, minimo, { db: app.db })).toBe(true);
    expect(await avisos(T, bia.id)).toEqual([]);
    expect(await contadorDeDuvidas(T.ctx, app.db)).toBe(0);
  });

  it('/code-review do PR #37 (D22): a risco_revogado AINDA NÃO ABERTA, por POST direto → false; continua na fila, com o texto, até "Abrir dúvida"', async () => {
    const { T, bia } = await consultorio();
    const r = await mensagemNoBanco(app.db, T.tenantId, bia.id, encaminhada({ risco: 'transtorno_alimentar', revogadaEm: new Date(), texto: RISCO }));
    expect(await marcarComoVista(T.ctx, r, { db: app.db })).toBe(false);
    expect(await linha(T, r)).toMatchObject({ resolvidaEm: null, abertaPelaNutriEm: null, texto: RISCO });
    expect((await filaDeDuvidas(T.ctx, app.db)).map((d) => [d.id, d.selo])).toEqual([[r, 'risco_revogado']]);
    expect(await avisos(T, bia.id)).toEqual([]);
  });

  it('id de outro consultório ou inválido → false', async () => {
    const { T } = await consultorio();
    const outro = await consultorio();
    const deOutro = await mensagemNoBanco(app.db, outro.T.tenantId, outro.bia.id, encaminhada());
    expect(await marcarComoVista(T.ctx, deOutro, { db: app.db })).toBe(false);
    expect(await marcarComoVista(T.ctx, 'abc', { db: app.db })).toBe(false);
    expect((await linha(outro.T, deOutro))!.resolvidaEm).toBeNull();
  });
});

describe('conversaNaFicha (US-175 "Ver a conversa", D7 = a)', () => {
  it('as mensagens com o rótulo da categoria, o risco, a avaliação e a situação da dúvida; grava um "ler"; nunca fontes, modelo ou custo', async () => {
    const { T, bia, caio } = await consultorio();
    const t0 = Date.now() - 10 * 60_000;
    const q = await mensagemNoBanco(app.db, T.tenantId, bia.id, encaminhada({ createdAt: new Date(t0), texto: 'Posso trocar o arroz?', categoria: 'plano' }));
    await mensagemNoBanco(app.db, T.tenantId, bia.id, {
      autor: 'ia', status: null, createdAt: new Date(t0 + 1000), texto: 'No seu plano está assim: arroz 100 g', categoria: 'plano', tipoResposta: 'quantidade',
      respondeA: q, avaliacao: 'nao_ajudou', fontes: ['#S1'], modelo: 'claude-haiku-5-5', promptVersao: 'p1', reservaMicroUsd: 1234, contouNoLimite: false,
    });
    const r = await mensagemNoBanco(app.db, T.tenantId, bia.id, { createdAt: new Date(t0 + 2000), status: 'respondida', risco: 'emergencia', texto: 'quero sumir', encaminhadaEm: new Date(), resolvidaEm: new Date(), resolvidaPor: T.nutriId, resolucao: 'vista' });
    await mensagemNoBanco(app.db, T.tenantId, bia.id, { autor: 'sistema', status: null, createdAt: new Date(t0 + 2000), texto: null, textoFixo: 'risco_emergencia', respondeA: r, contouNoLimite: false });
    await mensagemNoBanco(app.db, T.tenantId, caio.id, encaminhada({ texto: 'de outro paciente' }));

    const ms = await conversaNaFicha(T.ctx, bia.id, app.db);
    expect(ms.map((m) => [m.autor, m.texto, m.textoFixo, m.categoria, m.risco, m.avaliacao, m.duvida])).toEqual([
      ['paciente', 'Posso trocar o arroz?', null, ROTULO_CATEGORIA.plano, false, null, 'aberta'],
      ['ia', 'No seu plano está assim: arroz 100 g', null, ROTULO_CATEGORIA.plano, false, 'nao_ajudou', null],
      ['paciente', 'quero sumir', null, null, true, null, 'vista'],
      ['sistema', null, 'risco_emergencia', null, false, null, null],
    ]);
    for (const m of ms) expect(Object.keys(m).sort()).toEqual(['autor', 'avaliacao', 'categoria', 'criadaEm', 'duvida', 'id', 'risco', 'seloRevogada', 'texto', 'textoFixo']);
    expect(ms.every((m) => m.seloRevogada === null)).toBe(true);
    expect(await leituras(T, null)).toEqual([{ acao: 'ler', entidade: 'ia_nutri', entidade_id: null, actor_user_id: T.nutriId }]);
    expect(await conversaNaFicha(T.ctx, 'abc', app.db)).toEqual([]);
  });

  it('paciente de outro consultório (id válido): nada, e nenhum "ler" com o id dele', async () => {
    const { T } = await consultorio();
    const outro = await consultorio();
    await mensagemNoBanco(app.db, outro.T.tenantId, outro.bia.id, encaminhada({ texto: 'de outro consultório' }));
    expect(await conversaNaFicha(T.ctx, outro.bia.id, app.db)).toEqual([]);
    const ls = await withTenant(T.ctx, (tx) => tx.execute(sql`select 1 from audit_log where entidade = 'ia_nutri' and patient_id = ${outro.bia.id}`), app.db);
    expect(ls.rows).toEqual([]);
  });

  it('revisão da T11 (I2, D22): perguntar com risco → desativarNoApp → a ficha não traz o texto (só o selo), não abre a dúvida; abrirDuvida ainda devolve o texto e apaga', async () => {
    const { T, p, ctxP } = await pronto();
    const { mensagemId } = await perguntar(ctxP, RISCO, depsApp);
    expect(await desativarNoApp(ctxP, depsApp)).toBe('desativada');
    for (let i = 0; i < 2; i++) {
      const ms = await conversaNaFicha(T.ctx, p.id, app.db);
      expect(JSON.stringify(ms)).not.toContain(RISCO);
      // o esqueleto da revogação (a resposta `sistema`, D32) fica de fora; só a pergunta de risco na fila, sem texto
      expect(ms.map((m) => [m.id, m.autor, m.texto, m.textoFixo, m.risco, m.duvida, m.seloRevogada])).toEqual([[mensagemId, 'paciente', null, null, true, 'aberta', 'risco_revogado']]);
    }
    expect((await linha(T, mensagemId!))?.abertaPelaNutriEm).toBeNull(); // ler a ficha não é abrir a dúvida
    expect((await filaDeDuvidas(T.ctx, app.db)).map((f) => [f.id, f.selo])).toEqual([[mensagemId, 'risco_revogado']]);
    expect(await abrirDuvida(T.ctx, mensagemId!, app.db)).toMatchObject({ texto: RISCO, selo: 'risco_revogado' });
    expect(await linha(T, mensagemId!)).toBeNull();
    expect(await conversaNaFicha(T.ctx, p.id, app.db)).toEqual([]);
  });

  it('o mesmo depois do pedido de exclusão atendido (apagarIaNutriDoTitular); o aviso mínimo (sem texto) vem com o seu selo', async () => {
    const { T, p, ctxP } = await pronto();
    const { mensagemId } = await perguntar(ctxP, RISCO, depsApp);
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado', anonimizarApos: '2046-09-30' }).where(eq(patients.id, p.id)), app.db);
    await apagarIaNutriDoTitular({ tenantId: T.tenantId, role: 'worker' }, p.id, app.db);
    const ms = await conversaNaFicha(T.ctx, p.id, app.db);
    expect(JSON.stringify(ms)).not.toContain(RISCO);
    expect(ms.map((m) => [m.id, m.seloRevogada])).toEqual([[mensagemId, 'risco_revogado']]);
    expect(await abrirDuvida(T.ctx, mensagemId!, app.db)).toMatchObject({ texto: RISCO });
    expect(await linha(T, mensagemId!)).toBeNull();

    const c = await consultorio();
    const minimo = await mensagemNoBanco(app.db, c.T.tenantId, c.bia.id, encaminhada({ risco: 'emergencia', revogadaEm: new Date(), texto: null }));
    expect((await conversaNaFicha(c.T.ctx, c.bia.id, app.db)).map((m) => [m.id, m.texto, m.seloRevogada])).toEqual([[minimo, null, 'aviso_minimo']]);
  });
});
