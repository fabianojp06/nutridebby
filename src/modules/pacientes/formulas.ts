import { arredondar } from '@/lib/numero';

/**
 * Apêndice A da spec (validar com a nutricionista, P-08). Funções puras: o servidor calcula o que
 * grava; o navegador usa as mesmas para a prévia ao vivo. Unidades: kg, cm, anos, mm.
 */
export type Sexo = 'F' | 'M';
export type Protocolo = 'jp3' | 'jp7';

export const DOBRAS = [
  { id: 'peitoral', rotulo: 'Peitoral' },
  { id: 'axilar_media', rotulo: 'Axilar média' },
  { id: 'triceps', rotulo: 'Tríceps' },
  { id: 'subescapular', rotulo: 'Subescapular' },
  { id: 'abdominal', rotulo: 'Abdominal' },
  { id: 'suprailiaca', rotulo: 'Supra-ilíaca' },
  { id: 'coxa', rotulo: 'Coxa' },
] as const;
export type DobraId = (typeof DOBRAS)[number]['id'];

const JP3: Record<Sexo, DobraId[]> = { M: ['peitoral', 'abdominal', 'coxa'], F: ['triceps', 'suprailiaca', 'coxa'] };

export function dobrasDoProtocolo(p: Protocolo, sexo: Sexo): DobraId[] {
  return p === 'jp3' ? JP3[sexo] : DOBRAS.map((d) => d.id);
}

/** IMC = P / (A/100)². */
export function imc(pesoKg: number, alturaCm: number): number {
  const m = alturaCm / 100;
  return pesoKg / (m * m);
}

// D = a − b·S + c·S² − d·I
const COEF_JP: Record<Protocolo, Record<Sexo, readonly [number, number, number, number]>> = {
  jp3: { M: [1.10938, 0.0008267, 0.0000016, 0.0002574], F: [1.0994921, 0.0009929, 0.0000023, 0.0001392] },
  jp7: { M: [1.112, 0.00043499, 0.00000055, 0.00028826], F: [1.097, 0.00046971, 0.00000056, 0.00012828] },
};

export function densidadeJP(p: Protocolo, sexo: Sexo, somaMm: number, idade: number): number {
  const [a, b, c, d] = COEF_JP[p][sexo];
  return a - b * somaMm + c * somaMm * somaMm - d * idade;
}

/** Siri: %G = 495 / D − 450. */
export const siri = (densidade: number): number => 495 / densidade - 450;

export type ResultadoGordura = { ok: true; densidade: number; percGordura: number } | { ok: false; faltando: DobraId[] };

/**
 * %G do protocolo. Faltando dobra, não calcula (US-013 "Dobra faltando"). A densidade gravada tem 5
 * casas e o %G 2, mas o %G sai da densidade SEM arredondar (arredondar antes muda a 2ª casa).
 */
export function calcularGordura(p: Protocolo, sexo: Sexo, idade: number, dobras: Partial<Record<DobraId, number | null>>): ResultadoGordura {
  const necessarias = dobrasDoProtocolo(p, sexo);
  const faltando = necessarias.filter((d) => typeof dobras[d] !== 'number');
  if (faltando.length) return { ok: false, faltando };
  const soma = necessarias.reduce((s, d) => s + (dobras[d] as number), 0);
  const densidade = densidadeJP(p, sexo, soma, idade);
  return { ok: true, densidade: arredondar(densidade, 5), percGordura: arredondar(siri(densidade), 2) };
}

export type FormulaTmb = 'harris_benedict' | 'mifflin' | 'fao_oms';
export const FORMULAS_TMB: readonly { id: FormulaTmb; nome: string }[] = [
  { id: 'harris_benedict', nome: 'Harris-Benedict' },
  { id: 'mifflin', nome: 'Mifflin-St Jeor' },
  { id: 'fao_oms', nome: 'FAO/OMS' },
];
export type DadosTmb = { sexo: Sexo; pesoKg: number; alturaCm: number; idade: number };

/** TMB em kcal, sem arredondar (RN-14 arredonda só na exibição, com `kcal`). */
export function tmb(f: FormulaTmb, d: DadosTmb): number {
  const { sexo, pesoKg: P, alturaCm: A, idade: I } = d;
  switch (f) {
    case 'harris_benedict':
      return sexo === 'M' ? 66.47 + 13.75 * P + 5.003 * A - 6.755 * I : 655.1 + 9.563 * P + 1.85 * A - 4.676 * I;
    case 'mifflin':
      return 10 * P + 6.25 * A - 5 * I + (sexo === 'M' ? 5 : -161);
    case 'fao_oms':
      if (I < 18) throw new RangeError('FAO/OMS não se aplica a menores de 18 anos (RN-17)');
      if (I < 30) return sexo === 'M' ? 15.3 * P + 679 : 14.7 * P + 496;
      if (I < 60) return sexo === 'M' ? 11.6 * P + 879 : 8.7 * P + 829;
      return sexo === 'M' ? 13.5 * P + 487 : 10.5 * P + 596;
  }
}

export const FATOR_MIN = 1;
export const FATOR_MAX = 2.5;

/**
 * GET = TMB × fator (com a TMB sem arredondar), limpo do erro de ponto flutuante em 6 casas:
 * 1302,5 × 1,40 dá 1823,4999999999998 em JS, e o meio para cima (RN-14) sairia 1823 em vez de 1824.
 */
export const gastoTotal = (tmbKcal: number, fator: number): number => arredondar(tmbKcal * fator, 6);

/** RN-14: kcal inteiros, meio para cima — depois de limpar o resíduo de ponto flutuante (6 casas). */
export const kcal = (v: number): number => arredondar(arredondar(v, 6), 0);

export function compararTmb(d: DadosTmb): Record<FormulaTmb, number> {
  return { harris_benedict: tmb('harris_benedict', d), mifflin: tmb('mifflin', d), fao_oms: tmb('fao_oms', d) };
}
