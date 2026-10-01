/** CSV simples (RFC 4180) dos seeds: cabeçalho na 1ª linha, campos entre aspas podem ter vírgula e "". */
export function lerCsv(texto: string): Record<string, string>[] {
  const linhas: string[][] = [];
  let campo = '';
  let linha: string[] = [];
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ',') {
      linha.push(campo);
      campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = '';
    } else campo += c;
  }
  if (campo || linha.length) linhas.push([...linha, campo]);
  const [cab, ...resto] = linhas.filter((l) => !(l.length === 1 && l[0] === ''));
  return resto.map((l, i) => {
    if (l.length !== cab.length) throw new Error(`CSV: linha ${i + 2} tem ${l.length} campos, esperava ${cab.length}`);
    return Object.fromEntries(cab.map((k, j) => [k, l[j]]));
  });
}
