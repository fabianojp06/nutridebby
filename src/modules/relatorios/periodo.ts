import { inicioDoDia, partesNoFuso } from '@/modules/agenda/fuso';
import { nomeDoMes } from '@/modules/financeiro/meses';
import { MESES_MAX, MSG_RELATORIOS } from './constantes';

/**
 * RN-481 (US-486): o período dos Relatórios — meses inteiros 'AAAA-MM' no fuso do consultório, no máximo 12, "De" ≤
 * "Até", sem mês futuro. Puro. O relógio e o calendário do fuso só vêm de `src/modules/agenda/fuso.ts` (C-483: este
 * arquivo importa de lá, não edita nem reexporta). A aritmética de meses é por índice (ano × 12 + mês), sem `Date`.
 */
export type Periodo = { de: string; ate: string; meses: string[] };
export type ErroDoPeriodo = 'ordem' | 'longo' | 'invalido';

const MES = /^(\d{4})-(0[1-9]|1[0-2])$/;
/** Antes disso não há consultório; e um ano de dois dígitos viraria 19xx no `Date.UTC` de `fuso.ts`. */
const ANO_MIN = 2000;

const p2 = (n: number) => String(n).padStart(2, '0');
const indice = (mes: string) => Number(mes.slice(0, 4)) * 12 + Number(mes.slice(5, 7)) - 1;
const doIndice = (i: number) => `${Math.floor(i / 12)}-${p2((i % 12) + 1)}`;

function mesValido(v: string | null): v is string {
  const m = v === null ? null : MES.exec(v);
  return m !== null && Number(m[1]) >= ANO_MIN;
}

function mesesEntre(de: string, ate: string): string[] {
  const inicio = indice(de);
  return Array.from({ length: indice(ate) - inicio + 1 }, (_, i) => doIndice(inicio + i));
}

const periodo = (de: string, ate: string): Periodo => ({ de, ate, meses: mesesEntre(de, ate) });

/** Mês atual no fuso: `hoje` é o dia 'AAAA-MM-DD' já no fuso (`hojeNoFuso`) ou o instante (`new Date()`). */
function mesAtual(hoje: string | Date, fuso: string): string {
  return (typeof hoje === 'string' ? hoje : partesNoFuso(hoje, fuso).data).slice(0, 7);
}

/**
 * Lê `de` e `ate` da URL. Sem erro: o período pedido (campo ausente ou vazio = o do padrão). Com erro: os números são os
 * do **padrão** (o mês atual e os 11 anteriores) e `escolhido` guarda o que veio, para os `<select>` (null quando nem é um
 * mês; a página ainda confere se o mês está nas opções). Mês ilegível ou futuro → `invalido`; "De" depois de "Até" →
 * `ordem`; mais de 12 meses → `longo`.
 */
export function periodoDaUrl(
  sp: URLSearchParams,
  hoje: string | Date,
  fuso: string,
): { periodo: Periodo; erro: ErroDoPeriodo | null; escolhido: { de: string | null; ate: string | null } } {
  const atual = mesAtual(hoje, fuso);
  const padrao = periodo(doIndice(indice(atual) - (MESES_MAX - 1)), atual);
  const lido = (k: string) => {
    const v = sp.get(k);
    return v === null || v === '' ? null : v;
  };
  const brutoDe = lido('de');
  const brutoAte = lido('ate');
  const de = brutoDe ?? padrao.de;
  const ate = brutoAte ?? padrao.ate;

  let erro: ErroDoPeriodo | null = null;
  if (!mesValido(de) || !mesValido(ate) || de > atual || ate > atual) erro = 'invalido';
  else if (de > ate) erro = 'ordem';
  else if (indice(ate) - indice(de) + 1 > MESES_MAX) erro = 'longo';

  if (erro) return { periodo: padrao, erro, escolhido: { de: mesValido(brutoDe) ? brutoDe : null, ate: mesValido(brutoAte) ? brutoAte : null } };
  return { periodo: periodo(de, ate), erro: null, escolhido: { de, ate } };
}

/**
 * RE-D48: as opções dos `<select>` "De" e "Até" — do mais antigo entre o mês do primeiro cadastro do consultório
 * ('AAAA-MM' ou 'AAAA-MM-DD', no fuso) e o mês atual − 11, até o mês atual (`hoje` = 'AAAA-MM-DD' no fuso). O padrão
 * sempre está na lista; mês futuro nunca.
 */
export function opcoesDeMes(primeiroCadastro: string | null, hoje: string): string[] {
  const atual = hoje.slice(0, 7);
  const primeiro = primeiroCadastro?.slice(0, 7) ?? null;
  const inicio = doIndice(Math.min(indice(atual) - (MESES_MAX - 1), mesValido(primeiro) ? indice(primeiro) : Infinity));
  return mesesEntre(inicio, atual);
}

/** Do 1º do mês às 00:00 até o 1º do mês seguinte às 00:00 (exclusivo), no fuso. Mês fora do formato: RangeError. */
export function limitesDoMes(mes: string, fuso: string): { inicio: Date; fim: Date } {
  if (!mesValido(mes)) throw new RangeError('Mês fora do formato AAAA-MM.');
  return { inicio: inicioDoDia(`${mes}-01`, fuso), fim: inicioDoDia(`${doIndice(indice(mes) + 1)}-01`, fuso) };
}

/** "dezembro de 2025". */
export function mesPorExtenso(mes: string): string {
  return `${nomeDoMes(mes)} de ${mes.slice(0, 4)}`;
}

/** "12/2025" (RN-494: meses mm/aaaa no CSV; "Período: {mm/aaaa} a {mm/aaaa}" na impressão). */
export function mesNumerico(mes: string): string {
  return `${mes.slice(5, 7)}/${mes.slice(0, 4)}`;
}

/** "Mostrando dezembro de 2025 a novembro de 2026." (RN-481: o período dos números na tela). */
export function textoMostrando(p: Periodo): string {
  return MSG_RELATORIOS.filtros.mostrando(mesPorExtenso(p.de), mesPorExtenso(p.ate));
}
