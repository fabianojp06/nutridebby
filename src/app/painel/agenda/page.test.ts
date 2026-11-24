import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { consultaDireta, em, localPrincipal, novoLocal, tenantAgenda } from '../../../../test/agenda';
import { makeDb } from '../../../../test/db';
import { novoPaciente, novoTenant, type TenantDeTeste } from '../../../../test/pacientes';

/**
 * Plano 23 (US-404, US-405, spec §7): a tela da agenda com o banco de verdade — grade de horas (Dia/Semana), Mês, filtros
 * num formulário GET sem JavaScript e legenda em texto. As datas são as da semana de hoje (a página usa o relógio de verdade).
 */
const sessao = vi.hoisted(() => ({ atual: null as null | { ctx: unknown; tenant: unknown } }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/tenant-session', () => ({ requireNutri: vi.fn(async () => sessao.atual) }));

const { default: AgendaPage } = await import('./page');
const { closeDb } = await import('@/db/client');
const { hojeNoFuso } = await import('@/modules/pacientes/datas');
const { semanaDe } = await import('@/modules/agenda/calendario');

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await closeDb();
  await app.pool.end();
});

const html = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await AgendaPage({ searchParams: Promise.resolve(sp) } as never));
const texto = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const quantas = (h: string, s: string) => h.split(s).length - 1;

let T: TenantDeTeste;
let clinica: string;
let ana: string;
const hoje = hojeNoFuso('America/Sao_Paulo');
const [segunda, terca, quarta] = semanaDe(hoje);

beforeAll(async () => {
  T = await novoTenant(app.db);
  sessao.atual = { ctx: T.ctx, tenant: { ...tenantAgenda(T), enderecoConsultorio: null } };
  const principal = await localPrincipal(app.db, T.ctx);
  clinica = await novoLocal(app.db, T.ctx, { nome: 'Clínica Centro' });
  ana = (await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' })).id;
  const carla = (await novoPaciente(app.db, T.ctx, { nome: 'Carla Dias' })).id;
  await consultaDireta(app.db, T.ctx, ana, em(segunda, '08:40'), 50, { localId: clinica });
  await consultaDireta(app.db, T.ctx, carla, em(terca, '09:00'), 90, { localId: principal });
  // quarta: 5 consultas → "mais 2" no Mês
  for (const [i, nome] of ['Dani', 'Edu', 'Fia', 'Gui', 'Hel'].entries()) {
    const p = (await novoPaciente(app.db, T.ctx, { nome })).id;
    await consultaDireta(app.db, T.ctx, p, em(quarta, `${String(13 + i).padStart(2, '0')}:00`), 30, { localId: principal });
  }
});

describe('/painel/agenda (US-404, US-405)', () => {
  it('Semana em grade: caption, th scope col/row, item na hora em que começa com o horário visível; a de 90 min aparece uma vez, "até 10:30"', async () => {
    const h = await html({ visao: 'semana', data: hoje });
    expect(h).toMatch(/<h1[^>]*>Agenda<\/h1>/);
    expect(h).toContain('aria-label="Seções da agenda"'); // AbasDaAgenda
    const grade = /<table[^>]*data-testid="agenda-grade"[\s\S]*?<\/table>/.exec(h)?.[0] ?? '';
    expect(grade).toContain('<caption');
    expect(quantas(grade, 'scope="col"')).toBe(8); // "Hora" + 7 dias
    expect(grade).toMatch(/<th scope="row"[^>]*>08h<\/th>/);
    expect(texto(grade)).toContain('08:40–09:30');
    expect(quantas(texto(grade), 'Carla Dias')).toBe(1);
    expect(texto(grade)).toContain('09:00 (até 10:30)');
    // a linha das 08h tem a consulta de Ana; a das 09h, a de Carla
    const linha = (hh: string) => new RegExp(`<tr><th scope="row"[^>]*>${hh}h</th>[\\s\\S]*?</tr>`).exec(grade)?.[0] ?? '';
    expect(texto(linha('08'))).toContain('Ana Souza');
    expect(texto(linha('09'))).toContain('Carla Dias');
    expect(texto(linha('09'))).not.toContain('Ana Souza');
    // link nomeado pelo conteúdo visível, sem aria-label (WCAG 2.5.3); selos em texto
    expect(grade).not.toMatch(/<a [^>]*aria-label/);
    expect(texto(grade)).toContain('Primeira consulta');
    expect(texto(grade)).toContain('Clínica Centro');
    // a 360 px, a lista por dia (h2 por dia)
    expect(h).toContain('data-testid="agenda-lista-dias"');
  });

  it('Mês: caption "{mês} de {ano}", "{n} consultas", até 3 nomes e "mais 2"; o dia abre a visão Dia', async () => {
    const h = await html({ visao: 'mes', data: quarta });
    const grade = /<table[^>]*data-testid="agenda-mes"[\s\S]*?<\/table>/.exec(h)?.[0] ?? '';
    expect(grade).toMatch(/<caption[^>]*>[a-zç]+ de \d{4}<\/caption>/);
    expect(texto(grade)).toContain('5 consultas');
    expect(texto(grade)).toContain('mais 2');
    expect(texto(grade)).toContain('Dani');
    expect(texto(grade)).not.toContain('Gui');
    expect(grade).toContain(`href="/painel/agenda?visao=dia&amp;data=${quarta}"`);
  });

  it('filtros: formulário GET com os outros parâmetros em hidden; "Ir para data" com label; legenda em texto; sem marcador de retorno no PR 2', async () => {
    const h = await html({ visao: 'semana', data: hoje, local: clinica, paciente: ana, horas: '24', aniversario: '1' });
    const forms = [...h.matchAll(/<form[^>]*method="get"[\s\S]*?<\/form>/g)].map((m) => m[0]);
    expect(forms).toHaveLength(2);
    const [filtrar, irPara] = forms;
    expect(filtrar).toContain('<input type="hidden" name="visao" value="semana"/>');
    expect(filtrar).toContain(`<input type="hidden" name="data" value="${hoje}"/>`);
    expect(texto(filtrar)).toContain('Todos os locais');
    expect(filtrar).toContain(`<option value="${clinica}" selected="">Clínica Centro</option>`);
    expect(filtrar).toContain(`<option value="${ana}" selected="">Ana Souza</option>`);
    expect(texto(filtrar)).toContain('Filtrar');
    expect(irPara).toMatch(/<label[^>]*for="ir-para-data"[^>]*>Ir para data<\/label>/);
    for (const [nome, valor] of [['visao', 'semana'], ['local', clinica], ['paciente', ana], ['horas', '24'], ['aniversario', '1']]) {
      expect(irPara).toContain(`<input type="hidden" name="${nome}" value="${valor}"/>`);
    }
    expect(texto(irPara)).toContain('Ir para a data');
    expect(texto(h)).toContain('Limpar filtros');
    // "Próximo" preserva os filtros (I-05)
    expect(h).toMatch(new RegExp(`href="/painel/agenda\\?visao=semana&amp;data=[0-9-]+&amp;local=${clinica}&amp;paciente=${ana}&amp;horas=24&amp;aniversario=1"[^>]*>Próximo`));
    // impressão com os mesmos filtros, sem prefetch
    expect(h).toMatch(/href="\/painel\/agenda\/imprimir\?visao=semana[^"]*"[^>]*>Imprimir ou salvar em PDF/);
    // "Mostrar 24 horas": a grade vai de 00h a 23h
    expect(h).toMatch(/<th scope="row"[^>]*>00h<\/th>/);
    expect(h).toMatch(/<th scope="row"[^>]*>23h<\/th>/);
    const legenda = texto(/<section[^>]*aria-labelledby="titulo-legenda"[\s\S]*?<\/section>/.exec(h)?.[0] ?? '');
    for (const r of ['Legenda', 'Primeira consulta', 'Retorno', 'Presença a registrar', 'Bloqueio', 'Aniversário']) expect(legenda).toContain(r);
    expect(legenda).not.toContain('Pedido a responder'); // AG-D72: só com o status `solicitada` (T6/T8, PEDIDOS_NA_AGENDA)
    // M4: os dois formulários com nome; M5: "Anterior"/"Próximo" dizem a visão ao leitor de tela, depois do texto visível
    expect(filtrar).toContain('aria-label="Filtros da agenda"');
    expect(irPara).toContain('aria-label="Navegação por data"'); // E2E do PR 2: o nome do form não repete o rótulo do campo
    expect(h).toMatch(/>Anterior<span class="sr-only"> \(semana anterior\)<\/span><\/a>/);
    expect(h).toMatch(/>Próximo<span class="sr-only"> \(próxima semana\)<\/span><\/a>/);
    expect(texto(h)).not.toContain('Previsões de retorno');
    expect(texto(h)).not.toContain('Retorno previsto');
    // só Ana, na Clínica (Carla continua como opção do filtro "Paciente")
    const grade = /<table[^>]*data-testid="agenda-grade"[\s\S]*?<\/table>/.exec(h)?.[0] ?? '';
    expect(texto(grade)).toContain('Ana Souza');
    expect(texto(grade)).not.toContain('Carla Dias');
  });

  it('"hoje" no Mês em texto, não só pela cor (I-2): "(hoje)" no nome do link e a cor do link trocada, não somada', async () => {
    const h = await html({ visao: 'mes', data: hoje });
    const grade = /<table[^>]*data-testid="agenda-mes"[\s\S]*?<\/table>/.exec(h)?.[0] ?? '';
    const link = new RegExp(`<a [^>]*href="/painel/agenda\\?visao=dia&amp;data=${hoje}"[^>]*>[\\s\\S]*?</a>`).exec(grade)?.[0] ?? '';
    expect(texto(link)).toContain('(hoje)');
    expect(link).toContain('text-ok');
    expect(link).not.toContain('text-link');
    const outro = new RegExp(`<a [^>]*href="/painel/agenda\\?visao=dia&amp;data=(?!${hoje})[0-9-]+"[^>]*>[\\s\\S]*?</a>`).exec(grade)?.[0] ?? '';
    expect(outro).toContain('text-link');
    expect(texto(outro)).not.toContain('(hoje)');
  });

  it('M3: "Aniversários" some na Lista e "Mostrar 24 horas" no Mês e na Lista, sem perder o valor (campo oculto)', async () => {
    const mes = await html({ visao: 'mes', data: hoje, horas: '24', aniversario: '1' });
    expect(texto(mes)).not.toContain('Mostrar 24 horas');
    expect(texto(mes)).toContain('Aniversários');
    expect(mes).toContain('<input type="hidden" name="horas" value="24"/>');
    const lista = await html({ visao: 'lista', data: hoje, horas: '24', aniversario: '1' });
    expect(texto(lista)).not.toContain('Mostrar 24 horas');
    expect(texto(lista)).not.toContain('Aniversários');
    expect(lista).toContain('<input type="hidden" name="aniversario" value="1"/>');
    const semana = await html({ visao: 'semana', data: hoje });
    expect(texto(semana)).toContain('Mostrar 24 horas');
    expect(texto(semana)).toContain('Aniversários');
  });

  it('Lista: o ItemConsulta de sempre, com o local e o tipo; data inválida volta para hoje', async () => {
    const h = await html({ visao: 'lista', data: segunda });
    expect(texto(h)).toContain('Ana Souza');
    expect(texto(h)).toContain('Clínica Centro · Presencial');
    expect(texto(h)).toContain('Primeira consulta');
    expect(h).not.toContain('data-testid="agenda-grade"');
    expect(h).toMatch(/<a class="inline-flex min-h-11 items-center text-link underline" href="\/painel\/agenda\/consultas\/[0-9a-f-]{36}">Ana Souza<\/a>/); // M2: alvo de 44 px
    const invalida = await html({ visao: 'lista', data: '9999-12-31' });
    expect(invalida).toContain(`href="/painel/agenda?visao=lista&amp;data=${hoje}"`); // "Hoje"
  });
});
