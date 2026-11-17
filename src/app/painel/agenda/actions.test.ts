import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { consultaDireta, tenantAgenda } from '../../../../test/agenda';
import { makeDb } from '../../../../test/db';
import { novoPaciente, novoTenant, type TenantDeTeste } from '../../../../test/pacientes';

/**
 * US-037 + US-303 (Plano 20, T7): "Realizada"/"Faltou" pela tela da consulta, com o banco de verdade. A action leva só o
 * resultado da cobrança na URL (`?ok=presenca&cobranca=…`, nunca o valor: ficaria no histórico do navegador); a página lê
 * o valor da própria cobrança e mostra a mensagem da §6.2.
 */
const sessao = vi.hoisted(() => ({ atual: null as null | { ctx: unknown; tenant: unknown } }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/tenant-session', () => ({ requireNutri: vi.fn(async () => sessao.atual) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (orig) => ({
  ...(await orig<typeof import('next/navigation')>()),
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
  notFound: () => {
    throw new Error('notFound');
  },
}));

const { presencaAction } = await import('./actions');
const { default: ConsultaPage } = await import('./consultas/[id]/page');
const { closeDb } = await import('@/db/client');
const { withTenant } = await import('@/db/tenant');
const { stopBoss } = await import('@/jobs/boss');
const { salvarConfiguracoes } = await import('@/modules/financeiro/configuracoes');
const { MSG_FINANCEIRO: M } = await import('@/modules/financeiro/constantes');
const { formatarReais } = await import('@/modules/financeiro/dinheiro');
const { marcarRecebido } = await import('@/modules/financeiro/lancamentos');
const { MSG_PRESENCA } = await import('@/modules/agenda/presenca');
const { hojeNoFuso } = await import('@/modules/pacientes/datas');

const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  await owner.pool.end();
});
beforeEach(() => vi.clearAllMocks());

const CONFIGURACOES = '/painel/financeiro/configuracoes';
type Cenario = TenantDeTeste & { p: string; c: string; inicio: Date };
async function cenario(o: { configurar?: boolean } = {}): Promise<Cenario> {
  const T = await novoTenant(app.db);
  sessao.atual = { ctx: T.ctx, tenant: tenantAgenda(T) };
  if (o.configurar !== false)
    await salvarConfiguracoes(T.ctx, T.tenant, { saldoInicialEm: '2026-01-01', saldoInicial: '0', valorConsulta: '250,00' }, { db: app.db });
  const p = (await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' })).id;
  // começou há 1 min (a action usa o relógio de verdade)
  const inicio = new Date(Date.now() - 60_000);
  const c = await consultaDireta(app.db, T.ctx, p, inicio);
  return { ...T, p, c, inicio };
}
const destino = (p: Promise<unknown>) =>
  p.then(
    (r) => {
      throw new Error(`devia redirecionar: ${JSON.stringify(r)}`);
    },
    (e: Error) => e.message.replace(/^redirect /, ''),
  );
const pagina = async (C: Cenario, sp: Record<string, string>) =>
  renderToStaticMarkup(await ConsultaPage({ params: Promise.resolve({ id: C.c }), searchParams: Promise.resolve(sp) } as never));
/** O texto da página, sem as marcações (os links ficam no meio das frases). */
const texto = (html: string) => html.replace(/<[^>]+>/g, '');
const linkDasConfiguracoes = (html: string, rotulo: string) =>
  new RegExp(`<a [^>]*href="${CONFIGURACOES}"[^>]*>${rotulo}</a>`).test(html);
const lancamento = async (C: Cenario) => (await owner.pool.query('select id from fin_lancamentos where tenant_id = $1', [C.tenantId])).rows[0]?.id as string | undefined;

describe('presencaAction (US-303, RN-310): ?ok=presenca&cobranca=<resultado>, sem o valor', () => {
  it('"Realizada" → cobranca=criada; a página diz o valor lido da cobrança e mostra a seção "Cobrança"', async () => {
    const C = await cenario();
    const url = await destino(presencaAction(C.c, 'realizada'));
    expect(url).toBe(`/painel/agenda/consultas/${C.c}?ok=presenca&cobranca=criada`);
    expect(url).not.toMatch(/valor|250/);
    const html = await pagina(C, { ok: 'presenca', cobranca: 'criada' });
    expect(texto(html)).toContain(M.presenca.criada(formatarReais(25000)));
    expect(html).toContain('<h2 id="cobranca" tabindex="-1" class="text-lg font-semibold">Cobrança</h2>');
    // vence no dia da consulta: "Em atraso" só se o dia virou no fuso entre o início e agora
    const situacao = hojeNoFuso(C.tenant.fuso, C.inicio) < hojeNoFuso(C.tenant.fuso) ? M.situacoes.em_atraso : M.situacoes.previsto;
    expect(texto(html)).toContain(M.consulta.valorESituacao(formatarReais(25000), situacao));
    expect(html).toContain(`href="/painel/financeiro/lancamentos/${await lancamento(C)}"`);
    expect(texto(html)).toContain(M.consulta.abrir);
    expect(texto(html)).toContain(M.consulta.salvarValor);
  });

  it('sem o valor da consulta → cobranca=sem_valor; a página mostra o texto com o link para as configurações', async () => {
    const C = await cenario({ configurar: false });
    expect(await destino(presencaAction(C.c, 'realizada'))).toBe(`/painel/agenda/consultas/${C.c}?ok=presenca&cobranca=sem_valor`);
    const html = await pagina(C, { ok: 'presenca', cobranca: 'sem_valor' });
    const t = M.presenca.semValor;
    expect(texto(html)).toContain(`${t.antes}${t.link}${t.depois}`);
    expect(linkDasConfiguracoes(html, t.link)).toBe(true);
    // a seção: sem cobrança e sem configuração → "Configure o Financeiro" é link
    expect(texto(html)).toContain(M.consulta.semCobranca);
    expect(texto(html)).toContain(`${M.consulta.configure.link}${M.consulta.configure.depois}`);
    expect(linkDasConfiguracoes(html, M.consulta.configure.link)).toBe(true);
  });

  it('"Faltou" com a cobrança em aberto → cobranca=aberta; recebida → cobranca=recebida; a seção continua', async () => {
    const C = await cenario();
    await destino(presencaAction(C.c, 'realizada'));
    expect(await destino(presencaAction(C.c, 'faltou'))).toBe(`/painel/agenda/consultas/${C.c}?ok=presenca&cobranca=aberta`);
    let html = await pagina(C, { ok: 'presenca', cobranca: 'aberta' });
    expect(texto(html)).toContain(M.presenca.aberta);
    expect(texto(html)).toContain(M.acoes.cancelar);

    await destino(presencaAction(C.c, 'realizada'));
    const hoje = hojeNoFuso(C.tenant.fuso);
    await marcarRecebido(C.ctx, C.tenant, (await lancamento(C))!, { pagoEm: hoje, forma: 'pix' }, { db: app.db });
    expect(await destino(presencaAction(C.c, 'faltou'))).toBe(`/painel/agenda/consultas/${C.c}?ok=presenca&cobranca=recebida`);
    html = await pagina(C, { ok: 'presenca', cobranca: 'recebida' });
    expect(texto(html)).toContain(M.presenca.recebida);
    const [a, m, d] = hoje.split('-');
    expect(texto(html)).toContain(M.consulta.valorESituacao(formatarReais(25000), M.consulta.recebidoEm(`${d}/${m}/${a}`, 'Pix')));
  });

  it('paciente bloqueado → cobranca=bloqueado: só "Presença registrada." e a seção com o aviso do bloqueio', async () => {
    const C = await cenario();
    await withTenant(
      { tenantId: C.tenantId, role: 'worker' },
      (tx) => tx.execute(sql`update patients set status = 'bloqueado', bloqueado_em = now(), anonimizar_apos = '2046-01-01' where id = ${C.p}`),
      app.db,
    );
    expect(await destino(presencaAction(C.c, 'realizada'))).toBe(`/painel/agenda/consultas/${C.c}?ok=presenca&cobranca=bloqueado`);
    const html = await pagina(C, { ok: 'presenca', cobranca: 'bloqueado' });
    expect(html).toMatch(new RegExp(`<p role="status"[^>]*>${MSG_PRESENCA.registrada}</p>`));
    expect(texto(html)).toContain(M.consulta.bloqueado);
    expect(texto(html)).not.toContain(M.consulta.registrar);
  });

  it('a mesma situação → ?ok=presenca, sem cobranca; resultado desconhecido na URL → só "Presença registrada."', async () => {
    const C = await cenario();
    await destino(presencaAction(C.c, 'realizada'));
    expect(await destino(presencaAction(C.c, 'realizada'))).toBe(`/painel/agenda/consultas/${C.c}?ok=presenca`);
    for (const cobranca of ['', 'qualquer', 'criada<script>']) {
      const html = await pagina(C, { ok: 'presenca', cobranca });
      expect(html).toMatch(new RegExp(`<p role="status"[^>]*>${MSG_PRESENCA.registrada}</p>`));
    }
  });

  it('consulta realizada sem cobrança, Financeiro configurado → "Registrar cobrança" com o valor sugerido', async () => {
    const C = await cenario();
    await withTenant(C.ctx, (tx) => tx.execute(sql`update appointments set status = 'realizada' where id = ${C.c}`), app.db);
    const html = await pagina(C, {});
    expect(texto(html)).toContain(M.consulta.semCobranca);
    expect(texto(html)).toContain(M.consulta.registrar);
    expect(html).toContain('value="250,00"');
  });
});

/**
 * Spec §7 (revisão da T7, rodada 1): as ações da seção "Cobrança" voltam com `?ok=cobranca_*&envio=`; a mensagem vai para
 * uma região `role="status"` sempre montada logo acima da seção (fora do `key` dela, que remonta), não para o `Aviso` do
 * topo, e o foco vai ao h2 "Cobrança" (`tabIndex={-1}`) — ou ao h1 da consulta, se a seção saiu.
 */
describe('seção "Cobrança": região fixa e foco depois das ações (§7)', () => {
  const ESTILO_OK = 'rounded-2xl border border-ok bg-ok-fundo p-3 text-ok';
  const ocorrencias = (html: string, t: string) => texto(html).split(t).length - 1;

  it('consulta realizada: a região vazia já está montada logo acima da seção, e o h2 recebe foco', async () => {
    const C = await cenario();
    await destino(presencaAction(C.c, 'realizada'));
    const html = await pagina(C, {});
    expect(html).toContain('<div class="space-y-2"><p role="status"></p><section aria-labelledby="cobranca"');
    expect(html).toContain('<h2 id="cobranca" tabindex="-1" class="text-lg font-semibold">Cobrança</h2>');
    expect(html).toMatch(/<h1 id="titulo-consulta" tabindex="-1"[^>]*>Consulta de Ana Souza<\/h1>/);
  });

  it.each([
    ['cobranca_registrada', M.ok.salvo],
    ['cobranca_salva', M.ok.salvo],
    ['cobranca_recebida', M.ok.recebido],
    ['cobranca_cancelada', M.ok.cancelado],
  ])('?ok=%s → "%s" na região de cima da seção, uma vez só (fora do Aviso do topo)', async (ok, mensagem) => {
    const C = await cenario();
    await destino(presencaAction(C.c, 'realizada'));
    const html = await pagina(C, { ok, envio: '1731800000000' });
    expect(html).toContain(`<div class="space-y-2"><p role="status" class="${ESTILO_OK}">${mensagem}</p><section aria-labelledby="cobranca"`);
    expect(ocorrencias(html, mensagem)).toBe(1);
  });

  it('cancelou a cobrança de uma "Faltou" (a seção sai): a região continua com "Lançamento cancelado."', async () => {
    const C = await cenario();
    await withTenant(C.ctx, (tx) => tx.execute(sql`update appointments set status = 'faltou' where id = ${C.c}`), app.db);
    const html = await pagina(C, { ok: 'cobranca_cancelada', envio: '1731800000000' });
    expect(html).toContain(`<div class="space-y-2"><p role="status" class="${ESTILO_OK}">${M.ok.cancelado}</p></div>`);
    expect(html).not.toContain('<h2 id="cobranca"');
    // sem a seção, o foco vai ao h1 da consulta
    expect(html).toMatch(/<h1 id="titulo-consulta" tabindex="-1"/);
  });

  it('consulta sem seção e sem ok= da cobrança: sem a região; chave desconhecida não vira texto', async () => {
    const C = await cenario();
    expect(await pagina(C, {})).not.toContain('<div class="space-y-2"><p role="status"');
    await destino(presencaAction(C.c, 'realizada'));
    expect(await pagina(C, { ok: 'cobranca_<b>x</b>', envio: '1' })).toContain('<div class="space-y-2"><p role="status"></p><section');
  });
});
