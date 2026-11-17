/**
 * Plano 17 (lembretes de rotina por push). Sem banco nem import de servidor: o painel e o portal (cliente) também usam.
 * Aqui ficam só limites, prioridades, textos do push, mensagens de validação e formatadores; os rótulos de botão e de
 * campo ficam nos `.tsx` das seções (Tarefas 5 e 6).
 */
import type { ConfigAgua, ConfigRefeicoes } from './config';
import type { TipoSlot } from './slots';

/**
 * Plano 19 (D28): os rótulos de dias num lugar só (`plano-alimentar/dias.ts`, com as mesmas saídas: "todos os dias",
 * "seg a sex", "sáb e dom", "seg, qua e sex"); reexportado para as seções do Plano 17 que já importam daqui.
 */
export { rotuloDosDias } from '@/modules/plano-alimentar/dias';

/** §5.2: janela permitida no fuso do tenant (minutos desde 00:00); o slot das 22:00 vale. */
export const JANELA_INICIO = '06:00';
export const JANELA_FIM = '22:00';
export const JANELA_INICIO_MIN = 6 * 60;
export const JANELA_FIM_MIN = 22 * 60;
/** §5.2: teto de pushes por paciente por dia (fundidos no mesmo minuto contam 1). */
export const TETO_POR_DIA = 24;

export const INTERVALOS_AGUA = [60, 90, 120, 180, 240] as const;
export const ANTECEDENCIAS = [0, 15, 30] as const;
export const DIARIO_DEPOIS = [30, 60] as const;
export const MAX_HORARIOS = 4;
export const MAX_SUPLEMENTOS = 5;
export const MAX_LIVRES = 5;
export const TEXTO_MAX = { suplemento: 60, livre: 120 } as const;

/** Prioridade na fusão do mesmo minuto e no corte do teto (maior = mais importante). */
export const PRIORIDADE: Record<TipoSlot, number> = { refeicao: 5, suplemento: 4, livre: 3, diario: 2, agua: 1 };

/**
 * Textos da tela de bloqueio (exatos). Nome do suplemento, texto livre e nome de refeição fora da lista fechada nunca vão
 * ao push: a refeição só leva `refeicaoDoDiario(nome)` quando ≠ 'Outro' (NORMAS-DECISAO-1).
 */
export const TITULO_PUSH = 'NutriDebby';
export const TEXTOS_PUSH = {
  agua: 'Hora de beber água 💧',
  refeicaoAntes: (rotulo: string) => `Está chegando a hora: ${rotulo}`,
  refeicaoNaHora: (rotulo: string) => `Hora de: ${rotulo}`,
  refeicaoAntesGenerica: 'Está chegando a hora da sua refeição',
  refeicaoNaHoraGenerica: 'Hora da sua refeição',
  diario: 'Registre sua refeição no diário',
  suplemento: 'Hora do seu suplemento',
  livre: 'Você tem um lembrete do seu plano',
} as const;

/** Mensagens de `validarLembrete`. */
export const MSG_LEMBRETES = {
  horarioForaDaJanela: 'Escolha um horário entre 06:00 e 22:00.',
  fimAntesDoInicio: 'O fim precisa ser depois do início.',
  diasVazio: 'Escolha ao menos um dia da semana.',
  intervalo: 'Escolha um intervalo da lista.',
  opcao: 'Escolha uma opção da lista.',
  horarios: 'Escolha de 1 a 4 horários.',
  horarioRepetido: 'Há dois horários iguais. Remova um deles.',
  textoSuplemento: 'Escreva o nome do suplemento.',
  textoLivre: 'Escreva o texto do lembrete.',
  textoLongoSuplemento: 'Use até 60 caracteres.',
  textoLongoLivre: 'Use até 120 caracteres.',
  formulario: 'Formulário inválido.',
} as const;

const ROTULO_INTERVALO: Record<ConfigAgua['intervaloMin'], string> = { 60: '1 h', 90: '1h30', 120: '2 h', 180: '3 h', 240: '4 h' };

/** "a cada {rótulo}": 60 → "1 h", 90 → "1h30". */
export function rotuloDoIntervalo(min: ConfigAgua['intervaloMin']): string {
  return ROTULO_INTERVALO[min];
}

/** "a", "a e b", "a, b e c". */
const emLista = (nomes: string[]): string => (nomes.length <= 1 ? (nomes[0] ?? '') : `${nomes.slice(0, -1).join(', ')} e ${nomes.at(-1)}`);

/** Horários de suplemento/livre (HH:MM) em ordem: "08:00 e 20:00" (resumo do portal, Tarefa 6). */
export function rotuloDosHorarios(horarios: string[]): string {
  return emLista([...horarios].sort());
}

export function rotuloDaAntecedencia(min: ConfigRefeicoes['antecedenciaMin']): string {
  return min === 0 ? 'na hora' : `${min} min antes`;
}

const registroNoDiario = (min: number): string => `registro no diário ${min} min depois`;

/** Painel: "pedir registro no diário 30 min depois" / "sem pedido de registro". */
export function rotuloDoDiario(min: ConfigRefeicoes['diarioDepoisMin']): string {
  return min === null ? 'sem pedido de registro' : `pedir ${registroNoDiario(min)}`;
}

/** Portal (resumo das Refeições em Eu › Lembretes): "pedido de registro no diário 30 min depois"; sem pedido, null. */
export function rotuloDoDiarioNoPortal(min: ConfigRefeicoes['diarioDepoisMin']): string | null {
  return min === null ? null : `pedido de ${registroNoDiario(min)}`;
}
