import { NUTRIENTES, type ChaveNutriente } from '@/modules/alimentos/nutrientes';

/**
 * US-231: os campos de micronutrientes do formulário do "Meu alimento" — um por chave do catálogo, `name` = `micros.<chave>`
 * (a mesma chave do erro que `criarAlimento`/`editarAlimento` devolvem). Sem 'use client' nem servidor: o formulário, as
 * páginas e as actions importam daqui.
 */
export const nomeDoCampoMicro = (chave: ChaveNutriente) => `micros.${chave}` as const;

/** Os micros gravados como o formulário mostra: vírgula decimal, sem arredondar (o valor é o que ela digitou). */
export function valoresDosMicros(micros: Partial<Record<ChaveNutriente, number>>): Record<string, string> {
  return Object.fromEntries(Object.entries(micros).map(([k, v]) => [nomeDoCampoMicro(k as ChaveNutriente), String(v).replace('.', ',')]));
}

/** O que o formulário mandou, por chave (campo ausente = nulo = sem valor). */
export function microsDoFormulario(fd: FormData): Record<ChaveNutriente, FormDataEntryValue | null> {
  return Object.fromEntries(NUTRIENTES.map((n) => [n.chave, fd.get(nomeDoCampoMicro(n.chave))])) as Record<ChaveNutriente, FormDataEntryValue | null>;
}
