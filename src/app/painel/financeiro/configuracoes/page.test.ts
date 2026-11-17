import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import { makeDb } from '../../../../../test/db';
import { novoTenant, type TenantDeTeste } from '../../../../../test/pacientes';

/** US-300 (Plano 20, T5): a tela "Configurações do Financeiro" com o banco de verdade. */
const sessao = vi.hoisted(() => ({ atual: null as null | { ctx: unknown; tenant: unknown } }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/tenant-session', () => ({ requireNutri: vi.fn(async () => sessao.atual) }));
vi.mock('next/navigation', async (orig) => ({ ...(await orig<typeof import('next/navigation')>()), usePathname: () => '/painel/financeiro/configuracoes' }));

const { default: Configuracoes } = await import('./page');
const { closeDb } = await import('@/db/client');
const { arquivarCategoria, listarCategorias, salvarConfiguracoes } = await import('@/modules/financeiro/configuracoes');
const { MSG_FINANCEIRO: M } = await import('@/modules/financeiro/constantes');
const { hojeNoFuso } = await import('@/modules/pacientes/datas');

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
const html = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await Configuracoes({ searchParams: Promise.resolve(sp) } as never));
const campo = (h: string, id: string) => new RegExp(`<input[^>]*id="${id}"[^>]*>`).exec(h)?.[0] ?? '';

describe('/painel/financeiro/configuracoes (US-300)', () => {
  it('primeiro acesso: h1, seção atual na navegação, os rótulos e as ajudas exatas ligadas aos campos; data de hoje sugerida; sem categorias', async () => {
    const T = await tenant();
    const h = await html();
    expect(h).toMatch(/<h1 id="titulo-financeiro" tabindex="-1"[^>]*>Configurações do Financeiro<\/h1>/);
    expect(h).toMatch(/<a aria-current="page"[^>]*href="\/painel\/financeiro\/configuracoes"[^>]*>Configurações<\/a>/);
    expect(h).toMatch(/<form[^>]*novalidate=""/i);
    for (const [id, rotulo] of [['saldoInicialEm', M.configuracoes.dataSaldo], ['saldoInicial', M.configuracoes.valorSaldo], ['valorConsulta', M.configuracoes.valorConsulta]])
      expect(h).toContain(`<label for="${id}" class="block font-medium">${rotulo}</label>`);
    expect(h).toContain(`>${M.configuracoes.saldo}</h2>`);
    expect(h).toContain(M.configuracoes.ajudaSaldo);
    expect(h).toContain(M.configuracoes.ajudaValorConsulta);
    expect(campo(h, 'saldoInicial')).toContain('aria-describedby="saldoInicial-dica"');
    expect(campo(h, 'valorConsulta')).toContain('aria-describedby="valorConsulta-dica"');
    expect(campo(h, 'saldoInicialEm')).toContain(`value="${hojeNoFuso(T.tenant.fuso)}"`);
    expect(h).toMatch(/<button[^>]*>Salvar<\/button>/);
    expect(h).not.toContain(`>${M.configuracoes.categorias}</h2>`);
  });

  it('?aviso=informeSaldo (vindo de uma ação de lançamento) aparece na região de status', async () => {
    await tenant();
    expect(await html({ aviso: 'informeSaldo' })).toMatch(/<p role="status"[^>]*>Informe o saldo do caixa para começar\.<\/p>/);
  });

  it('configurado: os valores salvos nos campos e as categorias por tipo, com nomes acessíveis que citam a categoria e o selo "Arquivada"', async () => {
    const T = await tenant();
    await salvarConfiguracoes(T.ctx, T.tenant, { saldoInicialEm: '2026-11-01', saldoInicial: '-320,00', valorConsulta: '250,00' }, { db: app.db });
    const div = (await listarCategorias(T.ctx, { db: app.db })).find((c) => c.nome === 'Divulgação')!;
    await arquivarCategoria(T.ctx, div.id, { db: app.db });
    const h = await html({ ok: 'config' });
    expect(h).toMatch(/<p role="status"[^>]*>Configurações salvas\.<\/p>/);
    expect(campo(h, 'saldoInicialEm')).toContain('value="2026-11-01"');
    expect(campo(h, 'saldoInicial')).toContain('value="-320,00"');
    expect(campo(h, 'valorConsulta')).toContain('value="250,00"');
    expect(h).toContain(`>${M.configuracoes.categorias}</h2>`);
    expect(h).toContain(`>${M.configuracoes.entradas}</h3>`);
    expect(h).toContain(`>${M.configuracoes.saidas}</h3>`);
    const linha = /<li[^>]*>(?:(?!<\/li>)[\s\S])*Divulgação(?:(?!<\/li>)[\s\S])*<\/li>/.exec(h)?.[0] ?? '';
    expect(linha).toContain(M.configuracoes.arquivada);
    expect(linha).toMatch(/<button[^>]*>Reativar<span class="sr-only"> categoria Divulgação<\/span><\/button>/);
    expect(linha).toMatch(/<button[^>]*>Excluir<span class="sr-only"> categoria Divulgação<\/span><\/button>/);
    expect(linha).toMatch(/<button[^>]*aria-expanded="false"[^>]*>Renomear<span class="sr-only"> categoria Divulgação<\/span><\/button>/);
    expect(linha).not.toContain('>Arquivar<');
    const consultas = /<li[^>]*>(?:(?!<\/li>)[\s\S])*Consultas(?:(?!<\/li>)[\s\S])*<\/li>/.exec(h)?.[0] ?? '';
    expect(consultas).toMatch(/<button[^>]*>Arquivar<span class="sr-only"> categoria Consultas<\/span><\/button>/);
    expect(consultas).not.toContain(M.configuracoes.arquivada);
    expect(consultas).not.toContain('>Excluir<'); // a categoria da cobrança nunca se exclui (RN-303): sem o botão
    // "Nova categoria" em cada lista, com o tipo no nome acessível
    expect(h.match(/>Nova categoria<span class="sr-only"> de (entrada|saída)<\/span><\/label>/g)).toHaveLength(2);
  });
});
