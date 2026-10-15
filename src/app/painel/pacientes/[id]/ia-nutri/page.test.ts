import { eq } from 'drizzle-orm';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { aceiteNoBanco, iaNutriPronta, liberarNoBanco, mensagemNoBanco } from '../../../../../../test/ia-nutri';
import { ctxPaciente, novoTenant, type TenantDeTeste } from '../../../../../../test/pacientes';
import { pacienteComConta } from '../../../../../../test/portal';
import { closeDb, getDb } from '@/db/client';
import { patients, tenants, type PatientRow, type TenantRow } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { MSG_IA_NUTRI } from '@/modules/ia/nutri-paciente/constantes';
import { TEXTOS_FIXOS } from '@/modules/ia/nutri-paciente/textos';

// Plano 15 (US-170, US-175 "Ver a conversa", DP-17): a aba "IA Nutri" da ficha, com o banco de verdade; a sessão (o
// prontuário), o ambiente e os formulários cliente simulados.
const atual = vi.hoisted(() => ({ prontuario: null as unknown }));
vi.mock('server-only', () => ({}));
vi.mock('../prontuario', () => ({ carregarProntuario: async () => atual.prontuario }));
vi.mock('@/env', async (orig) => ({ ...(await orig<typeof import('@/env')>()), getEnv: () => ({ IA_PROVEDOR: 'fake', IA_RETENCAO_ZERO: '1', IA_INFERENCE_GEO: 'us', IA_TETO_GLOBAL_MENSAL_USD: 50 }) }));
vi.mock('./actions', () => ({ salvarLiberacaoIaNutriAction: vi.fn(), desativarPelaNutriAction: vi.fn() }));
vi.mock('./liberacao-form', () => ({ LiberacaoForm: ({ liberado, pesoOculto }: { liberado: boolean; pesoOculto: boolean }) => `[LiberacaoForm ${liberado ? 'liberado' : 'não'}${pesoOculto ? ' peso-oculto' : ''}]` }));
vi.mock('@/components/confirmar-botao', () => ({ ConfirmarBotao: ({ mensagem, children }: { mensagem: string; children: string }) => `[ConfirmarBotao ${mensagem} | ${children}]` }));
const { default: IaNutriPage } = await import('./page');

const db = getDb();
afterAll(() => closeDb());

async function cenario(o: { aceite?: boolean; status?: 'ativo' | 'arquivado' | 'bloqueado' } = {}) {
  const T = await novoTenant(db);
  await iaNutriPronta(db, T.tenantId);
  const { paciente, userId } = await pacienteComConta(db, T);
  await liberarNoBanco(db, T.ctx, paciente.id);
  if (o.aceite) await aceiteNoBanco(db, ctxPaciente(T.tenantId, paciente.id, userId));
  if (o.status && o.status !== 'ativo') await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: o.status!, ...(o.status === 'bloqueado' ? { anonimizarApos: '2046-09-30' } : {}) }).where(eq(patients.id, paciente.id)), db);
  const [lido] = await withTenant(T.ctx, (tx) => tx.select().from(patients).where(eq(patients.id, paciente.id)), db);
  return { T, paciente: lido };
}
async function pagina(T: TenantDeTeste, paciente: PatientRow, busca: Record<string, string> = {}) {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, T.tenantId));
  atual.prontuario = { ctx: T.ctx, tenant: tenant as TenantRow, paciente };
  const el = (await IaNutriPage({ params: Promise.resolve({ id: paciente.id }), searchParams: Promise.resolve(busca) } as never)) as ReactElement;
  return renderToStaticMarkup(el);
}

describe('/painel/pacientes/[id]/ia-nutri (US-170, DP-17)', () => {
  it('DP-17: o paciente arquivado com consentimento vigente mostra "Registrar desativação a pedido do paciente"; sem consentimento, não', async () => {
    const com = await cenario({ aceite: true, status: 'arquivado' });
    const h = await pagina(com.T, com.paciente);
    expect(h).toContain(`[ConfirmarBotao ${MSG_IA_NUTRI.confirmarDesativarPelaNutri} | ${MSG_IA_NUTRI.desativarPelaNutri}]`);
    expect(h).toContain(MSG_IA_NUTRI.liberadaEmUso);
    const sem = await cenario({ status: 'arquivado' });
    const h2 = await pagina(sem.T, sem.paciente);
    expect(h2).not.toContain(MSG_IA_NUTRI.desativarPelaNutri);
    expect(h2).toContain(MSG_IA_NUTRI.liberadaAguardando);
  });

  it('o paciente bloqueado (pedido de exclusão) também tem a aba e o registro da desativação, sem o formulário de liberação', async () => {
    const { T, paciente } = await cenario({ aceite: true, status: 'bloqueado' });
    const h = await pagina(T, paciente);
    expect(h).toContain(MSG_IA_NUTRI.desativarPelaNutri);
    expect(h).not.toContain('[LiberacaoForm');
  });

  it('o retorno da desativação e da liberação na região role="status" sempre montada; valor fora da lista → vazia', async () => {
    const { T, paciente } = await cenario();
    expect(await pagina(T, paciente, { 'ia-nutri': 'desativada' })).toContain(`<p role="status">${MSG_IA_NUTRI.desativadaPelaNutri}</p>`);
    expect(await pagina(T, paciente, { 'ia-nutri': 'salvo' })).toContain(`<p role="status">${MSG_IA_NUTRI.liberadaAguardando}</p>`);
    expect(await pagina(T, paciente, { 'ia-nutri': 'peso-oculto' })).toContain(`<p role="status">${MSG_IA_NUTRI.pesoOculto.replaceAll('"', '&quot;')}</p>`);
    expect(await pagina(T, paciente, { 'ia-nutri': '<script>' })).toContain('<p role="status"></p>');
    expect(await pagina(T, paciente)).toContain('[LiberacaoForm liberado]');
  });

  it('a conversa numa lista com o autor em texto, a categoria, o risco, o "não ajudou" e a situação da dúvida', async () => {
    const { T, paciente } = await cenario({ aceite: true });
    const t0 = Date.now() - 60_000;
    const q = await mensagemNoBanco(db, T.tenantId, paciente.id, { createdAt: new Date(t0), status: 'respondida', texto: 'Posso trocar o arroz?', encaminhadaEm: new Date() });
    await mensagemNoBanco(db, T.tenantId, paciente.id, { autor: 'ia', status: null, createdAt: new Date(t0 + 1000), texto: 'No seu plano está assim: arroz 100 g', categoria: 'plano', respondeA: q, avaliacao: 'nao_ajudou', contouNoLimite: false });
    const r = await mensagemNoBanco(db, T.tenantId, paciente.id, { createdAt: new Date(t0 + 2000), status: 'respondida', risco: 'emergencia', texto: 'quero sumir', encaminhadaEm: new Date() });
    await mensagemNoBanco(db, T.tenantId, paciente.id, { autor: 'sistema', status: null, createdAt: new Date(t0 + 2000), texto: null, textoFixo: 'risco_emergencia', respondeA: r, contouNoLimite: false });
    const h = await pagina(T, paciente);
    const lista = h.slice(h.indexOf('<ol'), h.indexOf('</ol>'));
    expect(lista.match(/<li/g)).toHaveLength(4);
    for (const t of ['Paciente', MSG_IA_NUTRI.autorIa, MSG_IA_NUTRI.autorSistema, 'Posso trocar o arroz?', 'Dúvida sobre o plano', MSG_IA_NUTRI.naoAjudouSelo, MSG_IA_NUTRI.seloRisco, TEXTOS_FIXOS.risco_emergencia])
      expect(lista, t).toContain(t);
    expect(lista).toContain('Na fila');
  });
});
