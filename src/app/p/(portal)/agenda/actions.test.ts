import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { appointments, user } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { horariosParaPaciente } from '@/modules/agenda/agendamento-paciente';
import { MSG_AGENDA, MSG_SOLICITACOES } from '@/modules/agenda/constantes';
import type { TenantAgenda } from '@/modules/agenda/consultas';
import { chaveDosPedidos, consultaDireta, pedidoDireto, semanaToda, tenantAgenda } from '../../../../../test/agenda';
import { ctxPaciente, emailsNaFila, novoPaciente, novoTenant } from '../../../../../test/pacientes';

// Rodada 1 da revisão da T12: as ações do PWA pelo caminho real (módulos do Plano 05 → Postgres via Testcontainers);
// só a sessão (requirePaciente) e o runtime do Next são simulados.
const sessao = vi.hoisted(() => ({ atual: null as unknown, revalidados: [] as string[] }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/paciente-session', () => ({ requirePaciente: async () => sessao.atual }));
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => void sessao.revalidados.push(p) }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`redirect ${url}`), { url });
  },
}));

const { agendarAction, avisarAction, cancelarAction, desistirAction, remarcarAction } = await import('./actions');
const db = getDb();
afterAll(async () => {
  await stopBoss();
  await closeDb();
});
beforeEach(() => {
  sessao.revalidados = [];
});

/** Plano 23: o local do último `cenario()` (o principal, onde valem as regras da semana). */
const formularioDe = { localId: '' };
async function cenario() {
  const T = await novoTenant(db);
  const localId = await semanaToda(db, T.ctx);
  const ana = await novoPaciente(db, T.ctx, { nome: 'Ana Souza' });
  const tenant: TenantAgenda = tenantAgenda(T);
  sessao.atual = { ctx: ctxPaciente(T.tenantId, ana.id), tenant };
  formularioDe.localId = localId;
  return { T, ana, tenant };
}
const H = 3_600_000;
const formulario = (inicio: Date) => {
  const fd = new FormData();
  fd.set('inicio', inicio.toISOString());
  fd.set('localId', formularioDe.localId);
  return fd;
};
const consulta = async (T: Awaited<ReturnType<typeof novoTenant>>, id: string) => {
  const [c] = await withTenant(T.ctx, (tx) => tx.select().from(appointments).where(eq(appointments.id, id)), db);
  return c;
};

describe('remarcarAction (US-033 no PWA)', () => {
  it('no sucesso vai para a consulta nova com ?ok=remarcada (a página da antiga voltaria "cancelada" e sem a confirmação)', async () => {
    const { T, ana, tenant } = await cenario();
    const agora = Date.now();
    const hs = await horariosParaPaciente(tenant, new Date(agora), { db });
    const antigo = hs.find((h) => h.inicio.getTime() > agora + 72 * H)!;
    const novo = hs.find((h) => h.inicio.getTime() >= antigo.inicio.getTime() + 2 * H)!;
    const id = await consultaDireta(db, T.ctx, ana.id, antigo.inicio);
    const err = await remarcarAction(id, {}, formulario(novo.inicio)).then(
      () => null,
      (e: { url?: string }) => e,
    );
    const m = /^\/p\/agenda\/([0-9a-f-]{36})\?ok=remarcada$/.exec(err?.url ?? '');
    expect(m, String(err)).not.toBeNull();
    expect(m![1]).not.toBe(id);
    expect(await consulta(T, m![1])).toMatchObject({ status: 'agendada', patientId: ana.id, inicio: novo.inicio, remarcadaDe: id });
    expect(await consulta(T, id)).toMatchObject({ status: 'cancelada', canceladoPor: 'paciente' });
    expect(sessao.revalidados).toContain('/p/agenda');
  });

  it('horário que não está mais livre → erro na própria tela, sem redirecionar', async () => {
    const { T, ana, tenant } = await cenario();
    const agora = Date.now();
    const hs = await horariosParaPaciente(tenant, new Date(agora), { db });
    const antigo = hs.find((h) => h.inicio.getTime() > agora + 72 * H)!;
    const id = await consultaDireta(db, T.ctx, ana.id, antigo.inicio);
    await expect(remarcarAction(id, {}, formulario(new Date(antigo.inicio.getTime() + 30 * 60_000)))).resolves.toEqual({ erro: MSG_AGENDA.indisponivel });
    expect(await consulta(T, id)).toMatchObject({ status: 'agendada' });
  });
});

describe('avisarAction (US-035 no PWA)', () => {
  it('fora do prazo do RN-04: grava o pedido, avisa a nutricionista e a página se refaz; de novo → a mesma resposta, sem novo aviso', async () => {
    const { T, ana } = await cenario();
    const id = await consultaDireta(db, T.ctx, ana.id, new Date(Date.now() + 3 * H));
    await expect(avisarAction(id)).resolves.toEqual({ ok: MSG_AGENDA.avisoDeRemarcacao });
    expect(sessao.revalidados).toEqual([`/p/agenda/${id}`]);
    expect((await consulta(T, id)).pedidoRemarcacaoEm).not.toBeNull();
    await expect(avisarAction(id)).resolves.toEqual({ ok: MSG_AGENDA.avisoDeRemarcacao });
    const [nutri] = await db.select({ email: user.email }).from(user).where(eq(user.id, T.nutriId));
    expect((await emailsNaFila('aviso_agenda', nutri.email)).filter((e) => e.evento === 'pedido_remarcacao')).toHaveLength(1);
  });

  it('consulta cancelada pela nutricionista ou já começada → "Para alterar, fale com sua nutricionista.", nada gravado, e a página se refaz', async () => {
    const { T, ana } = await cenario();
    const cancelada = await consultaDireta(db, T.ctx, ana.id, new Date(Date.now() + 3 * H), 60, { status: 'cancelada', canceladoPor: 'nutri', canceladaEm: new Date() });
    const comecou = await consultaDireta(db, T.ctx, ana.id, new Date(Date.now() - 10 * 60_000));
    for (const id of [cancelada, comecou]) {
      await expect(avisarAction(id)).resolves.toEqual({ erro: MSG_AGENDA.foraDoPrazo });
      expect(sessao.revalidados).toContain(`/p/agenda/${id}`);
      expect((await consulta(T, id)).pedidoRemarcacaoEm).toBeNull();
    }
    const [nutri] = await db.select({ email: user.email }).from(user).where(eq(user.id, T.nutriId));
    expect(await emailsNaFila('aviso_agenda', nutri.email)).toEqual([]);
  });
});

describe('cancelarAction (US-033 no PWA)', () => {
  it('cancela e refaz a lista e a própria página da consulta (onde a pessoa está)', async () => {
    const { T, ana, tenant } = await cenario();
    const agora = Date.now();
    const h = (await horariosParaPaciente(tenant, new Date(agora), { db })).find((x) => x.inicio.getTime() > agora + 72 * H)!;
    const id = await consultaDireta(db, T.ctx, ana.id, h.inicio);
    expect(await cancelarAction(id)).toEqual({ ok: MSG_AGENDA.cancelada });
    expect(await consulta(T, id)).toMatchObject({ status: 'cancelada', canceladoPor: 'paciente' });
    expect(sessao.revalidados).toEqual(['/p/agenda', `/p/agenda/${id}`]);
  });
});

describe('Plano 23: o pedido no portal (US-408, AG-D42, AG-D53)', () => {
  it('com a chave ligada, agendar mostra "Pedido enviado. Sua nutricionista vai confirmar…" (pelo status devolvido); desligada, "Consulta marcada para…"', async () => {
    const { T, ana } = await cenario();
    await chaveDosPedidos(db, T);
    const ligada: TenantAgenda = tenantAgenda(T, { agendaConfirmarPedidos: true });
    sessao.atual = { ctx: ctxPaciente(T.tenantId, ana.id), tenant: ligada };
    const hs = await horariosParaPaciente(ligada, new Date(), { db });
    await expect(agendarAction({}, formulario(hs[0].inicio))).resolves.toEqual({ ok: MSG_SOLICITACOES.portal.pedidoEnviado });
    const [c] = await withTenant(T.ctx, (tx) => tx.select().from(appointments).where(eq(appointments.patientId, ana.id)), db);
    expect(c).toMatchObject({ status: 'solicitada', inicio: hs[0].inicio });
    expect(sessao.revalidados).toContain('/p/agenda');
    await chaveDosPedidos(db, T, false);
    sessao.atual = { ctx: ctxPaciente(T.tenantId, ana.id), tenant: tenantAgenda(T) };
    const r = await agendarAction({}, formulario(hs[3].inicio));
    expect(r.ok).toMatch(/^Consulta marcada para /);
  });

  it('desistir → volta a "Minhas consultas" com ?ok=pedido-cancelado e o pedido "pedido_desistido"; de novo → "Este pedido já foi respondido ou venceu." na própria tela', async () => {
    const { T, ana } = await cenario();
    const id = await pedidoDireto(db, T, ana.id, new Date(Date.now() + 5 * 24 * H));
    sessao.atual = { ctx: ctxPaciente(T.tenantId, ana.id), tenant: tenantAgenda(T, { agendaConfirmarPedidos: true }) };
    const err = await desistirAction(id).then(
      () => null,
      (e: { url?: string }) => e,
    );
    expect(err?.url).toBe('/p/agenda?ok=pedido-cancelado');
    expect(await consulta(T, id)).toMatchObject({ status: 'cancelada', canceladoPor: 'pedido_desistido' });
    expect(sessao.revalidados).toEqual(expect.arrayContaining(['/p/agenda', `/p/agenda/${id}`]));
    await expect(desistirAction(id)).resolves.toEqual({ erro: MSG_SOLICITACOES.mudou });
  });
});
