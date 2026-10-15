import { eq } from 'drizzle-orm';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { mensagemNoBanco } from '../../../../test/ia-nutri';
import { novoPaciente, novoTenant, type TenantDeTeste } from '../../../../test/pacientes';
import { closeDb, getDb } from '@/db/client';
import { iaNutriMensagens, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { MSG_IA_NUTRI } from '@/modules/ia/nutri-paciente/constantes';
import { TEXTOS_FIXOS } from '@/modules/ia/nutri-paciente/textos';

// Plano 15 (US-175): a fila "Dúvidas dos pacientes", a tela da dúvida e "Marcar como vista", com o banco de verdade; só a
// sessão e o runtime do Next simulados.
const sessao = vi.hoisted(() => ({ atual: null as unknown }));
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
const { default: Fila } = await import('./page');
const { default: Duvida } = await import('./[id]/page');
const { marcarVistaAction } = await import('./actions');

const db = getDb();
afterAll(async () => {
  await stopBoss(); // "Marcar como vista" enfileira o push
  await closeDb();
});

async function consultorio() {
  const T = await novoTenant(db);
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, T.tenantId));
  sessao.atual = { ctx: T.ctx, tenant };
  const bia = await novoPaciente(db, T.ctx, { nome: 'Bia Lima' });
  const caio = await novoPaciente(db, T.ctx, { nome: 'Caio Reis' });
  return { T, bia, caio };
}
const encaminhada = (o: Partial<typeof iaNutriMensagens.$inferInsert> = {}) => ({ status: 'respondida', encaminhadaEm: new Date(), ...o });
const html = (el: unknown) => renderToStaticMarkup(el as ReactElement);
const fila = async (busca: Record<string, string> = {}) => html(await Fila({ searchParams: Promise.resolve(busca) } as never));
const duvida = async (id: string) => html(await Duvida({ params: Promise.resolve({ id }) } as never));
const existe = async (T: TenantDeTeste, id: string) => (await withTenant(T.ctx, (tx) => tx.select({ id: iaNutriMensagens.id }).from(iaNutriMensagens).where(eq(iaNutriMensagens.id, id)), db)).length > 0;
/** O botão (o protocolo de risco cita "Marcar como vista" no texto). */
const BOTAO_VISTA = `>${MSG_IA_NUTRI.marcarVista}</button>`;
const erro = (p: Promise<unknown>) => p.then(() => null, (e: Error) => e.message);

describe('/painel/duvidas (US-175 "Fila")', () => {
  it('o risco no topo com o selo, "há {n} horas" e "Abrir dúvida" de cada paciente; a região de status sempre montada', async () => {
    const { T, bia, caio } = await consultorio();
    const antiga = await mensagemNoBanco(db, T.tenantId, bia.id, encaminhada({ createdAt: new Date(Date.now() - 5 * 3_600_000) }));
    const risco = await mensagemNoBanco(db, T.tenantId, caio.id, encaminhada({ risco: 'emergencia', texto: 'quero sumir' }));
    const h = await fila();
    expect(h).toContain('<p role="status"></p>');
    expect(h).toContain('data-guia="fila-duvidas"');
    expect(h.indexOf(`/painel/duvidas/${risco}`)).toBeLessThan(h.indexOf(`/painel/duvidas/${antiga}`));
    expect(h).toContain(MSG_IA_NUTRI.seloRisco);
    expect(h).toContain(MSG_IA_NUTRI.haHoras(5));
    expect(h).toContain(MSG_IA_NUTRI.haHoras(0));
    expect(h).toContain('Abrir dúvida<span class="sr-only"> de Bia Lima</span>');
    expect(await fila({ vista: '1' })).toContain(`<p role="status">${MSG_IA_NUTRI.vista}</p>`);
  });

  it('vazia → "Nenhuma dúvida aguardando."', async () => {
    await consultorio();
    expect(await fila()).toContain(MSG_IA_NUTRI.filaVazia);
  });
});

describe('/painel/duvidas/[id] e "Marcar como vista" (US-175, D22, D24 = b)', () => {
  it('a dúvida com risco: a pergunta, o protocolo logo abaixo, a resposta de texto fixo e "Marcar como vista"; marcar → a fila com ?vista=1; de novo → sem', async () => {
    const { T, caio } = await consultorio();
    const r = await mensagemNoBanco(db, T.tenantId, caio.id, encaminhada({ risco: 'emergencia', texto: 'quero sumir' }));
    await mensagemNoBanco(db, T.tenantId, caio.id, { autor: 'sistema', status: null, texto: null, textoFixo: 'risco_emergencia', respondeA: r, contouNoLimite: false });
    const h = await duvida(r);
    expect(h).toContain('quero sumir');
    for (const l of MSG_IA_NUTRI.protocoloRisco) expect(h.indexOf(l.replaceAll('"', '&quot;')), l).toBeGreaterThan(h.indexOf('quero sumir'));
    expect(h).toContain(TEXTOS_FIXOS.risco_emergencia);
    expect(h).toContain(BOTAO_VISTA);
    expect(h).not.toMatch(/<textarea|type="text"/); // D24 = b: nenhum campo de texto livre
    expect(await erro(marcarVistaAction(r))).toBe('redirect /painel/duvidas?vista=1');
    expect(await erro(marcarVistaAction(r))).toBe('redirect /painel/duvidas');
    expect(await duvida(r)).not.toContain(BOTAO_VISTA); // já resolvida
  });

  it('D22: a de quem desativou é mostrada uma vez, com o aviso para anotar e sem "Marcar como vista"; depois, 404', async () => {
    const { T, bia } = await consultorio();
    const r = await mensagemNoBanco(db, T.tenantId, bia.id, encaminhada({ risco: 'transtorno_alimentar', revogadaEm: new Date(), texto: 'vomito depois de comer' }));
    const h = await duvida(r);
    expect(h).toContain('vomito depois de comer');
    expect(h).toContain(MSG_IA_NUTRI.riscoApagadoAoAbrir);
    expect(h).toContain(MSG_IA_NUTRI.seloRiscoRevogado);
    expect(h).not.toContain(BOTAO_VISTA);
    expect(await existe(T, r)).toBe(false);
    expect(await erro(duvida(r))).toBe('notFound');
  });

  it('id inválido ou de outro consultório → 404', async () => {
    const outro = await consultorio();
    const deOutro = await mensagemNoBanco(db, outro.T.tenantId, outro.bia.id, encaminhada());
    await consultorio();
    expect(await erro(duvida(deOutro))).toBe('notFound');
    expect(await erro(duvida('abc'))).toBe('notFound');
    expect(await erro(marcarVistaAction(deOutro))).toBe('redirect /painel/duvidas');
  });
});
