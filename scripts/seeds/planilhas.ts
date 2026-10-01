import * as XLSX from 'xlsx';

/** Linhas de uma aba como matriz de textos (os números saem como o Excel mostra: "2.5", "Tr", "NA"). */
export function lerAba(conteudo: Buffer, aba: string): string[][] {
  const wb = XLSX.read(conteudo);
  const sheet = wb.Sheets[aba];
  if (!sheet) throw new Error(`Aba não encontrada: ${aba}`);
  return XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: '' });
}
