import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import { mensagemNoBanco } from '../../../../test/ia-nutri';
import { makeDb } from '../../../../test/db';
import { consultorioDoChat, mensagemDoDono, naSessao, pacienteDoChat } from '../../../../test/mensagens';
import { novoPaciente, type TenantDeTeste } from '../../../../test/pacientes';
import { closeDb, getDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { MSG_MENSAGENS } from '@/modules/mensagens/constantes';

// Plano 25, T6a (US-442, RN-453, RN-463, §4.1, §7.1; CH-D42): a caixa de mensagens do painel, com o banco de verdade; só a
// sessão e o runtime do Next simulados. Nunca o texto das mensagens; sem auditRead.
const sessao = vi.hoisted(() => ({ atual: null as unknown }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/tenant-session', () => ({ requireNutri: vi.fn(async () => sessao.atual) }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
  notFound: () => {
    throw new Error('notFound');
  },
}));
const { default: Caixa, metadata } = await import('./page');

const db = getDb();
const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  await closeDb();
  await owner.pool.end();
});
const M = MSG_MENSAGENS;

async function consultorio(o: { iaNutri?: boolean } = {}) {
  const T = await consultorioDoChat(db, owner.pool);
  await owner.pool.query("update tenants set crn = 'CRN-4 12345' where id = $1", [T.tenantId]);
  if (o.iaNutri) await owner.pool.query('update tenants set ia_nutri_ativada_em = now() where id = $1', [T.tenantId]);
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, T.tenantId));
  sessao.atual = { ctx: T.ctx, tenant };
  return T;
}
const html = (el: unknown) => renderToStaticMarkup(el as ReactElement);
const caixa = async (busca: Record<string, string> = {}) => html(await Caixa({ searchParams: Promise.resolve(busca) } as never));
const leituras = async (T: TenantDeTeste) => (await naSessao(db, T.ctx, sql`select count(*)::int as n from audit_log where tenant_id = ${T.tenantId} and acao = 'ler'`))[0].n;
/** O `<a>` (com o que tem dentro) que aponta para `href`. */
const link = (h: string, href: string) => new RegExp(`<a [^>]*href="${href.replace(/[?]/g, '\\?')}"[^>]*>[\\s\\S]*?</a>`).exec(h)?.[0] ?? '';
const nav = (h: string, rotulo: string) => new RegExp(`<nav aria-label="${rotulo}"[^>]*>[\\s\\S]*?</nav>`).exec(h)?.[0] ?? '';

describe('/painel/mensagens — a caixa (US-442)', () => {
  it('o <title> é sempre "Mensagens" (nunca o nome do paciente)', () => {
    expect(metadata).toEqual({ title: 'Mensagens' });
  });

  it('as conversas com nome, tipo, quando e não lidas; o risco não lido no topo com o selo de alerta; nunca o texto; sem auditRead', async () => {
    const T = await consultorio();
    const ana = await pacienteDoChat(db, T, { nome: 'Ana Souza' });
    const bia = await pacienteDoChat(db, T, { nome: 'Bia Lima' });
    await mensagemDoDono(owner.pool, T, bia, { texto: 'TEXTO-SECRETO-BIA' });
    await mensagemDoDono(owner.pool, T, bia, { texto: 'TEXTO-SECRETO-BIA-2' });
    await mensagemDoDono(owner.pool, T, ana, { texto: 'TEXTO-SECRETO-ANA', risco: 'emergencia' });
    const caio = await pacienteDoChat(db, T, { nome: 'Caio Reis' });
    await mensagemDoDono(owner.pool, T, caio, { autor: 'nutri', texto: 'TEXTO-SECRETO-NUTRI' });
    const antes = await leituras(T);
    const h = await caixa();
    expect(await leituras(T)).toBe(antes);
    expect(h).not.toMatch(/TEXTO-SECRETO/);
    expect(h).toContain(`<h1 class="font-titulo text-2xl font-semibold">${M.caixa.titulo}</h1>`);
    // ordem: o risco não lido primeiro, depois a mais recente
    const pos = (id: string) => h.indexOf(`href="/painel/mensagens/${id}"`);
    expect(pos(ana.p)).toBeGreaterThan(-1);
    expect(pos(ana.p)).toBeLessThan(pos(caio.p));
    expect(pos(caio.p)).toBeLessThan(pos(bia.p));
    const deAna = link(h, `/painel/mensagens/${ana.p}`);
    expect(deAna).toContain('Ana Souza');
    expect(deAna).toContain(M.caixa.tipos.mensagemDoPaciente);
    expect(deAna).toContain('agora');
    expect(deAna).toContain(M.caixa.naoLidas(1));
    // selo de alerta com texto e ícone decorativo (não só cor): os tokens de erro, nunca cor literal
    expect(deAna).toMatch(/<span class="[^"]*border-erro[^"]*bg-erro-fundo[^"]*text-erro[^"]*"><svg aria-hidden="true"[\s\S]*?<\/svg>Sinal de risco<\/span>/);
    expect(link(h, `/painel/mensagens/${bia.p}`)).toContain(M.caixa.naoLidas(2));
    expect(link(h, `/painel/mensagens/${bia.p}`)).not.toContain(M.caixa.seloRisco);
    expect(link(h, `/painel/mensagens/${caio.p}`)).toContain(M.caixa.tipos.voceEnviou);
    expect(link(h, `/painel/mensagens/${caio.p}`)).not.toContain('não lida');
    // o nome em negrito só com não lidas
    expect(deAna).toMatch(/font-semibold[^"]*">Ana Souza</);
    expect(link(h, `/painel/mensagens/${caio.p}`)).not.toMatch(/font-semibold[^"]*">Caio Reis</);
    // a aba "Conversas" com o número das conversas com não lidas
    const abas = nav(h, 'Seções de Mensagens');
    expect(abas).toContain(`aria-current="page"`);
    expect(link(abas, '/painel/mensagens')).toContain(M.menu.abaConversasComContador(2));
    expect(link(abas, '/painel/mensagens')).toContain('aria-current="page"');
  });

  it('os dois <nav> com aria-label próprio; "Todas"/"Não lidas" com aria-current; a busca no formulário GET; "Nova conversa"', async () => {
    await consultorio();
    const h = await caixa();
    const filtro = nav(h, 'Filtro das conversas');
    expect(filtro).toBeTruthy();
    expect(link(filtro, '/painel/mensagens')).toContain('aria-current="page"');
    expect(link(filtro, '/painel/mensagens')).toContain(M.caixa.filtroTodas);
    expect(link(filtro, '/painel/mensagens?filtro=nao-lidas')).toContain(M.caixa.filtroNaoLidas);
    expect(link(filtro, '/painel/mensagens?filtro=nao-lidas')).not.toContain('aria-current');
    expect(h).toMatch(/<form(?=[^>]*\bmethod="get")(?=[^>]*\brole="search")[^>]*>/);
    expect(h).toMatch(new RegExp(`<label for="busca"[^>]*>${M.caixa.buscarPaciente}</label>`));
    expect(h).toContain(`>${M.caixa.buscar}</button>`);
    expect(link(h, '/painel/mensagens/nova')).toContain(M.caixa.novaConversa);
    const naoLidas = await caixa({ filtro: 'nao-lidas', busca: 'bia' });
    expect(link(nav(naoLidas, 'Filtro das conversas'), '/painel/mensagens?filtro=nao-lidas&amp;busca=bia')).toContain('aria-current="page"');
    expect(naoLidas).toMatch(/<input(?=[^>]*\btype="hidden")(?=[^>]*\bname="filtro")(?=[^>]*\bvalue="nao-lidas")[^>]*>/);
    expect(naoLidas).toMatch(/<input(?=[^>]*\bid="busca")(?=[^>]*\bname="busca")(?=[^>]*\btype="search")(?=[^>]*\bvalue="bia")[^>]*>/);
  });

  it('"Não lidas" só mostra as conversas com mensagem do paciente não lida; a busca pelo nome', async () => {
    const T = await consultorio();
    const ana = await pacienteDoChat(db, T, { nome: 'Ana Souza' });
    const bia = await pacienteDoChat(db, T, { nome: 'Bia Lima' });
    await mensagemDoDono(owner.pool, T, ana);
    await mensagemDoDono(owner.pool, T, bia, { autor: 'nutri' });
    const h = await caixa({ filtro: 'nao-lidas' });
    expect(h).toContain(`/painel/mensagens/${ana.p}`);
    expect(h).not.toContain(`/painel/mensagens/${bia.p}`);
    const b = await caixa({ busca: 'bia' });
    expect(b).toContain(`/painel/mensagens/${bia.p}`);
    expect(b).not.toContain(`/painel/mensagens/${ana.p}`);
  });

  it('vazia → o texto exato; vazio do filtro → "Nenhuma mensagem não lida."', async () => {
    await consultorio();
    expect(await caixa()).toContain(`<p>${M.caixa.vazio.replaceAll('"', '&quot;')}</p>`);
    expect(await caixa({ filtro: 'nao-lidas' })).toContain(`<p>${M.caixa.vazioDoFiltro}</p>`);
    expect(await caixa({ busca: 'ninguém' })).toContain(`<p>${M.novaConversa.nenhum}</p>`);
  });

  it('50 por página: "Mostrar mais" leva a ?pagina=2 mantendo o filtro; a página 2 sem "Mostrar mais"', async () => {
    const T = await consultorio();
    for (let i = 0; i < 51; i++) {
      const p = await novoPaciente(db, T.ctx, { nome: `Paciente ${String(i).padStart(2, '0')}` });
      await owner.pool.query(
        `insert into chat_conversas (tenant_id, patient_id, liberada_em, liberada_por, tcle_forma, liberada_nome, liberada_crn)
         values ($1, $2, now(), $3, 'aceite_escrito', 'x', 'x')`,
        [T.tenantId, p.id, T.nutriId],
      );
    }
    const h1 = await caixa({ filtro: 'todas' });
    expect(h1.match(/href="\/painel\/mensagens\/[0-9a-f-]{36}"/g)).toHaveLength(50);
    expect(link(h1, '/painel/mensagens?pagina=2')).toContain('Mostrar mais');
    const h2 = await caixa({ pagina: '2' });
    expect(h2.match(/href="\/painel\/mensagens\/[0-9a-f-]{36}"/g)).toHaveLength(1);
    expect(h2).not.toContain('Mostrar mais');
    const comBusca = await caixa({ busca: 'Paciente' });
    expect(link(comBusca, '/painel/mensagens?busca=Paciente&amp;pagina=2')).toContain('Mostrar mais');
    // página fora do formato → a primeira
    expect((await caixa({ pagina: 'x' })).match(/href="\/painel\/mensagens\/[0-9a-f-]{36}"/g)).toHaveLength(50);
  });

  it('a aba "Dúvidas da IA Nutri" só com a IA Nutri ativada ou com dúvida aberta (a regra de hoje do menu), com o número', async () => {
    const T = await consultorio();
    expect(nav(await caixa(), 'Seções de Mensagens')).not.toContain(M.menu.abaDuvidas);
    // dúvida aberta (a fila continua depois de desativar a IA Nutri)
    const bia = await novoPaciente(db, T.ctx, { nome: 'Bia Lima' });
    await mensagemNoBanco(db, T.tenantId, bia.id, { status: 'respondida', encaminhadaEm: new Date() });
    const abas = nav(await caixa(), 'Seções de Mensagens');
    expect(link(abas, '/painel/duvidas')).toContain(M.menu.abaDuvidasComContador(1));
    expect(link(abas, '/painel/duvidas')).not.toContain('aria-current');
    expect(link(abas, '/painel/mensagens')).toMatch(new RegExp(`>${M.menu.abaConversas}</a>$`));
    // IA Nutri ativada, sem dúvida: a aba sem número
    await consultorio({ iaNutri: true });
    expect(link(nav(await caixa(), 'Seções de Mensagens'), '/painel/duvidas')).toMatch(new RegExp(`>${M.menu.abaDuvidas}</a>$`));
  });
});

describe('Plano 25 (RN-473, CH-D46): links das telas de Mensagens sem prefetch', () => {
  const raiz = path.resolve('src/app/painel/mensagens');
  const arquivos = readdirSync(raiz, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.tsx'));
  it('há telas para conferir', () => expect(arquivos.length).toBeGreaterThanOrEqual(3));
  it.each(arquivos.map((f) => [f]))('%s: todo <Link> tem prefetch={false}', (f) => {
    const s = readFileSync(path.join(raiz, f), 'utf8');
    const links = [...s.matchAll(/<Link\b[\s\S]*?>/g)].map((m) => m[0]);
    for (const l of links) expect(l, `${f}: ${l}`).toContain('prefetch={false}');
  });
});
