import type { UsoIA } from './constantes';

/**
 * Plano 14B (F2 do parecer JUR-2026-013, item 3.2 (ii); spec §5.4, RN-115, RN-120; D8): o CONTRATO do que sai para a IA
 * no resumo e no rascunho. A montagem (resumo-dados.ts, rascunho-dados.ts) devolve um objeto cujas chaves de topo são
 * exatamente estas categorias; o teste campos-enviados.test.ts confere a montagem contra este contrato, e o
 * textos-legais.test.ts confere que cada categoria tem a sua frase no texto da autorização. Mudou o que sai → muda aqui →
 * o texto tem de mudar → versão nova da autorização (RN-109). Plano 15: `perguntas` é só da conversa da IA Nutri
 * (CATEGORIAS_DA_IA_NUTRI, abaixo), cujo texto é o do consentimento — mudou o que sai nela → versão nova do consentimento.
 */
export const CATEGORIAS = ['idade', 'sexo', 'medidas', 'gasto', 'exames', 'anamnese', 'orientacoes', 'plano', 'diario', 'notas', 'metas', 'perguntas'] as const;
export type Categoria = (typeof CATEGORIAS)[number];

export const CATEGORIAS_POR_USO: Record<Exclude<UsoIA, 'leitura_laudos'>, readonly Categoria[]> = {
  resumo_historico: ['idade', 'sexo', 'medidas', 'gasto', 'exames', 'anamnese', 'orientacoes', 'plano', 'diario', 'notas'],
  rascunho_plano: ['idade', 'sexo', 'anamnese', 'metas'],
};

/**
 * Plano 15 (§7.3): o que sai na conversa da IA Nutri. Separado de CATEGORIAS_POR_USO: `conversa_paciente` não é UsoIA (a
 * autorização da 14A não muda) e a frase de cada categoria está no texto do CONSENTIMENTO da IA Nutri, não na autorização
 * 1.1. A montagem do contexto (nutri-paciente/contexto.ts) devolve um objeto com exatamente estas chaves de topo.
 */
export const CATEGORIAS_DA_IA_NUTRI = ['plano', 'orientacoes', 'perguntas'] as const satisfies readonly Categoria[];
/** A frase de cada categoria no "O que é enviado" do consentimento da IA Nutri (textos-legais.ts); o teste confere só ali. */
export const FRASE_DA_CATEGORIA_IA_NUTRI: Record<(typeof CATEGORIAS_DA_IA_NUTRI)[number], string> = {
  plano: 'o seu plano publicado',
  orientacoes: 'as orientações dos últimos atendimentos',
  perguntas: 'o que você escrever nas perguntas',
};

/**
 * A frase de cada categoria no texto da autorização 1.1 — na lista do parágrafo "O que é enviado" (entre "No resumo e no
 * rascunho" e "O seu nome, e-mail"), no trecho comum ou no do próprio uso; o textos-legais.test.ts confere só ali.
 */
export const FRASE_DA_CATEGORIA: Record<Categoria, string> = {
  idade: 'a sua idade',
  sexo: 'o seu sexo',
  medidas: 'medidas',
  gasto: 'cálculos de gasto energético',
  exames: 'exames',
  anamnese: 'anamnese',
  orientacoes: 'orientações',
  plano: 'plano',
  diario: 'diário alimentar sem as fotos',
  notas: 'as anotações dela',
  metas: 'as metas, as restrições e as preferências que a nutricionista informar',
  // Plano 15: só da IA Nutri (o Record exige); não aparece no texto 1.1, que só lista as categorias dos usos da 14B
  perguntas: FRASE_DA_CATEGORIA_IA_NUTRI.perguntas,
};
