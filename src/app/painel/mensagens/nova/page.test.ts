import { eq, sql } from 'drizzle-orm';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import { makeDb } from '../../../../../test/db';
import { consultorioDoChat, naSessao, pacienteDoChat } from '../../../../../test/mensagens';
import { novoPaciente, type TenantDeTeste } from '../../../../../test/pacientes';
import { closeDb, getDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { MSG_MENSAGENS } from '@/modules/mensagens/constantes';

// Plano 25, T6a (CH-D66, §4.1): "Nova conversa" — titulares ativos e não anonimizados, com ou sem conversa, em ordem
// alfabética, 50 por página, busca por nome, "Sem acesso ao app"; cada linha é link sem prefetch para a conversa; sem
// auditRead (como a lista de pacientes, regra 8).
const sessao = vi.hoisted(() => ({ atual: null as unknown }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/tenant-session', () => ({ requireNutri: vi.fn(async () => sessao.atual) }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
  notFound: () => {
    throw new Error('notFound');
  },
}));
const { default: NovaConversa, metadata } = await import('./page');

const db = getDb();
const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  await closeDb();
  await owner.pool.end();
});
const N = MSG_MENSAGENS.novaConversa;

async function consultorio() {
  const T = await consultorioDoChat(db, owner.pool);
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, T.tenantId));
  sessao.atual = { ctx: T.ctx, tenant };
  return T;
}
const html = (el: unknown) => renderToStaticMarkup(el as ReactElement);
const nova = async (busca: Record<string, string> = {}) => html(await NovaConversa({ searchParams: Promise.resolve(busca) } as never));
const leituras = async (T: TenantDeTeste) => (await naSessao(db, T.ctx, sql`select count(*)::int as n from audit_log where tenant_id = ${T.tenantId} and acao in ('ler', 'exportar')`))[0].n;
const link = (h: string, href: string) => new RegExp(`<a [^>]*href="${href.replace(/[?]/g, '\\?')}"[^>]*>[\\s\\S]*?</a>`).exec(h)?.[0] ?? '';
const conversas = (h: string) => [...h.matchAll(/href="\/painel\/mensagens\/([0-9a-f-]{36})"/g)].map((m) => m[1]);

describe('/painel/mensagens/nova (CH-D66)', () => {
  it('h1 "Nova conversa", o <title> "Mensagens" e a busca num formulário GET', async () => {
    expect(metadata).toEqual({ title: 'Mensagens' });
    await consultorio();
    const h = await nova();
    expect(h).toContain(`<h1 class="font-titulo text-2xl font-semibold">${N.titulo}</h1>`);
    expect(h).toMatch(/<form(?=[^>]*\bmethod="get")(?=[^>]*\brole="search")[^>]*>/);
    expect(h).toMatch(new RegExp(`<label for="busca"[^>]*>${N.buscarPaciente}</label>`));
    expect(h).toContain(`>${N.buscar}</button>`);
  });

  it('só titulares ativos, em ordem alfabética (sem acento), com e sem conversa; "Sem acesso ao app" para quem não tem conta; sem auditRead', async () => {
    const T = await consultorio();
    const bia = await pacienteDoChat(db, T, { nome: 'Bia Lima' }); // com conta e conversa liberada
    const ana = await novoPaciente(db, T.ctx, { nome: 'Ângela Souza' }); // sem conta
    const davi = await novoPaciente(db, T.ctx, { nome: 'Davi Melo' });
    const eva = await novoPaciente(db, T.ctx, { nome: 'Eva Reis' });
    await owner.pool.query("update patients set status = 'arquivado' where id = $1", [davi.id]);
    await owner.pool.query("update patients set status = 'bloqueado', bloqueado_em = now(), anonimizar_apos = current_date + 30 where id = $1", [eva.id]);
    const antes = await leituras(T);
    const h = await nova();
    expect(await leituras(T)).toBe(antes);
    expect(conversas(h)).toEqual([ana.id, bia.p]);
    const deAna = link(h, `/painel/mensagens/${ana.id}`);
    expect(deAna).toContain('Ângela Souza');
    expect(deAna).toContain(N.semAcessoAoApp);
    expect(link(h, `/painel/mensagens/${bia.p}`)).toContain('Bia Lima');
    expect(link(h, `/painel/mensagens/${bia.p}`)).not.toContain(N.semAcessoAoApp);
    // só nome e acesso: nada de e-mail, nascimento ou situação
    expect(h).not.toMatch(/@teste\.dev|@exemplo|Arquivado|Bloqueado/);
  });

  it('a busca pelo nome (sem acento); nenhuma → "Nenhum paciente encontrado."; o campo volta preenchido', async () => {
    const T = await consultorio();
    const carla = await novoPaciente(db, T.ctx, { nome: 'Carla Lima' });
    await novoPaciente(db, T.ctx, { nome: 'Bruno Reis' });
    const h = await nova({ busca: 'car' });
    expect(conversas(h)).toEqual([carla.id]);
    expect(h).toMatch(/<input(?=[^>]*\bid="busca")(?=[^>]*\bname="busca")(?=[^>]*\btype="search")(?=[^>]*\bvalue="car")[^>]*>/);
    const vazio = await nova({ busca: 'zzz' });
    expect(vazio).toContain(`<p>${N.nenhum}</p>`);
    expect(conversas(vazio)).toEqual([]);
  });

  it('50 por página com "Mostrar mais" (?pagina=, mantendo a busca); a página 2 sem', async () => {
    const T = await consultorio();
    for (let i = 0; i < 51; i++) await novoPaciente(db, T.ctx, { nome: `Paciente ${String(i).padStart(2, '0')}` });
    const p1 = await nova();
    expect(conversas(p1)).toHaveLength(50);
    expect(link(p1, '/painel/mensagens/nova?pagina=2')).toContain(N.mostrarMais);
    const p2 = await nova({ pagina: '2' });
    expect(conversas(p2)).toHaveLength(1);
    expect(p2).not.toContain(N.mostrarMais);
    expect(link(await nova({ busca: 'Paciente' }), '/painel/mensagens/nova?busca=Paciente&amp;pagina=2')).toContain(N.mostrarMais);
  });
});
