import { diaDaSemana, partesNoFuso } from '@/modules/agenda/fuso';

/**
 * Plano 19 (RN-246, D28): o único lugar de `DiaDaSemana` e dos rótulos de dias; os lembretes do Plano 17 passam a
 * importar daqui. Sem banco nem React: o editor (cliente), o servidor, o PDF e o portal usam as mesmas regras.
 */
export type DiaDaSemana = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = domingo

/** A ordem de toda lista de dias: seg…dom. */
export const ORDEM_DIAS: readonly DiaDaSemana[] = [1, 2, 3, 4, 5, 6, 0];
/** Os 7 dias na convenção do banco (`meals.dias_semana`, padrão `{0,…,6}`). */
export const TODOS_OS_DIAS: readonly DiaDaSemana[] = [0, 1, 2, 3, 4, 5, 6];

export const DIA_CURTO: Record<DiaDaSemana, string> = { 0: 'dom', 1: 'seg', 2: 'ter', 3: 'qua', 4: 'qui', 5: 'sex', 6: 'sáb' };
export const DIA_EXTENSO: Record<DiaDaSemana, string> = { 0: 'Domingo', 1: 'Segunda', 2: 'Terça', 3: 'Quarta', 4: 'Quinta', 5: 'Sexta', 6: 'Sábado' };

/** "a", "a e b", "a, b e c". */
const emLista = (nomes: string[]): string => (nomes.length <= 1 ? (nomes[0] ?? '') : `${nomes.slice(0, -1).join(', ')} e ${nomes.at(-1)}`);

const presentes = (dias: readonly DiaDaSemana[]): DiaDaSemana[] => ORDEM_DIAS.filter((d) => dias.includes(d));
const ehSegASex = (p: DiaDaSemana[]): boolean => p.length === 5 && p.every((d) => d >= 1 && d <= 5);

/** Cartões e legenda do editor: "todos os dias", "seg a sex", "sáb e dom" ou "seg, qua e sex" (as saídas do Plano 17). */
export function rotuloDosDias(dias: readonly DiaDaSemana[]): string {
  const p = presentes(dias);
  if (p.length === 7) return 'todos os dias';
  if (ehSegASex(p)) return 'seg a sex';
  return emLista(p.map((d) => DIA_CURTO[d]));
}

/** Títulos de perfil no PDF e no portal: "Todos os dias", "Segunda a sexta", "Sábado e domingo", "Segunda, quarta e sexta". */
export function rotuloDosDiasPorExtenso(dias: readonly DiaDaSemana[]): string {
  const p = presentes(dias);
  if (p.length === 7) return 'Todos os dias';
  if (ehSegASex(p)) return 'Segunda a sexta';
  return emLista(p.map((d, i) => (i === 0 ? DIA_EXTENSO[d] : DIA_EXTENSO[d].toLowerCase())));
}

/** O dia de hoje no fuso do consultório (`tenants.fuso`), com os helpers da agenda (os mesmos dos lembretes). */
export function diaDaSemanaNoFuso(agora: Date, fuso: string): DiaDaSemana {
  return diaDaSemana(partesNoFuso(agora, fuso).data) as DiaDaSemana;
}

export function valeNoDia(r: { diasSemana: readonly number[] }, dia: DiaDaSemana): boolean {
  return r.diasSemana.includes(dia);
}

/** As refeições que valem no dia, na ordem recebida. */
export function refeicoesDoDia<R extends { diasSemana: readonly number[] }>(refeicoes: R[], dia: DiaDaSemana): R[] {
  return refeicoes.filter((r) => valeNoDia(r, dia));
}

export type PerfilDeDia<R> = { dias: DiaDaSemana[]; refeicoes: R[] };

/**
 * RN-246: dias com exatamente o mesmo conjunto de refeições formam um perfil ("Segunda a sexta"). Perfis na ordem do
 * primeiro dia (seg…dom), dias de cada perfil em ordem seg…dom, refeições na ordem recebida. Dia sem refeição fica fora
 * (`diasSemRefeicao`). Todas as refeições nos 7 dias = um perfil só.
 */
export function perfisDeDia<R extends { id: string; diasSemana: readonly number[] }>(refeicoes: R[]): PerfilDeDia<R>[] {
  const perfis = new Map<string, PerfilDeDia<R>>();
  for (const dia of ORDEM_DIAS) {
    const doDia = refeicoesDoDia(refeicoes, dia);
    if (!doDia.length) continue;
    const chave = doDia.map((r) => r.id).join('\n');
    const p = perfis.get(chave);
    if (p) p.dias.push(dia);
    else perfis.set(chave, { dias: [dia], refeicoes: doDia });
  }
  return [...perfis.values()];
}

/** RN-246: dias sem nenhuma refeição (aviso na publicação), em ordem seg…dom. */
export function diasSemRefeicao(refeicoes: { diasSemana: readonly number[] }[]): DiaDaSemana[] {
  return ORDEM_DIAS.filter((d) => !refeicoes.some((r) => valeNoDia(r, d)));
}
