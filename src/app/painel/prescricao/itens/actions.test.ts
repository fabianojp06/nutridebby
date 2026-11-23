import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { novoTenant } from '../../../../../test/pacientes';
import { closeDb, getDb } from '@/db/client';
import { tenants, type TenantRow } from '@/db/schema';
import { stopBoss } from '@/jobs/boss';
import { abrirItemSalvo, listarItensSalvos, MSG_MODELOS } from '@/modules/documentos/modelos';

// Plano 22 (T10b, US-379, RN-398, R22-11): as actions dos itens salvos pelo caminho real (guarda `acessoComDocumentos` →
// módulo → Postgres do Testcontainers). Só a sessão é simulada: `requireNutri` devolve a sessão do caso, ou rejeita como o
// redirecionamento do papel errado.
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

const { excluirItemSalvoAction, salvarItemSalvoAction } = await import('./actions');
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
const CHA = { tipo: 'planta_cha', nomenclatura: 'Matricaria chamomilla L.', parte: 'Flores', modoPreparo: 'infusao', formaUso: '1 colher de sopa em 150 mL', posologia: '1 xícara à noite' };

async function consultorio(liberado = true) {
  const T = await novoTenant(db);
  await db.update(tenants).set({ documentosLiberados: liberado }).where(eq(tenants.id, T.tenantId));
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, T.tenantId));
  sessao.atual = { ctx: T.ctx, tenant: tenant as TenantRow };
  return T;
}
function form(nome: string, item: unknown) {
  const f = new FormData();
  f.set('nome', nome);
  f.set('item', typeof item === 'string' ? item : JSON.stringify(item));
  return f;
}

describe('actions dos itens salvos (US-379)', () => {
  it('erro devolve as mensagens (o item com o prefixo item.) e os valores; sucesso volta à lista do grupo com "Item salvo."; editar; excluir', async () => {
    const T = await consultorio();
    const s = await salvarItemSalvoAction(null, {}, form('', { ...VITD, posologia: '' }));
    expect(s.erros?.nome).toBe(MSG_MODELOS.erros.nome);
    expect(Object.keys(s.erros ?? {})).toContain('item.posologia');
    expect(s.valores).toEqual({ nome: '', item: JSON.stringify({ ...VITD, posologia: '' }) });
    expect(typeof s.envio).toBe('number');
    // o que não é JSON não derruba a action: o Zod do item recusa
    expect(Object.keys((await salvarItemSalvoAction(null, {}, form('Vitamina D', 'não é JSON'))).erros ?? {}).length).toBeGreaterThan(0);

    expect(await destino(salvarItemSalvoAction(null, {}, form('Vitamina D', VITD)))).toMatch(/^redirect \/painel\/prescricao\/itens\?tipo=suplementos&ok=salvo&r=[0-9a-f]{8}$/);
    expect(await destino(salvarItemSalvoAction(null, {}, form('Camomila', CHA)))).toMatch(/^redirect \/painel\/prescricao\/itens\?tipo=fitoterapicos&ok=salvo&r=/);
    const [vitd] = await listarItensSalvos(T.ctx, 'suplementos', { db });
    expect(vitd).toMatchObject({ nome: 'Vitamina D', tipo: 'suplemento' });
    // nome repetido (sem diferença de maiúsculas)
    expect((await salvarItemSalvoAction(null, {}, form('vitamina d', VITD))).erros).toEqual({ nome: MSG_MODELOS.erros.itemRepetido });

    // editar: a posologia muda
    expect(await destino(salvarItemSalvoAction(vitd.id, {}, form('Vitamina D', { ...VITD, posologia: '2 ao dia' })))).toMatch(/^redirect \/painel\/prescricao\/itens\?tipo=suplementos&ok=salvo&r=/);
    expect((await abrirItemSalvo(T.ctx, vitd.id, { db }))?.item.posologia).toBe('2 ao dia');

    // excluir volta à lista do grupo pedido (o que não é grupo vale suplementos)
    expect(await destino(excluirItemSalvoAction(vitd.id, 'suplementos'))).toMatch(/^redirect \/painel\/prescricao\/itens\?tipo=suplementos&ok=excluido&r=[0-9a-f]{8}$/);
    expect(await listarItensSalvos(T.ctx, 'suplementos', { db })).toEqual([]);
    // já excluído: volta à lista, sem "Item excluído."
    expect(await destino(excluirItemSalvoAction(vitd.id, 'qualquer'))).toBe('redirect /painel/prescricao/itens?tipo=suplementos');
  });

  it('sem documentos_liberados: cada action responde notFound e nada é gravado (RN-398)', async () => {
    const T = await consultorio(false);
    await expect(salvarItemSalvoAction(null, {}, form('Vitamina D', VITD))).rejects.toThrow('notFound');
    await expect(excluirItemSalvoAction('00000000-0000-4000-8000-000000000001', 'suplementos')).rejects.toThrow('notFound');
    await db.update(tenants).set({ documentosLiberados: true }).where(eq(tenants.id, T.tenantId));
    expect(await listarItensSalvos(T.ctx, 'suplementos', { db })).toEqual([]);
  });

  it('papel errado: o redirecionamento de requireNutri sai antes de qualquer gravação', async () => {
    const T = await consultorio();
    sessao.recusa = new Error('redirect /conta/outro-papel?esperado=nutri');
    expect(await destino(salvarItemSalvoAction(null, {}, form('Vitamina D', VITD)))).toBe('redirect /conta/outro-papel?esperado=nutri');
    expect(await destino(excluirItemSalvoAction('00000000-0000-4000-8000-000000000001', 'suplementos'))).toBe('redirect /conta/outro-papel?esperado=nutri');
    sessao.recusa = null;
    expect(await listarItensSalvos(T.ctx, 'suplementos', { db })).toEqual([]);
  });
});
