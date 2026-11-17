import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novoTenant } from '../../../test/pacientes';
import { withTenant, type TenantContext } from '@/db/tenant';
import { buscarPorNutriente, equivalentes } from './busca-avancada';
import { MSG_BUSCA } from './busca-avancada-constantes';
import { idTaco } from './taco';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

const ARROZ = idTaco(3); // "Arroz, tipo 1, cozido": 128 kcal, P 2,5, C 28,1, L 0,2 por 100 g
const ENERGIA_REF = (128 * 120) / 100; // 120 g de arroz = 153,6 kcal

type Proprio = { nome: string; grupo?: string; kcal: number; p?: number; c?: number; l?: number; micros?: Record<string, number | null> };
async function meuAlimento(ctx: TenantContext, tenantId: string, a: Proprio): Promise<string> {
  const [r] = await withTenant(
    ctx,
    (tx) =>
      tx.execute<{ id: string }>(sql`insert into foods (tenant_id, nome, grupo, kcal, proteina_g, carboidrato_g, lipidio_g, fibra_g, micros)
        values (${tenantId}, ${a.nome}, ${a.grupo ?? 'Cereais e derivados'}, ${a.kcal}, ${a.p ?? 0}, ${a.c ?? 0}, ${a.l ?? 0}, 0, ${JSON.stringify(a.micros ?? {})}::jsonb) returning id`),
    app.db,
  ).then((x) => x.rows);
  return r.id;
}

const crescente = (xs: number[]) => xs.every((x, k) => k === 0 || xs[k - 1] <= x);
const decrescente = (xs: number[]) => xs.every((x, k) => k === 0 || xs[k - 1] >= x);

describe('busca por nutriente (RN-241, US-234)', () => {
  it('"Rico em ferro": até 20, do maior para o menor, sem quem não tem o valor, com o critério e o aviso', async () => {
    const T = await novoTenant(app.db);
    const r = await buscarPorNutriente(T.ctx, { chave: 'ferro_mg', direcao: 'rico' }, app.db);
    expect(r.criterio).toBe('Ordenado por ferro em 100 g (maior primeiro).');
    expect(r.aviso).toBe(MSG_BUSCA.sugestao);
    expect(r.resultados.length).toBeGreaterThan(0);
    expect(r.resultados.length).toBeLessThanOrEqual(20);
    expect(r.resultados.every((a) => typeof a.micros.ferro_mg === 'number' && a.valor === a.micros.ferro_mg)).toBe(true);
    expect(decrescente(r.resultados.map((a) => a.valor))).toBe(true);
  });

  it('"Pobre em sódio, só verduras": do menor para o maior, só o grupo, nulos de fora; desempate por nome', async () => {
    const T = await novoTenant(app.db);
    const grupo = 'Verduras, hortaliças e derivados';
    // dois alimentos próprios com sódio 0 (nomes que vêm antes de qualquer nome da TACO) e um sem o valor: o sem valor
    // nunca entra; o empate sai por nome (gravados fora da ordem)
    const aab = await meuAlimento(T.ctx, T.tenantId, { nome: 'Aab verdura sem sódio', grupo, kcal: 10, micros: { sodio_mg: 0 } });
    const aaa = await meuAlimento(T.ctx, T.tenantId, { nome: 'Aaa verdura sem sódio', grupo, kcal: 10, micros: { sodio_mg: 0 } });
    const semValor = await meuAlimento(T.ctx, T.tenantId, { nome: 'Verdura sem o valor', grupo, kcal: 10, micros: { sodio_mg: null } });
    const r = await buscarPorNutriente(T.ctx, { chave: 'sodio_mg', direcao: 'pobre', grupo }, app.db);
    expect(r.criterio).toBe('Ordenado por sódio em 100 g (menor primeiro).');
    expect(r.resultados.every((a) => a.grupo === grupo && typeof a.micros.sodio_mg === 'number')).toBe(true);
    expect(r.resultados.map((a) => a.id)).not.toContain(semValor);
    expect(crescente(r.resultados.map((a) => a.valor))).toBe(true);
    expect(r.resultados.slice(0, 2).map((a) => a.id)).toEqual([aaa, aab]);
  });

  it('"Rico em proteína" (macro `proteinaG`) e filtro de fonte', async () => {
    const T = await novoTenant(app.db);
    const r = await buscarPorNutriente(T.ctx, { chave: 'proteinaG', direcao: 'rico', fontes: ['taco'] }, app.db);
    expect(r.criterio).toBe('Ordenado por proteína em 100 g (maior primeiro).');
    expect(r.resultados).toHaveLength(20);
    expect(r.resultados.every((a) => a.fonte === 'taco' && a.valor === a.porCem.proteinaG)).toBe(true);
    expect(decrescente(r.resultados.map((a) => a.valor))).toBe(true);
  });

  it('nada encontrado: "Nenhum alimento atende a este critério." (a TACO não traz vitamina D)', async () => {
    const T = await novoTenant(app.db);
    expect(await buscarPorNutriente(T.ctx, { chave: 'vitamina_d_mcg', direcao: 'rico', fontes: ['taco'] }, app.db)).toEqual({
      criterio: 'Ordenado por vitamina D em 100 g (maior primeiro).',
      aviso: 'Nenhum alimento atende a este critério.',
      resultados: [],
    });
  });

  it('alimento próprio de outro consultório nunca aparece', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const deB = await meuAlimento(B.ctx, B.tenantId, { nome: 'Farinha de ferro de B', kcal: 300, micros: { ferro_mg: 99999 } });
    expect((await buscarPorNutriente(B.ctx, { chave: 'ferro_mg', direcao: 'rico' }, app.db)).resultados[0].id).toBe(deB);
    expect((await buscarPorNutriente(A.ctx, { chave: 'ferro_mg', direcao: 'rico' }, app.db)).resultados.map((a) => a.id)).not.toContain(deB);
  });
});

describe('equivalentes (RN-242, US-234)', () => {
  it('"Equivalentes por energia": arroz 120 g → macarrão 104 g primeiro, mesmo grupo, critério exato e aviso', async () => {
    const T = await novoTenant(app.db);
    // 148 kcal com os macros na proporção do arroz: em 104 g fica a ~0,1 g de P/C/L da referência
    const macarrao = await meuAlimento(T.ctx, T.tenantId, { nome: 'Macarrão, cozido', kcal: 148, p: 2.9, c: 32.5, l: 0.2 });
    const r = await equivalentes(T.ctx, { foodId: ARROZ, quantidadeG: 120, igualarPor: 'kcal' }, app.db);
    expect(r).not.toBeNull();
    expect(r!.criterio).toBe('Mesmo grupo (Cereais e derivados) · mesma energia · ordenados pela proximidade de proteína, carboidrato e lipídio.');
    expect(r!.aviso).toBe(MSG_BUSCA.sugestao);
    expect(r!.referencia).toEqual({ nome: 'Arroz, tipo 1, cozido', grupo: 'Cereais e derivados', quantidadeG: 120, kcal: ENERGIA_REF });
    expect(r!.resultados[0]).toMatchObject({ id: macarrao, nome: 'Macarrão, cozido', quantidadeG: 104 }); // round(120 × 128 ÷ 148)
    expect(r!.resultados.length).toBeLessThanOrEqual(20);
    expect(r!.resultados.map((a) => a.id)).not.toContain(ARROZ);
    for (const a of r!.resultados) {
      expect(a.grupo).toBe('Cereais e derivados');
      expect(a.quantidadeG).toBe(Math.round((120 * 128) / a.porCem.kcal!));
    }
    // ordem: soma das diferenças de P/C/L na quantidade sugerida, crescente
    const dif = (a: NonNullable<typeof r>['resultados'][number]) =>
      Math.abs((a.porCem.proteinaG! * a.quantidadeG) / 100 - 3) + Math.abs((a.porCem.carboidratoG! * a.quantidadeG) / 100 - 33.72) + Math.abs((a.porCem.lipidioG! * a.quantidadeG) / 100 - 0.24);
    const comMacros = r!.resultados.filter((a) => a.porCem.proteinaG !== null && a.porCem.carboidratoG !== null && a.porCem.lipidioG !== null);
    expect(crescente(comMacros.map(dif).map((x) => Math.round(x * 1e6)))).toBe(true);
  });

  it('"Equivalentes por um nutriente": carboidrato — mesma quantidade de carboidrato e energia a ±10%, ordenados pela diferença de energia', async () => {
    const T = await novoTenant(app.db);
    // mesma quantidade de carboidrato, mas energia 30% acima: fica de fora
    const fora = await meuAlimento(T.ctx, T.tenantId, { nome: 'Cereal calórico', kcal: 166, p: 2.5, c: 28.1, l: 3 });
    // a mesma energia por carboidrato do arroz: diferença 0, vem primeiro
    const dentro = await meuAlimento(T.ctx, T.tenantId, { nome: 'Cereal parecido', kcal: 128, p: 3, c: 28.1, l: 0.1 });
    const r = (await equivalentes(T.ctx, { foodId: ARROZ, quantidadeG: 120, igualarPor: 'carboidratoG' }, app.db))!;
    expect(r.criterio).toBe('Mesmo grupo (Cereais e derivados) · mesmo carboidrato · energia até ±10%.');
    const ids = r.resultados.map((a) => a.id);
    expect(ids[0]).toBe(dentro);
    expect(ids).not.toContain(fora);
    expect(r.resultados.find((a) => a.id === dentro)!.quantidadeG).toBe(120); // 120 × 28,1 ÷ 28,1
    const energia = r.resultados.map((a) => (a.porCem.kcal! * a.quantidadeG) / 100);
    expect(energia.every((e) => Math.abs(e - ENERGIA_REF) <= 0.1 * ENERGIA_REF)).toBe(true);
    expect(crescente(energia.map((e) => Math.abs(e - ENERGIA_REF)).map((x) => Math.round(x * 1e6)))).toBe(true);
    for (const a of r.resultados) expect(a.quantidadeG).toBe(Math.round((120 * 28.1) / a.porCem.carboidratoG!));
  });

  it('nada encontrado e referência sem o valor: "Nenhum alimento atende a este critério."', async () => {
    const T = await novoTenant(app.db);
    const sozinho = await meuAlimento(T.ctx, T.tenantId, { nome: 'Castanha única', grupo: 'Nozes e sementes', kcal: 600, micros: { selenio_mcg: 1900 } });
    const r = (await equivalentes(T.ctx, { foodId: sozinho, quantidadeG: 30, igualarPor: 'selenio_mcg', fontes: ['taco'] }, app.db))!;
    expect(r).toMatchObject({ aviso: 'Nenhum alimento atende a este critério.', resultados: [], criterio: 'Mesmo grupo (Nozes e sementes) · mesmo selênio · energia até ±10%.' });
    const semValor = (await equivalentes(T.ctx, { foodId: ARROZ, quantidadeG: 120, igualarPor: 'vitamina_d_mcg' }, app.db))!;
    expect(semValor).toMatchObject({ aviso: 'Nenhum alimento atende a este critério.', resultados: [] });
  });

  it('alimento próprio de outro consultório nunca aparece, nem serve de referência', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const deB = await meuAlimento(B.ctx, B.tenantId, { nome: 'Macarrão de B', kcal: 148, p: 2.9, c: 32.5, l: 0.2 });
    expect((await equivalentes(B.ctx, { foodId: ARROZ, quantidadeG: 120, igualarPor: 'kcal' }, app.db))!.resultados[0].id).toBe(deB);
    expect((await equivalentes(A.ctx, { foodId: ARROZ, quantidadeG: 120, igualarPor: 'kcal' }, app.db))!.resultados.map((a) => a.id)).not.toContain(deB);
    expect(await equivalentes(A.ctx, { foodId: deB, quantidadeG: 100, igualarPor: 'kcal' }, app.db)).toBeNull();
  });

  it('quantidade sugerida fora de 0,1 a 5000 g fica de fora', async () => {
    const T = await novoTenant(app.db);
    // 5000 g de arroz = 6400 kcal; um cereal de 1 kcal precisaria de 640000 g
    const ralo = await meuAlimento(T.ctx, T.tenantId, { nome: 'Cereal quase sem energia', kcal: 1, c: 0.1 });
    const r = (await equivalentes(T.ctx, { foodId: ARROZ, quantidadeG: 5000, igualarPor: 'kcal' }, app.db))!;
    expect(r.resultados.map((a) => a.id)).not.toContain(ralo);
    expect(r.resultados.every((a) => a.quantidadeG >= 0.1 && a.quantidadeG <= 5000)).toBe(true);
  });
});
