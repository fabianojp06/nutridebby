import { diaCurto, diaDaSemana, paraInstante, partesNoFuso, somarDias } from './fuso';

export type Modalidade = 'presencial' | 'online';
export type ModalidadeRegra = Modalidade | 'ambas';
/** Regra de atendimento (US-030): horários de `inicio`/`fim` como 'HH:MM' no fuso do tenant. */
export type Regra = { diaSemana: number; inicio: string; fim: string; duracaoMin: number; modalidade: ModalidadeRegra };
export type Intervalo = { inicio: Date; fim: Date };
export type Horario = Intervalo & { modalidades: Modalidade[] };

/** 'HH:MM' de 00:00 a 23:59 (RNF-12). Validação dos formulários de regra (US-030) e de consulta (US-031). */
export const HORA_HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Valor de formulário (`FormData`/JSON) como texto aparado; o que não é texto (ausente, arquivo, número) vira ''. */
export const textoAparado = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export const minutosDe = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Intervalos semiabertos [inicio, fim): encostar não é sobrepor (como o `tstzrange '[)'` do EXCLUDE). */
export const sobrepoe = (a: Intervalo, b: Intervalo) => a.inicio.getTime() < b.fim.getTime() && b.inicio.getTime() < a.fim.getTime();

const MODALIDADES: Modalidade[] = ['presencial', 'online'];

function modalidadesDa(regra: ModalidadeRegra, online: boolean): Modalidade[] {
  if (regra === 'presencial') return ['presencial'];
  if (regra === 'online') return online ? ['online'] : [];
  return online ? ['presencial', 'online'] : ['presencial'];
}

/**
 * RN-03: horários livres = regras de atendimento − bloqueios − consultas não canceladas, com início em
 * [de, ate). Cada regra gera horários de `duracaoMin` a partir do início, enquanto couberem até o fim.
 * Hora local que não existe (horário de verão) é pulada (D8). `online = false` (sem link padrão): nada
 * online para o paciente (US-031). Plano 23 (AG-D47): horários de mesmo início e fim viram um só, com a união das
 * modalidades — o backfill desdobra a regra "ambas" em uma presencial e uma online, e `escolherHorario` pega o primeiro
 * horário do instante.
 */
export function gerarHorarios(o: { regras: Regra[]; bloqueios: Intervalo[]; ocupados: Intervalo[]; de: Date; ate: Date; fuso: string; online: boolean }): Horario[] {
  if (o.ate.getTime() <= o.de.getTime()) return [];
  const fora = [...o.bloqueios, ...o.ocupados];
  const saida = new Map<string, Horario>();
  const ultimo = partesNoFuso(o.ate, o.fuso).data;
  for (let dia = partesNoFuso(o.de, o.fuso).data; dia <= ultimo; dia = somarDias(dia, 1)) {
    const semana = diaDaSemana(dia);
    for (const r of o.regras) {
      if (r.diaSemana !== semana) continue;
      const modalidades = modalidadesDa(r.modalidade, o.online);
      if (!modalidades.length) continue;
      for (let m = minutosDe(r.inicio); m + r.duracaoMin <= minutosDe(r.fim); m += r.duracaoMin) {
        const inicio = paraInstante(dia, hhmm(m), o.fuso);
        if (!inicio || inicio.getTime() < o.de.getTime() || inicio.getTime() >= o.ate.getTime()) continue;
        const h: Horario = { inicio, fim: new Date(inicio.getTime() + r.duracaoMin * 60_000), modalidades };
        if (fora.some((x) => sobrepoe(h, x))) continue;
        const chave = `${h.inicio.getTime()}-${h.fim.getTime()}`;
        const igual = saida.get(chave);
        if (igual) igual.modalidades = MODALIDADES.filter((m) => igual.modalidades.includes(m) || modalidades.includes(m));
        else saida.set(chave, h);
      }
    }
  }
  return [...saida.values()].sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
}

/** US-031 "Fora do horário de atendimento": o intervalo inteiro cabe numa regra do mesmo dia local. */
export function dentroDoHorario(i: Intervalo, regras: Regra[], fuso: string): boolean {
  const a = partesNoFuso(i.inicio, fuso);
  const b = partesNoFuso(i.fim, fuso);
  const fimMin = b.data === a.data ? b.minutos : b.data === somarDias(a.data, 1) && b.minutos === 0 ? 24 * 60 : -1;
  return regras.some((r) => r.diaSemana === a.diaSemana && minutosDe(r.inicio) <= a.minutos && fimMin > a.minutos && fimMin <= minutosDe(r.fim));
}

/** O que a tela mostra de um horário livre (nada além de intervalo e modalidade, D11). */
export type HorarioVisivel = { inicio: string; dia: string; data: string; hora: string; modalidades: Modalidade[] };

/** Horários livres para a tela do paciente: o instante em ISO (valor do formulário), o dia curto e a hora no fuso. */
export function horariosVisiveis(hs: Horario[], fuso: string): HorarioVisivel[] {
  return hs.map((h) => {
    const p = partesNoFuso(h.inicio, fuso);
    return { inicio: h.inicio.toISOString(), dia: diaCurto(p.data), data: p.data, hora: p.hora, modalidades: h.modalidades };
  });
}
