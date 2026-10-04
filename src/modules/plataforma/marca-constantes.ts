/**
 * PF-B1/F8: constantes sem nenhum import, para que componentes `'use client'` (formulários de
 * perfil e logo) possam importá-las sem puxar `marca.ts`/`logo.ts`/`contas.ts` — que trazem
 * pg, pg-boss e sharp para o bundle do navegador.
 */

// D23 (Plano 08): a cor do design e do themeColor do PWA (6,36:1 com branco)
export const COR_PADRAO = '#1d6b5a';

export const LOGO_MAX_BYTES = 2 * 1024 * 1024; // US-005: ≤ 2 MB
export const LOGO_LADO_MAX = 512;
export const MSG_LOGO_GRANDE = 'O logo pode ter no máximo 2 MB.';

/** Fusos do Brasil (RN-06): os da tela e os únicos que o servidor aceita em `tenants.fuso` (perfilSchema, marca.ts). */
export const FUSOS_BRASIL = [
  'America/Sao_Paulo', 'America/Bahia', 'America/Fortaleza', 'America/Recife', 'America/Maceio', 'America/Belem',
  'America/Araguaina', 'America/Santarem', 'America/Manaus', 'America/Cuiaba', 'America/Campo_Grande',
  'America/Porto_Velho', 'America/Boa_Vista', 'America/Rio_Branco', 'America/Noronha',
] as const;
