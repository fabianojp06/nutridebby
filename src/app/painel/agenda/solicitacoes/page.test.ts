import { randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import { chaveDosPedidos, em, localPrincipal, novoLocal, pedidoDireto, SP, tenantAgenda } from '../../../../../test/agenda';
import { makeDb } from '../../../../../test/db';
import { novoPaciente, novoTenant, type TenantDeTeste } from '../../../../../test/pacientes';

/**
 * Plano 23 (US-407, US-409, RN-404, §7): as telas das solicitações com o banco de verdade — a fila, a aba "Solicitações
 * ({n})", o pedido na tela da consulta e a chave em Horários. A página usa o relógio de verdade: os pedidos ficam dias à frente.
 */
const sessao = vi.hoisted(() => ({ atual: null as null | { ctx: unknown; tenant: unknown } }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/tenant-session', () => ({ requireNutri: vi.fn(async () => sessao.atual) }));

const { default: SolicitacoesPage } = await import('./page');
const { default: ConsultaPage } = await import('../consultas/[id]/page');
const { default: HorariosPage } = await import('../horarios/page');
const { default: AgendaPage } = await import('../page');
const { FormularioDaRecusa } = await import('./recusar-dialogo');
const { closeDb } = await import('@/db/client');
const { stopBoss } = await import('@/jobs/boss');
const { withTenant } = await import('@/db/tenant');
const { appointments, publicBookingRequests } = await import('@/db/schema');
const { hojeNoFuso, somarDias, formatarData } = await import('@/modules/pacientes/datas');
const { recusarSolicitacao } = await import('@/modules/agenda/solicitacoes');
const { TERMO_PACIENTE } = await import('@/modules/pacientes/termo-paciente');
const { eq } = await import('drizzle-orm');

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});

const texto = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const dia = (n: number) => somarDias(hojeNoFuso(SP), n);
const entrar = (T: TenantDeTeste, extra: Parameters<typeof tenantAgenda>[1] = {}) => (sessao.atual = { ctx: T.ctx, tenant: tenantAgenda(T, extra) });
const fila = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await SolicitacoesPage({ searchParams: Promise.resolve(sp) } as never));

/** O pedido da pessoa nova aguardando (como `app_pedido_aguardar` o deixa), na sessão da nutricionista. */
async function pessoaNova(T: TenantDeTeste, localId: string, inicio: Date, nome = 'Carla Dias', modalidade = 'presencial'): Promise<string> {
  const id = randomUUID();
  const agora = new Date();
  await withTenant(
    T.ctx,
    (tx) =>
      tx.insert(publicBookingRequests).values({
        id, tenantId: T.tenantId, tokenHash: randomUUID(), codigoHash: 'x', email: `carla-${id.slice(0, 8)}@ex.com`, nome,
        inicio, fim: new Date(inicio.getTime() + 3_600_000), modalidade, localId, termoVersao: TERMO_PACIENTE,
        expiraEm: new Date(agora.getTime() + 600_000), verificadoEm: agora, aguardandoDesde: agora,
      }),
    app.db,
  );
  return id;
}

describe('/painel/agenda/solicitacoes (US-409, §7)', () => {
  it('a fila: cartões com h2 (paciente ou "Nova pessoa: {nome}"), horário, local, origem, "Pedido em" e "Responda até"; o vencido fora; a aba "Solicitações (2)" atual', async () => {
    const T = await novoTenant(app.db);
    const principal = await localPrincipal(app.db, T.ctx);
    const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
    const bia = await novoPaciente(app.db, T.ctx, { nome: 'Bia Vencida' });
    await pedidoDireto(app.db, T, ana.id, em(dia(5), '09:00'), 60, { localId: principal });
    await pedidoDireto(app.db, T, bia.id, new Date(Date.now() + 3 * 3_600_000)); // daqui a 3 h: venceu (antecedência 12 h)
    await pessoaNova(T, principal, em(dia(6), '10:00'));
    entrar(T, { agendaConfirmarPedidos: true });
    const h = await fila();
    expect(h).toMatch(/<h1 id="titulo-agenda" tabindex="-1"[^>]*>Solicitações<\/h1>/);
    expect(/<a [^>]*>Solicitações \(2\)<\/a>/.exec(h)?.[0]).toMatch(/aria-current="page"[\s\S]*href="\/painel\/agenda\/solicitacoes"/);
    expect(h).toMatch(/<h2[^>]*>Ana Souza<\/h2>/);
    expect(h).toMatch(/<h2[^>]*>Nova pessoa: Carla Dias<\/h2>/);
    const t = texto(h);
    expect(t).toContain(`${formatarData(dia(5))} às 09:00–10:00`);
    expect(t).toContain('Consultório · App');
    expect(t).toContain('Consultório · Página de agendamento');
    expect(t).toContain(`Pedido em ${formatarData(hojeNoFuso(SP))}`);
    expect(t).toContain(`Responda até ${formatarData(dia(4))} às 21:00`);
    expect(t).not.toContain('Bia Vencida'); // leitura preguiçosa (RN-427)
    expect(h).toContain('aria-label="Aceitar o pedido de Ana Souza"');
    expect(h).toContain('aria-label="Recusar o pedido de Carla Dias"');
    // revisão da T8: o nome da pessoa nova (até 120 caracteres, sem espaço) quebra no cartão e no título do diálogo
    expect(h).toMatch(/<article [^>]*class="[^"]*\[overflow-wrap:anywhere\]/);
    expect(h).toMatch(/<div class="[^"]*\[overflow-wrap:anywhere\][^"]*"><form/);
    // o diálogo da recusa (fechado): título e aviso da §6.2; o formulário só monta aberto
    expect(t).toContain('Recusar o pedido de Ana Souza? A pessoa recebe um e-mail avisando.');
    // a região de status fica montada acima da lista, vazia sem `?ok=`
    expect(h.indexOf('role="status"')).toBeGreaterThan(-1);
    expect(h.indexOf('role="status"')).toBeLessThan(h.indexOf('Ana Souza</h2>'));
  });

  it('vazia: "Nenhum pedido aguardando resposta."; ?ok= e ?erro= de lista fechada na região de status', async () => {
    const T = await novoTenant(app.db);
    entrar(T, { agendaConfirmarPedidos: true });
    expect(texto(await fila())).toContain('Nenhum pedido aguardando resposta.');
    for (const [sp, msg] of [
      [{ ok: 'aceito' }, 'Pedido aceito. Consulta marcada.'],
      [{ ok: 'recusado' }, 'Pedido recusado.'],
      [{ ok: 'mudou' }, 'Este pedido já foi respondido ou venceu.'],
      [{ erro: 'inativo' }, 'Este e-mail é de um paciente arquivado ou bloqueado. Recuse o pedido ou fale com a pessoa.'],
      [{ erro: 'ocupado' }, 'Esse horário já está ocupado. Recuse o pedido ou combine outro horário com a pessoa.'],
    ] as const) {
      expect(await fila(sp), JSON.stringify(sp)).toMatch(new RegExp(`<p role="status"[^>]*>${msg.replace(/[.?]/g, '\\$&')}</p>`));
    }
    expect(await fila({ ok: '<b>x</b>', erro: 'qualquer' })).toMatch(/<p role="status"><\/p>/);
  });

  it('RN-404: o aviso do TCLE só no pedido de primeira consulta online (paciente sem consulta anterior; pessoa nova online)', async () => {
    const T = await novoTenant(app.db);
    await localPrincipal(app.db, T.ctx);
    const video = await novoLocal(app.db, T.ctx, { nome: 'Videoconferência', tipo: 'online' });
    const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
    await pedidoDireto(app.db, T, ana.id, em(dia(5), '09:00'), 60, { localId: video, modalidade: 'online' });
    entrar(T, { agendaConfirmarPedidos: true });
    const aviso = 'Primeira consulta online: confira o TCLE de telenutrição antes de atender.';
    expect(texto(await fila()).split(aviso)).toHaveLength(2);
    await pessoaNova(T, video, em(dia(6), '10:00'), 'Carla Dias', 'online');
    expect(texto(await fila()).split(aviso)).toHaveLength(3);
  });

  it('a recusa: "Motivo (só você vê)" só no pedido de paciente (AG-D23), com "Cancelar" e "Confirmar recusa"', () => {
    const recusar = async () => ({});
    const comMotivo = renderToStaticMarkup(createElement(FormularioDaRecusa, { comMotivo: true, recusar, aoCancelar: () => undefined }));
    expect(comMotivo).toMatch(/<label for="motivo-recusa"[^>]*>Motivo \(só você vê\)<\/label>/);
    expect(comMotivo).toContain('name="motivo"');
    expect(texto(comMotivo)).toContain('Confirmar recusa');
    const semMotivo = renderToStaticMarkup(createElement(FormularioDaRecusa, { comMotivo: false, recusar, aoCancelar: () => undefined }));
    expect(semMotivo).not.toContain('Motivo');
    expect(texto(semMotivo)).toContain('Cancelar');
    expect(texto(semMotivo)).toContain('Confirmar recusa');
  });
});

describe('o pedido na tela da consulta (US-409 "Pedido não se altera", RN-404, AG-D23)', () => {
  const consulta = async (id: string) => renderToStaticMarkup(await ConsultaPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) } as never));

  it('"Aceitar" e "Recusar", sem "Alterar data e hora", "Cancelar consulta" nem "Registrar presença"; o aviso do TCLE na primeira online', async () => {
    const T = await novoTenant(app.db);
    await localPrincipal(app.db, T.ctx);
    const video = await novoLocal(app.db, T.ctx, { nome: 'Videoconferência', tipo: 'online' });
    const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
    const id = await pedidoDireto(app.db, T, ana.id, em(dia(5), '09:00'), 60, { localId: video, modalidade: 'online' });
    entrar(T, { agendaConfirmarPedidos: true });
    const h = await consulta(id);
    const t = texto(h);
    expect(t).toContain('Pedido a responder');
    expect(h).toContain('aria-label="Aceitar o pedido de Ana Souza"');
    expect(h).toContain('aria-label="Recusar o pedido de Ana Souza"');
    expect(t).toContain(`Responda até ${formatarData(dia(4))} às 21:00`);
    expect(t).toContain('Primeira consulta online: confira o TCLE de telenutrição antes de atender.');
    for (const fora of ['Alterar data e hora', 'Cancelar consulta', 'Registrar presença', 'Iniciar atendimento']) expect(t, fora).not.toContain(fora);
  });

  it('o pedido recusado mostra o motivo só nesta tela ("Motivo (só você vê):"); sem motivo, nada', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
    const id = await pedidoDireto(app.db, T, ana.id, em(dia(5), '09:00'));
    const outro = await pedidoDireto(app.db, T, ana.id, em(dia(6), '09:00'));
    await recusarSolicitacao(T.ctx, tenantAgenda(T), { tipo: 'consulta', id, motivo: 'Agenda cheia na semana' }, { db: app.db });
    await recusarSolicitacao(T.ctx, tenantAgenda(T), { tipo: 'consulta', id: outro }, { db: app.db });
    entrar(T);
    const t = texto(await consulta(id));
    expect(t).toContain('Pedido não aceito');
    expect(t).toContain('Motivo (só você vê): Agenda cheia na semana');
    expect(t).not.toContain('Aceitar o pedido');
    expect(texto(await consulta(outro))).not.toContain('Motivo');
    const [c] = await withTenant(T.ctx, (tx) => tx.select().from(appointments).where(eq(appointments.id, id)), app.db);
    expect(c).toMatchObject({ status: 'cancelada', canceladoPor: 'pedido_recusado' });
  });
});

describe('a chave em Horários e a aba nas telas da agenda (US-407, AG-D72)', () => {
  it('Horários: h2 "Pedidos de consulta", a caixa "Confirmar os pedidos antes de marcar" com a explicação ligada; marcada com a chave ligada', async () => {
    const T = await novoTenant(app.db);
    await localPrincipal(app.db, T.ctx);
    entrar(T);
    const h = renderToStaticMarkup(await HorariosPage());
    expect(h).toMatch(/<h2 id="pedidos-de-consulta"[^>]*>Pedidos de consulta<\/h2>/);
    const caixa = /<input[^>]*name="confirmar"[^>]*>/.exec(h)?.[0] ?? '';
    expect(caixa).toContain('aria-describedby="chave-pedidos-ajuda"');
    expect(caixa).not.toContain('checked');
    expect(h).toMatch(/<p id="chave-pedidos-ajuda"[^>]*>Os pedidos feitos pelo app e pela página de agendamento esperam a sua resposta em Solicitações\.<\/p>/);
    expect(texto(h)).toContain('Confirmar os pedidos antes de marcar');
    // revisão da T8: o botão diz o que salva; durante o envio, aria-disabled (nunca `disabled`, o foco não sai dele)
    const salvar = /<button[^>]*>Salvar configuração<\/button>/.exec(h)?.[0] ?? '';
    expect(salvar).toContain('type="submit"');
    expect(salvar).not.toMatch(/\s(aria-)?disabled=/); // nem `disabled` nem `aria-disabled` fora do envio
    expect(h).toMatch(/<p role="status"><\/p><button/); // a região montada, vazia antes de salvar
    expect(texto(h)).not.toContain('Solicitações ('); // desligada e sem pedido: sem a aba
    await chaveDosPedidos(app.db, T);
    entrar(T, { agendaConfirmarPedidos: true });
    const ligada = renderToStaticMarkup(await HorariosPage());
    expect(/<input[^>]*name="confirmar"[^>]*>/.exec(ligada)?.[0]).toContain('checked');
    expect(/<a [^>]*>Solicitações \(0\)<\/a>/.exec(ligada)?.[0]).toContain('href="/painel/agenda/solicitacoes"');
  });

  it('Agenda: a aba só com a chave ligada ou com pedido pendente (depois de "Agenda", antes de "Pendências")', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    entrar(T);
    const agenda = async () => renderToStaticMarkup(await AgendaPage({ searchParams: Promise.resolve({}) } as never));
    expect(await agenda()).not.toContain('/painel/agenda/solicitacoes');
    await pedidoDireto(app.db, T, ana.id, em(dia(5), '09:00'));
    await chaveDosPedidos(app.db, T, false); // desligou com um pendente: a aba fica até a resposta
    const h = await agenda();
    const abas = /<nav aria-label="Seções da agenda">[\s\S]*?<\/nav>/.exec(h)?.[0] ?? '';
    expect(texto(abas).trim().split(/\s{1,}(?=[A-ZÁÉÍÓÚ])/)).toEqual(['Agenda', 'Solicitações (1)', 'Pendências', 'Horários', 'Locais']);
  });
});
