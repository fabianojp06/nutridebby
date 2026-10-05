import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { and, count, eq, isNull } from 'drizzle-orm';
import { makeDb, semPreChecagem } from '../../../test/db';
import { closeDb } from '@/db/client';
import { account, invites, tenants, user } from '@/db/schema';
import { EMAIL_FINALIDADE } from '@/email/queue';
import type { EmailJobData, EmailMessage } from '@/email/types';
import { getBoss, stopBoss } from '@/jobs/boss';
import { createAuth } from '@/lib/auth';
import { openSecret, sha256 } from '@/lib/crypto';
import { hashPassword } from '@/lib/password.server';
import { ContaError, criarContaNutri, definirDocumentosLiberados, listarContas, reenviarConvite } from './contas';
import { ContaNaoEncontradaError } from './tenant-status';
import { inspecionarConvite } from './convites';

const app = makeDb(inject('appDatabaseUrl'));
const now = new Date('2026-10-01T12:00:00Z');
const deps = { db: app.db, appUrl: 'http://localhost:3000', now };
afterAll(async () => {
  // getBoss() (usado por convitesPara) abre o pool do módulo via getPool() — sem fechá-lo
  // (closeDb()) depois de stopBoss(), a saída do teste não fica limpa.
  await stopBoss();
  await closeDb();
  await app.pool.end();
});

const s = () => randomUUID().slice(0, 8);
async function convitesPara(email: string): Promise<string[]> {
  const jobs = await (await getBoss()).findJobs<EmailJobData>('email');
  return jobs
    .map((j) => JSON.parse(openSecret(j.data.selado, EMAIL_FINALIDADE)) as EmailMessage)
    .filter((m): m is Extract<EmailMessage, { tipo: 'convite_nutri' }> => m.tipo === 'convite_nutri' && m.para === email)
    .map((m) => m.link);
}
const tokenDe = (link: string) => link.split('/convite/')[1];

describe('criarContaNutri (US-001)', () => {
  it('cria tenant ativa com cota 500, nutri sem senha, convite de 72 h só em hash e e-mail na fila', async () => {
    const x = s();
    const r = await criarContaNutri({ nomeExibicao: 'Debby Silva', email: `debby-${x}@exemplo.com`, crn: 'crn-3 12345', slug: `debby-${x}` }, deps);
    const [t] = await app.db.select().from(tenants).where(eq(tenants.id, r.tenantId));
    expect(t).toMatchObject({ status: 'ativa', waCotaMensal: 500, crn: 'CRN-3 12345', slug: `debby-${x}`, nomeExibicao: 'Debby Silva' });
    const [u] = await app.db.select().from(user).where(eq(user.id, r.userId));
    expect(u).toMatchObject({ appRole: 'nutri', tenantId: r.tenantId, emailVerified: false, email: `debby-${x}@exemplo.com` });
    expect(await app.db.select().from(account).where(eq(account.userId, r.userId))).toEqual([]);
    const [c] = await app.db.select().from(invites).where(eq(invites.userId, r.userId));
    expect(c.expiraEm.toISOString()).toBe('2026-10-04T12:00:00.000Z');
    const links = await convitesPara(`debby-${x}@exemplo.com`);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatch(/^http:\/\/localhost:3000\/convite\/[A-Za-z0-9_-]{43}$/);
    expect(c.tokenHash).toBe(sha256(tokenDe(links[0])));
    expect(await inspecionarConvite(app.db, tokenDe(links[0]), now)).toMatchObject({ estado: 'valido', email: `debby-${x}@exemplo.com`, nome: 'Debby Silva' });
    expect(await inspecionarConvite(app.db, tokenDe(links[0]), new Date('2026-10-04T12:00:01Z'))).toEqual({ estado: 'expirado' });
    expect(await inspecionarConvite(app.db, 'A'.repeat(43), now)).toEqual({ estado: 'invalido' });
    expect(await inspecionarConvite(app.db, '../etc', now)).toEqual({ estado: 'invalido' });
  });

  it('mensagens exatas de validação', async () => {
    const e = await criarContaNutri({ nomeExibicao: 'Db', email: 'nao-e-email', crn: '12345', slug: 'a b' }, deps).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ContaError);
    expect((e as ContaError).erros).toEqual({
      nomeExibicao: 'Informe o nome (3 a 80 caracteres)',
      email: 'Informe um e-mail válido',
      crn: 'CRN inválido. Ex.: CRN-3 12345',
      slug: 'Use de 3 a 40 letras minúsculas, números ou hífen',
    });
  });

  it('slug duplicado: "Endereço já em uso" e nenhum tenant ou usuário é criado', async () => {
    const x = s();
    await criarContaNutri({ nomeExibicao: 'Primeira', email: `p-${x}@exemplo.com`, crn: 'CRN-3 12345', slug: `dup-${x}` }, deps);
    const e = await criarContaNutri({ nomeExibicao: 'Segunda', email: `s-${x}@exemplo.com`, crn: 'CRN-3 12345', slug: `dup-${x}` }, deps).catch((x2: unknown) => x2);
    expect((e as ContaError).erros).toEqual({ slug: 'Endereço já em uso' });
    // PF-F2: verifica pelas linhas que este teste criaria, não por contagem global
    // (arquivos de teste rodam em paralelo).
    expect((await app.db.select({ n: count() }).from(user).where(eq(user.email, `s-${x}@exemplo.com`)))[0].n).toBe(0);
    expect((await app.db.select({ n: count() }).from(tenants).where(eq(tenants.slug, `dup-${x}`)))[0].n).toBe(1);
  });

  it('e-mail e slug com maiúsculas e espaços são normalizados; duplicidade sem diferenciar maiúsculas (Review Focus 1)', async () => {
    const x = s();
    const r = await criarContaNutri({ nomeExibicao: '  Ana Paula  ', email: `  Ana.Paula-${x}@Exemplo.COM `, crn: 'CRN3 123', slug: `  Ana-${x} ` }, deps);
    const [u] = await app.db.select().from(user).where(eq(user.id, r.userId));
    expect(u.email).toBe(`ana.paula-${x}@exemplo.com`);
    expect(u.name).toBe('Ana Paula');
    const [t] = await app.db.select().from(tenants).where(eq(tenants.id, r.tenantId));
    expect(t.slug).toBe(`ana-${x}`);
    const e = await criarContaNutri({ nomeExibicao: 'Outra', email: `ANA.PAULA-${x}@exemplo.com`, crn: 'CRN-3 12345', slug: `outra-${x}` }, deps).catch((y: unknown) => y);
    expect((e as ContaError).erros).toEqual({ email: 'E-mail já cadastrado' });
  });

  it('corrida entre dois admins com o mesmo endereço: um cria, o outro recebe "Endereço já em uso"', async () => {
    const x = s();
    const [a, b] = await Promise.allSettled([
      criarContaNutri({ nomeExibicao: 'Corrida A', email: `ca-${x}@exemplo.com`, crn: 'CRN-3 12345', slug: `corrida-${x}` }, deps),
      criarContaNutri({ nomeExibicao: 'Corrida B', email: `cb-${x}@exemplo.com`, crn: 'CRN-3 12345', slug: `corrida-${x}` }, deps),
    ]);
    const ok = [a, b].filter((p) => p.status === 'fulfilled');
    const falha = [a, b].find((p): p is PromiseRejectedResult => p.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect((falha!.reason as ContaError).erros).toEqual({ slug: 'Endereço já em uso' });
  });

  // T5-R1: a corrida acima nem sempre chega a disputar o INSERT nesta máquina (a pré-checagem de
  // uma delas já vê a linha da outra). Estes dois testes forçam, de forma determinística, o
  // caminho em que só a constraint UNIQUE decide — com `semPreChecagem`, a pré-checagem sempre
  // devolve [], então o INSERT real é quem bate na linha já existente.
  it('slug já existente (sem a pré-checagem enxergar): uniqueViolation mapeia para "Endereço já em uso" e desfaz a transação', async () => {
    const x = s();
    await app.db.insert(tenants).values({ slug: `existe-${x}`, nomeExibicao: 'Já existe' });
    const e = await criarContaNutri(
      { nomeExibicao: 'Nova', email: `nova-slug-${x}@exemplo.com`, crn: 'CRN-3 12345', slug: `existe-${x}` },
      { ...deps, db: semPreChecagem(app.db) },
    ).catch((x2: unknown) => x2);
    expect(e).toBeInstanceOf(ContaError);
    expect((e as ContaError).erros).toEqual({ slug: 'Endereço já em uso' });
    expect((await app.db.select({ n: count() }).from(user).where(eq(user.email, `nova-slug-${x}@exemplo.com`)))[0].n).toBe(0);
  });

  it('e-mail já cadastrado (sem a pré-checagem enxergar): uniqueViolation mapeia para "E-mail já cadastrado" e desfaz a transação', async () => {
    const x = s();
    const email = `existe-email-${x}@exemplo.com`;
    await app.db.insert(user).values({ id: randomUUID(), name: 'Já existe', email, emailVerified: false, appRole: 'nutri' });
    const e = await criarContaNutri(
      { nomeExibicao: 'Nova', email, crn: 'CRN-3 12345', slug: `novo-email-${x}` },
      { ...deps, db: semPreChecagem(app.db) },
    ).catch((x2: unknown) => x2);
    expect(e).toBeInstanceOf(ContaError);
    expect((e as ContaError).erros).toEqual({ email: 'E-mail já cadastrado' });
    expect((await app.db.select({ n: count() }).from(tenants).where(eq(tenants.slug, `novo-email-${x}`)))[0].n).toBe(0);
  });

  it('faz login com o e-mail em MAIÚSCULAS depois de aceitar o convite (Review Focus 1, PF-F7)', async () => {
    const x = s();
    const email = `maiusc-${x}@exemplo.com`;
    const senha = 'Nutri2026segura';
    const r = await criarContaNutri({ nomeExibicao: 'Maiusc', email, crn: 'CRN-3 12345', slug: `maiusc-${x}` }, deps);
    // Simula a aceitação do convite (a senha é gravada pela Tarefa 6): grava a credencial
    // diretamente, como o aceite fará, e confere que o login não diferencia maiúsculas (citext).
    await app.db.insert(account).values({ id: randomUUID(), userId: r.userId, accountId: r.userId, providerId: 'credential', password: await hashPassword(senha) });
    const auth = createAuth(app.db);
    const res = await auth.handler(
      new Request('http://localhost:3000/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        body: JSON.stringify({ email: email.toUpperCase(), password: senha }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ user: { id: r.userId, email } });
  });
});

describe('reenviarConvite (US-001 "Convite expirado")', () => {
  it('troca o convite: o link antigo deixa de valer e um novo e-mail é enfileirado', async () => {
    const x = s();
    const email = `reenvio-${x}@exemplo.com`;
    const r = await criarContaNutri({ nomeExibicao: 'Reenvio', email, crn: 'CRN-3 12345', slug: `reenvio-${x}` }, deps);
    const [antigo] = await convitesPara(email);
    const depois = new Date('2026-10-05T12:00:00Z'); // o primeiro já expirou
    await reenviarConvite(r.tenantId, { ...deps, now: depois });
    const links = await convitesPara(email);
    expect(links).toHaveLength(2);
    const novo = links.find((l) => l !== antigo)!;
    expect(await inspecionarConvite(app.db, tokenDe(antigo), depois)).toEqual({ estado: 'invalido' });
    expect(await inspecionarConvite(app.db, tokenDe(novo), depois)).toMatchObject({ estado: 'valido' });
  });

  it('recusa quando a nutricionista já definiu a senha (T5-R2: code "ja_tem_senha")', async () => {
    const x = s();
    const r = await criarContaNutri({ nomeExibicao: 'Com senha', email: `cs-${x}@exemplo.com`, crn: 'CRN-3 12345', slug: `com-senha-${x}` }, deps);
    await app.db.insert(account).values({ id: randomUUID(), userId: r.userId, accountId: r.userId, providerId: 'credential', password: 'x' });
    const e = await reenviarConvite(r.tenantId, deps).catch((x2: unknown) => x2);
    expect(e).toBeInstanceOf(ContaError);
    expect((e as ContaError).code).toBe('ja_tem_senha');
    expect((e as ContaError).erros).toEqual({ geral: 'A nutricionista já definiu a senha. Se ela esqueceu, use "Esqueci minha senha".' });
  });

  it('recusa quando o tenant não tem nutricionista (T5-R2: code "sem_nutri")', async () => {
    const e = await reenviarConvite(randomUUID(), deps).catch((x2: unknown) => x2);
    expect(e).toBeInstanceOf(ContaError);
    expect((e as ContaError).code).toBe('sem_nutri');
    expect((e as ContaError).erros).toEqual({ geral: 'Conta sem nutricionista.' });
  });

  it('recusa quando o tenant está suspenso (PF-N6, code "conta_suspensa")', async () => {
    const x = s();
    const r = await criarContaNutri({ nomeExibicao: 'Suspensa', email: `susp-${x}@exemplo.com`, crn: 'CRN-3 12345', slug: `susp-${x}` }, deps);
    await app.db.update(tenants).set({ status: 'suspensa' }).where(eq(tenants.id, r.tenantId));
    const e = await reenviarConvite(r.tenantId, deps).catch((x2: unknown) => x2);
    expect(e).toBeInstanceOf(ContaError);
    expect((e as ContaError).code).toBe('conta_suspensa');
    expect((e as ContaError).erros).toEqual({ geral: 'Conta suspensa: reative antes de reenviar o convite.' });
  });

  it('dois reenvios ao mesmo tempo (duplo clique) deixam só um convite não usado (T5-R3)', async () => {
    const x = s();
    const email = `duplo-${x}@exemplo.com`;
    const r = await criarContaNutri({ nomeExibicao: 'Duplo clique', email, crn: 'CRN-3 12345', slug: `duplo-${x}` }, deps);
    await Promise.all([reenviarConvite(r.tenantId, deps), reenviarConvite(r.tenantId, deps)]);
    const pendentes = await app.db.select().from(invites).where(and(eq(invites.userId, r.userId), isNull(invites.usadoEm)));
    expect(pendentes).toHaveLength(1);
  });
});

describe('listarContas', () => {
  it('mostra o estado do convite: pendente, expirado e aceito', async () => {
    const x = s();
    const r = await criarContaNutri({ nomeExibicao: 'Lista', email: `lista-${x}@exemplo.com`, crn: 'CRN-3 12345', slug: `lista-${x}` }, deps);
    const achar = async (quando: Date) => (await listarContas(app.db, quando)).find((c) => c.tenantId === r.tenantId)!;
    expect(await achar(now)).toMatchObject({ convite: 'pendente', email: `lista-${x}@exemplo.com`, status: 'ativa', slug: `lista-${x}` });
    expect((await achar(new Date('2026-10-05T00:00:00Z'))).convite).toBe('expirado');
    await app.db.insert(account).values({ id: randomUUID(), userId: r.userId, accountId: r.userId, providerId: 'credential', password: 'x' });
    await app.db.update(invites).set({ usadoEm: now }).where(and(eq(invites.userId, r.userId)));
    expect((await achar(now)).convite).toBe('aceito');
  });

  it('traz a base do CS-03 e o início do uso (D15) como número e "AAAA-MM-DD"', async () => {
    const x = s();
    const r = await criarContaNutri({ nomeExibicao: 'Métricas', email: `met-${x}@exemplo.com`, crn: 'CRN-3 12345', slug: `met-${x}` }, deps);
    const achar = async () => (await listarContas(app.db, now)).find((c) => c.tenantId === r.tenantId)!;
    expect(await achar()).toMatchObject({ taxaFaltasBase: null, goLiveEm: null });
    await app.db.update(tenants).set({ taxaFaltasBase: 18.5, goLiveEm: '2026-10-01' }).where(eq(tenants.id, r.tenantId));
    expect(await achar()).toMatchObject({ taxaFaltasBase: 18.5, goLiveEm: '2026-10-01' });
  });
});

describe('definirDocumentosLiberados (D20, Plano 10A)', () => {
  it('nasce bloqueado; o admin libera e bloqueia de novo; a lista mostra; conta inexistente → ContaNaoEncontradaError', async () => {
    const x = s();
    const r = await criarContaNutri({ nomeExibicao: 'Documentos', email: `doc-${x}@exemplo.com`, crn: 'CRN-3 12345', slug: `doc-${x}` }, deps);
    const achar = async () => (await listarContas(app.db, now)).find((c) => c.tenantId === r.tenantId)!;
    expect((await achar()).documentosLiberados).toBe(false);
    await definirDocumentosLiberados(app.db, r.tenantId, true, randomUUID());
    expect((await achar()).documentosLiberados).toBe(true);
    await definirDocumentosLiberados(app.db, r.tenantId, false, randomUUID());
    expect((await achar()).documentosLiberados).toBe(false);
    await expect(definirDocumentosLiberados(app.db, randomUUID(), true, randomUUID())).rejects.toThrow(ContaNaoEncontradaError);
  });
});
