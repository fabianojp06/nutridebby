/**
 * RN-250 (Plano 19, US-237): o tipo de "Minhas refeições", na ordem do dia. Sem imports `@/`: o schema do Drizzle
 * (`src/db/schema/biblioteca-plano.ts`) importa daqui com caminho relativo para o CHECK `refeicoes_modelo_tipo_valido`.
 */
export const TIPOS_DE_REFEICAO = ['Café da manhã', 'Lanche da manhã', 'Almoço', 'Lanche da tarde', 'Jantar', 'Ceia', 'Outra'] as const;

export type TipoDeRefeicao = (typeof TIPOS_DE_REFEICAO)[number];
