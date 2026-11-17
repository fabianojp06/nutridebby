/**
 * RN-230 (Plano 19): de onde vem o alimento (`foods.fonte`). `taco`, `usda` e `tbca` são tabelas públicas (`tenant_id`
 * nulo, só leitura); `propria` é o "Meu alimento" do consultório. Sem imports `@/`: o schema do Drizzle
 * (`src/db/schema/alimentos.ts`) importa daqui com caminho relativo para o CHECK `foods_fonte_valida`.
 */
export const FONTES_DE_ALIMENTO = ['taco', 'usda', 'tbca', 'propria'] as const;

export type Fonte = (typeof FONTES_DE_ALIMENTO)[number];
export type FontePublica = Exclude<Fonte, 'propria'>;

/**
 * RN-232 (D7): nenhuma linha com `fonte = 'tbca'` entra enquanto for `false` (guarda em `fontes.test.ts` sobre
 * `drizzle/*.sql` e `seeds/`), e o filtro de fonte e o selo não mostram a TBCA (`fontesVisiveis`). A carga vira plano
 * próprio, depois da autorização (carga, conversão, "Duplicar", PDF, exportação e IA).
 */
export const TBCA_AUTORIZADA: boolean = false;

/**
 * Ano da versão do FoodData Central do seed (RN-231): preenchido na Tarefa 12, com o seed. Até lá não há linha `usda`
 * (guarda em `fontes.test.ts`) e a publicação recusa item da USDA (`exigirVersaoDasTabelas`, `publicacao.ts`): a
 * versão congela no plano publicado (RN-237) e "{ano}" ficaria para sempre.
 */
const USDA_ANO = '{ano}';

/** Versão ou citação com marcador ainda não preenchido (`{ano}`, `{data}`). */
export const temMarcador = (texto: string): boolean => /\{[a-z]+\}/.test(texto);

export type DadosDaFonte = {
  selo: string;
  sigla: string;
  /** RN-233: citação no rodapé do PDF e na tela de alimentos. */
  citacao: string;
  /** Versão da tabela, congelada no item na publicação (`fonteVersao`, RN-237). */
  versao: string;
  /** sha256 dos arquivos de origem do seed (INT-04; a TACO tem o seu em `TACO_FONTE`). */
  sha256?: string[];
};

/** RN-233: selo, sigla, citação e versão de cada tabela pública. */
export const FONTES: Record<FontePublica, DadosDaFonte> = {
  taco: { selo: 'TACO', sigla: 'TACO', citacao: 'TACO 4ª ed. — NEPA/UNICAMP', versao: '4ª ed., 2011' },
  usda: {
    selo: 'USDA (EUA)',
    sigla: 'USDA',
    citacao: `U.S. Department of Agriculture, Agricultural Research Service. FoodData Central, ${USDA_ANO}. fdc.nal.usda.gov`,
    versao: `FoodData Central ${USDA_ANO}`,
  },
  tbca: {
    selo: 'TBCA',
    sigla: 'TBCA',
    // RN-232: formato publicado em tbca.net.br (conferido em 16/11/2026); a data de acesso entra com a carga
    citacao:
      'Tabela Brasileira de Composição de Alimentos (TBCA). Universidade de São Paulo (USP). Centro de Pesquisa em Alimentos (FoRC). Versão 7.3. São Paulo, 2025. Disponível em: http://www.fcf.usp.br/tbca. Acesso em: {data}.',
    versao: 'Versão 7.3',
  },
};

const SELO = { taco: 'TACO', usda: 'USDA (EUA)', tbca: 'TBCA', propria: 'Meu alimento' } as const satisfies Record<Fonte, string>;

/** O texto do selo ("TACO", "USDA (EUA)", "TBCA", "Meu alimento"): o `origem` da busca, do item do plano e da receita. */
export type SeloDaFonte = (typeof SELO)[Fonte];

/** RN-230: selo do alimento na busca, no editor e na página do alimento. */
export function seloDaFonte(f: Fonte): SeloDaFonte {
  return SELO[f];
}

/** RN-259: textos da fonte do alimento (§6.1 da spec). */
export const MSG_FONTES = {
  /** US-230: no resultado da busca, em "Ver nutrientes" e na página do alimento da USDA. */
  traduzido: 'Nome traduzido automaticamente do inglês.',
  /** RN-233: no rodapé do PDF do plano, quando há item da USDA (ou "Meu alimento" duplicado da USDA). */
  traduzidoNoPdf: 'Nomes de alimentos da USDA traduzidos do inglês.',
} as const;

/** "Fonte: {citação}." — sem repetir o ponto final quando a citação já termina com um (TBCA). */
export function textoDaCitacao(f: FontePublica): string {
  const c = FONTES[f].citacao;
  return `Fonte: ${c}${c.endsWith('.') ? '' : '.'}`;
}

/** RN-230: "Sem valor na TACO" (RN-02) vira "Sem valor na {sigla}"; no "Meu alimento", "Sem valor". */
export function semValorNa(f: Fonte): string {
  return f === 'propria' ? 'Sem valor' : `Sem valor na ${FONTES[f].sigla}`;
}

/** Fontes que o filtro e a lista de citações mostram, na ordem do catálogo, sem repetir; a TBCA só com autorização. */
export function fontesVisiveis(carregadas: Fonte[]): Fonte[] {
  return FONTES_DE_ALIMENTO.filter((f) => carregadas.includes(f) && (f !== 'tbca' || TBCA_AUTORIZADA));
}
