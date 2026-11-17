import { partesNoFuso } from '@/modules/agenda/fuso';
import { DIA_CURTO, diaDaSemanaNoFuso, type DiaDaSemana } from '@/modules/plano-alimentar/dias';
import { daquiA } from './datas-portal';

/**
 * Plano 19 (RN-247): as regras do dia da semana no app do paciente, sem banco nem React — o servidor (`planoDoPaciente`,
 * mural) e o componente cliente da página Plano (`dia-de-hoje.tsx`, que decide o "hoje" pelo relógio do aparelho para a
 * cópia offline) usam as mesmas.
 */
export const MSG_PLANO_DIAS = {
  hoje: (dia: string) => `Hoje (${dia})`,
  verOutrosDias: 'Ver outros dias',
  semRefeicaoHoje: 'Seu plano não tem refeições para hoje.',
  ligado: 'Ligado ao seu plano',
  lista: 'Lista de substituição',
  conteudos: 'Receitas e materiais do seu plano',
  precisaInternet: 'Abrir precisa de internet.',
  /** RN-254: o texto livre e a orientação da lista ligada são da nutricionista (a voz dela, RN-194). */
  suaNutricionista: 'Sua nutricionista:',
  /** Plano 16: a próxima refeição de hoje ("Próxima, daqui a 2 h") — `daquiA` só vale para menos de 24 h. */
  proximaHoje: (quando: string) => `Próxima, ${quando}`,
  proximaAmanha: (hora: string) => `Próxima: amanhã às ${hora}`,
  proximaNoDia: (dia: string, hora: string) => `Próxima: ${dia} às ${hora}`,
  /** RN-247 (e): a refeição de outro dia abre só para leitura. */
  noDiaDela: 'Você responde a esta refeição no dia dela.',
} as const;

/** O dia da semana e os minutos desde 00:00, no fuso do consultório. */
export type AgoraNoFuso = { dia: DiaDaSemana; minutos: number };

export function agoraNoFuso(agora: Date, fuso: string): AgoraNoFuso {
  return { dia: diaDaSemanaNoFuso(agora, fuso), minutos: partesNoFuso(agora, fuso).minutos };
}

const HHMM = /^\d{2}:\d{2}$/;
const minutosDe = (horario: string) => {
  const [h, m] = horario.split(':').map(Number);
  return h * 60 + m;
};

/**
 * RN-247 (d): a primeira refeição COM HORÁRIO de hoje a partir de agora (na hora ainda é a próxima); depois da última, a
 * primeira do próximo dia que tenha refeição — "Próxima: amanhã às {hh:mm}" ou "Próxima: {dia abreviado} às {hh:mm}" (até
 * o mesmo dia da semana seguinte). Sem refeição com horário, null.
 */
export function proximaRefeicao(refeicoes: readonly { id: string; horario: string; dias: readonly number[] }[], agora: AgoraNoFuso): { id: string; texto: string } | null {
  const ordem = refeicoes.filter((r) => HHMM.test(r.horario)).sort((a, b) => a.horario.localeCompare(b.horario));
  for (let n = 0; n <= 7; n++) {
    const dia = ((agora.dia + n) % 7) as DiaDaSemana;
    const r = ordem.find((x) => x.dias.includes(dia) && (n > 0 || minutosDe(x.horario) >= agora.minutos));
    if (!r) continue;
    if (n === 0) return { id: r.id, texto: MSG_PLANO_DIAS.proximaHoje(daquiA(minutosDe(r.horario) - agora.minutos)) };
    return { id: r.id, texto: n === 1 ? MSG_PLANO_DIAS.proximaAmanha(r.horario) : MSG_PLANO_DIAS.proximaNoDia(DIA_CURTO[dia], r.horario) };
  }
  return null;
}

/** O perfil de dia (RN-246) em que o dia está; dia sem refeição → undefined. */
export function perfilDoDia<P extends { dias: readonly number[] }>(perfis: readonly P[], dia: DiaDaSemana): P | undefined {
  return perfis.find((p) => p.dias.includes(dia));
}

/** "Com um perfil só, nada muda na tela" (RN-247 c): todas as refeições valem nos 7 dias. */
export const umPerfilSo = (perfis: readonly { dias: readonly number[] }[]): boolean => perfis.length === 1 && perfis[0].dias.length === 7;
