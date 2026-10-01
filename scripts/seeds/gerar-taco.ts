import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { converterTaco, paraCsvTaco, sqlSeedTaco, TACO_FONTE } from '../../src/modules/alimentos/taco';
import { lerAba } from './planilhas';

const xls = readFileSync(TACO_FONTE.arquivo);
const hash = createHash('sha256').update(xls).digest('hex');
if (hash !== TACO_FONTE.sha256) throw new Error(`Planilha da TACO diferente da esperada (sha256 ${hash})`);
const registros = converterTaco(lerAba(xls, TACO_FONTE.aba));
writeFileSync(TACO_FONTE.csv, paraCsvTaco(registros));
writeFileSync(TACO_FONTE.migration, sqlSeedTaco(registros));
console.log(`${registros.length} alimentos da TACO em ${TACO_FONTE.csv} e ${TACO_FONTE.migration}`);
