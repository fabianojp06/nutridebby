import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { lerAba } from '../../../scripts/seeds/planilhas';
import { makeDb } from '../../../test/db';
import { lerCsv } from '@/lib/csv';
import { MEDIDAS_FONTE, sqlSeedMedidas } from './medidas';

const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(() => owner.pool.end());

describe('seed de medidas fiel ao IBGE (INT-04, P-10, D3)', () => {
  const zip = readFileSync(MEDIDAS_FONTE.zip);
  const linhas = lerCsv(readFileSync(MEDIDAS_FONTE.csv, 'utf8'));

  it('cada linha do CSV existe no IBGE com os mesmos gramas (descrição exata da referência)', () => {
    expect(createHash('sha256').update(zip).digest('hex')).toBe(MEDIDAS_FONTE.sha256);
    const xls = Buffer.from(unzipSync(new Uint8Array(zip))[MEDIDAS_FONTE.xls]);
    const ibge = new Map<string, Set<number>>();
    for (const l of lerAba(xls, MEDIDAS_FONTE.aba).slice(4)) {
      const d = String(l[10] ?? '').trim();
      if (d) ibge.set(d, (ibge.get(d) ?? new Set()).add(Number(l[8])));
    }
    const fora = linhas.filter((l) => !ibge.get(l.referencia_ibge)?.has(Number(l.gramas)));
    expect(fora).toEqual([]);
    expect(linhas.length).toBeGreaterThanOrEqual(44);
  });

  it('a migration de seed é o que o script gera (rode `pnpm seed:medidas`) e o banco tem as medidas', async () => {
    expect(readFileSync(MEDIDAS_FONTE.migration, 'utf8')).toBe(sqlSeedMedidas(linhas as Parameters<typeof sqlSeedMedidas>[0]));
    const r = await owner.pool.query(`select medidas_caseiras from foods where taco_id = 3`);
    expect(r.rows[0].medidas_caseiras).toContainEqual({ nome: 'colher de sopa cheia', plural: 'colheres de sopa cheias', gramas: 25 });
    const comMedida = await owner.pool.query(`select count(*)::int as n from foods where tenant_id is null and jsonb_array_length(medidas_caseiras) > 0`);
    expect(comMedida.rows[0].n).toBe(new Set(linhas.map((l) => l.taco_id)).size);
  });
});
