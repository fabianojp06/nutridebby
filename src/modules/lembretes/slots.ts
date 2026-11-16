/**
 * Plano 17 (§5.2): o plano do dia de um paciente — os instantes de push de cada lembrete ativo, na hora local do tenant.
 * Puro: o worker (envio), a visão da equipe (previsto para hoje) e o teto ao salvar (`maiorDiaDaSemana`) usam o mesmo cálculo.
 */
import { diaDaSemana, paraInstante, somarDias } from '@/modules/agenda/fuso';
import { HORA_HHMM, minutosDe } from '@/modules/agenda/horarios';
import type { LembreteNovo, SemTexto } from './config';
import { JANELA_FIM_MIN, JANELA_INICIO_MIN, PRIORIDADE, TETO_POR_DIA } from './constantes';

export type TipoSlot = 'refeicao' | 'diario' | 'suplemento' | 'livre' | 'agua';
/** `validoDesde`: o worker passa o `updated_at` do lembrete — slot anterior a ele não sai (lembrete salvo às 10:03 não envia a água das 10:00). */
export type LembreteParaSlots = { id: string; ativo: boolean; validoDesde?: Date } & SemTexto<LembreteNovo>; // LembreteNovo com texto continua atribuível
export type RefeicaoDoPlano = { nome: string; horario: string | null }; // 'HH:MM' ou null
/** `refeicao`: nome da refeição do plano nos slots `refeicao` e `diario`; null nos outros. */
export type Slot = { em: Date; tipo: TipoSlot; lembreteIds: string[]; refeicao: string | null };

type Entrada = {
  lembretes: LembreteParaSlots[];
  refeicoes: RefeicaoDoPlano[];
  data: string /* AAAA-MM-DD no fuso */;
  fuso: string;
  refeicoesNoDiario?: string[]; // nomes das refeições do plano já registradas no dia local (só o worker passa)
};
type Resultado = { slots: Slot[]; cortados: { total: number; tipos: TipoSlot[] }; refeicoesSemHorario: string[]; refeicoesForaDaJanela: string[] };

/** Um aviso antes da fusão: `ordem` = posição da refeição em `refeicoes` (desempate da fusão de duas refeições). */
type Bruto = { min: number; tipo: TipoSlot; lembreteId: string; refeicao: string | null; ordem: number };

const p2 = (n: number) => String(n).padStart(2, '0');
const hhmm = (min: number) => `${p2(Math.floor(min / 60))}:${p2(min % 60)}`;
const naJanela = (min: number) => min >= JANELA_INICIO_MIN && min <= JANELA_FIM_MIN;

function calcular(e: Entrada, previsao: boolean): Resultado {
  const dia = diaDaSemana(e.data);
  const noDiario = new Set(previsao ? [] : (e.refeicoesNoDiario ?? []));
  const semHorario = new Set<string>();
  const foraDaJanela = new Set<string>();
  const brutos: (Bruto & { em: Date })[] = [];

  for (const l of e.lembretes) {
    if (!l.ativo) continue;
    const doLembrete: Bruto[] = [];
    const add = (min: number, tipo: TipoSlot, refeicao: string | null = null, ordem = 0) => doLembrete.push({ min, tipo, lembreteId: l.id, refeicao, ordem });
    switch (l.tipo) {
      case 'agua': {
        if (!(l.config.dias as number[]).includes(dia)) break;
        const fim = minutosDe(l.config.fim);
        for (let m = minutosDe(l.config.inicio); m <= fim; m += l.config.intervaloMin) add(m, 'agua');
        break;
      }
      case 'suplemento':
      case 'livre':
        if (!(l.config.dias as number[]).includes(dia)) break;
        for (const h of l.config.horarios) add(minutosDe(h), l.tipo);
        break;
      case 'refeicoes': {
        const { antecedenciaMin, diarioDepoisMin } = l.config;
        e.refeicoes.forEach((r, ordem) => {
          if (!r.horario || !HORA_HHMM.test(r.horario)) {
            semHorario.add(r.nome);
            return;
          }
          const h = minutosDe(r.horario);
          if (!naJanela(h - antecedenciaMin)) foraDaJanela.add(r.nome);
          add(h - antecedenciaMin, 'refeicao', r.nome, ordem);
          // o diário já registrado sai antes da janela, da fusão e do teto: não derruba a água do mesmo minuto
          if (diarioDepoisMin !== null && !noDiario.has(r.nome)) add(h + diarioDepoisMin, 'diario', r.nome, ordem);
        });
        break;
      }
    }
    for (const b of doLembrete) {
      if (!naJanela(b.min)) continue;
      const em = paraInstante(e.data, hhmm(b.min), e.fuso); // hora que não existe no fuso (horário de verão): sem slot
      if (!em) continue;
      if (!previsao && l.validoDesde && em < l.validoDesde) continue;
      brutos.push({ ...b, em });
    }
  }

  // fusão do mesmo minuto: o mais prioritário (desempate: a refeição que vem antes no plano) define tipo e refeição
  brutos.sort((a, b) => a.em.getTime() - b.em.getTime() || PRIORIDADE[b.tipo] - PRIORIDADE[a.tipo] || a.ordem - b.ordem);
  const slots: Slot[] = [];
  for (const b of brutos) {
    const ultimo = slots.at(-1);
    if (ultimo && ultimo.em.getTime() === b.em.getTime()) {
      if (!ultimo.lembreteIds.includes(b.lembreteId)) ultimo.lembreteIds.push(b.lembreteId);
    } else {
      slots.push({ em: b.em, tipo: b.tipo, lembreteIds: [b.lembreteId], refeicao: b.tipo === 'refeicao' || b.tipo === 'diario' ? b.refeicao : null });
    }
  }

  // teto: saem os de menor prioridade; no mesmo tipo, os mais tarde do dia (corte determinístico)
  const excesso = slots.length - TETO_POR_DIA;
  const cortar = new Set<Slot>();
  if (excesso > 0) {
    const ordemDeCorte = [...slots].sort((a, b) => PRIORIDADE[a.tipo] - PRIORIDADE[b.tipo] || b.em.getTime() - a.em.getTime());
    for (const s of ordemDeCorte.slice(0, excesso)) cortar.add(s);
  }
  const tipos = [...new Set([...cortar].map((s) => s.tipo))].sort((a, b) => PRIORIDADE[a] - PRIORIDADE[b]);

  return {
    slots: slots.filter((s) => !cortar.has(s)),
    cortados: { total: cortar.size, tipos },
    refeicoesSemHorario: [...semHorario],
    refeicoesForaDaJanela: [...foraDaJanela],
  };
}

/**
 * Slots do dia `data` (no fuso), ordenados por `em`: gera os de cada lembrete `ativo`, descarta os anteriores a
 * `validoDesde` e os `diario` das refeições em `refeicoesNoDiario`, depois os fora da janela 06:00–22:00, funde os do
 * mesmo minuto e corta acima de 24 pelos de menor prioridade (refeição > suplemento > livre > diário > água).
 * `refeicoesSemHorario` e `refeicoesForaDaJanela` (a refeição cujo aviso cai fora da janela) só com um lembrete de refeições ativo.
 */
export function planoDoDia(e: Entrada): Resultado {
  return calcular(e, false);
}

/** Semana de referência (seg 08/06/2026 a dom 14/06/2026), sem mudança de horário de verão nos dois hemisférios. */
const SEGUNDA_DE_REFERENCIA = '2026-06-08';

/**
 * Maior total de avisos (antes do teto) entre os 7 dias da semana — o teto ao salvar (Tarefa 3). É previsão, não o envio
 * de hoje: ignora `validoDesde` e `refeicoesNoDiario`.
 */
export function maiorDiaDaSemana(e: Omit<Parameters<typeof planoDoDia>[0], 'data'>): number {
  let maior = 0;
  for (let i = 0; i < 7; i++) {
    const r = calcular({ ...e, data: somarDias(SEGUNDA_DE_REFERENCIA, i) }, true);
    maior = Math.max(maior, r.slots.length + r.cortados.total);
  }
  return maior;
}
