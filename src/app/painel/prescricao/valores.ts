import { TIPOS_DO_GRUPO, type GrupoDeItens } from '@/modules/documentos/modelos-textos';

/**
 * Plano 22 (T10b, spec §4.1): o que as telas de /painel/prescricao e as actions dividem, sem import do servidor (os
 * formulários 'use client' também leem daqui).
 */

export const LISTA_DE_ITENS = '/painel/prescricao/itens';
export const LISTA_DE_MODELOS = '/painel/prescricao/modelos';

/** §4.1: `tipo` ausente ou inválido em /painel/prescricao/itens vale `suplementos`. */
export const grupoDaUrl = (tipo: unknown): GrupoDeItens => (tipo === 'fitoterapicos' ? 'fitoterapicos' : 'suplementos');

/** RN-393: o grupo da lista em que um item salvo aparece (a coluna `tipo` decide). */
export const grupoDoTipo = (tipo: unknown): GrupoDeItens => ((TIPOS_DO_GRUPO.fitoterapicos as readonly unknown[]).includes(tipo) ? 'fitoterapicos' : 'suplementos');

/** O JSON de um campo escondido do formulário; o que não for JSON vira `null` (o módulo recusa com as mensagens dele). */
export function lerJson(v: FormDataEntryValue | null): unknown {
  try {
    return JSON.parse(typeof v === 'string' ? v : '');
  } catch {
    return null;
  }
}

export const texto = (v: FormDataEntryValue | null): string => (typeof v === 'string' ? v : '');
