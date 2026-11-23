import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { consultaDireta, em, localPrincipal, pedidoDireto, SP, tenantAgenda } from '../../../../../test/agenda';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../../../test/pacientes';
import { closeDb, getDb } from '@/db/client';
import { appointments, publicBookingRequests, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { hojeNoFuso, somarDias } from '@/modules/pacientes/datas';
import { TERMO_PACIENTE } from '@/modules/pacientes/termo-paciente';

/**
 * Plano 23 (US-407, US-409, §7): as ações da fila e da chave pelo caminho real (módulo → Postgres via Testcontainers); só a
 * sessão e o runtime do Next são simulados. O relógio é o de verdade: os pedidos ficam dias à frente.
 */
const sessao = vi.hoisted(() => ({ atual: null as unknown, revalidados: [] as string[] }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/tenant-session', () => ({ requireNutri: async () => sessao.atual }));
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => void sessao.revalidados.push(p) }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`redirect ${url}`), { url });
  },
}));

const { aceitarAction, recusarAction } = await import('./actions');
const { salvarChaveAction } = await import('../horarios/actions');
const db = getDb();
afterAll(async () => {
  await stopBoss();
  await closeDb();
});
beforeEach(() => {
  sessao.revalidados = [];
});

const dia = (n: number) => somarDias(hojeNoFuso(SP), n);
const entrar = (T: TenantDeTeste) => (sessao.atual = { ctx: T.ctx, tenant: tenantAgenda(T, { agendaConfirmarPedidos: true }) });
/** A URL do redirect (a action termina sempre em redirect, salvo o erro do diálogo da recusa). */
const volta = (p: Promise<unknown>) => p.then((r) => ({ devolveu: r }), (e: { url?: string }) => e.url ?? e);
const consulta = async (T: TenantDeTeste, id: string) => (await withTenant(T.ctx, (tx) => tx.select().from(appointments).where(eq(appointments.id, id)), db))[0];
const fd = (motivo?: string) => {
  const f = new FormData();
  if (motivo !== undefined) f.set('motivo', motivo);
  return f;
};

async function pessoaNova(T: TenantDeTeste, localId: string, inicio: Date, email = `carla-${randomUUID().slice(0, 8)}@ex.com`): Promise<string> {
  const id = randomUUID();
  const agora = new Date();
  await withTenant(
    T.ctx,
    (tx) =>
      tx.insert(publicBookingRequests).values({
        id, tenantId: T.tenantId, tokenHash: randomUUID(), codigoHash: 'x', email, nome: 'Carla Dias',
        inicio, fim: new Date(inicio.getTime() + 3_600_000), modalidade: 'presencial', localId, termoVersao: TERMO_PACIENTE,
        expiraEm: new Date(agora.getTime() + 600_000), verificadoEm: agora, aguardandoDesde: agora,
      }),
    db,
  );
  return id;
}

describe('aceitarAction e recusarAction (US-409)', () => {
  it('aceitar → ?ok=aceito (com o marcador do envio) e a consulta agendada; de novo → ?ok=mudou; as telas se refazem', async () => {
    const T = await novoTenant(db);
    const ana = await novoPaciente(db, T.ctx);
    const id = await pedidoDireto(db, T, ana.id, em(dia(5), '09:00'));
    entrar(T);
    expect(await volta(aceitarAction('consulta', id))).toMatch(/^\/painel\/agenda\/solicitacoes\?ok=aceito&envio=\d+$/);
    expect(await consulta(T, id)).toMatchObject({ status: 'agendada' });
    expect(sessao.revalidados).toEqual(expect.arrayContaining(['/painel/agenda/solicitacoes', '/painel/agenda', '/painel']));
    expect(await volta(aceitarAction('consulta', id))).toMatch(/^\/painel\/agenda\/solicitacoes\?ok=mudou&envio=\d+$/);
  });

  it('recusar → ?ok=recusado, com o motivo só na consulta; motivo longo → erro no próprio diálogo, nada muda; de novo → ?ok=mudou', async () => {
    const T = await novoTenant(db);
    const ana = await novoPaciente(db, T.ctx);
    const id = await pedidoDireto(db, T, ana.id, em(dia(5), '09:00'));
    entrar(T);
    expect(await volta(recusarAction('consulta', id, {}, fd('x'.repeat(301))))).toEqual({ devolveu: { erro: 'Use no máximo 300 caracteres' } });
    expect(await consulta(T, id)).toMatchObject({ status: 'solicitada' });
    expect(await volta(recusarAction('consulta', id, {}, fd('Agenda cheia')))).toMatch(/^\/painel\/agenda\/solicitacoes\?ok=recusado&envio=\d+$/);
    expect(await consulta(T, id)).toMatchObject({ status: 'cancelada', canceladoPor: 'pedido_recusado', motivoCancelamento: 'Agenda cheia' });
    expect(await volta(recusarAction('consulta', id, {}, fd()))).toMatch(/\?ok=mudou&envio=\d+$/);
  });

  it('pessoa nova: e-mail de paciente arquivado → ?erro=inativo; horário tomado → ?erro=ocupado (os textos da §6.2 pela lista fechada); recusar → ?ok=recusado', async () => {
    const T = await novoTenant(db);
    const L = await localPrincipal(db, T.ctx);
    const arquivada = await novoPaciente(db, T.ctx, { status: 'arquivado' });
    entrar(T);
    const inativo = await pessoaNova(T, L, em(dia(5), '09:00'), arquivada.email);
    expect(await volta(aceitarAction('pessoa_nova', inativo))).toMatch(/\?erro=inativo&envio=\d+$/);
    const tomado = await pessoaNova(T, L, em(dia(6), '09:00'));
    const outro = await novoPaciente(db, T.ctx);
    await consultaDireta(db, T.ctx, outro.id, em(dia(6), '09:00'), 60, { localId: L });
    expect(await volta(aceitarAction('pessoa_nova', tomado))).toMatch(/\?erro=ocupado&envio=\d+$/);
    expect(await volta(recusarAction('pessoa_nova', tomado, {}, fd('ignorado')))).toMatch(/\?ok=recusado&envio=\d+$/);
    expect(await volta(aceitarAction('pessoa_nova', tomado))).toMatch(/\?ok=mudou&envio=\d+$/);
  });

  it('sessão de paciente → recusada antes da transação (RN-400); o pedido não muda', async () => {
    const T = await novoTenant(db);
    const ana = await novoPaciente(db, T.ctx);
    const id = await pedidoDireto(db, T, ana.id, em(dia(5), '09:00'));
    sessao.atual = { ctx: ctxPaciente(T.tenantId, ana.id), tenant: tenantAgenda(T, { agendaConfirmarPedidos: true }) };
    await expect(aceitarAction('consulta', id)).rejects.toThrow('agenda: só a sessão nutri');
    await expect(recusarAction('consulta', id, {}, fd())).rejects.toThrow('agenda: só a sessão nutri');
    expect(await consulta(T, id)).toMatchObject({ status: 'solicitada' });
  });
});

describe('salvarChaveAction (US-407)', () => {
  it('marcada liga, desmarcada desliga; "Configuração salva." e as telas com a aba se refazem', async () => {
    const T = await novoTenant(db);
    entrar(T);
    const chave = async () => (await db.select({ v: tenants.agendaConfirmarPedidos }).from(tenants).where(eq(tenants.id, T.tenantId)))[0].v;
    const marcada = new FormData();
    marcada.set('confirmar', 'on');
    expect(await salvarChaveAction({}, marcada)).toEqual({ ok: 'Configuração salva.', envio: expect.any(Number) }); // o marcador de cada salvamento
    expect(await chave()).toBe(true);
    expect(sessao.revalidados).toEqual(expect.arrayContaining(['/painel/agenda/horarios', '/painel/agenda', '/painel']));
    expect(await salvarChaveAction({}, new FormData())).toEqual({ ok: 'Configuração salva.', envio: expect.any(Number) });
    expect(await chave()).toBe(false);
  });
});
