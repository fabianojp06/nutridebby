import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { inject } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { emailsNaFila, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { account, auditLog, equipeMembros, invites, session, tenants, user } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { sha256 } from '@/lib/crypto';
import { logger } from '@/lib/logger';
import { inspecionarConvite } from './convites';
import { convidarRecepcao, definirPermissaoFinanceiro, desativarRecepcao, EquipeError, listarEquipe, reativarRecepcao, reenviarConviteRecepcao } from './equipe';
import { MSG_EQUIPE } from './equipe-textos';

/**
 * Plano 26 (RN-499, RN-502, RN-503, RN-516; US-488): a Equipe pelo módulo, com a constante `EQUIPE_LIGADA` desligada (o
 * módulo não a olha: quem recusa são a página e as actions, RE-D52).
 */
const app = makeDb(inject('appDatabaseUrl'));
const now = new Date('2026-11-17T13:32:00Z');
const deps = { db: app.db, appUrl: 'http://localhost:3106', now };
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});

const s = () => randomUUID().slice(0, 8);
const emailNovo = () => `rec-${s()}@ex.com`;
const convidar = (t: TenantDeTeste, o: { nome?: string; email?: string; financeiro?: boolean } = {}) =>
  convidarRecepcao(t.ctx, { nome: o.nome ?? 'Carla Lima', email: o.email ?? emailNovo(), financeiro: o.financeiro ?? false }, deps);
const erroDe = async (p: Promise<unknown>) => {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(EquipeError);
  return e as EquipeError;
};
const membro = async (t: TenantDeTeste, id: string) => (await withTenant(t.ctx, (tx) => tx.select().from(equipeMembros).where(eq(equipeMembros.id, id)), app.db))[0];
const auditoria = (t: TenantDeTeste) => withTenant(t.ctx, (tx) => tx.select().from(auditLog).where(eq(auditLog.entidade, 'equipe')).orderBy(auditLog.criadoEm), app.db);
const contaDe = async (t: TenantDeTeste, membroId: string) => {
  const m = await membro(t, membroId);
  return (await app.db.select().from(user).where(eq(user.id, m.userId)))[0];
};
const tokenDe = (link: string) => link.split('/convite/')[1];

describe('convidarRecepcao (RN-499, US-488 "Convidar")', () => {
  it('cria a conta `recepcao` sem senha, a linha da equipe, o convite de 72 h e o e-mail, e audita `criar` sem paciente', async () => {
    const t = await novoTenant(app.db, 'Debby Silva');
    const email = emailNovo();
    const { membroId } = await convidar(t, { nome: '  Carla Lima ', email: email.toUpperCase(), financeiro: true });
    const m = await membro(t, membroId);
    expect(m).toMatchObject({ tenantId: t.tenantId, papel: 'recepcao', financeiro: true, convidadaPor: t.nutriId, desativadaEm: null, desativadaPor: null });
    const u = await contaDe(t, membroId);
    expect(u).toMatchObject({ name: 'Carla Lima', email, appRole: 'recepcao', tenantId: t.tenantId, emailVerified: false });
    expect(await app.db.select().from(account).where(eq(account.userId, u.id))).toEqual([]);
    const [c] = await app.db.select().from(invites).where(eq(invites.userId, u.id));
    expect(c).toMatchObject({ tipo: 'recepcao', tenantId: t.tenantId, usadoEm: null });
    expect(c.expiraEm.toISOString()).toBe('2026-11-20T13:32:00.000Z');
    const emails = await emailsNaFila('convite_recepcao', email);
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ nome: 'Carla Lima', nutricionista: 'Debby Silva', consultorio: 'Debby Silva' });
    expect(emails[0].link).toMatch(/^http:\/\/localhost:3106\/convite\/[A-Za-z0-9_-]{43}$/);
    expect(c.tokenHash).toBe(sha256(tokenDe(emails[0].link)));
    expect(await inspecionarConvite(app.db, tokenDe(emails[0].link), now)).toMatchObject({ estado: 'valido', tipo: 'recepcao', consultorio: 'Debby Silva' });
    const a = await auditoria(t);
    expect(a.map((x) => ({ acao: x.acao, entidadeId: x.entidadeId, patientId: x.patientId, ator: x.actorUserId }))).toEqual([
      { acao: 'criar', entidadeId: membroId, patientId: null, ator: t.nutriId },
    ]);
  });

  it.each([
    ['Ca', false],
    ['C'.repeat(81), false],
    ['Car', true],
    ['C'.repeat(80), true],
  ])('nome %j: válido = %s ("Informe o nome (3 a 80 caracteres)")', async (nome, valido) => {
    const t = await novoTenant(app.db);
    if (valido) {
      await expect(convidar(t, { nome })).resolves.toMatchObject({ membroId: expect.any(String) });
      return;
    }
    const e = await erroDe(convidar(t, { nome }));
    expect(e.erros).toEqual({ nome: 'Informe o nome (3 a 80 caracteres)' });
    expect(await listarEquipe(t.ctx, deps)).toMatchObject({ membros: [] });
  });

  it('e-mail inválido: "Informe um e-mail válido", junto com o erro do nome', async () => {
    const t = await novoTenant(app.db);
    const e = await erroDe(convidarRecepcao(t.ctx, { nome: 'Ca', email: 'nao-e-email', financeiro: false }, deps));
    expect(e.erros).toEqual({ nome: MSG_EQUIPE.erros.nome, email: 'Informe um e-mail válido' });
  });

  it('quarto convite com 3 ativas: a mensagem do limite e nada é criado', async () => {
    const t = await novoTenant(app.db);
    for (let i = 0; i < 3; i++) await convidar(t);
    const email = emailNovo();
    const e = await erroDe(convidar(t, { email }));
    expect(e.code).toBe('limite');
    expect(e.erros).toEqual({ geral: 'O consultório pode ter até 3 pessoas ativas na recepção.' });
    expect(await app.db.select().from(user).where(eq(user.email, email))).toEqual([]);
    expect((await listarEquipe(t.ctx, deps)).membros).toHaveLength(3);
  });

  it('dois convites ao mesmo tempo com 2 ativas: só um passa (a trava do consultório)', async () => {
    const t = await novoTenant(app.db);
    await convidar(t);
    await convidar(t);
    const r = await Promise.allSettled([convidar(t), convidar(t)]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const recusa = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(recusa.reason).toBeInstanceOf(EquipeError);
    expect((recusa.reason as EquipeError).code).toBe('limite');
    expect(await listarEquipe(t.ctx, deps)).toMatchObject({ ativas: 3, limiteAtingido: true });
  });

  it('e-mail que já tem conta (paciente, nutricionista, recepção de outro consultório): a mesma mensagem neutra', async () => {
    const t = await novoTenant(app.db);
    const outro = await novoTenant(app.db);
    const paciente = emailNovo();
    await app.db.insert(user).values({ id: randomUUID(), name: 'Ana Souza', email: paciente, appRole: 'paciente' });
    const deOutro = emailNovo();
    await convidar(outro, { email: deOutro });
    const [nutri] = await app.db.select({ email: user.email }).from(user).where(eq(user.id, outro.nutriId));
    for (const email of [paciente, nutri.email, deOutro, deOutro.toUpperCase()]) {
      const e = await erroDe(convidar(t, { email }));
      expect(e.erros, email).toEqual({ email: 'Este e-mail já tem uma conta no NutriDebby. Use outro e-mail para a recepção.' });
    }
    expect((await listarEquipe(t.ctx, deps)).membros).toEqual([]);
  });

  it('consultório suspenso não convida (RN-15)', async () => {
    const t = await novoTenant(app.db);
    await app.db.update(tenants).set({ status: 'suspensa' }).where(eq(tenants.id, t.tenantId));
    const e = await erroDe(convidar(t));
    expect(e.erros).toEqual({ geral: 'Conta suspensa: não é possível convidar agora.' });
    expect((await listarEquipe(t.ctx, deps)).membros).toEqual([]);
  });

  it('só a sessão da nutricionista convida (a recepção e o worker são recusados antes da transação)', async () => {
    const t = await novoTenant(app.db);
    for (const ctx of [{ ...t.ctx, role: 'recepcao' as const }, { tenantId: t.tenantId, role: 'worker' as const }]) {
      await expect(convidarRecepcao(ctx, { nome: 'Carla Lima', email: emailNovo(), financeiro: false }, deps)).rejects.toThrow('só muda pela sessão da nutricionista');
    }
  });

  it('o log leva só ids: nunca o nome nem o e-mail (regra 3, RNF-482)', async () => {
    const chamadas: unknown[][] = [];
    for (const nivel of ['info', 'warn', 'error', 'debug'] as const) vi.spyOn(logger, nivel).mockImplementation(((...a: unknown[]) => void chamadas.push(a)) as never);
    const t = await novoTenant(app.db);
    const email = emailNovo();
    const { membroId } = await convidar(t, { nome: 'Nome Muito Único', email });
    await reenviarConviteRecepcao(t.ctx, membroId, deps);
    await desativarRecepcao(t.ctx, membroId, deps);
    await reativarRecepcao(t.ctx, membroId, deps);
    expect(chamadas.length).toBeGreaterThan(0);
    const texto = JSON.stringify(chamadas);
    expect(texto).not.toContain('Nome Muito Único');
    expect(texto).not.toContain(email);
    expect(texto).toContain(membroId);
  });
});

describe('reenviarConviteRecepcao (RN-499)', () => {
  it('sem senha: convite novo (o anterior deixa de valer) e o e-mail de novo; audita `alterar`', async () => {
    const t = await novoTenant(app.db);
    const email = emailNovo();
    const { membroId } = await convidar(t, { email });
    const [primeiro] = await emailsNaFila('convite_recepcao', email);
    await reenviarConviteRecepcao(t.ctx, membroId, deps);
    const emails = await emailsNaFila('convite_recepcao', email);
    expect(emails).toHaveLength(2);
    expect(await inspecionarConvite(app.db, tokenDe(primeiro.link), now)).toEqual({ estado: 'invalido' });
    expect(await inspecionarConvite(app.db, tokenDe(emails[1].link), now)).toMatchObject({ estado: 'valido', tipo: 'recepcao' });
    expect((await auditoria(t)).map((a) => a.acao)).toEqual(['criar', 'alterar']);
  });

  it('com a senha criada: "A senha já foi criada…" e nenhum convite novo', async () => {
    const t = await novoTenant(app.db);
    const email = emailNovo();
    const { membroId } = await convidar(t, { email });
    const u = await contaDe(t, membroId);
    await app.db.insert(account).values({ id: randomUUID(), userId: u.id, accountId: u.id, providerId: 'credential', password: 'x' });
    const e = await erroDe(reenviarConviteRecepcao(t.ctx, membroId, deps));
    expect(e.erros).toEqual({ geral: 'A senha já foi criada. Se a pessoa esqueceu, use "Esqueci minha senha".' });
    expect(await emailsNaFila('convite_recepcao', email)).toHaveLength(1);
  });

  it('pessoa de outro consultório ou id inválido: não encontrada', async () => {
    const t = await novoTenant(app.db);
    const outro = await novoTenant(app.db);
    const { membroId } = await convidar(outro);
    for (const id of [membroId, 'nao-e-uuid', randomUUID()]) expect((await erroDe(reenviarConviteRecepcao(t.ctx, id, deps))).code).toBe('nao_encontrado');
  });
});

describe('definirPermissaoFinanceiro (RN-502)', () => {
  it('grava a permissão e audita `alterar` da entidade `equipe`, sem paciente', async () => {
    const t = await novoTenant(app.db);
    const { membroId } = await convidar(t);
    await definirPermissaoFinanceiro(t.ctx, membroId, true, deps);
    expect((await membro(t, membroId)).financeiro).toBe(true);
    await definirPermissaoFinanceiro(t.ctx, membroId, false, deps);
    expect((await membro(t, membroId)).financeiro).toBe(false);
    const a = await auditoria(t);
    expect(a.map((x) => [x.acao, x.entidadeId, x.patientId])).toEqual([
      ['criar', membroId, null],
      ['alterar', membroId, null],
      ['alterar', membroId, null],
    ]);
  });
});

describe('desativarRecepcao e reativarRecepcao (RN-503)', () => {
  it('desativar apaga as sessões e o convite pendente na mesma transação e grava quem desativou; a linha e a conta ficam', async () => {
    const t = await novoTenant(app.db);
    const { membroId } = await convidar(t);
    const u = await contaDe(t, membroId);
    await app.db.insert(session).values({ token: randomUUID(), userId: u.id, expiresAt: new Date(Date.now() + 3_600_000), updatedAt: new Date() });
    await desativarRecepcao(t.ctx, membroId, deps);
    const m = await membro(t, membroId);
    expect(m.desativadaEm).toBeInstanceOf(Date);
    expect(m.desativadaPor).toBe(t.nutriId);
    expect(await app.db.select().from(session).where(eq(session.userId, u.id))).toEqual([]);
    expect(await app.db.select().from(invites).where(and(eq(invites.userId, u.id), isNull(invites.usadoEm)))).toEqual([]);
    expect(await app.db.select({ id: user.id }).from(user).where(eq(user.id, u.id))).toHaveLength(1);
    // de novo: nada muda (nem a data, nem a auditoria)
    await desativarRecepcao(t.ctx, membroId, deps);
    expect((await membro(t, membroId)).desativadaEm?.getTime()).toBe(m.desativadaEm!.getTime());
    expect((await auditoria(t)).map((a) => a.acao)).toEqual(['criar', 'alterar']);
    expect((await listarEquipe(t.ctx, deps)).membros[0]).toMatchObject({ situacao: 'desativado', desativadaEm: m.desativadaEm });
  });

  it('reativar acima do limite: a mensagem do limite; abaixo dele, volta ativa com a senha de antes', async () => {
    const t = await novoTenant(app.db);
    const { membroId } = await convidar(t);
    await desativarRecepcao(t.ctx, membroId, deps);
    const outros = [await convidar(t), await convidar(t), await convidar(t)];
    const e = await erroDe(reativarRecepcao(t.ctx, membroId, deps));
    expect(e.erros).toEqual({ geral: 'O consultório pode ter até 3 pessoas ativas na recepção.' });
    expect((await membro(t, membroId)).desativadaEm).not.toBeNull();
    await desativarRecepcao(t.ctx, outros[0].membroId, deps);
    await reativarRecepcao(t.ctx, membroId, deps);
    expect(await membro(t, membroId)).toMatchObject({ desativadaEm: null, desativadaPor: null });
    expect(await listarEquipe(t.ctx, deps)).toMatchObject({ ativas: 3, limiteAtingido: true });
  });
});

describe('listarEquipe (§7.2, RN-516)', () => {
  it('situação de cada pessoa: convite enviado (com a validade), vencido, ativo e desativado; o último acesso', async () => {
    const t = await novoTenant(app.db);
    const enviado = await convidar(t, { nome: 'Dora Reis' });
    const vencido = await convidarRecepcao(t.ctx, { nome: 'Eva Melo', email: emailNovo(), financeiro: false }, { ...deps, now: new Date('2026-11-10T12:00:00Z') });
    const ativo = await convidar(t, { nome: 'Carla Lima', financeiro: true });
    const conta = await contaDe(t, ativo.membroId);
    await app.db.insert(account).values({ id: randomUUID(), userId: conta.id, accountId: conta.id, providerId: 'credential', password: 'x' });
    const acesso = new Date('2026-11-17T12:12:00Z');
    await app.db.update(user).set({ ultimoAcessoEm: acesso }).where(eq(user.id, conta.id));
    await desativarRecepcao(t.ctx, vencido.membroId, deps);
    const desativado = vencido;
    const r = await listarEquipe(t.ctx, deps);
    expect(r.ativas).toBe(2);
    expect(r.limiteAtingido).toBe(false);
    const porId = new Map(r.membros.map((m) => [m.id, m]));
    expect(porId.get(enviado.membroId)).toMatchObject({ nome: 'Dora Reis', situacao: 'convite_enviado', ultimoAcessoEm: null });
    expect(porId.get(enviado.membroId)!.conviteValeAte?.toISOString()).toBe('2026-11-20T13:32:00.000Z');
    expect(porId.get(ativo.membroId)).toMatchObject({ situacao: 'ativo', financeiro: true, ultimoAcessoEm: acesso, conviteValeAte: null });
    expect(porId.get(desativado.membroId)).toMatchObject({ situacao: 'desativado' });
    // sem desativar: o convite de 72 h a partir de 10/11 já venceu em 17/11
    const t2 = await novoTenant(app.db);
    const velho = await convidarRecepcao(t2.ctx, { nome: 'Eva Melo', email: emailNovo(), financeiro: false }, { ...deps, now: new Date('2026-11-10T12:00:00Z') });
    expect((await listarEquipe(t2.ctx, deps)).membros).toEqual([expect.objectContaining({ id: velho.membroId, situacao: 'convite_vencido', conviteValeAte: null })]);
  });

  it('não mostra a equipe de outro consultório', async () => {
    const t = await novoTenant(app.db);
    const outro = await novoTenant(app.db);
    await convidar(outro);
    expect((await listarEquipe(t.ctx, deps)).membros).toEqual([]);
  });
});
