import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { auditLog, patientCadastro, tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getAuth } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { consultaDireta, em } from '../../../../../../test/agenda';
import { nutriComDpa } from '../../../../../../test/nutri';
import { novoPaciente, novoTenant } from '../../../../../../test/pacientes';
import { pacienteComConta } from '../../../../../../test/portal';
import { criarEEntrar, entrar } from '../../../../../../test/sessao';

/**
 * Plano 26, T3 (US-487, RN-493, RN-494, RNF-482): a rota do CSV dos Relatórios com o banco e a sessão de verdade. Numa
 * navegação nunca há JSON: sem sessão → login com a volta para a seção; DPA pendente → /painel/dpa; período inválido → a
 * seção com `?erro=periodo`. O `exportar` (entidade `relatorios`) é gravado na transação da leitura: um sem paciente no
 * agregado, um por paciente no Ranking. Seção não permitida → 303 para /painel/sem-permissao com o motivo (T6).
 */
const falha = vi.hoisted(() => ({ csv: false, semPermissao: false }));
vi.mock('server-only', () => ({}));
// erro forçado DEPOIS da leitura e do `exportar`, ainda dentro da transação (a montagem do arquivo)
vi.mock('@/modules/relatorios/csv', async (orig) => {
  const real = await orig<typeof import('@/modules/relatorios/csv')>();
  return {
    ...real,
    montarCsv: (...a: Parameters<typeof real.montarCsv>) => {
      if (falha.csv) throw new Error('falha forçada: Ana Souza 250,00 Consultas');
      return real.montarCsv(...a);
    },
  };
});
// a nutricionista vê todas as seções (RN-480): a recusa só se prova com a regra trocada
vi.mock('@/modules/relatorios/acesso', async (orig) => {
  const real = await orig<typeof import('@/modules/relatorios/acesso')>();
  return { ...real, podeVerSecao: (...a: Parameters<typeof real.podeVerSecao>) => !falha.semPermissao && real.podeVerSecao(...a) };
});

const { GET, HEAD } = await import('./route');

const db = getDb();
afterAll(() => closeDb());
beforeEach(() => {
  falha.csv = false;
  falha.semPermissao = false;
  vi.restoreAllMocks();
});

const BOM = [0xef, 0xbb, 0xbf];
const pedir = (q: string, cookie?: string, site: string | null = 'same-origin', extra: Record<string, string> = {}) =>
  GET(
    new Request(`http://localhost:3000/api/painel/relatorios/csv?${q}`, {
      headers: { ...(cookie ? { cookie } : {}), ...(site ? { 'sec-fetch-site': site } : {}), ...extra },
    }),
  );
async function corpo(r: Response) {
  const bytes = new Uint8Array(await r.arrayBuffer());
  return { bytes, texto: new TextDecoder('utf-8', { ignoreBOM: false }).decode(bytes) };
}
const linhas = (texto: string) => texto.split('\r\n').slice(0, -1).map((l) => l.split(';'));

/**
 * As exportações dos Relatórios do consultório, lidas **dentro** de `withTenant` na sessão da nutricionista (fora, a RLS
 * de `audit_log` esconderia tudo e o "0 linhas" passaria calado). O controle positivo de cada caso é a linha gravada pela
 * rota aparecer nesta mesma leitura.
 */
const exportacoes = (ctx: TenantContext) =>
  withTenant(
    ctx,
    (tx) =>
      tx
        .select({ acao: auditLog.acao, entidadeId: auditLog.entidadeId, patientId: auditLog.patientId, actorUserId: auditLog.actorUserId })
        .from(auditLog)
        .where(and(eq(auditLog.tenantId, ctx.tenantId), eq(auditLog.entidade, 'relatorios'))),
    db,
  );

/** Nutricionista com DPA e três pacientes com consultas realizadas em março de 2026 (João com nome social). */
async function cenario() {
  const A = await nutriComDpa(db, getAuth());
  const ctx: TenantContext = { ...A.ctx, ip: '203.0.113.36' };
  const ana = (await novoPaciente(db, ctx, { nome: 'Ana Souza' })).id;
  const joao = (await novoPaciente(db, ctx, { nome: 'João Silva' })).id;
  const bia = (await novoPaciente(db, ctx, { nome: '=Bia' })).id;
  await withTenant(ctx, (tx) => tx.insert(patientCadastro).values({ tenantId: ctx.tenantId, patientId: joao, nomeSocial: 'Joana Silva' }), db);
  for (const [p, dia] of [[ana, '2026-03-02'], [ana, '2026-03-09'], [joao, '2026-03-03'], [bia, '2026-03-04']] as const)
    await consultaDireta(db, ctx, p, em(dia, '10:00'), 60, { status: 'realizada' });
  return { ...A, ctx, ana, joao, bia };
}

describe('GET /api/painel/relatorios/csv (US-487, RN-494)', () => {
  it('agregado: CSV com BOM, ";" e CRLF, o nome da RN-494 e um exportar sem paciente com entidade_id "{secao}|{de}..{ate}|todos"', async () => {
    const C = await cenario();
    expect(await exportacoes(C.ctx)).toEqual([]);
    const r = await pedir('secao=agenda&de=2026-01&ate=2026-06', C.cookie);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="relatorio-agenda-2026-01-a-2026-06.csv"');
    expect(r.headers.get('cache-control')).toBe('no-store');
    const { bytes, texto } = await corpo(r);
    expect([...bytes.slice(0, 3)]).toEqual(BOM);
    expect(texto.endsWith('\r\n')).toBe(true);
    expect(texto.replaceAll('\r\n', '')).not.toContain('\n');
    const tabela = linhas(texto);
    expect(tabela[0]).toEqual(['Mês', 'Marcadas', 'Realizadas', 'Faltas', 'Taxa de faltas', 'Canceladas pelo paciente', 'Canceladas pelo consultório', 'Marcadas pelo paciente', 'Retornos']);
    expect(tabela.find((l) => l[0] === '03/2026')?.slice(0, 3)).toEqual(['03/2026', '4', '4']);
    expect(tabela).toHaveLength(7);
    expect(await exportacoes(C.ctx)).toEqual([{ acao: 'exportar', entidadeId: 'agenda|2026-01..2026-06|todos', patientId: null, actorUserId: C.ctx.actorUserId }]);
  });

  it('Ranking: a coluna "Paciente (nome de registro)" com o nome civil (célula com fórmula neutralizada) e um exportar por paciente da lista', async () => {
    const C = await cenario();
    const r = await pedir('secao=ranking&de=2026-01&ate=2026-06&por=consultas', C.cookie);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="relatorio-ranking-consultas-2026-01-a-2026-06.csv"');
    const { texto } = await corpo(r);
    const tabela = linhas(texto);
    expect(tabela[1]).toEqual(['Posição', 'Paciente (nome de registro)', 'Consultas']);
    expect(tabela[2]).toEqual(['1', 'Ana Souza', '2']);
    expect(texto).toContain('João Silva');
    expect(texto).not.toContain('Joana Silva');
    expect(texto).toContain(";'=Bia;");
    const ex = await exportacoes(C.ctx);
    expect(ex.map((e) => e.patientId).sort()).toEqual([C.ana, C.joao, C.bia].sort());
    expect(ex.every((e) => e.acao === 'exportar' && e.entidadeId === 'ranking|2026-01..2026-06|todos' && e.actorUserId === C.ctx.actorUserId)).toBe(true);
    // sem `por`, "Mais consultas"; "Maior receita" com o nome próprio do arquivo
    const receita = await pedir('secao=ranking&de=2026-01&ate=2026-06&por=receita', C.cookie);
    expect(receita.headers.get('content-disposition')).toBe('attachment; filename="relatorio-ranking-receita-2026-01-a-2026-06.csv"');
    expect((await pedir('secao=ranking&de=2026-01&ate=2026-06', C.cookie)).headers.get('content-disposition')).toContain('relatorio-ranking-consultas-');
  });

  it('período inválido (invertido, longo, ilegível, futuro) → 303 para a seção com ?erro=periodo, sem exportar; sem período, o padrão baixa', async () => {
    const C = await cenario();
    for (const q of ['de=2026-06&ate=2026-01', 'de=2025-01&ate=2026-06', 'de=abc&ate=2026-06', 'de=2026-01&ate=2099-01']) {
      const r = await pedir(`secao=planos&${q}`, C.cookie);
      expect([r.status, r.headers.get('location')], q).toEqual([303, '/painel/relatorios/planos?erro=periodo']);
      expect(r.headers.get('content-type') ?? '', q).not.toContain('json');
    }
    const pacientes = await pedir('secao=pacientes&de=2026-06&ate=2026-01', C.cookie);
    expect(pacientes.headers.get('location')).toBe('/painel/relatorios?erro=periodo');
    expect(await exportacoes(C.ctx)).toEqual([]);
    const padrao = await pedir('secao=planos', C.cookie);
    expect(padrao.status).toBe(200);
    expect(await exportacoes(C.ctx)).toHaveLength(1);
  });

  it('seção desconhecida ou critério do Ranking inválido → 303 para os Relatórios, sem exportar', async () => {
    const C = await cenario();
    for (const [q, destino] of [
      ['secao=prontuario&de=2026-01&ate=2026-06', '/painel/relatorios'],
      ['de=2026-01&ate=2026-06', '/painel/relatorios'],
      ['secao=ranking&de=2026-01&ate=2026-06&por=nome', '/painel/relatorios/ranking'],
    ]) {
      const r = await pedir(q, C.cookie);
      expect([r.status, r.headers.get('location')], q).toEqual([303, destino]);
    }
    expect(await exportacoes(C.ctx)).toEqual([]);
  });

  it('seção não permitida (RN-480) → 303 para "Sem permissão" com o motivo (T6, RE-D47), sem arquivo e sem exportar', async () => {
    const C = await cenario();
    falha.semPermissao = true;
    for (const [q, motivo] of [
      ['secao=agenda&de=2026-01&ate=2026-06', 'nutri'],
      ['secao=financeiro&de=2026-01&ate=2026-06', 'financeiro'],
    ]) {
      const r = await pedir(q, C.cookie);
      expect([r.status, r.headers.get('location')], q).toEqual([303, `/painel/sem-permissao?motivo=${motivo}`]);
      expect(r.headers.get('content-disposition')).toBeNull();
    }
    expect(await exportacoes(C.ctx)).toEqual([]);
  });

  it('falha na montagem do arquivo: o exportar volta junto (mesma transação) e o log tem só o código, a seção e o motivo técnico (RNF-482)', async () => {
    const C = await cenario();
    const erro = vi.spyOn(logger, 'error').mockImplementation(() => undefined as never);
    const aviso = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never);
    const consola = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    falha.csv = true;
    const r = await pedir('secao=ranking&de=2026-01&ate=2026-06', C.cookie);
    expect(r.status).toBe(500);
    expect(r.headers.get('content-disposition')).toBeNull();
    expect(await exportacoes(C.ctx)).toEqual([]);
    expect(erro).toHaveBeenCalledTimes(1);
    const [campos, mensagem] = erro.mock.calls[0] as unknown as [Record<string, unknown>, string];
    expect(Object.keys(campos).sort()).toEqual(['codigo', 'motivo', 'secao']);
    expect(campos).toEqual({ codigo: 'relatorios_csv_falhou', secao: 'ranking', motivo: 'Error' });
    const registrado = JSON.stringify([...erro.mock.calls, ...aviso.mock.calls, ...consola.mock.calls]);
    expect(mensagem).not.toMatch(/\d/);
    for (const dado of ['Ana', 'João', 'Joana', 'Bia', '250', 'Consultas', '2026', C.ana, C.joao]) expect(registrado, dado).not.toContain(dado);
    // controle: sem a falha, a mesma leitura grava e a mesma consulta ao log enxerga
    falha.csv = false;
    expect((await pedir('secao=ranking&de=2026-01&ate=2026-06', C.cookie)).status).toBe(200);
    expect(await exportacoes(C.ctx)).toHaveLength(3);
  });
});

describe('fora da sessão da nutricionista com DPA, de outro site e HEAD', () => {
  it('sem sessão → 303 para o login com a volta para a seção (nunca JSON)', async () => {
    for (const [q, volta] of [
      ['secao=agenda&de=2026-01&ate=2026-06', '/painel/relatorios/agenda'],
      ['secao=pacientes', '/painel/relatorios'],
      ['secao=xyz', '/painel/relatorios'],
    ]) {
      const r = await pedir(q);
      expect([r.status, r.headers.get('location')], q).toEqual([303, `/entrar?volta=${encodeURIComponent(volta)}`]);
      expect(r.headers.get('content-type') ?? '', q).not.toContain('json');
    }
  });

  it('DPA pendente → 303 para /painel/dpa, sem exportar', async () => {
    const [t] = await db.insert(tenants).values({ slug: `rel-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Rel' }).returning();
    const n = await criarEEntrar(db, getAuth(), { appRole: 'nutri', tenantId: t.id });
    const r = await pedir('secao=agenda&de=2026-01&ate=2026-06', n.cookie);
    expect([r.status, r.headers.get('location')]).toEqual([303, '/painel/dpa']);
    expect(await exportacoes({ tenantId: t.id, role: 'nutri', actorUserId: n.id, ip: null })).toEqual([]);
  });

  it('sessão de paciente e de admin → o 403 { erro: "Acesso negado" } de sempre', async () => {
    const { email } = await pacienteComConta(db, await novoTenant(db));
    const paciente = await entrar(getAuth(), email);
    const admin = (await criarEEntrar(db, getAuth(), { appRole: 'admin', twoFactorEnabled: true })).cookie;
    for (const cookie of [paciente, admin]) {
      const r = await pedir('secao=agenda&de=2026-01&ate=2026-06', cookie);
      expect(r.status).toBe(403);
      expect(await r.json()).toEqual({ erro: 'Acesso negado' });
    }
  });

  it('pedido vindo de outro site, ou sem como confirmar a origem → 303 para a seção, sem arquivo e sem exportar; Referer da casa baixa', async () => {
    const C = await cenario();
    const q = 'secao=ranking&de=2026-01&ate=2026-06';
    for (const [site, extra] of [
      ['cross-site', {}],
      ['same-site', { referer: 'http://localhost:3000/painel/relatorios/ranking' }],
      [null, {}],
      [null, { origin: 'https://outro.example' }],
      [null, { referer: 'https://outro.example/x' }],
    ] as [string | null, Record<string, string>][]) {
      const r = await pedir(q, C.cookie, site, extra);
      expect([r.status, r.headers.get('location')], `${site} ${JSON.stringify(extra)}`).toEqual([303, '/painel/relatorios/ranking']);
      expect(r.headers.get('content-disposition')).toBeNull();
    }
    expect(await exportacoes(C.ctx)).toEqual([]);
    for (const [site, extra] of [
      ['none', {}],
      [null, { referer: 'http://localhost:3000/painel/relatorios/ranking' }],
    ] as [string | null, Record<string, string>][])
      expect((await pedir(q, C.cookie, site, extra)).status, `${site}`).toBe(200);
    expect(await exportacoes(C.ctx)).toHaveLength(6);
  });

  it('HEAD → 405 sem tocar o banco', async () => {
    const r = await HEAD();
    expect(r.status).toBe(405);
    expect(r.headers.get('allow')).toBe('GET');
  });
});
