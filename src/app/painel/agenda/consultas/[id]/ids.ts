/**
 * Ids da tela da consulta que recebem o foco depois das ações da seção "Cobrança" (spec §7: região fixa + foco no
 * título). Módulo puro: a página (servidor) e a seção (cliente) usam o mesmo texto — um valor exportado de um módulo
 * `'use client'` chega ao servidor como referência de cliente, não como o texto.
 */
export const ID_COBRANCA = 'cobranca';
export const ID_TITULO_CONSULTA = 'titulo-consulta';
/** O h2 "Cobrança"; se a seção saiu (cancelou a cobrança de uma consulta "Faltou"), o h1 da consulta. */
export const ALVOS_DA_COBRANCA = [ID_COBRANCA, ID_TITULO_CONSULTA] as const;
