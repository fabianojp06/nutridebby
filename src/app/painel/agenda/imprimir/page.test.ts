import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import { consultaDireta, em, localPrincipal, novoLocal, tenantAgenda } from '../../../../../test/agenda';
import { makeDb } from '../../../../../test/db';
import { novoPaciente, novoTenant } from '../../../../../test/pacientes';

/** Plano 23 (US-406, RN-418, RN-419, AG-D71): a página de impressão da agenda, com o banco de verdade. */
const sessao = vi.hoisted(() => ({ atual: null as null | { ctx: unknown; tenant: unknown } }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/tenant-session', () => ({ requireNutri: vi.fn(async () => sessao.atual) }));
vi.mock('@serwist/turbopack', () => ({ withSerwist: <T,>(c: T) => c })); // só a configuração do Next, sem o service worker

const { default: ImprimirPage, dynamic } = await import('./page');
const { default: nextConfig } = await import('../../../../../next.config');
const { closeDb } = await import('@/db/client');
const { withTenant } = await import('@/db/tenant');
const { availabilityBlocks } = await import('@/db/schema');
const { hojeNoFuso } = await import('@/modules/pacientes/datas');
const { semanaDe } = await import('@/modules/agenda/calendario');

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await closeDb();
  await app.pool.end();
});

const html = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await ImprimirPage({ searchParams: Promise.resolve(sp) } as never));
const texto = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('/painel/agenda/imprimir (US-406)', () => {
  it('h1 "Agenda de {período}", local, tabela por dia, bloqueio sem motivo, rodapé; nada de contato, link, observação ou valor', async () => {
    const T = await novoTenant(app.db);
    sessao.atual = { ctx: T.ctx, tenant: { ...tenantAgenda(T), enderecoConsultorio: null } };
    const principal = await localPrincipal(app.db, T.ctx);
    const video = await novoLocal(app.db, T.ctx, { nome: 'Videoconferência', tipo: 'online', linkSala: 'https://sala.exemplo.test/segredo' });
    const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza', email: 'ana.souza@exemplo.test', telefoneE164: '+5581999990000' });
    const [segunda, terca, quarta, quinta] = semanaDe(hojeNoFuso('America/Sao_Paulo'));
    await consultaDireta(app.db, T.ctx, ana.id, em(segunda, '08:40'), 50, { localId: principal });
    await consultaDireta(app.db, T.ctx, ana.id, em(terca, '09:00'), 60, { localId: video, modalidade: 'online', linkOnline: 'https://sala.exemplo.test/segredo' });
    await consultaDireta(app.db, T.ctx, ana.id, em(quarta, '10:00'), 60, { status: 'cancelada', canceladoPor: 'nutri', canceladaEm: new Date(), motivoCancelamento: 'Observação sigilosa' });
    await withTenant(T.ctx, (tx) => tx.insert(availabilityBlocks).values({ tenantId: T.tenantId, inicio: em(quinta, '08:00'), fim: em(quinta, '12:00'), motivo: 'Congresso secreto' }), app.db);

    const h = await html({ visao: 'semana', data: segunda, aniversario: '1' });
    expect(dynamic).toBe('force-dynamic');
    expect(h).toMatch(/<h1[^>]*>Agenda de \d{2}\/\d{2}\/\d{4} a \d{2}\/\d{2}\/\d{4}<\/h1>/);
    expect(texto(h)).toContain('Local: Todos os locais');
    // I-1: uma tabela só, um <tbody> por dia (o dia num th scope="rowgroup"), o rodapé no <tfoot> (repete em toda página,
    // dentro do fluxo) — nada de position: fixed cobrindo a última linha
    expect(h.split('<table').length - 1).toBe(1);
    expect(h).toMatch(/<caption class="sr-only">Agenda de [^<]+\. Local: Todos os locais<\/caption>/);
    expect(h.split('<tbody').length - 1).toBe(3); // segunda, terça e o bloqueio de quinta (a cancelada de quarta fica fora)
    expect(h.split('scope="rowgroup"').length - 1).toBe(3);
    expect(h).toMatch(/<tfoot><tr><td colSpan="6"[^>]*>Contém dados pessoais de pacientes\. Uso restrito do consultório\.<\/td><\/tr><\/tfoot>/i);
    expect(h).not.toContain('print:fixed');
    expect(texto(h)).toContain('08:40–09:30');
    expect(texto(h)).toContain('Ana Souza');
    expect(texto(h)).toContain('Bloqueado');
    expect(texto(h)).toContain('Contém dados pessoais de pacientes. Uso restrito do consultório.');
    expect(texto(h)).toContain('Voltar à agenda');
    for (const proibido of ['ana.souza@exemplo.test', '+5581999990000', '99999', 'https://', 'segredo', 'Congresso', 'Observação sigilosa', 'R$', 'Aniversário']) {
      expect(h, proibido).not.toContain(proibido);
    }
    // "Imprimir ou salvar em PDF" e "Voltar à agenda" só na tela
    expect(h).toMatch(/<a [^>]*class="[^"]*print:hidden[^"]*"[^>]*>Voltar à agenda<\/a>/);
  });

  it('o next.config.ts manda Cache-Control: no-store em /painel/agenda/imprimir, depois da regra /:path* (AG-D71)', async () => {
    const regras = await nextConfig.headers!();
    const geral = regras.findIndex((r) => r.source === '/:path*');
    const i = regras.findIndex((r) => r.source === '/painel/agenda/imprimir');
    expect(i).toBeGreaterThan(geral);
    expect(regras[i].headers).toContainEqual({ key: 'Cache-Control', value: 'no-store' });
  });
});
