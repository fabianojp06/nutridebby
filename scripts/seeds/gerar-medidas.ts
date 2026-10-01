import { readFileSync, writeFileSync } from 'node:fs';
import { lerCsv } from '../../src/lib/csv';
import { MEDIDAS_FONTE, sqlSeedMedidas } from '../../src/modules/alimentos/medidas';

// Uso: pnpm seed:medidas [arquivo-da-migration] (padrão: a migration inicial 0042)
const destino = process.argv[2] ?? MEDIDAS_FONTE.migration;
const linhas = lerCsv(readFileSync(MEDIDAS_FONTE.csv, 'utf8')) as Parameters<typeof sqlSeedMedidas>[0];
writeFileSync(destino, sqlSeedMedidas(linhas));
console.log(`${linhas.length} medidas de ${new Set(linhas.map((l) => l.taco_id)).size} alimentos em ${destino}`);
