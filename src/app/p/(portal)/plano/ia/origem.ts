/**
 * US-171: de onde o paciente veio para a tela de decisão da IA Nutri (`/p/plano/ia/autorizar?de=…`). Lista fechada: o
 * "Agora não" e o "Voltar" levam só a estes endereços — nunca a uma URL vinda da busca; outro valor → `plano`.
 */
export const ORIGENS_IA_NUTRI = {
  plano: { href: '/p/plano', secao: 'Plano' },
  refeicao: { href: '/p/plano', secao: 'Plano' },
  hoje: { href: '/p/inicio', secao: 'Hoje' },
  eu: { href: '/p/perfil#eu-ia-nutri', secao: 'Eu' },
} as const;
export type OrigemIaNutri = keyof typeof ORIGENS_IA_NUTRI;

export const origemIaNutri = (v: unknown): OrigemIaNutri =>
  typeof v === 'string' && Object.hasOwn(ORIGENS_IA_NUTRI, v) ? (v as OrigemIaNutri) : 'plano';
