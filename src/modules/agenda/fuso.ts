import { dataValida, formatarData, somarAnos, somarDias } from '@/modules/pacientes/datas';

/** RN-06: tudo gravado em UTC; calendário e relógio são os do fuso do tenant. Só Intl, sem biblioteca. */
export type PartesNoFuso = { data: string; hora: string; diaSemana: number; minutos: number };

const formatos = new Map<string, Intl.DateTimeFormat>();
function formato(fuso: string): Intl.DateTimeFormat {
  let f = formatos.get(fuso);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: fuso, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    formatos.set(fuso, f);
  }
  return f;
}

const p2 = (n: number) => String(n).padStart(2, '0');

/** Dia da semana de 'AAAA-MM-DD' (0 = domingo … 6 = sábado), sem depender do fuso do servidor. */
export function diaDaSemana(data: string): number {
  const [a, m, d] = data.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
}

/**
 * Segunda-feira da semana de 'AAAA-MM-DD' (a agenda e a página de remarcação começam a semana na segunda; o domingo
 * fecha a semana). É só calendário: a data já é a do fuso do tenant, então o fuso não entra.
 */
export function segundaDaSemana(data: string): string {
  return somarDias(data, -((diaDaSemana(data) + 6) % 7));
}

/** Data, hora, dia da semana e minutos desde 00:00 de um instante, no fuso. */
export function partesNoFuso(instante: Date, fuso: string): PartesNoFuso {
  const v: Record<string, number> = {};
  for (const p of formato(fuso).formatToParts(instante)) if (p.type !== 'literal') v[p.type] = Number(p.value);
  const data = `${v.year}-${p2(v.month)}-${p2(v.day)}`;
  return { data, hora: `${p2(v.hour)}:${p2(v.minute)}`, diaSemana: diaDaSemana(data), minutos: v.hour * 60 + v.minute };
}

/** Diferença (ms) entre o relógio do fuso e o UTC naquele instante. */
function deslocamento(instante: number, fuso: string): number {
  const p = partesNoFuso(new Date(instante), fuso);
  const [a, m, d] = p.data.split('-').map(Number);
  return Date.UTC(a, m - 1, d, Math.floor(p.minutos / 60), p.minutos % 60) - Math.floor(instante / 60_000) * 60_000;
}

/**
 * D8: instante da data + hora locais no fuso. Hora que não existe (adiantamento do horário de verão) → null;
 * hora que se repete (fim do horário de verão) → a primeira. Os deslocamentos de 1 dia antes e depois
 * cobrem os dois lados de qualquer mudança de horário.
 */
export function paraInstante(data: string, hora: string, fuso: string): Date | null {
  const [a, m, d] = data.split('-').map(Number);
  const [h, mi] = hora.split(':').map(Number);
  const alvo = Date.UTC(a, m - 1, d, h, mi);
  const validos = [alvo - deslocamento(alvo - 86_400_000, fuso), alvo - deslocamento(alvo + 86_400_000, fuso)].filter((t) => {
    const p = partesNoFuso(new Date(t), fuso);
    return p.data === data && p.hora === `${p2(h)}:${p2(mi)}`;
  });
  return validos.length ? new Date(Math.min(...validos)) : null;
}

/** 00:00 do dia no fuso (meia-noite que não existe no horário de verão → 01:00). */
export function inicioDoDia(data: string, fuso: string): Date {
  return paraInstante(data, '00:00', fuso) ?? paraInstante(data, '01:00', fuso)!;
}

/** 00:00 do dia 1º do mês de `instante` no fuso (RN-09: mês civil do tenant). */
export function inicioDoMes(instante: Date, fuso: string): Date {
  return inicioDoDia(`${partesNoFuso(instante, fuso).data.slice(0, 8)}01`, fuso);
}

/** 00:00 do dia 1º do mês seguinte ao de `instante`, no fuso. */
export function inicioDoMesSeguinte(instante: Date, fuso: string): Date {
  const [a, m] = partesNoFuso(instante, fuso).data.split('-').map(Number);
  return inicioDoDia(m === 12 ? `${a + 1}-01-01` : `${a}-${p2(m + 1)}-01`, fuso);
}

const DIAS = ['dom.', 'seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.'];

/** "sex., 16/10" (cabeçalho da agenda). */
export function diaCurto(data: string): string {
  return `${DIAS[diaDaSemana(data)]}, ${formatarData(data).slice(0, 5)}`;
}

/** "sex., 16/10/2026 às 14:00" no fuso (RNF-12). */
export function formatarQuando(instante: Date, fuso: string): string {
  const p = partesNoFuso(instante, fuso);
  return `${DIAS[p.diaSemana]}, ${formatarData(p.data)} às ${p.hora}`;
}

/** RN-06: "horário de Brasília" em America/Sao_Paulo; nos outros fusos, o nome longo do Intl em minúscula. */
export function rotuloDoFuso(fuso: string): string {
  if (fuso === 'America/Sao_Paulo') return 'horário de Brasília';
  const nome = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, timeZoneName: 'long' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value;
  return nome ? nome.charAt(0).toLowerCase() + nome.slice(1) : fuso;
}

/** Mensagens ao paciente (e-mail, WhatsApp, push): sempre com a sigla do fuso, porque o aparelho pode estar em outro. */
export function quandoComFuso(instante: Date, fuso: string): string {
  return `${formatarQuando(instante, fuso)} (${rotuloDoFuso(fuso)})`;
}

export { somarDias };

/** Teto das datas da agenda: até quantos anos depois de hoje (no fuso do tenant) uma consulta, um bloqueio ou `?data=` vale. */
export const ANOS_FUTUROS_AGENDA = 5;

/**
 * Revisão final (ruling da T2–T4): data da agenda = 'AAAA-MM-DD' que existe, de 1900 até hoje + 5 anos (`hoje` no fuso
 * do tenant, `hojeNoFuso`). Sem o teto, 9999-12-31 virava o ano 10000 em `somarDias`/`toISOString` e dava 500 (RangeError,
 * ou 22009 no banco). Fora dela: "Informe uma data válida" no campo (consulta, bloqueio) ou a página volta para hoje.
 */
export function dataDaAgendaValida(data: string, hoje: string): boolean {
  return dataValida(data) && data <= somarAnos(hoje, ANOS_FUTUROS_AGENDA);
}

/** `?data=` das páginas da agenda: a data pedida, se for uma data da agenda; senão hoje. */
export function dataDaAgendaOuHoje(pedida: unknown, hoje: string): string {
  return typeof pedida === 'string' && dataDaAgendaValida(pedida, hoje) ? pedida : hoje;
}
