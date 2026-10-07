import type { SerieMarcador } from '@/modules/pacientes/exames';

/**
 * RN-113 / D15 ★: grupos de nomes do mesmo marcador. Lista inicial a ser REVISADA PELA DEBBY antes do uso real (como o
 * manual guiado). Nunca é enviada à IA: o sistema compara depois da leitura.
 */
export const SINONIMOS: readonly (readonly string[])[] = [
  ['glicemia de jejum', 'glicose de jejum', 'glicose em jejum', 'glicemia em jejum', 'glicose jejum'],
  ['hemoglobina glicada', 'hemoglobina glicosilada', 'hba1c', 'a1c', 'hb a1c'],
  ['ast', 'tgo', 'aspartato aminotransferase', 'transaminase oxalacetica'],
  ['alt', 'tgp', 'alanina aminotransferase', 'transaminase piruvica'],
  ['colesterol hdl', 'hdl colesterol', 'hdl', 'hdl c'],
  ['colesterol ldl', 'ldl colesterol', 'ldl', 'ldl c'],
  ['colesterol nao hdl', 'nao hdl colesterol', 'nao hdl'],
  ['tsh', 'hormonio tireoestimulante', 'tireotrofina'],
  ['t4 livre', 't4l', 'tiroxina livre'],
  ['vitamina d', '25 oh vitamina d', '25 hidroxivitamina d', 'vitamina d 25 hidroxi', 'vitamina d3'],
  ['vitamina b12', 'cobalamina', 'cianocobalamina'],
  ['ggt', 'gama gt', 'gama glutamil transferase'],
  ['pcr', 'proteina c reativa', 'pcr ultrassensivel', 'proteina c reativa ultrassensivel'],
  ['triglicerides', 'triglicerideos', 'triglicerides totais'],
];

export function normalizarNome(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
const normUnidade = (u: string | null) => (u ?? '').normalize('NFC').trim().toLowerCase();

function mesmoMarcador(a: string, b: string): boolean {
  if (a === b) return true;
  return SINONIMOS.some((g) => g.includes(a) && g.includes(b));
}

/**
 * Nome da série existente do paciente para o nome lido, ou null se não há o que ajustar. Só ajusta com a mesma unidade
 * (ou uma das duas vazia): glicose em mg/dL e em mmol/L são séries diferentes (agruparMarcadores).
 */
export function nomeDaSerie(nomeLido: string, unidadeLida: string | null, series: readonly SerieMarcador[]): string | null {
  const n = normalizarNome(nomeLido);
  for (const s of series) {
    const unidadeBate = !s.unidade || !unidadeLida || normUnidade(s.unidade) === normUnidade(unidadeLida);
    if (unidadeBate && mesmoMarcador(n, normalizarNome(s.nome))) return s.nome.trim() === nomeLido.trim() ? null : s.nome;
  }
  return null;
}

/** "Já lançado neste exame": mesmo marcador, mesmo valor e mesma unidade. */
export function jaLancado(
  valores: readonly { nome: string; valor: number; unidade: string | null }[],
  nome: string,
  valor: number,
  unidade: string | null,
): boolean {
  const n = normalizarNome(nome);
  return valores.some((v) => normalizarNome(v.nome) === n && v.valor === valor && normUnidade(v.unidade) === normUnidade(unidade));
}
