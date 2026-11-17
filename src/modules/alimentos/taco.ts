import { FONTES } from './fontes';
import { GRUPOS_TACO } from './grupos';

/** INT-04: de onde vem o seed e para onde vai. O teste taco-fonte confere o sha256 e refaz CSV e migration. */
export const TACO_FONTE = {
  arquivo: 'seeds/fontes/Taco_4a_edicao_2011.xls',
  sha256: 'b7369a767b14bfe06ff9973957c140b266f9bb7932f870481ef2d99ba0a15ace',
  aba: 'CMVCol taco3',
  csv: 'seeds/taco-4ed.csv',
  migration: 'drizzle/0039_seed_taco.sql',
} as const;

/** Citação obrigatória (tela de alimentos e rodapé do PDF). Plano 19 (RN-233): mora em `FONTES.taco`; fica aqui para quem já importa. */
export const FONTE_TACO_TEXTO = FONTES.taco.citacao;

/** Coluna de cada nutriente na aba "CMVCol taco3" (0 = número, 1 = nome, 13 = número repetido). */
const COL_MACRO = { kcal: 3, proteinaG: 5, lipidioG: 6, carboidratoG: 8, fibraG: 9 } as const;
const COL_MICRO = {
  umidade_pct: 2, colesterol_mg: 7, cinzas_g: 10, calcio_mg: 11, magnesio_mg: 12, manganes_mg: 14, fosforo_mg: 15,
  ferro_mg: 16, sodio_mg: 17, potassio_mg: 18, cobre_mg: 19, zinco_mg: 20, retinol_mcg: 21, re_mcg: 22, rae_mcg: 23,
  tiamina_mg: 24, riboflavina_mg: 25, piridoxina_mg: 26, niacina_mg: 27, vitamina_c_mg: 28,
} as const;

export type CampoMicro = keyof typeof COL_MICRO;
export const CAMPOS_MICRO = Object.keys(COL_MICRO) as CampoMicro[];

/** Erros de digitação conhecidos da planilha original (conferidos no PDF da TACO). */
const CORRECOES: Record<number, Partial<Record<number, string>>> = {
  373: { 26: '0.02' }, // piridoxina digitada como ",0,02"
};

export type RegistroTaco = {
  tacoId: number;
  nome: string;
  grupo: string;
  kcal: number | null;
  proteinaG: number | null;
  carboidratoG: number | null;
  lipidioG: number | null;
  fibraG: number | null;
  micros: Record<CampoMicro, number | null>;
};

/** D2: mesmo id em todo ambiente. 3 → 00000000-0000-4000-8000-000000000003 */
export const idTaco = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const texto = (c: unknown) => String(c ?? '').trim();

/** D4: "Tr" (traço) → 0; "NA" (não aplicável), "*" (em reavaliação) e vazio → null. */
function valor(c: unknown, tacoId: number, col: number): number | null {
  const s = texto(c);
  if (s === 'Tr') return 0;
  if (s === '' || s === 'NA' || s === '*') return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`Valor inesperado na TACO: alimento ${tacoId}, coluna ${col}`);
  return Number(s);
}

/** Linhas da aba (sheet_to_json com header: 1, raw: false) → registros, na ordem da planilha. */
export function converterTaco(linhas: readonly (readonly unknown[])[]): RegistroTaco[] {
  const out: RegistroTaco[] = [];
  let grupo: string | null = null;
  for (const l of linhas) {
    const a = texto(l[0]);
    if (a === 'Legenda') break;
    if (/^\d+$/.test(a)) {
      const tacoId = Number(a);
      if (!grupo) throw new Error(`Alimento ${tacoId} antes de qualquer grupo`);
      const corr = CORRECOES[tacoId] ?? {};
      const v = (col: number) => valor(corr[col] ?? l[col], tacoId, col);
      const micros = Object.fromEntries(CAMPOS_MICRO.map((k) => [k, v(COL_MICRO[k])])) as RegistroTaco['micros'];
      out.push({
        tacoId,
        nome: texto(l[1]).replace(/\s+/g, ' '),
        grupo,
        kcal: v(COL_MACRO.kcal),
        proteinaG: v(COL_MACRO.proteinaG),
        carboidratoG: v(COL_MACRO.carboidratoG),
        lipidioG: v(COL_MACRO.lipidioG),
        fibraG: v(COL_MACRO.fibraG),
        micros,
      });
    } else if (a && l.slice(1).every((c) => texto(c) === '')) {
      if (!(GRUPOS_TACO as readonly string[]).includes(a)) throw new Error(`Grupo desconhecido na TACO: ${a}`);
      grupo = a;
    }
  }
  return out;
}

const num = (n: number | null) => (n === null ? '' : String(n));
const csvCampo = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** CSV legível (ponto decimal, vazio = sem valor). Gerado; o teste compara com seeds/taco-4ed.csv. */
export function paraCsvTaco(registros: RegistroTaco[]): string {
  const cab = ['taco_id', 'nome', 'grupo', 'kcal', 'proteina_g', 'carboidrato_g', 'lipidio_g', 'fibra_g', ...CAMPOS_MICRO];
  const linhas = registros.map((r) =>
    [String(r.tacoId), csvCampo(r.nome), csvCampo(r.grupo), num(r.kcal), num(r.proteinaG), num(r.carboidratoG), num(r.lipidioG), num(r.fibraG), ...CAMPOS_MICRO.map((k) => num(r.micros[k]))].join(','),
  );
  return `${[cab.join(','), ...linhas].join('\n')}\n`;
}

const sqlTexto = (s: string) => `'${s.replace(/'/g, "''")}'`;
const sqlNum = (n: number | null) => (n === null ? 'NULL' : String(n));

/** Migration de seed (D3): INSERTs de 100 em 100, separados pelo marcador do migrator do Drizzle. */
export function sqlSeedTaco(registros: RegistroTaco[]): string {
  const cab = '-- Gerado por `pnpm seed:taco` a partir de seeds/fontes/Taco_4a_edicao_2011.xls (TACO 4ª ed., NEPA/UNICAMP). Não editar.\n';
  const blocos: string[] = [];
  for (let i = 0; i < registros.length; i += 100) {
    const valores = registros.slice(i, i + 100).map(
      (r) =>
        `(${sqlTexto(idTaco(r.tacoId))}, ${r.tacoId}, ${sqlTexto(r.nome)}, ${sqlTexto(r.grupo)}, ${sqlNum(r.kcal)}, ${sqlNum(r.proteinaG)}, ${sqlNum(r.carboidratoG)}, ${sqlNum(r.lipidioG)}, ${sqlNum(r.fibraG)}, ${sqlTexto(JSON.stringify(r.micros))})`,
    );
    blocos.push(
      `INSERT INTO "foods" ("id", "taco_id", "nome", "grupo", "kcal", "proteina_g", "carboidrato_g", "lipidio_g", "fibra_g", "micros") VALUES\n${valores.join(',\n')};`,
    );
  }
  return `${cab}${blocos.join('\n--> statement-breakpoint\n')}\n`;
}
