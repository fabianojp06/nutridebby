import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { adminActions, session, tenants, twoFactor, user } from '@/db/schema';
import { getAuth } from '@/lib/auth';
import { confirmarCodigo2fa } from '@/lib/confirmar-2fa';
import { evaluateSession } from '@/lib/session-rules';
import { recepcaoComLogin } from '../../../test/equipe';
import { criarEEntrar, entrar } from '../../../test/sessao';
import { mensagemDaFalha, mensagemDoReinicio, MSG_2FA, mensagemDoComando, Reiniciar2faError, reiniciarDoisFatores, reiniciarPeloAdmin, type Codigo2fa } from './reiniciar-2fa';

const db = getDb();
const auth = getAuth();
afterAll(() => closeDb());

/** Conta com 2FA "ativo" no banco (a linha de two_factor com segredo qualquer: o que importa aqui é ela sumir). */
async function comDoisFatores(appRole: 'admin' | 'nutri' | 'paciente') {
  const c = await criarEEntrar(db, auth, { appRole });
  await entrar(auth, c.email); // segunda sessão
  await db.insert(twoFactor).values({ userId: c.id, secret: 'cifrado-qualquer', backupCodes: 'cifrado-qualquer' });
  await db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, c.id));
  return c;
}
const avisos = () => vi.fn(async () => 'job');

describe('reiniciarDoisFatores (P09-02 b, manual técnico §6.9.1)', () => {
  it('apaga o two_factor, desliga o 2FA, revoga as sessões, registra em admin_actions e avisa a conta — e o login volta a funcionar sem código', async () => {
    const admin = await criarEEntrar(db, auth, { appRole: 'admin', twoFactorEnabled: true });
    const alvo = await comDoisFatores('nutri');
    const avisar = avisos();
    const r = await reiniciarDoisFatores(`  ${alvo.email.toUpperCase()} `, { origem: 'admin', adminId: admin.id }, { db, avisar });
    expect(r).toEqual({ userId: alvo.id, papel: 'nutri', sessoesRevogadas: 2 });
    expect(await db.select().from(twoFactor).where(eq(twoFactor.userId, alvo.id))).toEqual([]);
    expect((await db.select({ v: user.twoFactorEnabled }).from(user).where(eq(user.id, alvo.id)))[0].v).toBe(false);
    expect(await db.select().from(session).where(eq(session.userId, alvo.id))).toEqual([]);
    const [reg] = await db.select().from(adminActions).where(eq(adminActions.alvoUserId, alvo.id));
    expect(reg).toMatchObject({ adminUserId: admin.id, acao: 'reiniciar_2fa', alvoPapel: 'nutri', origem: 'admin' });
    expect(avisar).toHaveBeenCalledWith({ tipo: 'aviso_2fa_reiniciado', para: alvo.email }, expect.anything());
    await expect(entrar(auth, alvo.email)).resolves.toMatch(/^nd\.session_token=/); // sem twoFactorRedirect
  });

  it('Review Focus 3: conta inexistente, a própria conta, conta sem 2FA e e-mail vazio → erro com a mensagem e nada muda', async () => {
    const admin = await comDoisFatores('admin');
    const sem = await criarEEntrar(db, auth, { appRole: 'nutri' });
    const autor = { origem: 'admin' as const, adminId: admin.id };
    const avisar = avisos();
    const casos: [string, Codigo2fa, string][] = [
      [`ninguem-${randomUUID()}@teste.dev`, 'nao_encontrada', MSG_2FA.naoEncontrada],
      [admin.email, 'propria', MSG_2FA.propria],
      [sem.email, 'sem_2fa', MSG_2FA.semDoisFatores],
      ['   ', 'email', MSG_2FA.email],
    ];
    for (const [email, codigo, mensagem] of casos) {
      const erro = await reiniciarDoisFatores(email, autor, { db, avisar }).catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(Reiniciar2faError);
      expect(erro).toMatchObject({ codigo, message: mensagem });
    }
    expect(avisar).not.toHaveBeenCalled();
    expect(await db.select().from(twoFactor).where(eq(twoFactor.userId, admin.id))).toHaveLength(1);
    expect(await db.select().from(adminActions).where(eq(adminActions.alvoUserId, admin.id))).toEqual([]);
  });

  it('code review do PR #22, item 3: configuração pela metade (linha de two_factor sem two_factor_enabled) → sem_2fa e nada muda', async () => {
    const admin = await criarEEntrar(db, auth, { appRole: 'admin', twoFactorEnabled: true });
    const metade = await criarEEntrar(db, auth, { appRole: 'nutri' });
    await db.insert(twoFactor).values({ userId: metade.id, secret: 'cifrado-qualquer', backupCodes: 'cifrado-qualquer' });
    const avisar = avisos();
    const erro = await reiniciarDoisFatores(metade.email, { origem: 'admin', adminId: admin.id }, { db, avisar }).catch((e: unknown) => e);
    expect(erro).toMatchObject({ codigo: 'sem_2fa', message: MSG_2FA.semDoisFatores });
    expect(avisar).not.toHaveBeenCalled();
    expect(await db.select().from(twoFactor).where(eq(twoFactor.userId, metade.id))).toHaveLength(1);
    expect(await db.select().from(session).where(eq(session.userId, metade.id))).toHaveLength(1);
    expect(await db.select().from(adminActions).where(eq(adminActions.alvoUserId, metade.id))).toEqual([]);
  });

  it('o e-mail não entra na fila → nada muda (mesma transação)', async () => {
    const alvo = await comDoisFatores('nutri');
    const falha = vi.fn(async () => { throw new Error('A fila de e-mail recusou o envio'); });
    await expect(reiniciarDoisFatores(alvo.email, { origem: 'cli', adminId: null }, { db, avisar: falha })).rejects.toThrow('recusou');
    expect(await db.select().from(twoFactor).where(eq(twoFactor.userId, alvo.id))).toHaveLength(1);
    expect(await db.select().from(session).where(eq(session.userId, alvo.id))).toHaveLength(2);
  });

  it('pelo comando no servidor (último admin travado): origem cli, sem admin, e o admin alvo é reiniciado', async () => {
    const alvo = await comDoisFatores('admin');
    const r = await reiniciarDoisFatores(alvo.email, { origem: 'cli', adminId: null }, { db, avisar: avisos() });
    expect(r.papel).toBe('admin');
    const [reg] = await db.select().from(adminActions).where(eq(adminActions.alvoUserId, alvo.id));
    expect(reg).toMatchObject({ adminUserId: null, origem: 'cli' });
  });
});

describe('reiniciarPeloAdmin: o código do 2FA da própria admin (code review do PR #22, item 1)', () => {
  const headers = () => new Headers({ cookie: 'nd.session_token=qualquer' });
  const recusas = (adminId: string) =>
    db.select().from(adminActions).where(eq(adminActions.adminUserId, adminId)).then((r) => r.filter((x) => x.acao === 'codigo_2fa_recusado'));

  it('código certo: confere o código da admin (sessão dela) e reinicia o 2FA da outra conta', async () => {
    const admin = await criarEEntrar(db, auth, { appRole: 'admin', twoFactorEnabled: true });
    const alvo = await comDoisFatores('nutri');
    const confirmar2fa = vi.fn(async () => 'ok' as const);
    const h = headers();
    const r = await reiniciarPeloAdmin(alvo.email, { adminId: admin.id, codigo: '123456', headers: h }, { db, avisar: avisos(), confirmar2fa });
    expect(r.papel).toBe('nutri');
    expect(confirmar2fa).toHaveBeenCalledWith({ userId: admin.id, codigo: '123456', headers: h });
    expect(await db.select().from(twoFactor).where(eq(twoFactor.userId, alvo.id))).toEqual([]);
  });

  it('código errado: recusa com a mensagem, registra a recusa (sem conta-alvo, sem e-mail) e nada muda na outra conta', async () => {
    const admin = await criarEEntrar(db, auth, { appRole: 'admin', twoFactorEnabled: true });
    const alvo = await comDoisFatores('nutri');
    const avisar = avisos();
    const erro = await reiniciarPeloAdmin(alvo.email, { adminId: admin.id, codigo: '000000', headers: headers() }, { db, avisar, confirmar2fa: async () => 'invalido' }).catch((e: unknown) => e);
    expect(erro).toMatchObject({ codigo: 'codigo', message: MSG_2FA.codigo });
    expect(await recusas(admin.id)).toEqual([expect.objectContaining({ acao: 'codigo_2fa_recusado', alvoUserId: null, alvoPapel: null, origem: 'admin' })]);
    expect(await db.select().from(twoFactor).where(eq(twoFactor.userId, alvo.id))).toHaveLength(1);
    expect(avisar).not.toHaveBeenCalled();
  });

  it('muitas tentativas: recusa sem conferir mais nada', async () => {
    const admin = await criarEEntrar(db, auth, { appRole: 'admin', twoFactorEnabled: true });
    const alvo = await comDoisFatores('nutri');
    const erro = await reiniciarPeloAdmin(alvo.email, { adminId: admin.id, codigo: '123456', headers: headers() }, { db, avisar: avisos(), confirmar2fa: async () => 'bloqueado' }).catch((e: unknown) => e);
    expect(erro).toMatchObject({ codigo: 'tentativas', message: MSG_2FA.tentativas });
    expect(await db.select().from(twoFactor).where(eq(twoFactor.userId, alvo.id))).toHaveLength(1);
  });

  it('e-mail vazio: recusa antes de gastar uma tentativa do código', async () => {
    const admin = await criarEEntrar(db, auth, { appRole: 'admin', twoFactorEnabled: true });
    const confirmar2fa = vi.fn(async () => 'ok' as const);
    await expect(reiniciarPeloAdmin('  ', { adminId: admin.id, codigo: '123456', headers: headers() }, { db, confirmar2fa })).rejects.toMatchObject({ codigo: 'email' });
    expect(confirmar2fa).not.toHaveBeenCalled();
  });

  it('conta de paciente: recusa com código próprio, nada muda e o código volta a valer', async () => {
    const admin = await criarEEntrar(db, auth, { appRole: 'admin', twoFactorEnabled: true });
    const paciente = await comDoisFatores('paciente');
    const liberar2fa = vi.fn(async () => undefined);
    const avisar = avisos();
    const erro = await reiniciarPeloAdmin(paciente.email, { adminId: admin.id, codigo: '123456', headers: headers() }, { db, avisar, confirmar2fa: async () => 'ok', liberar2fa }).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(Reiniciar2faError);
    expect(erro).toMatchObject({ codigo: 'paciente', message: MSG_2FA.paciente });
    expect(liberar2fa).toHaveBeenCalledWith({ userId: admin.id, codigo: '123456' });
    expect(avisar).not.toHaveBeenCalled();
    expect(await db.select().from(twoFactor).where(eq(twoFactor.userId, paciente.id))).toHaveLength(1);
    expect(await db.select().from(session).where(eq(session.userId, paciente.id))).toHaveLength(2);
  });

  it('pelo comando no servidor, a conta de paciente continua podendo ser reiniciada (só o dono, no host)', async () => {
    const paciente = await comDoisFatores('paciente');
    await expect(reiniciarDoisFatores(paciente.email, { origem: 'cli', adminId: null }, { db, avisar: avisos() })).resolves.toMatchObject({ papel: 'paciente' });
  });

  it('anti-repetição e limite de verdade (confirmarCodigo2fa): o mesmo código não reinicia duas contas; a recusa por conta inexistente devolve o código', async () => {
    const admin = await criarEEntrar(db, auth, { appRole: 'admin', twoFactorEnabled: true });
    const a = await comDoisFatores('nutri');
    const b = await comDoisFatores('nutri');
    const confirmar2fa = (e: Parameters<typeof confirmarCodigo2fa>[0]) => confirmarCodigo2fa(e, { db, verificar: async () => true });
    const deps = { db, avisar: avisos(), confirmar2fa };
    const pedido = { adminId: admin.id, codigo: '246 810', headers: headers() };
    await expect(reiniciarPeloAdmin(`ninguem-${randomUUID()}@teste.dev`, pedido, deps)).rejects.toMatchObject({ codigo: 'nao_encontrada' });
    await expect(reiniciarPeloAdmin(a.email, pedido, deps)).resolves.toMatchObject({ userId: a.id }); // o código voltou a valer
    await expect(reiniciarPeloAdmin(b.email, pedido, deps)).rejects.toMatchObject({ codigo: 'codigo' }); // já usado
    expect(await db.select().from(twoFactor).where(eq(twoFactor.userId, b.id))).toHaveLength(1);
    expect(await recusas(admin.id)).toHaveLength(1);
  });
});

describe('mensagemDaFalha do comando no servidor (code review do PR #22, item 9)', () => {
  it('recusa conhecida: a mensagem; erro inesperado: o nome e o SQLSTATE, nunca a mensagem (regra 3)', () => {
    expect(mensagemDaFalha(new Reiniciar2faError('nao_encontrada'))).toBe(MSG_2FA.naoEncontrada);
    const pg = Object.assign(new Error('insert into admin_actions … ana@exemplo.com'), { code: '42501' });
    const drizzle = Object.assign(new Error('Failed query: … ana@exemplo.com'), { name: 'DrizzleQueryError', cause: pg });
    const m = mensagemDaFalha(drizzle);
    expect(m).toBe('Erro inesperado ao reiniciar a verificação em duas etapas (DrizzleQueryError, SQLSTATE 42501)');
    expect(mensagemDaFalha(new TypeError('x@y.z'))).toBe('Erro inesperado ao reiniciar a verificação em duas etapas (TypeError)');
  });
});

describe('Plano 26 (§3, RE-D20): reiniciar o 2FA de uma conta da recepção', () => {
  it('pelo admin: admin_actions.alvo_papel = recepcao; a próxima entrada dela cai na configuração obrigatória (setup-2fa)', async () => {
    const admin = await criarEEntrar(db, auth, { appRole: 'admin', twoFactorEnabled: true });
    const [t] = await db.insert(tenants).values({ slug: `r2-${randomUUID().slice(0, 8)}`, nomeExibicao: 'R2' }).returning();
    const r = await recepcaoComLogin(db, auth, t.id);
    await db.insert(twoFactor).values({ userId: r.id, secret: 'cifrado-qualquer', backupCodes: 'cifrado-qualquer' });
    const res = await reiniciarPeloAdmin(r.email, { adminId: admin.id, codigo: '123456', headers: new Headers() }, { db, avisar: avisos(), confirmar2fa: async () => 'ok' });
    expect(res).toMatchObject({ userId: r.id, papel: 'recepcao' });
    const [reg] = await db.select().from(adminActions).where(eq(adminActions.alvoUserId, r.id));
    expect(reg).toMatchObject({ acao: 'reiniciar_2fa', alvoPapel: 'recepcao', origem: 'admin' });
    expect(mensagemDoReinicio(res.papel)).toBe(MSG_2FA.okAdmin);
    await expect(entrar(auth, r.email)).resolves.toMatch(/^nd\.session_token=/); // sem o desafio do 2FA
    const [u] = await db.select({ appRole: user.appRole, twoFactorEnabled: user.twoFactorEnabled }).from(user).where(eq(user.id, r.id));
    const agora = new Date();
    expect(evaluateSession({ now: agora, path: '/painel', allowed: ['nutri', 'recepcao'], session: { updatedAt: agora, createdAt: agora }, user: u, equipe: { ativo: true } })).toBe('setup-2fa');
  });
  it('a mensagem do reinício: admin e recepção têm a configuração obrigatória no próximo login; nutricionista e paciente, não', () => {
    expect([mensagemDoReinicio('admin'), mensagemDoReinicio('recepcao')]).toEqual([MSG_2FA.okAdmin, MSG_2FA.okAdmin]);
    expect([mensagemDoReinicio('nutri'), mensagemDoReinicio('paciente')]).toEqual([MSG_2FA.ok, MSG_2FA.ok]);
    // o comando no servidor segue a mesma regra
    expect([mensagemDoComando('admin'), mensagemDoComando('recepcao')]).toEqual(['No próximo login, a configuração será obrigatória.', 'No próximo login, a configuração será obrigatória.']);
    expect([mensagemDoComando('nutri'), mensagemDoComando('paciente')]).toEqual(['A pessoa pode ativar de novo em Conta > Segurança.', 'A pessoa pode ativar de novo em Conta > Segurança.']);
  });
});
