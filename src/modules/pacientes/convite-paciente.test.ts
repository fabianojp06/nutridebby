import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { emailsNaFila, novoPaciente, novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { invites, user } from '@/db/schema';
import { stopBoss } from '@/jobs/boss';
import { sha256 } from '@/lib/crypto';
import { aceitarConvite, CONVITE_INVALIDO, inspecionarConvite } from '@/modules/plataforma/convites';
import { PacienteNaoEncontradoError } from './base';
import { ConvitePacienteError, MSG_CONVITE_PACIENTE, reenviarConvitePaciente, situacaoDoAcesso } from './convite-paciente';
import { atualizarPaciente, criarPaciente } from './pacientes';

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
