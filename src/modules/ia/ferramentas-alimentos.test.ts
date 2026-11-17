import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { apagarPublicos, inserirPublicos } from '../../../test/alimentos-publicos';
import { makeDb } from '../../../test/db';
import { novoTenant } from '../../../test/pacientes';
import { withTenant } from '@/db/tenant';
import type { AlimentoEncontrado } from '@/modules/alimentos/busca';
import { idTaco } from '@/modules/alimentos/taco';
import { buscaDoTenant, executarFerramenta, FERRAMENTAS_ALIMENTOS, novoCatalogo, type BuscaAlimentos } from './ferramentas-alimentos';

const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
let publicos: string[] = [];
beforeAll(async () => {
  publicos = await inserirPublicos(owner.pool, [
    { nome: 'Pinhão, cozido, sem sal', nomeOriginal: 'Pine nuts, boiled, without salt', grupo: 'Nozes e sementes', kcal: 180 },
    { fonte: 'tbca', nome: 'Pinhão cozido TBCA', grupo: 'Nozes e sementes', kcal: 175 },
  ]);
});
afterAll(async () => {
  await apagarPublicos(owner.pool, publicos);
  await app.pool.end();
  await owner.pool.end();
});

const arroz: AlimentoEncontrado = { id: '00000000-0000-4000-8000-000000000003', nome: 'Arroz, tipo 1, cozido', nomeOriginal: null, grupo: 'Cereais e derivados', fonte: 'taco', origem: 'TACO', micros: { calcio_mg: 4 }, porCem: { kcal: 128, proteinaG: 2.5, carboidratoG: 28.1, lipidioG: 0.2, fibraG: 1.6 }, medidas: [{ id: null, origem: 'IBGE', nome: 'colher de sopa', plural: 'colheres de sopa', gramas: 25 }] };
const feijao: AlimentoEncontrado = { id: '00000000-0000-4000-8000-000000000561', nome: 'Feijão, carioca, cozido', nomeOriginal: null, grupo: 'Leguminosas e derivados', fonte: 'taco', origem: 'TACO', micros: {}, porCem: { kcal: 76, proteinaG: 4.8, carboidratoG: 13.6, lipidioG: 0.5, fibraG: 8.5 }, medidas: [] };
const busca = (lista: AlimentoEncontrado[]): BuscaAlimentos => async () => lista;

describe('ferramentas do rascunho e dos modelos (RN-116, D7)', () => {
  it('as duas ferramentas têm schema fechado (additionalProperties false e required), para o strict', () => {
    expect(FERRAMENTAS_ALIMENTOS.map((f) => f.nome)).toEqual(['buscar_alimentos', 'calcular_plano']);
    for (const f of FERRAMENTAS_ALIMENTOS) expect(f.schema).toMatchObject({ type: 'object', additionalProperties: false });
  });

  it('buscar_alimentos: ids locais estáveis na tarefa, nunca o id do banco; medidas com índice', async () => {
    const cat = novoCatalogo();
    const r1 = JSON.parse((await executarFerramenta({ id: 'c1', nome: 'buscar_alimentos', entrada: { termo: 'arroz' } }, cat, busca([arroz, feijao]))).conteudo);
    const r2 = JSON.parse((await executarFerramenta({ id: 'c2', nome: 'buscar_alimentos', entrada: { termo: 'feijão' } }, cat, busca([feijao]))).conteudo);
    expect(r1.map((a: { id: string }) => a.id)).toEqual(['A1', 'A2']);
    expect(r2[0].id).toBe('A2'); // o mesmo alimento, o mesmo id local
    expect(JSON.stringify(r1)).not.toContain(arroz.id);
    expect(r1[0]).toMatchObject({ nome: 'Arroz, tipo 1, cozido', por_100g: { kcal: 128 }, medidas: [{ indice: 1, nome: 'colher de sopa', gramas: 25 }] });
    expect(JSON.stringify(r1)).not.toContain('calcio'); // os micros não vão ao modelo
  });

  it('Review Focus 5 / RN-234: ferramentas da IA nunca devolvem USDA (nem TBCA) — só a TACO e os alimentos do consultório', async () => {
    const T = await novoTenant(app.db);
    await withTenant(
      T.ctx,
      (tx) => tx.execute(sql`insert into foods (tenant_id, nome, grupo, kcal, proteina_g, carboidrato_g, lipidio_g, fibra_g) values (${T.tenantId}, 'Pinhão cozido da casa', 'Nozes e sementes', 170, 3, 40, 1, 15)`),
      app.db,
    );
    const achados = await buscaDoTenant(T.tenantId, app.db)('pinhao cozido');
    expect(achados.map((a) => a.id)).toContain(idTaco(595));
    expect(achados.map((a) => a.nome)).toContain('Pinhão cozido da casa');
    for (const id of publicos) expect(achados.map((a) => a.id)).not.toContain(id);
    expect(new Set(achados.map((a) => a.fonte))).toEqual(new Set(['taco', 'propria']));
    // nem pelo nome em inglês
    expect((await buscaDoTenant(T.tenantId, app.db)('pine nuts boiled')).map((a) => a.id)).not.toContain(publicos[0]);
  });

  it('calcular_plano: totais e indicador pelo calculo.ts; alimento não buscado = erro sem dado', async () => {
    const cat = novoCatalogo();
    await executarFerramenta({ id: 'c1', nome: 'buscar_alimentos', entrada: { termo: 'arroz' } }, cat, busca([arroz]));
    const ok = JSON.parse((await executarFerramenta({ id: 'c2', nome: 'calcular_plano', entrada: { meta_kcal: 192, refeicoes: [{ itens: [{ alimento: 'A1', gramas: 150 }] }] } }, cat, busca([]))).conteudo);
    expect(ok).toMatchObject({ total_kcal: 192, indicador: 'Dentro da meta' });
    const erro = await executarFerramenta({ id: 'c3', nome: 'calcular_plano', entrada: { meta_kcal: null, refeicoes: [{ itens: [{ alimento: 'A9', gramas: 10 }] }] } }, cat, busca([]));
    expect(erro).toEqual({ conteudo: 'alimento A9 não foi buscado nesta tarefa', erro: true });
  });

  it('entrada fora do formato e ferramenta desconhecida → erro curto (o laço segue)', async () => {
    const cat = novoCatalogo();
    expect(await executarFerramenta({ id: 'c', nome: 'buscar_alimentos', entrada: { termo: 3 } }, cat, busca([]))).toEqual({ conteudo: 'entrada inválida', erro: true });
    expect(await executarFerramenta({ id: 'c', nome: 'apagar_tudo', entrada: {} }, cat, busca([]))).toEqual({ conteudo: 'ferramenta desconhecida', erro: true });
  });
});
