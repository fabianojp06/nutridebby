import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { makeDb } from '../../../../../test/db';
import { novoPaciente, novoTenant, type TenantDeTeste } from '../../../../../test/pacientes';

/** US-301 / US-302 / RN-306 (Plano 20, T6): a lista, o formulário novo e a edição dos lançamentos, com o banco de verdade. */
const sessao = vi.hoisted(() => ({
  atual: null as null | { ctx: unknown; tenant: unknown },
  caminho: '/painel/financeiro/lancamentos',
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
const { default: Novo } = await import('./novo/page');
const { default: Edicao } = await import('./[id]/page');
const { closeDb } = await import('@/db/client');
const { withTenant } = await import('@/db/tenant');
const { listarCategorias, salvarConfiguracoes } =
  await import('@/modules/financeiro/configuracoes');
const { cancelarLancamento, criarLancamento, listarLancamentos } =
  await import('@/modules/financeiro/lancamentos');
const { MSG_FINANCEIRO: M } = await import('@/modules/financeiro/constantes');
const { formatarReais } = await import('@/modules/financeiro/dinheiro');
const { intervaloDoMes, mesDe } = await import('@/modules/financeiro/meses');
const { formatarData, hojeNoFuso, somarDias } = await import('@/modules/pacientes/datas');

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await closeDb();
  await app.pool.end();
});

type Cenario = TenantDeTeste & { hoje: string; p: string; consultas: string; aluguel: string };
async function tenant(): Promise<TenantDeTeste> {
  const T = await novoTenant(app.db);
  sessao.atual = { ctx: T.ctx, tenant: { id: T.tenantId, ...T.tenant } };
  return T;
}
async function cenario(): Promise<Cenario> {
  const T = await tenant();
  const hoje = hojeNoFuso(T.tenant.fuso);
  await salvarConfiguracoes(
    T.ctx,
    T.tenant,
    { saldoInicialEm: somarDias(hoje, -1), saldoInicial: '1.500,00', valorConsulta: '250,00' },
    { db: app.db },
  );
  const cats = await listarCategorias(T.ctx, { db: app.db });
  const id = (nome: string) => cats.find((c) => c.nome === nome)!.id;
  const p = (await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' })).id;
  return { ...T, hoje, p, consultas: id('Consultas'), aluguel: id('Aluguel e condomínio') };
}
const entrada = (C: Cenario, extra: Record<string, unknown> = {}) =>
  criarLancamento(
    C.ctx,
    C.tenant,
    {
      tipo: 'entrada',
      valor: '250,00',
      categoriaId: C.consultas,
      vencimento: C.hoje,
      pacienteId: C.p,
      descricao: 'Retorno',
      ...extra,
    },
    { db: app.db },
  );
const saida = (C: Cenario, extra: Record<string, unknown> = {}) =>
  criarLancamento(
    C.ctx,
    C.tenant,
    {
      tipo: 'saida',
      valor: '1.200,00',
      categoriaId: C.aluguel,
      vencimento: C.hoje,
      descricao: 'Aluguel',
      ...extra,
    },
    { db: app.db },
  );
const bloquear = (T: TenantDeTeste, paciente: string) =>
  withTenant(
    { tenantId: T.tenantId, role: 'worker' },
    (tx) =>
      tx.execute(
        sql`update patients set status = 'bloqueado', bloqueado_em = now(), anonimizar_apos = '2046-01-01' where id = ${paciente}`,
      ),
    app.db,
  );
/** O último dia do mês anterior ao de `dia`. */
const mesAnterior = (dia: string) => somarDias(intervaloDoMes(mesDe(dia)).de, -1);

const render = async (
  pagina: (p: never) => Promise<React.ReactElement>,
  caminho: string,
  sp: Record<string, string> = {},
  params: Record<string, string> = {},
) => {
  sessao.caminho = caminho;
  return renderToStaticMarkup(
    await pagina({ searchParams: Promise.resolve(sp), params: Promise.resolve(params) } as never),
  );
};
const lista = (sp: Record<string, string> = {}) =>
  render(Lista, '/painel/financeiro/lancamentos', sp);
const novo = (sp: Record<string, string>) =>
  render(Novo, '/painel/financeiro/lancamentos/novo', sp);
const edicao = (id: string, sp: Record<string, string> = {}) =>
  render(Edicao, `/painel/financeiro/lancamentos/${id}`, sp, { id });
/** O texto visível, sem as tags (o "R$" do Intl tem espaço não separável: compara com formatarReais). */
const texto = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/[ \t\n]+/g, ' ');
const selectDe = (h: string, id: string) =>
  new RegExp(`<select[^>]*id="${id}"[^>]*>([\\s\\S]*?)</select>`).exec(h)?.[1] ?? '';
const opcoes = (select: string) =>
  [...select.matchAll(/<option([^>]*)>([^<]*)<\/option>/g)].map((m) => ({
    valor: /value="([^"]*)"/.exec(m[1])?.[1],
    rotulo: m[2],
    escolhida: m[1].includes('selected'),
  }));
const escolhida = (h: string, id: string) =>
  opcoes(selectDe(h, id)).find((o) => o.escolhida)?.valor;

describe('/painel/financeiro/lancamentos (US-302, RN-306)', () => {
  it('sem configuração: o primeiro acesso, sem "Nova entrada"/"Nova saída"', async () => {
    await tenant();
    const h = await lista();
    expect(h).toMatch(/<h1 id="titulo-financeiro" tabindex="-1"[^>]*>Lançamentos<\/h1>/);
    expect(h).toContain(M.comecePorAqui);
    expect(h).not.toContain(M.novaEntrada);
    expect(h).not.toContain(M.novaSaida);
  });

  it('sem mes: o mês atual no fuso, selecionado no <select> "Mês", com os meses de listarLancamentos e sem "Todos os meses"', async () => {
    const C = await cenario();
    const antigo = mesAnterior(C.hoje);
    await entrada(C, { descricao: 'Do mês atual' });
    await saida(C, { vencimento: antigo, descricao: 'Do mês anterior' });
    const h = await lista();
    expect(h).toContain('Do mês atual');
    expect(h).not.toContain('Do mês anterior');
    expect(h).toMatch(/<label[^>]*for="mes"[^>]*>Mês<\/label>/);
    expect(escolhida(h, 'mes')).toBe(mesDe(C.hoje));
    const { meses } = await listarLancamentos(C.ctx, C.tenant, {}, { db: app.db });
    expect(opcoes(selectDe(h, 'mes')).map((o) => o.valor)).toEqual(meses);
    expect(meses).toEqual([mesDe(C.hoje), mesDe(antigo)]);
    expect(h).not.toContain(M.filtros.todosOsMeses);
    expect(h).toContain(`>${M.filtros.mesAnterior}</a>`);
    expect(h).toContain(`>${M.filtros.proximoMes}</a>`);
    expect(h).toContain(M.novaEntrada);
  });

  it('mês futuro escolhido entra no <select> (listarLancamentos só vai até o mês atual); o mês anterior aponta para o mês de antes', async () => {
    const C = await cenario();
    const futuro = mesDe(somarDias(intervaloDoMes(mesDe(C.hoje)).ate, 1));
    const h = await lista({ mes: futuro });
    expect(escolhida(h, 'mes')).toBe(futuro);
    expect(opcoes(selectDe(h, 'mes'))[0].valor).toBe(futuro);
    expect(h).toMatch(
      new RegExp(
        `href="/painel/financeiro/lancamentos\\?mes=${mesDe(C.hoje)}"[^>]*>${M.filtros.mesAnterior}<`,
      ),
    );
  });

  it('com paciente e sem mes: todos os meses, "Todos os meses" escolhido, o chip "Paciente: {nome}" com "Limpar" e a "Nova entrada" do paciente', async () => {
    const C = await cenario();
    await entrada(C, { descricao: 'Do mês atual' });
    await entrada(C, { vencimento: mesAnterior(C.hoje), descricao: 'Do mês anterior' });
    await saida(C, { descricao: 'Sem paciente' });
    const h = await lista({ paciente: C.p });
    expect(h).toContain('Do mês atual');
    expect(h).toContain('Do mês anterior');
    expect(h).not.toContain('Sem paciente');
    expect(opcoes(selectDe(h, 'mes'))[0]).toEqual({
      valor: '',
      rotulo: M.filtros.todosOsMeses,
      escolhida: true,
    });
    expect(h).not.toContain(`>${M.filtros.mesAnterior}</a>`);
    expect(texto(h)).toContain('Paciente: Ana Souza');
    expect(h).toMatch(/href="\/painel\/financeiro\/lancamentos"[^>]*>Limpar<span class="sr-only">/);
    expect(h).toContain(
      `href="/painel/financeiro/lancamentos/novo?tipo=entrada&amp;paciente=${C.p}"`,
    );
    expect(h).toContain(`<input type="hidden" name="paciente" value="${C.p}"/>`);
  });

  it('os totais da lista em duas linhas, sem os cancelados; a situação em texto e as ações da linha', async () => {
    const C = await cenario();
    await entrada(C, { pagoEm: C.hoje, forma: 'pix' });
    await entrada(C, { valor: '100,00' });
    await saida(C, { pagoEm: C.hoje, forma: 'pix' });
    const cancelada = await entrada(C, { valor: '999,00', descricao: 'Duplicada' });
    await cancelarLancamento(C.ctx, cancelada.id, 'Lançado em duplicidade', { db: app.db });
    const h = texto(await lista());
    const r = formatarReais;
    expect(h).toContain(M.totaisDaLista.recebidoOuPago(r(25_000), r(120_000), r(-95_000)));
    expect(h).toContain(M.totaisDaLista.emAberto(r(10_000), r(0)));
    for (const s of ['Recebido', 'Previsto', 'Pago', 'Cancelado']) expect(h).toContain(s);
    expect(h).toContain(M.acoes.desfazer.entrada);
    expect(h).toContain(M.acoes.marcarPago.entrada);
    expect(h).toContain(M.acoes.desfazer.saida);
    expect(h).toContain(M.acoes.cancelar);
    // o cancelado não tem "Editar" nem outra ação: 3 linhas ativas, 3 "Editar"
    expect(h.match(/ Editar /g)).toHaveLength(3);
  });

  it('?ok=salvo&aviso=antes_do_saldo: "Lançamento salvo." e o aviso com a data do saldo, na mesma região de status', async () => {
    const C = await cenario();
    const h = await lista({ ok: 'salvo', aviso: 'antes_do_saldo', envio: '1' });
    expect(h).toContain(
      `<p role="status" class="${'rounded-2xl border border-ok bg-ok-fundo p-3 text-ok'}">${M.ok.salvo} ${M.antesDoSaldo(formatarData(somarDias(C.hoje, -1)))}</p>`,
    );
  });

  it('vazio: "Nenhum lançamento neste filtro."; os filtros Tipo, Categoria, Situação e Forma de pagamento com "Filtrar"', async () => {
    await cenario();
    const h = await lista({ situacao: 'cancelado', tipo: 'saida', forma: 'pix' });
    expect(h).toContain(M.vazioDaLista);
    expect(escolhida(h, 'situacao')).toBe('cancelado');
    expect(escolhida(h, 'tipo')).toBe('saida');
    expect(escolhida(h, 'forma')).toBe('pix');
    expect(opcoes(selectDe(h, 'situacao')).map((o) => o.rotulo)).toEqual([
      'Todas',
      'Previsto',
      'Em atraso',
      'Recebido ou pago',
      'Cancelado',
    ]);
    expect(selectDe(h, 'categoria')).toContain('Aluguel e condomínio');
    expect(h).toMatch(/<button[^>]*>Filtrar<\/button>/);
    expect(h).toContain('data-guia="financeiro-filtros"');
  });
});

describe('/painel/financeiro/lancamentos/novo (US-301)', () => {
  it('sem configuração: entrada e saída levam às Configurações com ?aviso=informeSaldo', async () => {
    await tenant();
    await expect(novo({ tipo: 'entrada' })).rejects.toThrow(
      'redirect /painel/financeiro/configuracoes?aviso=informeSaldo',
    );
    await expect(novo({ tipo: 'saida' })).rejects.toThrow(
      'redirect /painel/financeiro/configuracoes?aviso=informeSaldo',
    );
  });

  it('nova saída: h1, sem o campo "Paciente", ajuda da descrição da saída, "Já foi pago" e "Salvar saída"; noValidate', async () => {
    const C = await cenario();
    const h = await novo({ tipo: 'saida', paciente: C.p });
    expect(h).toMatch(/<h1 id="titulo-financeiro" tabindex="-1"[^>]*>Nova saída<\/h1>/);
    expect(h).not.toContain(M.campos.paciente);
    expect(h).not.toContain('name="pacienteId"');
    expect(h).toContain(M.ajudaDescricao.saida);
    expect(h).toContain(M.campos.jaFoi.saida);
    expect(h).toMatch(/<button[^>]*>Salvar saída<\/button>/);
    expect(h).toMatch(/<form[^>]*novalidate=""/i);
    expect(opcoes(selectDe(h, 'categoriaId')).map((o) => o.rotulo)).toContain(
      'Aluguel e condomínio',
    );
    expect(opcoes(selectDe(h, 'categoriaId')).map((o) => o.rotulo)).not.toContain('Consultas');
    expect(h).toContain('data-guia="financeiro-novo"');
  });

  it('nova entrada: "Paciente (opcional)" com ativos e arquivados ("(arquivado)"), sem bloqueados; ajuda da entrada', async () => {
    const C = await cenario();
    await novoPaciente(app.db, C.ctx, { nome: 'Carla Dias', status: 'arquivado' });
    const bruno = (await novoPaciente(app.db, C.ctx, { nome: 'Bruno Lima' })).id;
    await bloquear(C, bruno);
    const h = await novo({ tipo: 'entrada' });
    expect(h).toMatch(/<h1[^>]*>Nova entrada<\/h1>/);
    expect(h).toMatch(/<label[^>]*for="pacienteId"[^>]*>Paciente \(opcional\)<\/label>/);
    const rotulos = opcoes(selectDe(h, 'pacienteId')).map((o) => o.rotulo);
    expect(rotulos).toContain('Ana Souza');
    expect(rotulos).toContain(`Carla Dias ${M.campos.arquivado}`);
    expect(rotulos).not.toContain('Bruno Lima');
    expect(escolhida(h, 'pacienteId')).toBe('');
    expect(h).toContain(M.ajudaDescricao.entrada);
    expect(h).toMatch(/<button[^>]*>Salvar entrada<\/button>/);
  });

  it('?paciente=<id> vem escolhido; bloqueado vem sem paciente e com o aviso; de outro consultório ou inválido, sem paciente e sem aviso', async () => {
    const C = await cenario();
    expect(escolhida(await novo({ tipo: 'entrada', paciente: C.p }), 'pacienteId')).toBe(C.p);
    const bruno = (await novoPaciente(app.db, C.ctx, { nome: 'Bruno Lima' })).id;
    await bloquear(C, bruno);
    const b = await novo({ tipo: 'entrada', paciente: bruno });
    expect(escolhida(b, 'pacienteId')).toBe('');
    expect(b).toContain(M.bloqueado);
    const outro = await novoTenant(app.db);
    const deFora = (await novoPaciente(app.db, outro.ctx, { nome: 'De Fora' })).id;
    for (const paciente of [deFora, 'x']) {
      const h = await novo({ tipo: 'entrada', paciente });
      expect(escolhida(h, 'pacienteId')).toBe('');
      expect(h).not.toContain(M.bloqueado);
      expect(h).not.toContain('De Fora');
    }
  });

  it('tipo fora da lista → 404', async () => {
    await cenario();
    await expect(novo({ tipo: 'outro' })).rejects.toThrow('notFound');
  });
});

describe('/painel/financeiro/lancamentos/[id] (US-302)', () => {
  it('h1 "Entrada — {categoria}"; tipo e paciente como texto (sem campo); o formulário com os valores e as ações', async () => {
    const C = await cenario();
    const { id } = await entrada(C);
    const h = await edicao(id);
    expect(h).toMatch(/<h1 id="titulo-financeiro" tabindex="-1"[^>]*>Entrada — Consultas<\/h1>/);
    expect(texto(h)).toContain('Ana Souza');
    expect(h).not.toContain('name="pacienteId"');
    expect(h).not.toContain('name="tipo"');
    expect(h).toMatch(/<input[^>]*id="valor"[^>]*value="250,00"/);
    expect(escolhida(h, 'categoriaId')).toBe(C.consultas);
    expect(h).toContain(M.acoes.marcarPago.entrada);
    expect(h).toContain(M.acoes.cancelar);
    expect(h).toMatch(/<button[^>]*>Salvar entrada<\/button>/);
  });

  it('paciente bloqueado: o aviso, só o campo do valor (categoria, vencimento e descrição como texto), receber e cancelar', async () => {
    const C = await cenario();
    const { id } = await entrada(C);
    await bloquear(C, C.p);
    const h = await edicao(id);
    expect(h).toContain(M.bloqueado);
    expect(h).toMatch(/<input[^>]*id="valor"/);
    expect(h).not.toMatch(/<select[^>]*id="categoriaId"/);
    expect(h).not.toMatch(/<input[^>]*id="vencimento"[^>]*type="date"/);
    expect(h).not.toMatch(/<input[^>]*id="descricao"/);
    expect(texto(h)).toContain('Retorno');
    expect(h).toContain(M.acoes.marcarPago.entrada);
    expect(h).toContain(M.acoes.cancelar);
  });

  it('cancelado: só leitura, com a mensagem e o motivo; sem formulário nem ações', async () => {
    const C = await cenario();
    const { id } = await saida(C);
    await cancelarLancamento(C.ctx, id, 'Lançado em duplicidade', { db: app.db });
    const h = await edicao(id, { ok: 'cancelado' });
    expect(h).toMatch(/<h1[^>]*>Saída — Aluguel e condomínio<\/h1>/);
    expect(h).toMatch(/<p role="status"[^>]*>Lançamento cancelado\.<\/p>/);
    expect(h).toContain(M.erros.cancelado);
    expect(texto(h)).toContain('Lançado em duplicidade');
    expect(h).not.toContain('<form');
    expect(h).not.toContain(M.acoes.cancelar);
  });

  it('de outro consultório ou id inválido → 404', async () => {
    const A = await cenario();
    const { id } = await entrada(A);
    await cenario();
    await expect(edicao(id)).rejects.toThrow('notFound');
    await expect(edicao('x')).rejects.toThrow('notFound');
  });
});

describe('texto livre sem espaço não alarga a página a 360 px (revisão final do PR 2)', () => {
  // um código de barras de boleto colado na descrição: 48 dígitos, sem ponto de quebra
  const CODIGO = '2379'.repeat(12);
  const classes = (h: string, conteudo: string, tag: string) =>
    new RegExp(`<${tag} class="([^"]*)">${conteudo}</${tag}>`).exec(h)?.[1].split(' ') ?? [];

  it('a lista: a descrição com wrap-break-word, dentro do item flex com min-w-0', async () => {
    const C = await cenario();
    await entrada(C, { descricao: CODIGO });
    const h = await lista();
    expect(classes(h, CODIGO, 'span')).toContain('wrap-break-word');
    const item = new RegExp(`<span class="([^"]*)">[^<]*<span class="[^"]*">${CODIGO}</span></span>`).exec(h)?.[1].split(' ') ?? [];
    expect(item).toEqual(expect.arrayContaining(['min-w-0', 'wrap-break-word']));
  });

  it('a edição do bloqueado (paciente e descrição) e a leitura do cancelado (descrição e motivo): <dd> com min-w-0 e wrap-break-word', async () => {
    const C = await cenario();
    const { id } = await entrada(C, { descricao: CODIGO });
    await bloquear(C, C.p);
    const b = await edicao(id);
    for (const conteudo of [CODIGO, 'Ana Souza']) expect(classes(b, conteudo, 'dd'), conteudo).toEqual(expect.arrayContaining(['min-w-0', 'wrap-break-word']));

    const motivo = '0341'.repeat(12);
    const outra = await saida(C, { descricao: CODIGO });
    await cancelarLancamento(C.ctx, outra.id, motivo, { db: app.db });
    const c = await edicao(outra.id);
    for (const conteudo of [CODIGO, motivo]) expect(classes(c, conteudo, 'dd'), conteudo).toEqual(expect.arrayContaining(['min-w-0', 'wrap-break-word']));
  });
});
