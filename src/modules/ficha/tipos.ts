import type { Tx } from '@/db/client';
import type { PatientRow, TenantRow } from '@/db/schema';

/**
 * Plano 18 (D14, RN-277): contrato do registro de seções do Início da ficha. Cada seção é um arquivo em `secoes/` e uma
 * linha no fim de `SECOES_DA_FICHA` (`secoes/index.ts`); os outros planos (o Financeiro do Plano 20) penduram as suas assim.
 * Uma seção devolve só contador e rótulos genéricos (sem conteúdo clínico: nem o nome do modelo da anamnese, nem o do
 * exame), e o arquivo dela nunca chama `auditRead` — quem grava a leitura de uma seção com `leitura` é `inicio.ts`.
 */

/** `href`: relativo à ficha (`atendimentos/{id}`, sem `/` inicial) ou absoluto dentro do painel (`/painel/...`). */
export type ItemDaSecao = { id: string; rotulo: string; data: string /* AAAA-MM-DD no fuso */; situacao?: string; noApp: boolean; href: string };

/** No máximo 3 itens, os mais recentes primeiro. */
export type ResumoDaSecao = { total: number; ultimos: ItemDaSecao[] };

declare const marca: unique symbol;
/**
 * A transação do contexto de paciente sem login que conta o "No app" (D16, RN-281). Tipo marcado: só `no-app.ts` cria
 * (Tarefa 9), depois de conferir `current_setting('app.role') = 'paciente'` na própria transação.
 */
export type TxDePaciente = Tx & { readonly [marca]: 'paciente' };

/** Ações do Adicionar que não são link: as mesmas Server Actions dos botões da aba Documentos (RN-280). */
export type ChaveDeAcao = 'criar-receita' | 'criar-parecer';

/** `href` relativo à ficha (sem `/` inicial) ou absoluto em `/painel/`. */
export type DestinoDoAdicionar = { href: string } | { acao: ChaveDeAcao };

/** 'outros' só aparece no diálogo se alguma seção o usar (o Financeiro do Plano 20). */
export type GrupoDoAdicionar = 'avaliacoes' | 'prescricoes' | 'outros';

export type TenantDaSecao = Pick<TenantRow, 'fuso' | 'documentosLiberados' | 'examesPacienteAtivadoEm'>;
export type PacienteDaSecao = Pick<PatientRow, 'id' | 'status' | 'anonimizadoEm'>;

export type EntradaDoAdicionar = { grupo: GrupoDoAdicionar; rotulo: string; destino: DestinoDoAdicionar };

export type SecaoDaFicha = {
  id: string;
  titulo: string;
  /** Segmento da aba do "Ver todos" ('' = Início), quando não há `verTodos`. */
  aba: string;
  /** "Ver todos" fora da ficha: caminho absoluto em /painel/ (ex.: Financeiro, Plano 20). */
  verTodos?: (patientId: string) => string;
  /**
   * `total` só para a RN-192 (envios do paciente). Tem de ser monótona no `total`: se o total cresce, nunca passa de true a
   * false — `inicio.ts` chama `disponivel(t, p, Number.POSITIVE_INFINITY)` antes de consultar, para pular a seção que não aparece com
   * nenhum total, e só depois confere com o total real.
   */
  disponivel(t: TenantDaSecao, p: PacienteDaSecao, total: number): boolean;
  /**
   * Contador e os 3 últimos, numa consulta. `podeAdicionar: false` esconde o `adicionar` desta seção (ex.: Financeiro não
   * configurado, Plano 20); padrão true.
   */
  resumo(tx: Tx, patientId: string, fuso: string): Promise<{ total: number; ultimos: Omit<ItemDaSecao, 'noApp'>[]; podeAdicionar?: boolean }>;
  /**
   * Seção que devolve dado auditado (Plano 20): `inicio.ts` grava UM auditRead desta entidade, na mesma transação, só com
   * itens. O arquivo da seção nunca chama auditRead.
   */
  leitura?: { entidade: string };
  /** Lista: Documentos tem Receita e Parecer nutricional. */
  adicionar?: readonly EntradaDoAdicionar[];
  /** O que o paciente vê no app, contado no contexto de paciente (Tarefa 9). */
  noApp?: {
    contar(tx: TxDePaciente, patientId: string): Promise<number>;
    visiveis(tx: TxDePaciente, patientId: string, ids: string[]): Promise<string[]>;
  };
};
