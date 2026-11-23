import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import { makeDb } from '../../../../test/db';
import { novoPaciente, novoTenant, type TenantDeTeste } from '../../../../test/pacientes';

/** US-300 / US-305 (Plano 20, T5): o Resumo do Financeiro com o banco de verdade — primeiro acesso, aviso e cartões. */
const sessao = vi.hoisted(() => ({ atual: null as null | { ctx: unknown; tenant: unknown } }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/tenant-session', () => ({ requireNutri: vi.fn(async () => sessao.atual) }));
vi.mock('next/navigation', async (orig) => ({ ...(await orig<typeof import('next/navigation')>()), usePathname: () => '/painel/financeiro' }));

const { default: Resumo } = await import('./page');
const { closeDb } = await import('@/db/client');
const { listarCategorias, salvarConfiguracoes } = await import('@/modules/financeiro/configuracoes');
const { criarLancamento } = await import('@/modules/financeiro/lancamentos');
const { MSG_FINANCEIRO: M } = await import('@/modules/financeiro/constantes');
const { formatarReais } = await import('@/modules/financeiro/dinheiro');
const { hojeNoFuso } = await import('@/modules/pacientes/datas');
const { mesDe, nomeDoMes } = await import('@/modules/financeiro/meses');

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await closeDb();
  await app.pool.end();
});

async function tenant(): Promise<TenantDeTeste> {
  const T = await novoTenant(app.db);
  sessao.atual = { ctx: T.ctx, tenant: { id: T.tenantId, ...T.tenant } };
  return T;
}
const html = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await Resumo({ searchParams: Promise.resolve(sp) } as never));
/** O texto visível, sem as tags (o "R$" do Intl tem espaço não separável: compara com formatarReais). */
const texto = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/[ \t\n]+/g, ' ');
/** A tag de abertura do link com este texto (os atributos saem em qualquer ordem). */
const link = (h: string, rotulo: string) => new RegExp(`<a ([^>]*)>${rotulo.replace(/[?.]/g, '\\$&')}</a>`).exec(h)?.[1] ?? '';

describe('/painel/financeiro (US-300, US-305)', () => {
  it('primeiro acesso: "Comece por aqui", o texto e o botão "Configurar o Financeiro"; sem "Nova entrada"/"Nova saída" nem cartões', async () => {
    await tenant();
    const h = await html();
    expect(h).toMatch(/<h1 id="titulo-financeiro" tabindex="-1"[^>]*>Financeiro<\/h1>/);
    expect(h).toContain(M.comecePorAqui);
    expect(h).toContain(M.comeceTexto);
    expect(link(h, M.configurar)).toContain('href="/painel/financeiro/configuracoes"');
    expect(h).not.toContain(M.novaEntrada);
    expect(h).not.toContain(M.novaSaida);
    expect(h).not.toContain(M.cartaoSaldo.titulo);
  });

  it('a navegação interna: "Seções do Financeiro", com as cinco seções e o Resumo como atual', async () => {
    await tenant();
    const h = await html();
    const nav = /<nav aria-label="Seções do Financeiro"[^>]*>([\s\S]*?)<\/nav>/.exec(h)?.[1] ?? '';
    expect([...nav.matchAll(/<a[^>]*>([^<]+)<\/a>/g)].map((m) => m[1])).toEqual(['Resumo', 'Lançamentos', 'Pagamentos pendentes', 'Relatórios', 'Configurações']);
    expect(link(nav, 'Resumo')).toMatch(/aria-current="page".*href="\/painel\/financeiro"/);
    expect(nav.match(/aria-current/g)).toHaveLength(1);
  });

  it('a região role="status" fica sempre montada; ?ok=config mostra "Configurações salvas."; chave desconhecida não mostra nada', async () => {
    await tenant();
    expect(await html()).toMatch(/<p role="status"[^>]*><\/p>/);
    expect(await html({ ok: 'config' })).toMatch(/<p role="status"[^>]*>Configurações salvas\.<\/p>/);
    expect(await html({ ok: '<b>x</b>' })).toMatch(/<p role="status"[^>]*><\/p>/);
  });

  it('configurado sem valor da consulta: o aviso exato, com o link "Informar o valor da consulta"', async () => {
    const T = await tenant();
    await salvarConfiguracoes(T.ctx, T.tenant, { saldoInicialEm: '2026-11-01', saldoInicial: '1.500,00', valorConsulta: '' }, { db: app.db });
    const h = await html();
    expect(h).toContain(M.semValorConsulta);
    expect(link(h, M.informarValor)).toContain('href="/painel/financeiro/configuracoes#valorConsulta"');
    expect(h).not.toContain(M.comecePorAqui);
  });

  it('configurado: os quatro cartões, "Nova entrada"/"Nova saída", os últimos lançamentos e "Ver todos os lançamentos"; sem atraso, sem a linha de atraso', async () => {
    const T = await tenant();
    await salvarConfiguracoes(T.ctx, T.tenant, { saldoInicialEm: '2026-11-01', saldoInicial: '1.500,00', valorConsulta: '250,00' }, { db: app.db });
    const hoje = hojeNoFuso(T.tenant.fuso);
    const mes = nomeDoMes(mesDe(hoje));
    let h = await html();
    expect(h).not.toContain(M.semValorConsulta);
    const t = texto(h);
    expect(t).toContain(`${M.cartaoSaldo.titulo} ${formatarReais(150_000)}`);
    expect(t).toContain(M.cartaoSaldo.desde('01/11/2026'));
    expect(t).toContain(M.cartaoEntradas.titulo(mes));
    expect(t).toContain(M.cartaoSaidas.titulo(mes));
    expect(t).toContain(M.cartaoEntradas.recebido(formatarReais(0)));
    expect(t).toContain(M.cartaoSaidas.aPagar(formatarReais(0)));
    expect(t).toContain(M.cartaoPendentes.vazio);
    expect(t).toContain(M.ultimos.vazio);
    expect(t).not.toContain('Em atraso de meses anteriores');
    expect(link(h, M.novaEntrada)).toContain('href="/painel/financeiro/lancamentos/novo?tipo=entrada"');
    expect(link(h, M.novaSaida)).toContain('href="/painel/financeiro/lancamentos/novo?tipo=saida"');
    expect(link(h, M.ultimos.verTodos)).toContain('href="/painel/financeiro/lancamentos"');

    // uma entrada de paciente em aberto e uma saída vencida no mês anterior
    const cats = await listarCategorias(T.ctx, { db: app.db });
    const id = (nome: string) => cats.find((c) => c.nome === nome)!.id;
    const p = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
    await criarLancamento(T.ctx, T.tenant, { tipo: 'entrada', categoriaId: id('Consultas'), valor: '250,00', vencimento: hoje, pacienteId: p.id }, { db: app.db });
    await criarLancamento(T.ctx, T.tenant, { tipo: 'saida', categoriaId: id('Divulgação'), valor: '300,00', vencimento: '2026-10-10' }, { db: app.db });
    h = await html();
    const t2 = texto(h);
    expect(t2).toContain(M.cartaoEntradas.aReceber(formatarReais(25_000)));
    expect(t2).toContain(M.cartaoSaidas.atrasoAnterior(formatarReais(30_000)));
    expect(t2.match(/Em atraso de meses anteriores/g)).toHaveLength(1); // só nas saídas
    expect(t2).toContain(M.cartaoPendentes.resumo(1, formatarReais(25_000)));
    expect(link(h, 'Ver<span class="sr-only"> pagamentos pendentes</span>')).toContain('href="/painel/financeiro/pendencias"');
    expect(t2).toContain('Ana Souza · Consultas');
    expect(t2).toContain('Divulgação');
    expect(t2).not.toContain(M.ultimos.vazio);
  });
});
