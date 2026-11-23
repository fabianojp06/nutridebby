import { afterAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { makeDb } from '../../../../../test/db';
import { novoPaciente, novoTenant, type TenantDeTeste } from '../../../../../test/pacientes';

/**
 * US-301 / US-302 (Plano 20, T6): as actions dos lançamentos, com o banco de verdade. A sessão (consultório, usuária, IP)
 * vem sempre de `requireNutri`, nunca do formulário; o destino depois de receber ou cancelar só volta para a lista ou para
 * a edição (nunca para fora do Financeiro).
 */
const sessao = vi.hoisted(() => ({ atual: null as null | { ctx: unknown; tenant: unknown } }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/tenant-session', () => ({ requireNutri: vi.fn(async () => sessao.atual) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
  notFound: () => {
    throw new Error('notFound');
  },
}));

const {
  cancelarLancamentoAction,
  criarLancamentoAction,
  desfazerRecebimentoAction,
  editarLancamentoAction,
  receberLancamentoAction,
} = await import('./actions');
const { closeDb } = await import('@/db/client');
const { withTenant } = await import('@/db/tenant');
const { listarCategorias, salvarConfiguracoes } =
  await import('@/modules/financeiro/configuracoes');
const { criarLancamento } = await import('@/modules/financeiro/lancamentos');
const { MSG_FINANCEIRO } = await import('@/modules/financeiro/constantes');
const { mesDe } = await import('@/modules/financeiro/meses');
const { hojeNoFuso, somarDias } = await import('@/modules/pacientes/datas');
const { revalidatePath } = await import('next/cache');

const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  await closeDb();
  await app.pool.end();
  await owner.pool.end();
});
beforeEach(() => vi.clearAllMocks());

const M = MSG_FINANCEIRO.erros;
const LISTA = '/painel/financeiro/lancamentos';

type Cenario = TenantDeTeste & { hoje: string; p: string; consultas: string; aluguel: string };
function entrarComo(T: TenantDeTeste) {
  sessao.atual = { ctx: T.ctx, tenant: { id: T.tenantId, ...T.tenant } };
}
const formulario = (campos: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.set(k, v);
  return fd;
};
/** A mensagem do redirect (a action termina com redirect) ou null; falha se a action devolveu um estado. */
const destino = (p: Promise<unknown>) =>
  p.then(
    (r) => {
      throw new Error(`devia redirecionar: ${JSON.stringify(r)}`);
    },
    (e: Error) => e.message.replace(/^redirect /, ''),
  );
const ler = async (id: string) =>
  (await owner.pool.query('select to_jsonb(l) as r from fin_lancamentos l where id = $1', [id]))
    .rows[0]?.r;
const contar = async (tenantId: string) =>
  (
    await owner.pool.query('select count(*)::int as n from fin_lancamentos where tenant_id = $1', [
      tenantId,
    ])
  ).rows[0].n as number;
const bloquear = (T: TenantDeTeste, paciente: string) =>
  withTenant(
    { tenantId: T.tenantId, role: 'worker' },
    (tx) =>
      tx.execute(
        sql`update patients set status = 'bloqueado', bloqueado_em = now(), anonimizar_apos = '2046-01-01' where id = ${paciente}`,
      ),
    app.db,
  );

async function cenario(saldoInicialEm?: string): Promise<Cenario> {
  const T = await novoTenant(app.db);
  const hoje = hojeNoFuso(T.tenant.fuso);
  await salvarConfiguracoes(
    T.ctx,
    T.tenant,
    {
      saldoInicialEm: saldoInicialEm ?? somarDias(hoje, -60),
      saldoInicial: '1.500,00',
      valorConsulta: '250,00',
    },
    { db: app.db },
  );
  const cats = await listarCategorias(T.ctx, { db: app.db });
  const id = (nome: string) => cats.find((c) => c.nome === nome)!.id;
  const p = (await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' })).id;
  entrarComo(T);
  return { ...T, hoje, p, consultas: id('Consultas'), aluguel: id('Aluguel e condomínio') };
}
const novaEntrada = (C: Cenario, extra: Record<string, string> = {}) =>
  formulario({
    tipo: 'entrada',
    valor: '250,00',
    categoriaId: C.consultas,
    vencimento: C.hoje,
    pacienteId: C.p,
    descricao: 'Retorno',
    ...extra,
  });
const gravada = (C: Cenario, extra: Record<string, unknown> = {}) =>
  criarLancamento(
    C.ctx,
    C.tenant,
    {
      tipo: 'entrada',
      valor: '250,00',
      categoriaId: C.consultas,
      vencimento: C.hoje,
      pacienteId: C.p,
      ...extra,
    },
    { db: app.db },
  );
/** `/caminho?a=1&b=2` → [caminho, {a, b}] (a ordem dos parâmetros não importa). */
const partes = (url: string) => {
  const u = new URL(url, 'http://x');
  return [u.pathname, Object.fromEntries(u.searchParams)] as const;
};

describe('criarLancamentoAction (US-301)', () => {
  it('sem configuração (RN-301): leva às Configurações com ?aviso=informeSaldo e nada é gravado', async () => {
    const T = await novoTenant(app.db);
    entrarComo(T);
    const cat = '0b8f2a3c-1d2e-4f50-8a9b-0c1d2e3f4a5b';
    const fd = formulario({
      tipo: 'saida',
      valor: '100,00',
      categoriaId: cat,
      vencimento: hojeNoFuso(T.tenant.fuso),
    });
    expect(await destino(criarLancamentoAction({}, fd))).toBe(
      '/painel/financeiro/configuracoes?aviso=informeSaldo',
    );
    expect(await contar(T.tenantId)).toBe(0);
  });

  it('saída paga: volta à lista no mês de referência com ?ok=salvo e um envio novo; o Financeiro é revalidado', async () => {
    const C = await cenario();
    const fd = formulario({
      tipo: 'saida',
      valor: '1.200,00',
      categoriaId: C.aluguel,
      vencimento: C.hoje,
      jaFoi: 'on',
      pagoEm: C.hoje,
      forma: 'pix',
      descricao: '',
    });
    const [caminho, q] = partes(await destino(criarLancamentoAction({}, fd)));
    expect(caminho).toBe(LISTA);
    expect(q).toEqual({ mes: mesDe(C.hoje), ok: 'salvo', envio: expect.stringMatching(/^\d+$/) });
    const { rows } = await owner.pool.query(
      'select tipo, valor_centavos, pago_em::text, forma_pagamento, patient_id, criado_por from fin_lancamentos where tenant_id = $1',
      [C.tenantId],
    );
    expect(rows).toEqual([
      {
        tipo: 'saida',
        valor_centavos: 120_000,
        pago_em: C.hoje,
        forma_pagamento: 'pix',
        patient_id: null,
        criado_por: C.nutriId,
      },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith('/painel/financeiro', 'layout');
  });

  it('sem "Já foi recebido", a data e a forma enviadas são descartadas (o lançamento fica em aberto)', async () => {
    const C = await cenario();
    await destino(criarLancamentoAction({}, novaEntrada(C, { pagoEm: C.hoje, forma: 'pix' })));
    const { rows } = await owner.pool.query(
      'select pago_em, forma_pagamento from fin_lancamentos where tenant_id = $1',
      [C.tenantId],
    );
    expect(rows).toEqual([{ pago_em: null, forma_pagamento: null }]);
  });

  it('recebido antes do saldo do caixa: ?ok=salvo&aviso=antes_do_saldo, no mês do recebimento', async () => {
    const C = await cenario();
    const antes = somarDias(C.hoje, -61);
    const [, q] = partes(
      await destino(
        criarLancamentoAction(
          {},
          novaEntrada(C, { vencimento: antes, jaFoi: 'on', pagoEm: antes, forma: 'dinheiro' }),
        ),
      ),
    );
    expect(q).toMatchObject({ mes: mesDe(antes), ok: 'salvo', aviso: 'antes_do_saldo' });
  });

  it('erro: devolve os erros por campo e o que foi digitado (valores), com um envio novo; nada é gravado', async () => {
    const C = await cenario();
    const r = await criarLancamentoAction(
      {},
      novaEntrada(C, { jaFoi: 'on', pagoEm: C.hoje, forma: '' }),
    );
    expect(r.erros).toEqual({ forma: M.escolhaForma });
    expect(r.valores).toMatchObject({
      valor: '250,00',
      categoriaId: C.consultas,
      descricao: 'Retorno',
      pacienteId: C.p,
      jaFoi: 'on',
      pagoEm: C.hoje,
      forma: '',
    });
    expect(r.envio).toEqual(expect.any(Number));
    expect((await criarLancamentoAction(r, novaEntrada(C, { valor: '' }))).envio).not.toBe(r.envio);
    expect(await contar(C.tenantId)).toBe(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('paciente bloqueado: recusa com o texto exato, no campo do paciente', async () => {
    const C = await cenario();
    await bloquear(C, C.p);
    const r = await criarLancamentoAction({}, novaEntrada(C));
    expect(r.erros).toEqual({ pacienteId: M.bloqueadoNovo });
    expect(r.erros?.pacienteId).toBe(
      'Paciente bloqueado por pedido de exclusão: não é possível criar lançamentos novos para ele.',
    );
    expect(await contar(C.tenantId)).toBe(0);
  });

  it('o consultório e a usuária vêm da sessão: paciente de outro consultório não é encontrado; tenantId do formulário é ignorado', async () => {
    const A = await cenario();
    const B = await cenario();
    await expect(criarLancamentoAction({}, novaEntrada(B, { pacienteId: A.p }))).rejects.toThrow(
      'notFound',
    );
    const fd = formulario({
      tipo: 'saida',
      valor: '10,00',
      categoriaId: B.aluguel,
      vencimento: B.hoje,
      tenantId: A.tenantId,
      criadoPor: A.nutriId,
    });
    await destino(criarLancamentoAction({}, fd));
    expect(await contar(A.tenantId)).toBe(0);
    const { rows } = await owner.pool.query(
      'select criado_por from fin_lancamentos where tenant_id = $1',
      [B.tenantId],
    );
    expect(rows).toEqual([{ criado_por: B.nutriId }]);
  });
});

describe('editarLancamentoAction (US-302)', () => {
  it('salva e volta à lista no mês de referência com ?ok=salvo', async () => {
    const C = await cenario();
    const { id } = await gravada(C);
    const fd = formulario({
      id,
      valor: '200,00',
      categoriaId: C.consultas,
      vencimento: C.hoje,
      descricao: 'Retorno',
    });
    const [caminho, q] = partes(await destino(editarLancamentoAction({}, fd)));
    expect([caminho, q.mes, q.ok]).toEqual([LISTA, mesDe(C.hoje), 'salvo']);
    expect(await ler(id)).toMatchObject({ valor_centavos: 20_000, descricao: 'Retorno' });
  });

  it('paciente bloqueado: reduzir salva; aumentar recusa com o texto exato e devolve o digitado', async () => {
    const C = await cenario();
    const { id } = await gravada(C);
    await bloquear(C, C.p);
    const base = { id, categoriaId: C.consultas, vencimento: C.hoje, descricao: '' };
    const r = await editarLancamentoAction({}, formulario({ ...base, valor: '300,00' }));
    expect(r.erros).toEqual({
      geral:
        'Paciente bloqueado por pedido de exclusão: só é possível registrar o recebimento, reduzir o valor ou cancelar.',
    });
    expect(r.valores?.valor).toBe('300,00');
    expect(await ler(id)).toMatchObject({ valor_centavos: 25_000 });
    await destino(editarLancamentoAction({}, formulario({ ...base, valor: '200,00' })));
    expect(await ler(id)).toMatchObject({ valor_centavos: 20_000 });
  });

  it('lançamento de outro consultório → 404 e nada muda', async () => {
    const A = await cenario();
    const { id } = await gravada(A);
    const B = await cenario();
    await expect(
      editarLancamentoAction(
        {},
        formulario({ id, valor: '1,00', categoriaId: B.consultas, vencimento: B.hoje }),
      ),
    ).rejects.toThrow('notFound');
    expect(await ler(id)).toMatchObject({ valor_centavos: 25_000 });
  });
});

describe('receber, desfazer e cancelar (US-302)', () => {
  it('receber volta ao destino da tela (lista com os filtros) com ?ok=recebido; saída → ?ok=pago', async () => {
    const C = await cenario();
    const { id } = await gravada(C);
    const volta = `${LISTA}?mes=${mesDe(C.hoje)}&situacao=previsto&ok=salvo&aviso=antes_do_saldo&envio=1`;
    const [caminho, q] = partes(
      await destino(
        receberLancamentoAction({}, formulario({ id, volta, pagoEm: C.hoje, forma: 'dinheiro' })),
      ),
    );
    expect(caminho).toBe(LISTA);
    expect(q).toEqual({
      mes: mesDe(C.hoje),
      situacao: 'previsto',
      ok: 'recebido',
      envio: expect.stringMatching(/^\d+$/),
    });
    expect(await ler(id)).toMatchObject({ pago_em: C.hoje, forma_pagamento: 'dinheiro' });
    const s = await criarLancamento(
      C.ctx,
      C.tenant,
      { tipo: 'saida', valor: '90,00', categoriaId: C.aluguel, vencimento: C.hoje },
      { db: app.db },
    );
    const [, qs] = partes(
      await destino(
        receberLancamentoAction(
          {},
          formulario({ id: s.id, volta: `${LISTA}/${s.id}`, pagoEm: C.hoje, forma: 'pix' }),
        ),
      ),
    );
    expect(qs.ok).toBe('pago');
  });

  it('o destino só volta à lista ou à edição: outro endereço vira a lista, sem filtros', async () => {
    const C = await cenario();
    for (const volta of [
      'https://exemplo.com/painel/financeiro/lancamentos',
      '//exemplo.com/x',
      '/painel/pacientes',
      `${LISTA}/../../pacientes`,
      `${LISTA}/nao-e-id`,
    ]) {
      const { id } = await gravada(C);
      const [caminho, q] = partes(
        await destino(
          receberLancamentoAction({}, formulario({ id, volta, pagoEm: C.hoje, forma: 'pix' })),
        ),
      );
      expect([caminho, Object.keys(q).sort()], volta).toEqual([LISTA, ['envio', 'ok']]);
    }
    const { id } = await gravada(C);
    expect(
      partes(
        await destino(
          receberLancamentoAction(
            {},
            formulario({ id, volta: `${LISTA}/${id}?x=1`, pagoEm: C.hoje, forma: 'pix' }),
          ),
        ),
      )[0],
    ).toBe(`${LISTA}/${id}`);
    // o id em maiúsculas (aceito por `idValido`) também volta à edição; o resto do caminho continua exato
    const maiusculo = await gravada(C);
    expect(
      partes(
        await destino(
          receberLancamentoAction({}, formulario({ id: maiusculo.id, volta: `${LISTA}/${maiusculo.id.toUpperCase()}`, pagoEm: C.hoje, forma: 'pix' })),
        ),
      )[0],
    ).toBe(`${LISTA}/${maiusculo.id.toUpperCase()}`);
    const outroCaso = await gravada(C);
    expect(
      partes(
        await destino(
          receberLancamentoAction({}, formulario({ id: outroCaso.id, volta: `/PAINEL/financeiro/lancamentos/${outroCaso.id}`, pagoEm: C.hoje, forma: 'pix' })),
        ),
      )[0],
    ).toBe(LISTA);
  });

  it('Plano 20 (T8): receber no detalhe "Pagamentos pendentes de {nome}" volta para ele, sem outros parâmetros', async () => {
    const C = await cenario();
    const { id } = await gravada(C);
    const pendencias = `/painel/financeiro/pendencias/${C.p}`;
    const [caminho, q] = partes(
      await destino(
        receberLancamentoAction({}, formulario({ id, volta: `${pendencias}?ok=recebido&x=1`, pagoEm: C.hoje, forma: 'pix' })),
      ),
    );
    expect([caminho, Object.keys(q).sort()]).toEqual([pendencias, ['envio', 'ok']]);
    expect(q.ok).toBe('recebido');
    const outro = await gravada(C);
    expect(
      partes(
        await destino(
          receberLancamentoAction({}, formulario({ id: outro.id, volta: '/painel/financeiro/pendencias/nao-e-id', pagoEm: C.hoje, forma: 'pix' })),
        ),
      )[0],
    ).toBe(LISTA);
  });

  it('receber com erro devolve os erros e o digitado; desfazer volta com ?ok=salvo e limpa a data', async () => {
    const C = await cenario();
    const { id } = await gravada(C);
    const r = await receberLancamentoAction(
      {},
      formulario({ id, volta: LISTA, pagoEm: somarDias(C.hoje, 1), forma: '' }),
    );
    expect(r.erros).toEqual({ pagoEm: M.recebimentoFuturo, forma: M.escolhaForma });
    expect(r.valores).toEqual({ pagoEm: somarDias(C.hoje, 1), forma: '' });
    await destino(
      receberLancamentoAction({}, formulario({ id, volta: LISTA, pagoEm: C.hoje, forma: 'pix' })),
    );
    expect(
      partes(
        await destino(desfazerRecebimentoAction({}, formulario({ id, volta: `${LISTA}/${id}` }))),
      ),
    ).toEqual([`${LISTA}/${id}`, { ok: 'salvo', envio: expect.stringMatching(/^\d+$/) }]);
    expect(await ler(id)).toMatchObject({ pago_em: null, forma_pagamento: null });
  });

  it('cancelar sem motivo → "Informe o motivo do cancelamento."; com motivo → ?ok=cancelado; cancelado não muda mais', async () => {
    const C = await cenario();
    const { id } = await gravada(C);
    const r = await cancelarLancamentoAction({}, formulario({ id, volta: LISTA, motivo: '  ' }));
    expect(r.erros).toEqual({ motivo: 'Informe o motivo do cancelamento.' });
    expect(r.valores).toEqual({ motivo: '  ' });
    const [, q] = partes(
      await destino(
        cancelarLancamentoAction(
          {},
          formulario({ id, volta: LISTA, motivo: 'Lançado em duplicidade' }),
        ),
      ),
    );
    expect(q.ok).toBe('cancelado');
    expect(await ler(id)).toMatchObject({
      motivo_cancelamento: 'Lançado em duplicidade',
      cancelado_por: C.nutriId,
    });
    expect(
      (
        await receberLancamentoAction(
          {},
          formulario({ id, volta: LISTA, pagoEm: C.hoje, forma: 'pix' }),
        )
      ).erros,
    ).toEqual({ geral: M.cancelado });
  });

  it('outra sessão (outro consultório) não recebe, não desfaz e não cancela: 404 e nada muda', async () => {
    const A = await cenario();
    const { id } = await gravada(A, { pagoEm: A.hoje, forma: 'pix' });
    await cenario(); // a sessão passa a ser de outro consultório
    await expect(
      receberLancamentoAction(
        {},
        formulario({ id, volta: LISTA, pagoEm: A.hoje, forma: 'dinheiro' }),
      ),
    ).rejects.toThrow('notFound');
    await expect(desfazerRecebimentoAction({}, formulario({ id, volta: LISTA }))).rejects.toThrow(
      'notFound',
    );
    await expect(
      cancelarLancamentoAction({}, formulario({ id, volta: LISTA, motivo: 'x' })),
    ).rejects.toThrow('notFound');
    expect(await ler(id)).toMatchObject({
      pago_em: A.hoje,
      forma_pagamento: 'pix',
      cancelado_em: null,
    });
  });
});
