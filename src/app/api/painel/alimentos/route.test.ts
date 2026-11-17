import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { getAuth } from '@/lib/auth';
import { apagarPublicos, inserirPublicos } from '../../../../../test/alimentos-publicos';
import { makeDb } from '../../../../../test/db';
import { nutriComDpa } from '../../../../../test/nutri';
import { GET } from './route';

vi.mock('server-only', () => ({})); // requireApiNutri (src/lib/tenant-session.ts)

const db = getDb();
const auth = getAuth();
const owner = makeDb(inject('ownerDatabaseUrl'));
let usda: string;
beforeAll(async () => {
  [usda] = await inserirPublicos(owner.pool, [{ nome: 'Lentilha vermelha, cozida', nomeOriginal: 'Lentils, pink or red, cooked', grupo: 'Leguminosas e derivados', kcal: null, micros: { ferro_mg: 2.4 } }]);
});
afterAll(async () => {
  await apagarPublicos(owner.pool, [usda]);
  await owner.pool.end();
  await closeDb();
});

const pedir = (q: string | null, cookie?: string) =>
  GET(new Request(`http://localhost:3000/api/painel/alimentos${q === null ? '' : `?q=${encodeURIComponent(q)}`}`, { headers: cookie ? { cookie } : {} }));
/** Pedido com vários parâmetros (`fonte` pode repetir). */
const pedirCom = (params: [string, string][], cookie: string) =>
  GET(new Request(`http://localhost:3000/api/painel/alimentos?${new URLSearchParams(params)}`, { headers: { cookie } }));

describe('GET /api/painel/alimentos (US-020)', () => {
  it('200 com resultados e sem cache; sem termo = lista vazia; sem sessão = 401', async () => {
    const A = await nutriComDpa(db, auth);
    const r = await pedir('feijao carioca', A.cookie);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const { resultados } = await r.json();
    expect(resultados.map((x: { nome: string }) => x.nome)).toContain('Feijão, carioca, cozido');
    expect(await (await pedir(null, A.cookie)).json()).toEqual({ resultados: [] });
    expect((await pedir('feijao')).status).toBe(401);
  });

  it('RN-230: o resultado leva a fonte, o selo, o nome original e os micros (o editor soma os micros do rascunho)', async () => {
    const A = await nutriComDpa(db, auth);
    const { resultados } = await (await pedir('lentils red cooked', A.cookie)).json();
    expect(resultados.find((x: { id: string }) => x.id === usda)).toMatchObject({
      nome: 'Lentilha vermelha, cozida', nomeOriginal: 'Lentils, pink or red, cooked', fonte: 'usda', origem: 'USDA (EUA)', micros: { ferro_mg: 2.4 }, porCem: { kcal: null },
    });
  });

  it('Plano 19 (diálogo "Buscar alimento"): filtro de fonte e de grupo na busca por nome', async () => {
    const A = await nutriComDpa(db, auth);
    const usdaSo = await (await pedirCom([['q', 'lentilha'], ['fonte', 'usda']], A.cookie)).json();
    expect(usdaSo.resultados.map((x: { id: string }) => x.id)).toContain(usda);
    expect(usdaSo.resultados.every((x: { fonte: string }) => x.fonte === 'usda')).toBe(true);
    const tacoSo = await (await pedirCom([['q', 'lentilha'], ['fonte', 'taco'], ['fonte', 'propria']], A.cookie)).json();
    expect(tacoSo.resultados.length).toBeGreaterThan(0);
    expect(tacoSo.resultados.every((x: { fonte: string }) => x.fonte === 'taco' || x.fonte === 'propria')).toBe(true);
    const grupo = await (await pedirCom([['q', 'feijao'], ['grupo', 'Alimentos preparados']], A.cookie)).json();
    expect(grupo.resultados.length).toBeGreaterThan(0);
    expect(grupo.resultados.every((x: { grupo: string }) => x.grupo === 'Alimentos preparados')).toBe(true);
  });

  it('RN-241: `nutriente` e `direcao` fazem a busca por nutriente, com o critério e o aviso', async () => {
    const A = await nutriComDpa(db, auth);
    const r = await pedirCom([['nutriente', 'ferro_mg'], ['direcao', 'rico'], ['grupo', 'Leguminosas e derivados']], A.cookie);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const corpo = await r.json();
    expect(corpo).toMatchObject({ criterio: 'Ordenado por ferro em 100 g (maior primeiro).', aviso: 'Sugestão: confira antes de usar.' });
    expect(corpo.resultados.length).toBeGreaterThan(0);
    expect(corpo.resultados.every((x: { grupo: string; valor: number }) => x.grupo === 'Leguminosas e derivados' && typeof x.valor === 'number')).toBe(true);
    const proteina = await (await pedirCom([['nutriente', 'proteinaG'], ['direcao', 'pobre'], ['fonte', 'taco']], A.cookie)).json();
    expect(proteina.criterio).toBe('Ordenado por proteína em 100 g (menor primeiro).');
    const vazio = await (await pedirCom([['nutriente', 'vitamina_d_mcg'], ['direcao', 'rico'], ['fonte', 'taco']], A.cookie)).json();
    expect(vazio).toEqual({ criterio: 'Ordenado por vitamina D em 100 g (maior primeiro).', aviso: 'Nenhum alimento atende a este critério.', resultados: [] });
  });

  it('parâmetro inválido = 400 (nutriente fora do catálogo, direção, grupo ou fonte desconhecidos, nutriente sem direção)', async () => {
    const A = await nutriComDpa(db, auth);
    for (const params of [
      [['nutriente', 'plutonio_mg'], ['direcao', 'rico']],
      [['nutriente', 'ferro_mg'], ['direcao', 'muito']],
      [['nutriente', 'ferro_mg']],
      [['q', 'arroz'], ['grupo', 'Doces']],
      [['q', 'arroz'], ['fonte', 'ibge']],
    ] as [string, string][][]) {
      expect((await pedirCom(params, A.cookie)).status, JSON.stringify(params)).toBe(400);
    }
  });
});
