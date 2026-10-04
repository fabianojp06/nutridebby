import type { EstadoGuia, ProgressoGuia } from '@/modules/plataforma/preferencias-tipos';

/** P08-10 (D26): o manual guiado. Texto RASCUNHO até o dono e a Debby aprovarem (P08-08); espelhado na spec (US-057). */
export type Passo = { alvo?: string; titulo: string; texto: string };
export type Guia = {
  id: string;
  /** Sobe quando o texto muda de verdade: o aviso "Primeira vez aqui?" volta a aparecer (D27). */
  versao: number;
  /** Caminhos em que o guia vale (o primeiro guia da lista que casar). */
  padrao: RegExp;
  titulo: string;
  ajuda: { resumo: string; secoes: { titulo: string; itens: string[] }[] };
  passos: Passo[];
};

export const ID_BOAS_VINDAS = 'boas-vindas';

export const GUIAS: readonly Guia[] = [
  {
    id: ID_BOAS_VINDAS,
    versao: 1,
    padrao: /^\/painel$/,
    titulo: 'Início',
    ajuda: {
      resumo: 'O Início mostra o seu dia: a próxima consulta, a agenda de hoje, os diários novos e como os pacientes estão usando o app.',
      secoes: [{ titulo: 'O que dá para fazer aqui', itens: ['Abrir o prontuário do próximo paciente.', 'Ver os diários que ainda não foram vistos.', 'Acompanhar os pedidos de dados e de exclusão dos pacientes.'] }],
    },
    passos: [
      { titulo: 'Boas-vindas ao NutriDebby', texto: 'Um passeio rápido pelo painel. Você pode pular agora e rever depois no menu da sua conta.' },
      { alvo: 'menu', titulo: 'Menu do painel', texto: 'Pacientes, Agenda, Diários, Conteúdos e Configurações ficam sempre aqui no topo.' },
    ],
  },
  {
    id: 'agenda',
    versao: 1,
    padrao: /^\/painel\/agenda(\/(nova|pendencias|consultas\/.+))?$/,
    titulo: 'Agenda',
    ajuda: { resumo: 'A agenda do dia e da semana, com as consultas marcadas por você e pelos pacientes.', secoes: [] },
    passos: [{ alvo: 'menu', titulo: 'Agenda', texto: 'Escolha o dia ou a semana e abra uma consulta para confirmar, remarcar ou registrar a presença.' }],
  },
];

export function guiaDaRota(caminho: string): Guia | null {
  return GUIAS.find((g) => g.padrao.test(caminho)) ?? null;
}

/** true = ainda não está em nenhum dos `estados` na versão atual. */
export function precisaDoGuia(p: ProgressoGuia, g: Guia, estados: EstadoGuia[]): boolean {
  const r = p[g.id];
  return !r || r.v < g.versao || !estados.includes(r.estado);
}
