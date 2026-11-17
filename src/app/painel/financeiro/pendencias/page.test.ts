import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import { makeDb } from '../../../../../test/db';
import { novoPaciente, novoTenant, type TenantDeTeste } from '../../../../../test/pacientes';

/** US-304 / RN-311 / RN-318 (Plano 20, T8): "Pagamentos pendentes" e o detalhe de um paciente, com o banco de verdade. */
const sessao = vi.hoisted(() => ({
  atual: null as null | { ctx: unknown; tenant: unknown },
  caminho: '/painel/financeiro/pendencias',
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/tenant-session', () => ({ requireNutri: vi.fn(async () => sessao.atual) }));
vi.mock('next/navigation', async (orig) => ({
  ...(await orig<typeof import('next/navigation')>()),
  usePathname: () => sessao.caminho,
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
  notFound: () => {
    throw new Error('notFound');
  },
}));

const { default: Lista } = await import('./page');
const { default: Detalhe } = await import('./[patientId]/page');
const { closeDb } = await import('@/db/client');
const { listarCategorias, salvarConfiguracoes } = await import('@/modules/financeiro/configuracoes');
const { criarLancamento } = await import('@/modules/financeiro/lancamentos');
const { MSG_FINANCEIRO: M } = await import('@/modules/financeiro/constantes');
const { formatarData, hojeNoFuso, somarDias } = await import('@/modules/pacientes/datas');

const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  await closeDb();
  await app.pool.end();
  await owner.pool.end();
});

type Cenario = TenantDeTeste & { hoje: string; ana: string; consultas: string };
async function tenant(): Promise<TenantDeTeste> {
  const T = await novoTenant(app.db);
  sessao.atual = { ctx: T.ctx, tenant: { id: T.tenantId, ...T.tenant } };
  return T;
}
async function cenario(): Promise<Cenario> {
  const T = await tenant();
  const hoje = hojeNoFuso(T.tenant.fuso);
  await salvarConfiguracoes(T.ctx, T.tenant, { saldoInicialEm: somarDias(hoje, -60), saldoInicial: '1.500,00', valorConsulta: '250,00' }, { db: app.db });
  const cats = await listarCategorias(T.ctx, { db: app.db });
  const ana = (await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' })).id;
  return { ...T, hoje, ana, consultas: cats.find((c) => c.nome === 'Consultas')!.id };
}
const cobranca = (C: Cenario, vencimento: string, extra: Record<string, unknown> = {}) =>
  criarLancamento(C.ctx, C.tenant, { tipo: 'entrada', valor: '250,00', categoriaId: C.consultas, vencimento, pacienteId: C.ana, ...extra }, { db: app.db });

const leituras = async (tenantId: string) =>
  (
    await owner.pool.query<{ patient_id: string | null }>(
      `select patient_id from audit_log where tenant_id = $1 and acao = 'ler' and entidade = 'financeiro'`,
      [tenantId],
    )
  ).rows;

const render = async (
  pagina: (p: never) => Promise<React.ReactElement>,
  caminho: string,
  sp: Record<string, string> = {},
  params: Record<string, string> = {},
) => {
  sessao.caminho = caminho;
  return renderToStaticMarkup(await pagina({ searchParams: Promise.resolve(sp), params: Promise.resolve(params) } as never));
};
const lista = (sp: Record<string, string> = {}) => render(Lista, '/painel/financeiro/pendencias', sp);
const detalhe = (id: string, sp: Record<string, string> = {}) =>
  render(Detalhe, `/painel/financeiro/pendencias/${id}`, sp, { patientId: id });
const texto = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('Pagamentos pendentes (US-304)', () => {
  it('a lista por paciente: caption, colunas, introdução, total, quantidade, mais antiga e "Em atraso"; não grava "Visualizou" (RN-318)', async () => {
    const C = await cenario();
    await cobranca(C, somarDias(C.hoje, -30));
    await cobranca(C, somarDias(C.hoje, 10));
    const bia = (await novoPaciente(app.db, C.ctx, { nome: 'Beatriz Lima' })).id;
    // cobrança futura (RN-311): conta como "Previsto"
    await criarLancamento(C.ctx, C.tenant, { tipo: 'entrada', valor: '90,00', categoriaId: C.consultas, vencimento: somarDias(C.hoje, 10), pacienteId: bia }, { db: app.db });
    const html = await lista();
    const t = texto(html);
    expect(html).toContain('<h1 id="titulo-financeiro" tabindex="-1"');
    expect(t).toContain('Pagamentos pendentes');
    expect(t).toContain(M.pendentesIntro);
    expect(html).toMatch(/<caption[^>]*>Pacientes com pagamento pendente<\/caption>/);
    for (const col of ['Paciente', 'Em aberto', 'Cobranças', 'Mais antiga', 'Situação', 'Ação']) expect(html).toContain(`<th scope="col">${col}</th>`);
    expect(t).toContain(`Ana Souza R$ 500,00 2 ${formatarData(somarDias(C.hoje, -30))} Em atraso Ver`);
    expect(t).toContain(`Beatriz Lima R$ 90,00 1 ${formatarData(somarDias(C.hoje, 10))} Previsto Ver`);
    // a mais antiga primeiro
    expect(t.indexOf('Ana Souza')).toBeLessThan(t.indexOf('Beatriz Lima'));
    expect(html).toContain(`href="/painel/financeiro/pendencias/${C.ana}"`);
    expect(html).toMatch(/role="region" aria-labelledby="[^"]+" tabindex="0" class="[^"]*focus-visible:outline-offset-\[-3px\]/);
    expect(await leituras(C.tenantId)).toEqual([]);
  });

  it('vazio: "Nenhum pagamento pendente."; sem configuração, o primeiro acesso (RN-301)', async () => {
    await cenario();
    expect(texto(await lista())).toContain('Nenhum pagamento pendente.');
    await tenant();
    const t = texto(await lista());
    expect(t).toContain(M.comecePorAqui);
    expect(t).not.toContain('Nenhum pagamento pendente.');
  });
});

describe('Pagamentos pendentes de {nome} (US-304)', () => {
  it('as cobranças em aberto com "Marcar como recebido" em cada uma, a região fixa e o link para todos os lançamentos; grava "Visualizou" (RN-318)', async () => {
    const C = await cenario();
    await cobranca(C, somarDias(C.hoje, -30), { descricao: 'Retorno' });
    await cobranca(C, somarDias(C.hoje, -1));
    const html = await detalhe(C.ana);
    const t = texto(html);
    expect(html).toMatch(/<h1 id="titulo-financeiro" tabindex="-1"[^>]*>Pagamentos pendentes de Ana Souza<\/h1>/);
    expect(html.match(/>Marcar como recebido</g)).toHaveLength(2);
    expect(html).toContain('role="status"');
    expect(t).toContain(formatarData(somarDias(C.hoje, -30)));
    expect(t).toContain('R$ 250,00 · Em atraso');
    expect(html).toContain(`href="/painel/financeiro/lancamentos?paciente=${C.ana}"`);
    expect(t).toContain('Ver todos os lançamentos de Ana Souza');
    expect(await leituras(C.tenantId)).toEqual([{ patient_id: C.ana }]);
    expect(texto(await detalhe(C.ana, { ok: 'recebido', envio: '1' }))).toContain('Recebimento registrado.');
  });

  it('sem pendência: "Nenhum pagamento pendente de {nome}." e "Voltar aos pagamentos pendentes", sem gravar "Visualizou"', async () => {
    const C = await cenario();
    const html = await detalhe(C.ana);
    const t = texto(html);
    expect(t).toContain(M.pendentesDoPacienteVazio.texto('Ana Souza'));
    expect(t).toContain('Nenhum pagamento pendente de Ana Souza.');
    expect(html).toMatch(/<a [^>]*href="\/painel\/financeiro\/pendencias"[^>]*>Voltar aos pagamentos pendentes<\/a>/);
    expect(html).not.toContain('Marcar como recebido');
    expect(await leituras(C.tenantId)).toEqual([]);
  });

  it('paciente de outro consultório ou id inválido → 404', async () => {
    const C = await cenario();
    await tenant();
    await expect(detalhe(C.ana)).rejects.toThrow('notFound');
    await expect(detalhe('nao-e-id')).rejects.toThrow('notFound');
  });
});
