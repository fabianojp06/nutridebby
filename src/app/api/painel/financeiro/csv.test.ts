import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { getAuth } from '@/lib/auth';
import { makeDb } from '../../../../../test/db';
import { nutriComDpa } from '../../../../../test/nutri';
import { novoPaciente, novoTenant } from '../../../../../test/pacientes';
import { pacienteComConta } from '../../../../../test/portal';
import { criarEEntrar, entrar } from '../../../../../test/sessao';

/**
 * US-306 / RN-321 (Plano 20, T8): as rotas dos CSV, com o banco e a sessão de verdade. Em navegação (o link e o formulário
 * de Relatórios), a nutricionista nunca vê JSON: sem sessão vai ao login, DPA pendente vai a /painel/dpa, período inválido
 * volta a Relatórios. Papel errado (paciente, admin) fica no 403 JSON de sempre (acesso-negado.test.ts).
 */
const falha = vi.hoisted(() => ({ csv: false }));
vi.mock('server-only', () => ({}));
// erro forçado DEPOIS da leitura e do `exportar`, ainda dentro da transação (a montagem do arquivo)
vi.mock('@/modules/financeiro/csv', async (orig) => {
  const real = await orig<typeof import('@/modules/financeiro/csv')>();
  return {
    ...real,
    csvLancamentos: (...a: Parameters<typeof real.csvLancamentos>) => {
      if (falha.csv) throw new Error('falha forçada na montagem do CSV');
      return real.csvLancamentos(...a);
    },
  };
});

const { GET: lancamentosCsv, HEAD: lancamentosHead } = await import('./lancamentos.csv/route');
const { GET: fluxoCsv, HEAD: fluxoHead } = await import('./fluxo-de-caixa.csv/route');
const { listarCategorias, salvarConfiguracoes } = await import('@/modules/financeiro/configuracoes');
const { cancelarLancamento, criarLancamento } = await import('@/modules/financeiro/lancamentos');

const db = getDb();
const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  await closeDb();
  await owner.pool.end();
});
beforeEach(() => {
  falha.csv = false;
});

const BOM = [0xef, 0xbb, 0xbf];
const LOGIN = `/entrar?volta=${encodeURIComponent('/painel/financeiro/relatorios')}`;

/**
 * O link e o formulário de Relatórios: navegação da própria origem (`Sec-Fetch-Site: same-origin`), salvo `site`; `extra`
 * acrescenta `Origin`/`Referer` (navegador sem `Sec-Fetch-Site`).
 */
const pedir = (rota: typeof lancamentosCsv, caminho: string, cookie?: string, site: string | null = 'same-origin', extra: Record<string, string> = {}) =>
  rota(
    new Request(`http://localhost:3000/api/painel/financeiro/${caminho}`, {
      headers: { ...(cookie ? { cookie } : {}), ...(site ? { 'sec-fetch-site': site } : {}), ...extra },
    }),
  );

/** Os bytes (para ver o BOM, que o `text()` tira) e o texto sem o BOM. */
async function corpo(r: Response) {
  const bytes = new Uint8Array(await r.arrayBuffer());
  return { bytes, texto: new TextDecoder('utf-8', { ignoreBOM: false }).decode(bytes) };
}
const linhas = (texto: string) => texto.split('\r\n').slice(0, -1).map((l) => l.split(';'));

const exportacoes = async (tenantId: string) =>
  (
    await owner.pool.query<{ patient_id: string | null; entidade_id: string | null; actor_user_id: string | null }>(
      `select patient_id, entidade_id, actor_user_id from audit_log where tenant_id = $1 and acao = 'exportar' and entidade = 'financeiro' order by patient_id nulls first`,
      [tenantId],
    )
  ).rows;

/** Nutricionista com DPA, Financeiro configurado, dois pacientes e lançamentos de outubro de 2026 (e um de novembro). */
async function cenario() {
  const A = await nutriComDpa(db, getAuth());
  const [t] = await db.select({ fuso: tenants.fuso }).from(tenants).where(eq(tenants.id, A.tenantId));
  const ctx = { ...A.ctx, ip: '203.0.113.30' };
  await salvarConfiguracoes(ctx, t, { saldoInicialEm: '2026-01-01', saldoInicial: '1.000,00', valorConsulta: '250,00' });
  const cats = await listarCategorias(ctx);
  const cat = (nome: string) => cats.find((c) => c.nome === nome)!.id;
  const ana = await novoPaciente(db, ctx, { nome: 'Ana Souza' });
  const bia = await novoPaciente(db, ctx, { nome: 'Beatriz Lima' });
  const lancar = (extra: Record<string, unknown>) => criarLancamento(ctx, t, { tipo: 'entrada', valor: '250,00', categoriaId: cat('Consultas'), ...extra });
  await lancar({ vencimento: '2026-10-05', pacienteId: ana.id, descricao: 'Ana — retorno', jaFoi: 'on', pagoEm: '2026-10-05', forma: 'pix' });
  await lancar({ vencimento: '2026-10-10', pacienteId: bia.id, descricao: 'Primeira consulta' });
  await lancar({ vencimento: '2026-10-12', categoriaId: cat('Outras entradas'), valor: '1.250,50', descricao: '=HIPERLINK("x")' });
  const cancelada = await lancar({ vencimento: '2026-10-20', pacienteId: ana.id, descricao: 'Duplicada' });
  await cancelarLancamento(ctx, cancelada.id, 'Lançada em duplicidade');
  await criarLancamento(ctx, t, { tipo: 'saida', valor: '1.200,00', categoriaId: cat('Aluguel e condomínio'), vencimento: '2026-10-01', descricao: 'Aluguel de outubro', jaFoi: 'on', pagoEm: '2026-10-01', forma: 'boleto' });
  await lancar({ vencimento: '2026-11-03', pacienteId: bia.id, descricao: 'Fora do período' });
  return { ...A, ctx, ana: ana.id, bia: bia.id };
}

describe('GET /api/painel/financeiro/lancamentos.csv (RN-321)', () => {
  it('sem "Incluir o nome dos pacientes": BOM, ";" e CRLF, sem a coluna Paciente, descrição vazia nas entradas de pacientes; um exportar sem paciente', async () => {
    const C = await cenario();
    const r = await pedir(lancamentosCsv, 'lancamentos.csv?de=2026-10-01&ate=2026-10-31', C.cookie);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="lancamentos-2026-10-01-a-2026-10-31.csv"');
    expect(r.headers.get('cache-control')).toBe('no-store');
    const { bytes, texto } = await corpo(r);
    expect([...bytes.slice(0, 3)]).toEqual(BOM);
    expect(texto.endsWith('\r\n')).toBe(true);
    expect(texto.replaceAll('\r\n', '')).not.toContain('\n');
    const [cabecalho, ...dados] = linhas(texto);
    expect(cabecalho).toEqual(['Vencimento', 'Pagamento', 'Tipo', 'Categoria', 'Descrição', 'Forma de pagamento', 'Valor', 'Situação']);
    // o período é pela data de referência (RN-306); o cancelado entra, com a situação; o de novembro fica de fora
    expect(dados).toHaveLength(5);
    expect(texto).not.toContain('Ana Souza');
    expect(texto).not.toContain('Beatriz Lima');
    expect(texto).not.toContain('Ana — retorno');
    expect(texto).not.toContain('Primeira consulta');
    expect(texto).not.toContain('Duplicada');
    expect(dados).toContainEqual(['05/10/2026', '05/10/2026', 'Entrada', 'Consultas', '', 'Pix', '250,00', 'Recebido']);
    expect(dados).toContainEqual(['20/10/2026', '', 'Entrada', 'Consultas', '', '', '250,00', 'Cancelado']);
    expect(dados).toContainEqual(['01/10/2026', '01/10/2026', 'Saída', 'Aluguel e condomínio', 'Aluguel de outubro', 'Boleto', '1200,00', 'Pago']);
    // injeção de fórmula: a célula de texto ganha o apóstrofo (e as aspas, por causa das aspas dentro)
    expect(texto).toContain(`;"'=HIPERLINK(""x"")";`);
    expect(await exportacoes(C.tenantId)).toEqual([{ patient_id: null, entidade_id: null, actor_user_id: C.ctx.actorUserId }]);
  });

  it('com pacientes=1: a coluna Paciente (nome civil) e a descrição de todas as linhas; um exportar por paciente presente', async () => {
    const C = await cenario();
    const r = await pedir(lancamentosCsv, 'lancamentos.csv?de=2026-10-01&ate=2026-10-31&pacientes=1', C.cookie);
    expect(r.status).toBe(200);
    const [cabecalho, ...dados] = linhas((await corpo(r)).texto);
    expect(cabecalho).toEqual(['Vencimento', 'Pagamento', 'Tipo', 'Categoria', 'Descrição', 'Paciente', 'Forma de pagamento', 'Valor', 'Situação']);
    expect(dados).toContainEqual(['05/10/2026', '05/10/2026', 'Entrada', 'Consultas', 'Ana — retorno', 'Ana Souza', 'Pix', '250,00', 'Recebido']);
    expect(dados).toContainEqual(['10/10/2026', '', 'Entrada', 'Consultas', 'Primeira consulta', 'Beatriz Lima', '', '250,00', expect.any(String)]);
    expect(dados).toContainEqual(['01/10/2026', '01/10/2026', 'Saída', 'Aluguel e condomínio', 'Aluguel de outubro', '', 'Boleto', '1200,00', 'Pago']);
    const ex = await exportacoes(C.tenantId);
    expect(ex.map((e) => e.patient_id).sort()).toEqual([C.ana, C.bia].sort());
    expect(ex.every((e) => e.actor_user_id === C.ctx.actorUserId)).toBe(true);
  });

  it('período de 367 dias, invertido ou com data inválida → 303 para Relatórios com ?erro=periodo, sem exportar; 366 dias baixa', async () => {
    const C = await cenario();
    for (const q of ['de=2025-10-01&ate=2026-10-02', 'de=2026-10-31&ate=2026-10-01', 'de=2026-02-30&ate=2026-03-01', 'de=&ate=2026-10-01', '']) {
      const r = await pedir(lancamentosCsv, `lancamentos.csv?${q}`, C.cookie);
      expect([r.status, r.headers.get('location')], q).toEqual([303, '/painel/financeiro/relatorios?erro=periodo']);
      expect(r.headers.get('content-type') ?? '', q).not.toContain('json');
    }
    expect(await exportacoes(C.tenantId)).toEqual([]);
    expect((await pedir(lancamentosCsv, 'lancamentos.csv?de=2025-10-01&ate=2026-10-01', C.cookie)).status).toBe(200);
  });

  it('uma falha depois da leitura (na montagem do arquivo) desfaz o exportar: a leitura e o registro estão na mesma transação', async () => {
    const C = await cenario();
    falha.csv = true;
    await expect(pedir(lancamentosCsv, 'lancamentos.csv?de=2026-10-01&ate=2026-10-31&pacientes=1', C.cookie)).rejects.toThrow('falha forçada');
    expect(await exportacoes(C.tenantId)).toEqual([]);
  });
});

describe('GET /api/painel/financeiro/fluxo-de-caixa.csv (US-306)', () => {
  it('o fluxo do ano em CSV, com os cabeçalhos da RN-321 e um exportar sem paciente; ano inválido volta a Relatórios', async () => {
    const C = await cenario();
    const r = await pedir(fluxoCsv, 'fluxo-de-caixa.csv?ano=2026', C.cookie);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="fluxo-de-caixa-2026.csv"');
    expect(r.headers.get('cache-control')).toBe('no-store');
    const { bytes, texto } = await corpo(r);
    expect([...bytes.slice(0, 3)]).toEqual(BOM);
    const tabela = linhas(texto);
    expect(tabela[0]).toEqual(['Fluxo de caixa de 2026', 'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez', 'Total']);
    expect(tabela.find((l) => l[0] === 'Total de entradas')?.[10]).toBe('250,00');
    expect(tabela.find((l) => l[0] === 'Total de saídas')?.[10]).toBe('1200,00');
    expect(await exportacoes(C.tenantId)).toEqual([{ patient_id: null, entidade_id: null, actor_user_id: C.ctx.actorUserId }]);
    for (const q of ['ano=1999', 'ano=abc', '']) {
      const x = await pedir(fluxoCsv, `fluxo-de-caixa.csv?${q}`, C.cookie);
      expect([x.status, x.headers.get('location')], q).toEqual([303, '/painel/financeiro/relatorios']);
    }
    expect(await exportacoes(C.tenantId)).toHaveLength(1);
  });
});

describe('as duas rotas fora da sessão da nutricionista com DPA', () => {
  const CAMINHOS = [
    [lancamentosCsv, 'lancamentos.csv?de=2026-10-01&ate=2026-10-31'],
    [fluxoCsv, 'fluxo-de-caixa.csv?ano=2026'],
  ] as const;

  it('sem sessão → 303 para o login com a volta para Relatórios (nunca JSON)', async () => {
    for (const [rota, caminho] of CAMINHOS) {
      const r = await pedir(rota, caminho);
      expect([r.status, r.headers.get('location')], caminho).toEqual([303, LOGIN]);
      expect(r.headers.get('content-type') ?? '', caminho).not.toContain('json');
    }
  });

  it('DPA pendente → 303 para /painel/dpa (nunca JSON)', async () => {
    const [t] = await db.insert(tenants).values({ slug: `csv-${randomUUID().slice(0, 8)}`, nomeExibicao: 'CSV' }).returning();
    const n = await criarEEntrar(db, getAuth(), { appRole: 'nutri', tenantId: t.id });
    for (const [rota, caminho] of CAMINHOS) {
      const r = await pedir(rota, caminho, n.cookie);
      expect([r.status, r.headers.get('location')], caminho).toEqual([303, '/painel/dpa']);
    }
    expect(await exportacoes(t.id)).toEqual([]);
  });

  it('sessão de paciente e de admin → o 403 { erro: "Acesso negado" } de sempre', async () => {
    const { email } = await pacienteComConta(db, await novoTenant(db));
    const paciente = await entrar(getAuth(), email);
    const admin = (await criarEEntrar(db, getAuth(), { appRole: 'admin', twoFactorEnabled: true })).cookie;
    for (const cookie of [paciente, admin])
      for (const [rota, caminho] of CAMINHOS) {
        const r = await pedir(rota, caminho, cookie);
        expect(r.status, caminho).toBe(403);
        expect(await r.json(), caminho).toEqual({ erro: 'Acesso negado' });
      }
  });
});

describe('pedido vindo de outro site e HEAD (RN-321: o exportar só vale do clique da nutricionista)', () => {
  const CAMINHOS = [
    [lancamentosCsv, 'lancamentos.csv?de=2026-10-01&ate=2026-10-31&pacientes=1'],
    [fluxoCsv, 'fluxo-de-caixa.csv?ano=2026'],
  ] as const;
  /** A volta do `?erro=origem`: o do link do fluxo leva `csv=fluxo` (o alerta e o foco no cartão do fluxo, não no do formulário). */
  const VOLTA_DA_ORIGEM: Record<string, string> = {
    [CAMINHOS[0][1]]: '/painel/financeiro/relatorios?erro=origem',
    [CAMINHOS[1][1]]: '/painel/financeiro/relatorios?erro=origem&csv=fluxo',
  };

  it('Sec-Fetch-Site cross-site ou same-site → 303 para Relatórios, sem arquivo e sem exportar (mesmo com Referer da própria origem)', async () => {
    const C = await cenario();
    for (const site of ['cross-site', 'same-site'])
      for (const extra of [{}, { referer: 'http://localhost:3000/painel/financeiro/relatorios' }] as Record<string, string>[])
        for (const [rota, caminho] of CAMINHOS) {
          const r = await pedir(rota, caminho, C.cookie, site, extra);
          expect([r.status, r.headers.get('location')], `${site} ${caminho}`).toEqual([303, '/painel/financeiro/relatorios']);
          expect(r.headers.get('content-disposition'), `${site} ${caminho}`).toBeNull();
        }
    expect(await exportacoes(C.tenantId)).toEqual([]);
  });

  it('sem Sec-Fetch-Site e sem Origin nem Referer → 303 para Relatórios com ?erro=origem (o do fluxo com &csv=fluxo), sem arquivo e sem exportar', async () => {
    const C = await cenario();
    for (const [rota, caminho] of CAMINHOS) {
      const r = await pedir(rota, caminho, C.cookie, null);
      expect([r.status, r.headers.get('location')], caminho).toEqual([303, VOLTA_DA_ORIGEM[caminho]]);
      expect(r.headers.get('content-disposition'), caminho).toBeNull();
    }
    expect(await exportacoes(C.tenantId)).toEqual([]);
  });

  it('sem Sec-Fetch-Site, com Origin ou Referer de outro site (ou Origin de fora com Referer da casa) → 303 ?erro=origem, sem exportar', async () => {
    const C = await cenario();
    const casos: Record<string, string>[] = [
      { referer: 'https://outro.example/pagina' },
      { referer: 'http://localhost:3001/painel/financeiro/relatorios' },
      { referer: 'não é url' },
      { origin: 'https://outro.example' },
      { origin: 'null' },
      { origin: 'https://outro.example', referer: 'http://localhost:3000/painel/financeiro/relatorios' },
    ];
    for (const extra of casos)
      for (const [rota, caminho] of CAMINHOS) {
        const r = await pedir(rota, caminho, C.cookie, null, extra);
        expect([r.status, r.headers.get('location')], `${JSON.stringify(extra)} ${caminho}`).toEqual([303, VOLTA_DA_ORIGEM[caminho]]);
        expect(r.headers.get('content-disposition')).toBeNull();
      }
    expect(await exportacoes(C.tenantId)).toEqual([]);
  });

  it('sem Sec-Fetch-Site, com Referer ou Origin da própria origem (Safari antes do 16.4) → baixa e grava o exportar', async () => {
    const C = await cenario();
    for (const extra of [{ referer: 'http://localhost:3000/painel/financeiro/relatorios?ano=2026' }, { origin: 'http://localhost:3000' }] as Record<string, string>[]) {
      const r = await pedir(fluxoCsv, 'fluxo-de-caixa.csv?ano=2026', C.cookie, null, extra);
      expect(r.status, JSON.stringify(extra)).toBe(200);
      expect(r.headers.get('content-disposition')).toBe('attachment; filename="fluxo-de-caixa-2026.csv"');
    }
    expect(await exportacoes(C.tenantId)).toHaveLength(2);
    const r = await pedir(lancamentosCsv, 'lancamentos.csv?de=2026-10-01&ate=2026-10-31', C.cookie, null, { referer: 'http://localhost:3000/painel/financeiro/relatorios' });
    expect(r.status).toBe(200);
    expect(await exportacoes(C.tenantId)).toHaveLength(3);
  });

  it('HEAD → 405 sem tocar o banco (o HEAD automático do Next chamaria o GET)', async () => {
    const C = await cenario();
    for (const head of [lancamentosHead, fluxoHead]) {
      const r = await head();
      expect(r.status).toBe(405);
      expect(r.headers.get('allow')).toBe('GET');
    }
    expect(await exportacoes(C.tenantId)).toEqual([]);
  });

  it('controle: same-origin e none (endereço digitado) baixam e gravam o exportar', async () => {
    const C = await cenario();
    for (const site of ['same-origin', 'none']) {
      const r = await pedir(fluxoCsv, 'fluxo-de-caixa.csv?ano=2026', C.cookie, site);
      expect(r.status, site).toBe(200);
      expect(r.headers.get('content-disposition'), site).toBe('attachment; filename="fluxo-de-caixa-2026.csv"');
    }
    expect(await exportacoes(C.tenantId)).toHaveLength(2);
    const r = await pedir(lancamentosCsv, 'lancamentos.csv?de=2026-10-01&ate=2026-10-31&pacientes=1', C.cookie);
    expect(r.status).toBe(200);
    expect((await exportacoes(C.tenantId)).filter((e) => e.patient_id !== null).map((e) => e.patient_id).sort()).toEqual([C.ana, C.bia].sort());
  });
});
