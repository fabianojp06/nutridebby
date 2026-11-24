import type { TipoDeLocal } from '@/db/schema';
import { diaCurto, diaDaSemana, paraInstante, partesNoFuso, somarDias } from './fuso';

export type Modalidade = 'presencial' | 'online';
export type ModalidadeRegra = Modalidade | 'ambas';
/**
 * Regra de atendimento (US-030): horários de `inicio`/`fim` como 'HH:MM' no fuso do tenant. Plano 23 (RN-410): toda regra
 * nova tem local (a modalidade é o tipo dele); `localId` nulo só na regra gravada pela imagem anterior ao PR 2 (RN-410a).
 */
export type Regra = { diaSemana: number; inicio: string; fim: string; duracaoMin: number; modalidade: ModalidadeRegra; localId: string | null };
export type Intervalo = { inicio: Date; fim: Date };
/** Plano 23: cada horário livre é de um local (RN-409); o mesmo instante em dois locais são dois horários. */
export type Horario = Intervalo & { modalidades: Modalidade[]; localId: string };
/**
 * O que a geração precisa de um local ativo (AG-D62): o tipo, se é o principal e se aceita agendamento pelo paciente. A
 * lista vem na ordem da projeção `app_locais_para_agendamento` e de `locaisAtivos` (principal, depois `created_at`).
 */
export type LocalDaGeracao = { id: string; tipo: TipoDeLocal; principal: boolean; agendamentoOnline: boolean };

/** 'HH:MM' de 00:00 a 23:59 (RNF-12). Validação dos formulários de regra (US-030) e de consulta (US-031). */
export const HORA_HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Valor de formulário (`FormData`/JSON) como texto aparado; o que não é texto (ausente, arquivo, número) vira ''. */
export const textoAparado = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export const minutosDe = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Intervalos semiabertos [inicio, fim): encostar não é sobrepor (como o `tstzrange '[)'` do EXCLUDE). */
export const sobrepoe = (a: Intervalo, b: Intervalo) => a.inicio.getTime() < b.fim.getTime() && b.inicio.getTime() < a.fim.getTime();

/**
 * RN-410a: o(s) local(is) em que a regra vale. Com `localId`, o próprio local, se estiver entre os ativos (a modalidade é o
 * tipo dele: a FK composta garante que é a da regra). Sem local (regra gravada pela imagem anterior), o local ativo do tipo da
 * modalidade na ordem do backfill da 0127 e de `garantirLocaisIniciais` — o principal, se for desse tipo, senão o primeiro
 * por `created_at`; "ambas" vale no presencial e no online assim escolhidos. Sem local que sirva, nenhum. A atribuição usa
 * todos os locais ativos: o recorte por "Aceita agendamento pelo paciente" vem depois (AG-D62, `gerarHorarios`).
 */
export function regraNoLocal(r: Regra, locais: LocalDaGeracao[]): { localId: string; modalidade: Modalidade }[] {
  if (r.localId) {
    const l = locais.find((x) => x.id === r.localId);
    return l ? [{ localId: l.id, modalidade: l.tipo }] : [];
  }
  const primeiro = (tipo: TipoDeLocal) => locais.find((l) => l.tipo === tipo && l.principal) ?? locais.find((l) => l.tipo === tipo);
  const tipos: TipoDeLocal[] = r.modalidade === 'ambas' ? ['presencial', 'online'] : [r.modalidade];
  return tipos.flatMap((tipo) => {
    const l = primeiro(tipo);
    return l ? [{ localId: l.id, modalidade: tipo }] : [];
  });
}

/**
 * RN-03 / RN-409: horários livres = regras de atendimento do local − bloqueios − consultas e pedidos que ocupam (de qualquer
 * local, RN-408), com início em [de, ate). Cada regra gera horários de `duracaoMin` a partir do início, enquanto couberem até
 * o fim. Hora local que não existe (horário de verão) é pulada (D8). Plano 23: cada regra vale no local da RN-410a
 * (`regraNoLocal`); com `soAgendamentoOnline` (portal, página pública e link da consulta), só nos locais com "Aceita
 * agendamento pelo paciente", recortados depois da atribuição (AG-D62). AG-D47 por local: horários de mesmo início e fim só
 * viram um no mesmo local (com local, a junção não muda nada: cada local tem um tipo); no mesmo instante, um horário por
 * local, na ordem dos locais.
 */
export function gerarHorarios(o: { regras: Regra[]; locais: LocalDaGeracao[]; bloqueios: Intervalo[]; ocupados: Intervalo[]; de: Date; ate: Date; fuso: string; soAgendamentoOnline: boolean }): Horario[] {
  if (o.ate.getTime() <= o.de.getTime()) return [];
  const fora = [...o.bloqueios, ...o.ocupados];
  const ordem = new Map(o.locais.map((l, i) => [l.id, i]));
  const oferece = new Set(o.locais.filter((l) => !o.soAgendamentoOnline || l.agendamentoOnline).map((l) => l.id));
  const destinos = o.regras.map((r) => ({ r, nos: regraNoLocal(r, o.locais).filter((d) => oferece.has(d.localId)) })).filter((x) => x.nos.length);
  const saida = new Map<string, Horario>();
  const ultimo = partesNoFuso(o.ate, o.fuso).data;
  for (let dia = partesNoFuso(o.de, o.fuso).data; dia <= ultimo; dia = somarDias(dia, 1)) {
    const semana = diaDaSemana(dia);
    for (const { r, nos } of destinos) {
      if (r.diaSemana !== semana) continue;
      for (let m = minutosDe(r.inicio); m + r.duracaoMin <= minutosDe(r.fim); m += r.duracaoMin) {
        const inicio = paraInstante(dia, hhmm(m), o.fuso);
        if (!inicio || inicio.getTime() < o.de.getTime() || inicio.getTime() >= o.ate.getTime()) continue;
        const fim = new Date(inicio.getTime() + r.duracaoMin * 60_000);
        if (fora.some((x) => sobrepoe({ inicio, fim }, x))) continue;
        for (const d of nos) {
          const chave = `${d.localId}|${inicio.getTime()}|${fim.getTime()}`;
          if (!saida.has(chave)) saida.set(chave, { inicio, fim, modalidades: [d.modalidade], localId: d.localId });
        }
      }
    }
  }
  return [...saida.values()].sort((a, b) => a.inicio.getTime() - b.inicio.getTime() || (ordem.get(a.localId) ?? 0) - (ordem.get(b.localId) ?? 0) || a.fim.getTime() - b.fim.getTime());
}

/** US-031 "Fora do horário de atendimento": o intervalo inteiro cabe numa regra do mesmo dia local. */
export function dentroDoHorario(i: Intervalo, regras: Regra[], fuso: string): boolean {
  const a = partesNoFuso(i.inicio, fuso);
  const b = partesNoFuso(i.fim, fuso);
  const fimMin = b.data === a.data ? b.minutos : b.data === somarDias(a.data, 1) && b.minutos === 0 ? 24 * 60 : -1;
  return regras.some((r) => r.diaSemana === a.diaSemana && minutosDe(r.inicio) <= a.minutos && fimMin > a.minutos && fimMin <= minutosDe(r.fim));
}

/**
 * O que a tela mostra de um horário livre (nada além de intervalo, modalidade e local, D11). Plano 23 (AG-D60): o mesmo
 * instante em dois locais são dois horários; a tela filtra pelo local escolhido.
 */
export type HorarioVisivel = { inicio: string; dia: string; data: string; hora: string; modalidades: Modalidade[]; localId: string };

/**
 * Plano 23 (US-403, RN-406): um local na escolha do portal, da página pública e do link — só o que a projeção
 * `app_locais_para_agendamento` entrega de um local com agendamento pelo paciente (o endereço só com "Mostrar o endereço").
 * Nunca a sala.
 */
export type LocalVisivel = { id: string; nome: string; tipo: TipoDeLocal; cidade: string | null; endereco: string | null };

/** Horários livres para a tela do paciente: o instante em ISO (valor do formulário), o dia curto, a hora no fuso e o local. */
export function horariosVisiveis(hs: Horario[], fuso: string): HorarioVisivel[] {
  return hs.map((h) => {
    const p = partesNoFuso(h.inicio, fuso);
    return { inicio: h.inicio.toISOString(), dia: diaCurto(p.data), data: p.data, hora: p.hora, modalidades: h.modalidades, localId: h.localId };
  });
}

/**
 * I-13: o local que a escolha abre marcado. O pedido (`?local=` ou o local da consulta que se remarca) vale se for um dos
 * locais; senão, o primeiro local com horário na semana; senão, o primeiro da lista (principal primeiro).
 */
export function localInicial(locais: Pick<LocalVisivel, 'id'>[], horarios: Pick<HorarioVisivel, 'localId'>[], pedido: unknown): string | null {
  if (typeof pedido === 'string' && locais.some((l) => l.id === pedido)) return pedido;
  return locais.find((l) => horarios.some((h) => h.localId === l.id))?.id ?? locais[0]?.id ?? null;
}
