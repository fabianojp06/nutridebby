import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { emailsNaFila, novoPaciente, novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { account, auditLog, consents, invites, patients, tenants, user } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { createAuth } from '@/lib/auth';
import { verifyPassword } from '@/lib/password.server';
import { entrar } from '../../../test/sessao';
import { stopBoss } from '@/jobs/boss';
import { sha256 } from '@/lib/crypto';
import { aceitarConvite, CONVITE_INVALIDO, inspecionarConvite } from '@/modules/plataforma/convites';
import { PacienteNaoEncontradoError } from './base';
import { anonimizarContaSemVinculo, contaSemOutroVinculo } from './conta-titular';
import { aceitarConvitePaciente, ConvitePacienteError, inspecionarConvitePaciente, MSG_CONVITE_PACIENTE, reenviarConvitePaciente, situacaoDoAcesso, vincularContaExistente } from './convite-paciente';
import { atualizarPaciente, buscarPaciente, criarPaciente, listarPacientes } from './pacientes';
import { MSG_TERMO_NAO_ACEITO, TERMO_PACIENTE } from './termo-paciente';

const app = makeDb(inject('appDatabaseUrl'));
const now = new Date('2026-10-01T15:00:00Z');
const deps = { db: app.db, now, appUrl: 'http://localhost:3000' };
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});

const s = () => randomUUID().slice(0, 8);
const dados = (email: string) => ({ nome: 'Ana Souza', dataNascimento: '1991-03-10', sexo: 'F', email, telefone: '', whatsappAutorizado: false });
const tokenDe = (link: string) => link.split('/convite/paciente/')[1];
const pendentes = (patientId: string) => app.db.select().from(invites).where(and(eq(invites.patientId, patientId), isNull(invites.usadoEm)));

describe('convite do paciente (US-010)', () => {
  it('cadastrar enfileira o convite de 7 dias; no banco só o hash do token', async () => {
    const T = await novoTenant(app.db, 'Debby Silva');
    const email = `cv-${s()}@ex.com`;
    const p = await criarPaciente(T.ctx, T.tenant, dados(email), deps);
    const [msg] = await emailsNaFila('convite_paciente', email);
    expect(msg).toMatchObject({ nome: 'Ana Souza', nutri: 'Debby Silva', contaExistente: false });
    expect(msg.link).toMatch(/^http:\/\/localhost:3000\/convite\/paciente\/[A-Za-z0-9_-]{43}$/);
    const [c] = await pendentes(p.id);
    expect(c).toMatchObject({ tipo: 'paciente', tenantId: T.tenantId, userId: null, tokenHash: sha256(tokenDe(msg.link)) });
    expect(c.expiraEm.toISOString()).toBe('2026-10-08T15:00:00.000Z');
    expect(await situacaoDoAcesso(T.ctx, p, app.db, now)).toEqual({ estado: 'pendente', expiraEm: c.expiraEm });
    expect(await situacaoDoAcesso(T.ctx, p, app.db, new Date('2026-10-08T15:00:00Z'))).toEqual({ estado: 'expirado' });
  });

  it('quem já é paciente de outra nutricionista recebe o texto de conta existente', async () => {
    const T = await novoTenant(app.db);
    const email = `ja-${s()}@ex.com`;
    await app.db.insert(user).values({ id: randomUUID(), name: 'Ana', email, appRole: 'paciente' });
    await criarPaciente(T.ctx, T.tenant, dados(email), deps);
    expect((await emailsNaFila('convite_paciente', email))[0].contaExistente).toBe(true);
  });

  it('três cadastros simultâneos do mesmo e-mail enfileiram um convite só (Review Focus 5)', async () => {
    const T = await novoTenant(app.db);
    const email = `sim-${s()}@ex.com`;
    await Promise.allSettled([1, 2, 3].map(() => criarPaciente(T.ctx, T.tenant, dados(email), deps)));
    expect(await emailsNaFila('convite_paciente', email)).toHaveLength(1);
  });

  it('reenviar troca o convite (o anterior deixa de valer) e renova os 7 dias', async () => {
    const T = await novoTenant(app.db);
    const email = `re-${s()}@ex.com`;
    const p = await criarPaciente(T.ctx, T.tenant, dados(email), deps);
    const [antigo] = await pendentes(p.id);
    const depois = new Date('2026-10-05T10:00:00Z');
    const r = await reenviarConvitePaciente(T.ctx, T.tenant, p.id, { ...deps, now: depois });
    expect(r.expiraEm.toISOString()).toBe('2026-10-12T10:00:00.000Z');
    const agora = await pendentes(p.id);
    expect(agora).toHaveLength(1);
    expect(agora[0].tokenHash).not.toBe(antigo.tokenHash);
    expect(await emailsNaFila('convite_paciente', email)).toHaveLength(2);
  });

  it('não reenvia para quem já ativou, para arquivado nem para paciente de outro tenant', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const uid = randomUUID();
    await app.db.insert(user).values({ id: uid, name: 'Ana', email: `at-${s()}@ex.com`, appRole: 'paciente' });
    const ativo = await novoPaciente(app.db, A.ctx, { userId: uid });
    await expect(reenviarConvitePaciente(A.ctx, A.tenant, ativo.id, deps)).rejects.toThrow(MSG_CONVITE_PACIENTE.jaAtivo);
    const arquivado = await novoPaciente(app.db, A.ctx, { status: 'arquivado' });
    await expect(reenviarConvitePaciente(A.ctx, A.tenant, arquivado.id, deps)).rejects.toBeInstanceOf(ConvitePacienteError);
    const deB = await novoPaciente(app.db, B.ctx);
    await expect(reenviarConvitePaciente(A.ctx, A.tenant, deB.id, deps)).rejects.toBeInstanceOf(PacienteNaoEncontradoError);
    expect(await situacaoDoAcesso(A.ctx, ativo, app.db, now)).toEqual({ estado: 'ativo' });
  });

  it('corrigir o e-mail antes do aceite manda o convite para o e-mail novo', async () => {
    const T = await novoTenant(app.db);
    const errado = `errado-${s()}@ex.com`;
    const certo = `certo-${s()}@ex.com`;
    const p = await criarPaciente(T.ctx, T.tenant, dados(errado), deps);
    await atualizarPaciente(T.ctx, T.tenant, p.id, dados(certo), deps);
    expect(await emailsNaFila('convite_paciente', certo)).toHaveLength(1);
    expect(await pendentes(p.id)).toHaveLength(1);
  });

  // Guarda de regressão: hoje o CHECK invites_alvo (user_id nulo no convite de paciente) + o innerJoin(user)
  // já barram o token; o filtro tipo = 'nutri' do Step 2 é a segunda camada. O que importa aqui é o efeito:
  // nem abre a tela, nem consome o convite do paciente pela rota da nutricionista.
  it('o token do paciente não abre nem consome o primeiro acesso da nutricionista (/convite/<token>)', async () => {
    const T = await novoTenant(app.db);
    const email = `nt-${s()}@ex.com`;
    const p = await criarPaciente(T.ctx, T.tenant, dados(email), deps);
    const [msg] = await emailsNaFila('convite_paciente', email);
    const token = tokenDe(msg.link);
    expect(await inspecionarConvite(app.db, token, now)).toEqual({ estado: 'invalido' });
    await expect(
      aceitarConvite({ token, senha: 'Senha-muito-boa-2026', confirmacao: 'Senha-muito-boa-2026', aceitouDpa: true, ip: null }, { db: app.db, now }),
    ).rejects.toThrow(CONVITE_INVALIDO);
    expect(await pendentes(p.id)).toHaveLength(1); // usado_em continua nulo
  });
});

const SENHA = 'Paciente2026segura';
const auth = createAuth(app.db, { verificarTurnstile: async () => 'ok' });

/** Paciente cadastrado pela nutricionista (com WhatsApp autorizado) + token do convite em claro. */
async function convidado(extra: Record<string, unknown> = {}) {
  const T = await novoTenant(app.db, 'Debby Silva');
  const email = `ac-${s()}@ex.com`;
  const p = await criarPaciente(T.ctx, T.tenant, { ...dados(email), telefone: '(11) 91234-5678', whatsappAutorizado: true, ...extra }, deps);
  const [msg] = await emailsNaFila('convite_paciente', email);
  return { T, p, email, token: tokenDe(msg.link) };
}
/** O aceite vem depois do cadastro: o opt-in do paciente tem data nova (o gatilho da 0085 recusa reaproveitar a da nutri). */
const depois = new Date(now.getTime() + 60_000);
const aceite = (token: string, extra: Partial<Parameters<typeof aceitarConvitePaciente>[0]> = {}) =>
  aceitarConvitePaciente({ token, senha: SENHA, confirmacao: SENHA, aceitouTermo: true, whatsapp: true, ip: '203.0.113.30', ...extra }, { db: app.db, now: depois });
const lerPaciente = async (T: { tenantId: string; ctx: Parameters<typeof withTenant>[0] }, id: string) =>
  (await withTenant(T.ctx, (tx) => tx.select().from(patients).where(eq(patients.id, id)), app.db))[0];

describe('aceite do convite — conta nova (US-011)', () => {
  it('cria a conta de paciente, grava a senha, o termo (versão, data, IP), liga o prontuário e o opt-in do próprio paciente', async () => {
    const c = await convidado();
    expect(await inspecionarConvitePaciente(app.db, c.token, now)).toMatchObject({ estado: 'valido', conta: 'nenhuma', nutri: 'Debby Silva', temTelefone: true, whatsappMarcado: true });
    expect(await aceite(c.token)).toEqual({ email: c.email });
    const [u] = await app.db.select().from(user).where(eq(user.email, c.email));
    expect(u).toMatchObject({ appRole: 'paciente', tenantId: null, emailVerified: true, name: 'Ana Souza' });
    const [acc] = await app.db.select().from(account).where(eq(account.userId, u.id));
    expect(await verifyPassword(acc.password!, SENHA)).toBe(true);
    const [cons] = await app.db.select().from(consents).where(eq(consents.userId, u.id));
    expect(cons).toMatchObject({ termoVersao: TERMO_PACIENTE, tenantId: c.T.tenantId, ip: '203.0.113.30' });
    const p = await lerPaciente(c.T, c.p.id);
    expect(p).toMatchObject({ userId: u.id, whatsappOptinEm: depois, whatsappOptinOrigem: 'paciente', whatsappOptoutEm: null });
    const log = await withTenant(c.T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.entidadeId, c.p.id), eq(auditLog.acao, 'alterar'))).orderBy(auditLog.criadoEm), app.db);
    expect(log.at(-1)).toMatchObject({ actorUserId: u.id, ip: '203.0.113.30' });
    await expect(entrar(auth, c.email, SENHA)).resolves.toMatch(/^nd\.session_token=/);
    expect(await inspecionarConvitePaciente(app.db, c.token, now)).toEqual({ estado: 'invalido' });
  });

  it('sem o termo, com senha fraca ou senhas diferentes: nada é gravado e o convite continua valendo', async () => {
    const c = await convidado();
    await expect(aceite(c.token, { aceitouTermo: false })).rejects.toThrow(MSG_TERMO_NAO_ACEITO);
    await expect(aceite(c.token, { senha: 'curta1', confirmacao: 'curta1' })).rejects.toThrow('A senha precisa ter pelo menos 10 caracteres.');
    await expect(aceite(c.token, { confirmacao: 'Outra2026senha' })).rejects.toThrow('As senhas não conferem.');
    expect(await app.db.select().from(user).where(eq(user.email, c.email))).toEqual([]);
    await expect(aceite(c.token)).resolves.toEqual({ email: c.email });
  });

  it('desmarcar o WhatsApp que a nutricionista tinha autorizado grava o opt-out', async () => {
    const c = await convidado();
    await aceite(c.token, { whatsapp: false });
    const p = await lerPaciente(c.T, c.p.id);
    expect(p.whatsappOptinOrigem).toBe('nutri');
    expect(p.whatsappOptoutEm?.toISOString()).toBe(depois.toISOString());
  });

  it('duplo clique em "Continuar": uma conta só, os outros envios veem convite inválido (Review Focus 3)', async () => {
    const c = await convidado();
    const r = await Promise.allSettled([aceite(c.token), aceite(c.token), aceite(c.token)]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    for (const f of r.filter((x): x is PromiseRejectedResult => x.status === 'rejected')) {
      expect((f.reason as Error).message).toBe(MSG_CONVITE_PACIENTE.invalido);
    }
    expect(await app.db.select().from(user).where(eq(user.email, c.email))).toHaveLength(1);
  });

  it('expirado, arquivado depois do convite, ou nutricionista suspensa: recusado', async () => {
    const c = await convidado();
    await expect(aceitarConvitePaciente({ token: c.token, senha: SENHA, confirmacao: SENHA, aceitouTermo: true, whatsapp: false, ip: null }, { db: app.db, now: new Date('2026-10-08T15:00:01Z') })).rejects.toThrow(
      MSG_CONVITE_PACIENTE.expirado,
    );
    const arq = await convidado();
    await withTenant(arq.T.ctx, (tx) => tx.update(patients).set({ status: 'arquivado' }).where(eq(patients.id, arq.p.id)), app.db);
    await expect(aceite(arq.token)).rejects.toThrow(MSG_CONVITE_PACIENTE.invalido);
    const sus = await convidado();
    await app.db.update(tenants).set({ status: 'suspensa' }).where(eq(tenants.id, sus.T.tenantId));
    await expect(aceite(sus.token)).rejects.toThrow(MSG_CONVITE_PACIENTE.indisponivel);
  });
});

describe('aceite do convite — quem já tem conta (US-010 "E-mail já usado por paciente de outra nutricionista")', () => {
  it('a mesma conta passa a ter o vínculo com a segunda nutricionista; nenhum dado do tenant B aparece no A', async () => {
    const primeiro = await convidado();
    await aceite(primeiro.token);
    const [u] = await app.db.select().from(user).where(eq(user.email, primeiro.email));
    const B = await novoTenant(app.db, 'Outra Nutri');
    const pB = await criarPaciente(B.ctx, B.tenant, { ...dados(primeiro.email), nome: 'Ana S.' }, deps);
    const [msg] = (await emailsNaFila('convite_paciente', primeiro.email)).filter((m) => m.nutri === 'Outra Nutri');
    expect(msg.contaExistente).toBe(true);
    const tokenB = tokenDe(msg.link);
    expect(await inspecionarConvitePaciente(app.db, tokenB, now)).toMatchObject({ estado: 'valido', conta: 'paciente' });
    await vincularContaExistente({ token: tokenB, userId: u.id, aceitouTermo: true, whatsapp: false, ip: '203.0.113.31' }, { db: app.db, now });
    expect((await lerPaciente(B, pB.id)).userId).toBe(u.id);
    // mesma versão do termo, mas uma prova de aceite por nutricionista (controladora), com data e IP de cada vínculo
    const aceites = await app.db.select().from(consents).where(eq(consents.userId, u.id));
    expect(aceites.map((c) => [c.tenantId, c.ip]).sort()).toEqual([[B.tenantId, '203.0.113.31'], [primeiro.T.tenantId, '203.0.113.30']].sort());
    // a nutricionista A não enxerga o prontuário nem o vínculo de B (US-006)
    expect(await buscarPaciente(primeiro.T.ctx, pB.id, app.db)).toBeNull();
    expect((await listarPacientes(primeiro.T.ctx, {}, app.db)).map((x) => x.nome)).not.toContain('Ana S.');
    expect((await lerPaciente(primeiro.T, primeiro.p.id)).userId).toBe(u.id); // o vínculo de A segue o mesmo
  });

  it('B-2 (corrida com a anonimização, D18): o vínculo que espera a conta ser anonimizada é recusado e nada fica ligado à conta anonimizada', async () => {
    const primeiro = await convidado();
    await aceite(primeiro.token);
    const [u] = await app.db.select().from(user).where(eq(user.email, primeiro.email));
    const B = await novoTenant(app.db, 'Outra Nutri');
    const pB = await criarPaciente(B.ctx, B.tenant, dados(primeiro.email), deps);
    const tokenB = tokenDe((await emailsNaFila('convite_paciente', primeiro.email)).filter((m) => m.nutri === 'Outra Nutri')[0].link);
    // a sessão já foi conferida e o convite já foi lido (prepararAceite) quando a anonimização do prontuário de A começa

    // anonimização de A (job retencao-lgpd) em curso: solta a conta, confere que não há outro vínculo e a anonimiza,
    // ainda sem COMMIT
    let soltar!: () => void;
    const portao = new Promise<void>((res) => (soltar = res));
    let pidDaAnonimizacao = 0;
    let travada = false;
    const anonimizacao = withTenant(
      { tenantId: primeiro.T.tenantId, role: 'worker' },
      async (tx) => {
        pidDaAnonimizacao = (await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)).rows[0].pid;
        await tx.update(patients).set({ userId: null }).where(eq(patients.id, primeiro.p.id));
        expect(await contaSemOutroVinculo(tx, u.id)).toBe(true);
        expect(await anonimizarContaSemVinculo(tx, u.id, now)).toBe(true);
        travada = true;
        await portao;
      },
      app.db,
    );
    while (!travada) await new Promise((res) => setTimeout(res, 10)); // a conta já está travada pela anonimização

    const vinculo = vincularContaExistente({ token: tokenB, userId: u.id, aceitouTermo: true, whatsapp: false, ip: '203.0.113.32' }, { db: app.db, now }).then(
      () => 'vinculou',
      (e: unknown) => e,
    );
    // o aceite chegou à conta e espera a transação da anonimização
    const fim = Date.now() + 5000;
    let esperando = false;
    while (Date.now() < fim && !esperando) {
      const { rows } = await app.pool.query(
        `select 1 from pg_locks w join pg_locks h on h.locktype = 'transactionid' and h.transactionid = w.transactionid and h.granted
          where w.locktype = 'transactionid' and not w.granted and h.pid = $1`,
        [pidDaAnonimizacao],
      );
      esperando = rows.length > 0;
      if (!esperando) await new Promise((res) => setTimeout(res, 20));
    }
    expect(esperando).toBe(true);
    soltar();
    await anonimizacao;

    const r = await vinculo;
    expect(r).toBeInstanceOf(ConvitePacienteError);
    expect((r as Error).message).toBe(MSG_CONVITE_PACIENTE.outraConta);
    expect((await lerPaciente(B, pB.id)).userId).toBeNull();
    expect(await app.db.select().from(consents).where(and(eq(consents.userId, u.id), eq(consents.tenantId, B.tenantId)))).toEqual([]);
    expect(await pendentes(pB.id)).toHaveLength(1); // o convite não foi gasto
    // reaberto o link (sem sessão: a conta anonimizada não tem mais nenhuma), o e-mail não é mais de nenhuma conta → conta nova
    expect(await inspecionarConvitePaciente(app.db, tokenB, now)).toMatchObject({ estado: 'valido', conta: 'nenhuma' });
  });

  it('conta de outro e-mail ou e-mail que é de nutricionista: mensagem clara e nada vinculado (Review Focus 3)', async () => {
    const c = await convidado();
    const outro = randomUUID();
    await app.db.insert(user).values({ id: outro, name: 'Outra', email: `outra-${s()}@ex.com`, appRole: 'paciente' });
    await expect(vincularContaExistente({ token: c.token, userId: outro, aceitouTermo: true, whatsapp: false, ip: null }, { db: app.db, now })).rejects.toThrow(
      MSG_CONVITE_PACIENTE.outraConta,
    );
    expect((await lerPaciente(c.T, c.p.id)).userId).toBeNull();

    const T = await novoTenant(app.db);
    const emailDaNutri = `nutri-${s()}@ex.com`;
    await app.db.insert(user).values({ id: randomUUID(), name: 'Nutri', email: emailDaNutri, appRole: 'nutri', tenantId: T.tenantId });
    await criarPaciente(T.ctx, T.tenant, dados(emailDaNutri), deps);
    const token = tokenDe((await emailsNaFila('convite_paciente', emailDaNutri))[0].link);
    expect(await inspecionarConvitePaciente(app.db, token, now)).toMatchObject({ estado: 'valido', conta: 'equipe' });
    await expect(aceite(token)).rejects.toThrow(MSG_CONVITE_PACIENTE.contaDeEquipe);
  });
});
