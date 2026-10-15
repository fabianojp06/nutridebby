import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { inject } from 'vitest';
import { and, count, eq, isNull } from 'drizzle-orm';
import { makeDb, semPreChecagem } from '../../../test/db';
import { novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { account, adminActions, invites, tenants, user } from '@/db/schema';
import { EMAIL_FINALIDADE } from '@/email/queue';
import type { EmailJobData, EmailMessage } from '@/email/types';
import { getBoss, stopBoss } from '@/jobs/boss';
import { createAuth } from '@/lib/auth';
import { openSecret, sha256 } from '@/lib/crypto';
import { hashPassword } from '@/lib/password.server';
import { AUTORIZACAO_IA_VERSAO, IA_ADITIVO_VERSAO } from '@/modules/ia/textos-legais';
import { ContaError, contaPorId, CONTAS_POR_PAGINA, criarContaNutri, definirDocumentosLiberados, definirIaLiberada, IaProvisoriaError, listarContas, reenviarConvite, resumoDasContas } from './contas';
import { ContaNaoEncontradaError } from './tenant-status';
import { inspecionarConvite } from './convites';

// Minor 7 da revisão final: o ambiente "de produção" só quando o teste pede (o resto do arquivo usa o emProducao real)
const ambiente = vi.hoisted(() => ({ producao: null as boolean | null }));
vi.mock('@/env', async (orig) => {
  const real = await orig<typeof import('@/env')>();
  return { ...real, emProducao: (e: Parameters<typeof real.emProducao>[0]) => ambiente.producao ?? real.emProducao(e) };
});

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
    const achar = async (quando: Date) => (await listarContas(app.db, quando, { busca: `lista-${x}` })).contas.find((c) => c.tenantId === r.tenantId)!;
    expect(await achar(now)).toMatchObject({ convite: 'pendente', email: `lista-${x}@exemplo.com`, status: 'ativa', slug: `lista-${x}` });
    expect((await achar(new Date('2026-10-05T00:00:00Z'))).convite).toBe('expirado');
    await app.db.insert(account).values({ id: randomUUID(), userId: r.userId, accountId: r.userId, providerId: 'credential', password: 'x' });
    await app.db.update(invites).set({ usadoEm: now }).where(and(eq(invites.userId, r.userId)));
    expect((await achar(now)).convite).toBe('aceito');
  });

  it('traz a base do CS-03 e o início do uso (D15) como número e "AAAA-MM-DD"', async () => {
    const x = s();
    const r = await criarContaNutri({ nomeExibicao: 'Métricas', email: `met-${x}@exemplo.com`, crn: 'CRN-3 12345', slug: `met-${x}` }, deps);
    const achar = async () => (await listarContas(app.db, now, { busca: `met-${x}` })).contas.find((c) => c.tenantId === r.tenantId)!;
    expect(await achar()).toMatchObject({ taxaFaltasBase: null, goLiveEm: null });
    await app.db.update(tenants).set({ taxaFaltasBase: 18.5, goLiveEm: '2026-10-01' }).where(eq(tenants.id, r.tenantId));
    expect(await achar()).toMatchObject({ taxaFaltasBase: 18.5, goLiveEm: '2026-10-01' });
  });
});

describe('P09-07: páginas e busca da lista de consultórios', () => {
  /** Cinco consultórios com o mesmo marcador no nome e no slug e `created_at` em segundos seguidos; devolve os ids do mais novo ao mais antigo. */
  async function cinco() {
    const marca = `p097${s()}`;
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const [t] = await app.db.insert(tenants).values({ slug: `${marca}-${i}`, nomeExibicao: `Consultório ${marca} ${i}`, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)) }).returning({ id: tenants.id });
      ids.push(t.id);
    }
    return { marca, ids: ids.reverse() };
  }
  const ids = (p: { contas: { tenantId: string }[] }) => p.contas.map((c) => c.tenantId);

  it('cursor: "Próxima" até o fim e "Anterior" de volta, sem repetir nem pular (created_at desc, id desc), com duas nutricionistas no mesmo consultório', async () => {
    const { marca, ids: t } = await cinco();
    // revisão do plano: nada impede duas usuárias 'nutri' no mesmo consultório (o seed do E2E cria três); uma linha por consultório
    for (const n of [1, 2]) await app.db.insert(user).values({ name: `Nutri ${n}`, email: `${marca}-${n}@teste.local`, appRole: 'nutri', tenantId: t[2] });
    expect(ids(await listarContas(app.db, now, { busca: `${marca}-2@teste.local` }))).toEqual([t[2]]);
    const p1 = await listarContas(app.db, now, { busca: marca, limite: 2 });
    expect(ids(p1)).toEqual(t.slice(0, 2));
    expect(p1).toMatchObject({ anterior: null, proxima: t[1] });
    const p2 = await listarContas(app.db, now, { busca: marca, depois: p1.proxima, limite: 2 });
    expect(ids(p2)).toEqual(t.slice(2, 4));
    expect(p2).toMatchObject({ anterior: t[2], proxima: t[3] });
    const p3 = await listarContas(app.db, now, { busca: marca, depois: p2.proxima, limite: 2 });
    expect(ids(p3)).toEqual([t[4]]);
    expect(p3).toMatchObject({ anterior: t[4], proxima: null });
    const volta = await listarContas(app.db, now, { busca: marca, antes: p3.anterior, limite: 2 });
    expect(ids(volta)).toEqual(t.slice(2, 4));
    expect(volta).toMatchObject({ anterior: t[2], proxima: t[3] });
    const inicio = await listarContas(app.db, now, { busca: marca, antes: volta.anterior, limite: 2 });
    expect(ids(inicio)).toEqual(t.slice(0, 2));
    expect(inicio).toMatchObject({ anterior: null, proxima: t[1] });
  });

  it('busca por nome, endereço (slug) ou e-mail, sem diferenciar maiúsculas; % e _ são literais; até 100 caracteres; só espaços = sem busca', async () => {
    const { marca, ids: t } = await cinco();
    // a parte ASCII em maiúsculas (o lower() do Postgres em collation C não troca o Ó)
    expect(ids(await listarContas(app.db, now, { busca: `consultório ${marca.toUpperCase()} 3` }))).toEqual([t[1]]);
    expect(ids(await listarContas(app.db, now, { busca: `${marca}-0` }))).toEqual([t[4]]);
    const N = await novoTenant(app.db);
    const [u] = await app.db.select({ email: user.email }).from(user).where(eq(user.tenantId, N.tenantId));
    expect(ids(await listarContas(app.db, now, { busca: u.email.toUpperCase() }))).toEqual([N.tenantId]);
    expect((await listarContas(app.db, now, { busca: `${marca}%` })).contas).toEqual([]);
    expect((await listarContas(app.db, now, { busca: `${marca}_0` })).contas).toEqual([]);
    expect((await listarContas(app.db, now, { busca: `${marca}${'x'.repeat(200)}` })).busca).toHaveLength(100);
    expect((await listarContas(app.db, now, { busca: '   ' })).busca).toBe('');
  });

  it('cursor que não é uuid ou de consultório inexistente = primeira página; a página nunca passa de 50', async () => {
    const { marca, ids: t } = await cinco();
    expect(ids(await listarContas(app.db, now, { busca: marca, depois: "x' or 1=1 --", limite: 2 }))).toEqual(t.slice(0, 2));
    expect(ids(await listarContas(app.db, now, { busca: marca, depois: randomUUID(), limite: 2 }))).toEqual(t.slice(0, 2));
    expect((await listarContas(app.db, now)).contas.length).toBeLessThanOrEqual(CONTAS_POR_PAGINA);
  });
});

describe('definirDocumentosLiberados (D20, Plano 10A)', () => {
  it('nasce bloqueado; o admin libera e bloqueia de novo; a lista mostra; conta inexistente → ContaNaoEncontradaError', async () => {
    const x = s();
    const r = await criarContaNutri({ nomeExibicao: 'Documentos', email: `doc-${x}@exemplo.com`, crn: 'CRN-3 12345', slug: `doc-${x}` }, deps);
    const achar = async () => (await listarContas(app.db, now, { busca: `doc-${x}` })).contas.find((c) => c.tenantId === r.tenantId)!;
    expect((await achar()).documentosLiberados).toBe(false);
    await definirDocumentosLiberados(app.db, r.tenantId, true, randomUUID());
    expect((await achar()).documentosLiberados).toBe(true);
    await definirDocumentosLiberados(app.db, r.tenantId, false, randomUUID());
    expect((await achar()).documentosLiberados).toBe(false);
    await expect(definirDocumentosLiberados(app.db, randomUUID(), true, randomUUID())).rejects.toThrow(ContaNaoEncontradaError);
  });
});

describe('Plano 11 (US-100, D6) — liberar a IA de um consultório', () => {
  it('liga/desliga ia_liberada e grava admin_actions (liberar_ia / bloquear_ia, alvo = consultório, origem admin)', async () => {
    const T = await novoTenant(app.db);
    const admin = randomUUID();
    await definirIaLiberada(app.db, T.tenantId, true, admin);
    await definirIaLiberada(app.db, T.tenantId, false, admin);
    const acoes = await app.db.select().from(adminActions).where(eq(adminActions.alvoTenantId, T.tenantId));
    expect(acoes.map((a) => a.acao).sort()).toEqual(['bloquear_ia', 'liberar_ia']);
    expect(acoes[0]).toMatchObject({ adminUserId: admin, origem: 'admin', alvoUserId: null });
    const [t] = await app.db.select({ l: tenants.iaLiberada }).from(tenants).where(eq(tenants.id, T.tenantId));
    expect(t.l).toBe(false);
    await expect(definirIaLiberada(app.db, randomUUID(), true, admin)).rejects.toBeInstanceOf(ContaNaoEncontradaError);
  });

  it('D22 (A-06): em produção, recusa liberar enquanto a autorização ou o aditivo forem provisórios; bloquear sempre passa', async () => {
    const T = await novoTenant(app.db);
    const admin = randomUUID();
    for (const versoes of [['0.1-provisorio', '1.0'], ['1.0', '0.2-provisorio']]) {
      await expect(definirIaLiberada(app.db, T.tenantId, true, admin, { producao: true, versoes }), versoes.join()).rejects.toBeInstanceOf(IaProvisoriaError);
    }
    await definirIaLiberada(app.db, T.tenantId, false, admin, { producao: true });
    expect(await app.db.select().from(adminActions).where(eq(adminActions.alvoTenantId, T.tenantId))).toHaveLength(1);
  });

  it('A-D27 (dono, 09/10/2026), Plano 14B e Plano 15: com os textos finais (autorização 1.1, aditivo 1.2), a guarda da D22 deixa liberar em produção', async () => {
    const T = await novoTenant(app.db);
    expect([AUTORIZACAO_IA_VERSAO, IA_ADITIVO_VERSAO]).toEqual(['1.1', '1.2']);
    await definirIaLiberada(app.db, T.tenantId, true, randomUUID(), { producao: true });
    const [t] = await app.db.select({ l: tenants.iaLiberada }).from(tenants).where(eq(tenants.id, T.tenantId));
    expect(t.l).toBe(true);
  });

  it('Minor 7 (revisão final): sem informar `producao`, vale o ambiente — em produção a guarda da D22 continua fechada para texto provisório', async () => {
    const T = await novoTenant(app.db);
    ambiente.producao = true;
    try {
      await expect(definirIaLiberada(app.db, T.tenantId, true, randomUUID(), { versoes: ['0.1-provisorio', '1.0'] })).rejects.toBeInstanceOf(IaProvisoriaError);
    } finally {
      ambiente.producao = null;
    }
    const [t] = await app.db.select({ l: tenants.iaLiberada }).from(tenants).where(eq(tenants.id, T.tenantId));
    expect(t.l).toBe(false);
  });

  it('listarContas mostra IA liberada, ativada, a cota e a cota da IA Nutri', async () => {
    const T = await novoTenant(app.db);
    await definirIaLiberada(app.db, T.tenantId, true, randomUUID());
    const [t] = await app.db.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, T.tenantId));
    expect((await listarContas(app.db, undefined, { busca: t.slug })).contas.find((c) => c.tenantId === T.tenantId)).toMatchObject({ iaLiberada: true, iaAtivada: false, iaCotaMensalUsd: 15, iaNutriCotaMensalUsd: 7 }); // Plano 15 (D3): US$ 7 por padrão
  });
});

describe('P16-17: página da conta e resumo da lista do admin', () => {
  it('contaPorId devolve o mesmo ContaResumo da lista; conta que não existe ou id que não é uuid → null', async () => {
    const x = s();
    const r = await criarContaNutri({ nomeExibicao: 'Por id', email: `porid-${x}@exemplo.com`, crn: 'CRN-3 12345', slug: `porid-${x}` }, deps);
    await app.db.update(tenants).set({ taxaFaltasBase: 12, goLiveEm: '2026-10-02', documentosLiberados: true }).where(eq(tenants.id, r.tenantId));
    const daLista = (await listarContas(app.db, now, { busca: `porid-${x}` })).contas.find((c) => c.tenantId === r.tenantId);
    const conta = await contaPorId(r.tenantId, app.db, now);
    expect(conta).toEqual(daLista);
    expect(conta).toMatchObject({ convite: 'pendente', email: `porid-${x}@exemplo.com`, crn: 'CRN-3 12345', documentosLiberados: true, taxaFaltasBase: 12 });
    expect((await contaPorId(r.tenantId, app.db, new Date('2026-10-05T00:00:00Z')))!.convite).toBe('expirado');
    expect(await contaPorId(randomUUID(), app.db, now)).toBeNull();
    expect(await contaPorId("x' or 1=1 --", app.db, now)).toBeNull();
    expect(await contaPorId(undefined, app.db, now)).toBeNull();
  });

  it('resumoDasContas conta ativas, suspensas e convites pendentes de todas as contas (não só da página nem da busca)', async () => {
    // REPEATABLE READ: os outros arquivos de teste criam consultórios ao mesmo tempo; dentro da transação a foto não muda,
    // e a diferença entre as duas leituras é só o que este teste criou (desfeito no fim)
    const desfazer = new Error('desfazer');
    await app.db
      .transaction(
        async (tx) => {
          const antes = await resumoDasContas(tx, now);
          const x = s();
          /** Consultório ativo com uma nutricionista; `convite`: validade do convite não usado; `senha`: já aceitou. */
          const consultorio = async (n: string, o: { status?: 'ativa' | 'suspensa'; convite?: Date; senha?: boolean; nutri?: boolean } = {}) => {
            const [t] = await tx.insert(tenants).values({ slug: `r${n}-${x}`, nomeExibicao: `Resumo ${n}`, status: o.status ?? 'ativa' }).returning({ id: tenants.id });
            if (o.nutri === false) return;
            const [u] = await tx.insert(user).values({ name: `Nutri ${n}`, email: `r${n}-${x}@exemplo.com`, appRole: 'nutri', tenantId: t.id }).returning({ id: user.id });
            if (o.convite) await tx.insert(invites).values({ userId: u.id, tipo: 'nutri', tokenHash: `r${n}-${x}-${randomUUID()}`, expiraEm: o.convite });
            if (o.senha) await tx.insert(account).values({ id: randomUUID(), userId: u.id, accountId: u.id, providerId: 'credential', password: 'x' });
          };
          await consultorio('p', { convite: new Date('2026-10-04T12:00:00Z') }); // pendente
          await consultorio('a', { convite: new Date('2026-10-04T12:00:00Z'), senha: true }); // aceito (convite não usado, mas já tem senha)
          await consultorio('e', { convite: new Date('2026-09-30T12:00:00Z') }); // expirado
          await consultorio('s', { status: 'suspensa', convite: new Date('2026-10-04T12:00:00Z') }); // suspensa com convite pendente
          await consultorio('v', { nutri: false }); // ativa sem nutricionista (sem convite)
          const depois = await resumoDasContas(tx, now);
          expect({ ativas: depois.ativas - antes.ativas, suspensas: depois.suspensas - antes.suspensas, convitesPendentes: depois.convitesPendentes - antes.convitesPendentes })
            .toEqual({ ativas: 4, suspensas: 1, convitesPendentes: 2 });
          throw desfazer;
        },
        { isolationLevel: 'repeatable read' },
      )
      .catch((e: unknown) => {
        if (e !== desfazer) throw e;
      });
  });
});
