import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { consultaDireta } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { auditLog, tenants, type TenantRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { espiarLeiturasNegadas } from './leituras-negadas';

/**
 * Plano 26 (RN-514, RE-D63, R-482): o Início na sessão da recepção, no banco de verdade e com o espião de leituras negadas:
 * a página falha se chamar qualquer leitura do Início da nutricionista (indicadores, diário, WhatsApp, métricas, documentos,
 * pedidos do titular) ou um `auditRead` fora do cadastro.
 */
const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(() => Promise.all([app.pool.end(), owner.pool.end()]));

const sessao = vi.hoisted(() => ({ atual: null as null | { data: unknown; tenant: unknown; ctx: unknown; papel: 'recepcao'; financeiro: boolean } }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/tenant-session', () => ({ requireEquipe: vi.fn(async () => sessao.atual) }));
// o módulo do Início da recepção usa o banco do teste (o getDb do app apontaria para o mesmo, mas fecha com o processo)
vi.mock('@/db/client', async (original) => {
  const o = await original<typeof import('@/db/client')>();
  return { ...o, getDb: () => app.db };
});
const { chamadas } = espiarLeiturasNegadas(vi);
const { default: PainelHome } = await import('./page');
/** O ramo da recepção devolve o componente assíncrono InicioDaRecepcao: resolvido aqui (o renderToStaticMarkup não espera). */
async function renderInicio(): Promise<string> {
  const el = (await PainelHome()) as { type: unknown; props: unknown };
  return renderToStaticMarkup(typeof el.type === 'function' ? await (el.type as (p: unknown) => Promise<never>)(el.props) : (el as never));
}

let T: TenantDeTeste;
let rec: TenantContext;

beforeAll(async () => {
  T = await novoTenant(app.db);
  const recId = randomUUID();
  await owner.pool.query(`insert into "user" (id, name, email, app_role, tenant_id) values ($1, 'Carla Lima', $2, 'recepcao', $3)`, [recId, `rec-${recId.slice(0, 8)}@teste.dev`, T.tenantId]);
  await withTenant(T.ctx, (tx) => tx.execute(sql`insert into equipe_membros (tenant_id, user_id, papel, convidada_por) values (${T.tenantId}, ${recId}, 'recepcao', ${T.nutriId})`), app.db);
  rec = { tenantId: T.tenantId, role: 'recepcao', actorUserId: recId, ip: '203.0.113.36' };
  const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
  // daqui a uma hora (hoje no fuso do consultório, salvo perto da meia-noite: o teste confere a contagem pelo título)
  await consultaDireta(app.db, T.ctx, ana.id, new Date(Date.now() + 3_600_000));
  const [t] = await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId));
  sessao.atual = { data: { user: { id: recId, name: 'Carla Lima', email: 'carla@ex.com', appRole: 'recepcao' } }, tenant: t as TenantRow, ctx: rec, papel: 'recepcao', financeiro: false };
});

describe('Início da recepção (RN-514)', () => {
  it('"Seu dia, {nome}", agenda de hoje, presença a registrar e solicitações; nada do Início da nutricionista (espião)', async () => {
    const html = await renderInicio();
    expect(chamadas).toEqual([]);
    expect(html).toMatch(/<h1[^>]*>Seu dia, Carla<\/h1>/);
    expect(html).toMatch(/Agenda de hoje \(\d\)/);
    expect(html).toContain('Presença a registrar (0)');
    expect(html).toContain('Solicitações (0)');
    expect(html).toContain('Pedidos de pessoas ainda sem cadastro ficam com a nutricionista.');
    expect(html).toContain('O que os pacientes fizeram na agenda');
    expect(html).toContain('data-guia="agenda-hoje"');
    expect(html).toContain('data-guia="presenca"');
    // o nome acessível contém o texto visível (WCAG 2.5.3)
    expect(html).toMatch(/<a [^>]*href="\/painel\/agenda"[^>]*aria-label="Ver a agenda de hoje"[^>]*>Ver a agenda<\/a>|<a [^>]*aria-label="Ver a agenda de hoje"[^>]*href="\/painel\/agenda"[^>]*>Ver a agenda<\/a>/);
    // RE-D63 e RN-514: nem indicadores do mês, nem armazenamento, WhatsApp, IA, exames, dúvidas, diários ou documentos
    expect(html).not.toMatch(/Taxa de faltas|Consultas do mês|Critérios de sucesso|armazenamento|WhatsApp|Diários|Exames|Dúvidas|Documentos aguardando|Pedidos do titular|Abrir prontuário|Próxima consulta/);
    // os atalhos da nutricionista (Novo paciente, Agendar, Novo conteúdo) não estão no Início dela no PR 2
    expect(html).not.toMatch(/Novo conteúdo|Novo paciente/);
  });
  it('não grava leitura no Histórico de acessos', async () => {
    await renderInicio();
    const r = await withTenant(T.ctx, (tx) => tx.execute(sql`select count(*)::int as n from ${auditLog} where ${auditLog.actorUserId} = ${rec.actorUserId} and ${auditLog.acao} = 'ler'`), app.db);
    expect((r.rows[0] as { n: number }).n).toBe(0);
  });
  it('controle positivo: na sessão da nutricionista o Início lê o lerInicio — e o espião pega', async () => {
    const antes = sessao.atual!;
    sessao.atual = { ...antes, ctx: T.ctx, papel: 'nutri' as never };
    try {
      await expect(PainelHome()).rejects.toThrow(/leitura negada à recepção/);
      expect(chamadas).toEqual(['@/modules/agenda/inicio#lerInicio']);
    } finally {
      sessao.atual = antes;
      chamadas.length = 0;
    }
  });
});
