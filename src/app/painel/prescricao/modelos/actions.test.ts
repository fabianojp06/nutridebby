import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { novoTenant } from '../../../../../test/pacientes';
import { closeDb, getDb } from '@/db/client';
import { tenants, type TenantRow } from '@/db/schema';
import { stopBoss } from '@/jobs/boss';
import { abrirModeloPrescricao, listarModelosPrescricao, MSG_MODELOS, salvarModeloPrescricao } from '@/modules/documentos/modelos';

// Plano 22 (T10b, US-379, RN-398, R22-11): as actions dos modelos de prescrição pelo caminho real (guarda
// `acessoComDocumentos` → módulo → Postgres do Testcontainers); só a sessão é simulada, como em ../itens/actions.test.ts.
const sessao = vi.hoisted(() => ({ atual: null as unknown, recusa: null as Error | null }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/tenant-session', () => ({
  requireNutri: async () => {
    if (sessao.recusa) throw sessao.recusa;
    return sessao.atual;
  },
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
  notFound: () => {
    throw new Error('notFound');
  },
}));

const { excluirModeloPrescricaoAction, salvarModeloPrescricaoAction } = await import('./actions');
const db = getDb();
afterAll(async () => {
  await stopBoss();
  await closeDb();
});
beforeEach(() => {
  sessao.recusa = null;
});
const destino = (p: Promise<unknown>) => p.then(() => null, (e: Error) => e.message);
const VITD = { tipo: 'suplemento', categoria: 'nutriente', composicao: [{ nome: 'Vitamina D3', quantidade: '2000', unidade: 'UI' }], forma: 'Cápsula', via: 'oral', posologia: '1 ao dia' };

async function consultorio(liberado = true) {
  const T = await novoTenant(db);
  await db.update(tenants).set({ documentosLiberados: liberado }).where(eq(tenants.id, T.tenantId));
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, T.tenantId));
  sessao.atual = { ctx: T.ctx, tenant: tenant as TenantRow };
  // o modelo nasce da receita ("Salvar como modelo"); aqui, direto pelo módulo (com a sessão liberada)
  const id = await salvarModeloPrescricao(T.ctx, tenant as TenantRow, null, { nome: 'Rotina', itens: [VITD], orientacoes: '' }, { db });
  return { T, id };
}
function form(nome: string, conteudo: unknown) {
  const f = new FormData();
  f.set('nome', nome);
  f.set('conteudo', typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo));
  return f;
}

describe('actions dos modelos de prescrição (US-379)', () => {
  it('erro devolve as mensagens e os valores; sucesso volta à lista com "Modelo salvo."; a justificativa enviada é ignorada; excluir', async () => {
    const { T, id } = await consultorio();
    const s = await salvarModeloPrescricaoAction(id, {}, form('', { itens: [], orientacoes: '' }));
    expect(s.erros?.nome).toBe(MSG_MODELOS.erros.nome);
    expect(Object.keys(s.erros ?? {})).toContain('itens');
    expect(s.valores).toEqual({ nome: '', conteudo: JSON.stringify({ itens: [], orientacoes: '' }) });
    expect(Object.keys((await salvarModeloPrescricaoAction(id, {}, form('Rotina', 'não é JSON'))).erros ?? {})).toContain('itens');

    const f = form('Rotina da manhã', { itens: [{ ...VITD, posologia: '2 ao dia' }], orientacoes: '**Tomar com água.**', justificativa: 'não vai para o modelo' });
    expect(await destino(salvarModeloPrescricaoAction(id, {}, f))).toMatch(/^redirect \/painel\/prescricao\/modelos\?ok=salvo&r=[0-9a-f]{8}$/);
    const m = await abrirModeloPrescricao(T.ctx, id, { db });
    expect(m).toMatchObject({ nome: 'Rotina da manhã', orientacoes: '**Tomar com água.**' });
    expect(m?.itens.map((i) => i.posologia)).toEqual(['2 ao dia']);
    expect(JSON.stringify(m)).not.toContain('não vai para o modelo');

    expect(await destino(excluirModeloPrescricaoAction(id))).toMatch(/^redirect \/painel\/prescricao\/modelos\?ok=excluido&r=[0-9a-f]{8}$/);
    expect(await listarModelosPrescricao(T.ctx, { db })).toEqual([]);
    expect(await destino(excluirModeloPrescricaoAction(id))).toBe('redirect /painel/prescricao/modelos');
  });

  it('sem documentos_liberados: cada action responde notFound e nada muda (RN-398)', async () => {
    const { T, id } = await consultorio();
    await db.update(tenants).set({ documentosLiberados: false }).where(eq(tenants.id, T.tenantId));
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, T.tenantId));
    sessao.atual = { ctx: T.ctx, tenant };
    await expect(salvarModeloPrescricaoAction(id, {}, form('Outro nome', { itens: [VITD], orientacoes: '' }))).rejects.toThrow('notFound');
    await expect(excluirModeloPrescricaoAction(id)).rejects.toThrow('notFound');
    expect((await abrirModeloPrescricao(T.ctx, id, { db }))?.nome).toBe('Rotina');
  });

  it('papel errado: o redirecionamento de requireNutri sai antes de qualquer gravação', async () => {
    const { T, id } = await consultorio();
    sessao.recusa = new Error('redirect /conta/outro-papel?esperado=nutri');
    expect(await destino(salvarModeloPrescricaoAction(id, {}, form('Outro nome', { itens: [VITD], orientacoes: '' })))).toBe('redirect /conta/outro-papel?esperado=nutri');
    expect(await destino(excluirModeloPrescricaoAction(id))).toBe('redirect /conta/outro-papel?esperado=nutri');
    expect((await abrirModeloPrescricao(T.ctx, id, { db }))?.nome).toBe('Rotina');
  });
});
