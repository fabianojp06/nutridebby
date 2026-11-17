import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { textoDoPdf } from '../../../test/pdf';
import { novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { mealItems } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { criarAlimento } from '@/modules/alimentos/alimentos';
import { idTaco } from '@/modules/alimentos/taco';
import { carregarPlano } from './carregar';
import { lerCongelados } from './congelados';
import { renderizarPlano } from './plano-pdf';
import { gerarPdfDoPlano } from './plano-pdf-job';
import { publicarPlano } from './publicacao';
import { criarRascunho, salvarRascunho } from './rascunho';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
const now = new Date('2026-10-01T15:00:00Z');
const deps = { db: app.db, now };
const dataDir = process.env.DATA_DIR!;

const item = (foodId: string) => ({ id: randomUUID(), foodId, quantidadeG: '100', medida: null, substituiItemId: null });

/** Plano publicado pelo app novo (TACO e "Meu alimento"); depois cada item é regravado como o app antigo o congelava. */
async function publicadoComOFormatoAntigo(T: TenantDeTeste) {
  const { id: pao } = await criarAlimento(T.ctx, { nome: 'Pão da casa', grupo: 'Cereais e derivados', kcal: '250', proteinaG: '8', carboidratoG: '50', lipidioG: '2', fibraG: '3' }, deps);
  const p = await novoPaciente(app.db, T.ctx);
  const { id } = await criarRascunho(T.ctx, p.id, deps);
  await salvarRascunho(T.ctx, id, {
    revisao: 0, envio: randomUUID(), titulo: 'Plano de antes', metaKcal: '', mostrarCalorias: true, orientacoes: '',
    refeicoes: [{ id: randomUUID(), nome: 'Almoço', horario: '12:00', observacao: '', itens: [item(idTaco(3)), item(pao)] }],
  }, deps);
  await publicarPlano(T.ctx, p.id, id, deps);
  // o jsonb que o publicarPlano de antes do Plano 19 gravava: sem fonte, versão, fonte de origem nem micros
  await withTenant(
    T.ctx,
    (tx) =>
      tx.execute(sql`update meal_items mi set nutrientes = jsonb_build_object('nome', f.nome || ' (na publicação)',
          'origem', case when f.tenant_id is null then 'TACO' else 'Meu alimento' end,
          'kcal', f.kcal, 'proteinaG', f.proteina_g, 'carboidratoG', f.carboidrato_g, 'lipidioG', f.lipidio_g, 'fibraG', f.fibra_g)
        from foods f where f.id = mi.food_id and mi.plan_id = ${id}`),
    app.db,
  );
  return { p, id, pao };
}

describe('Review Focus 4 — plano publicado antes do deploy (RN-237, formato antigo do congelado)', () => {
  it('carregarPlano lê o formato antigo sem erro: nome e valores da cópia, fonte pela `origem` (TACO → taco, "Meu alimento" → propria)', async () => {
    const T = await novoTenant(app.db);
    const { id, pao } = await publicadoComOFormatoAntigo(T);
    const linhas = await withTenant(T.ctx, (tx) => tx.select({ foodId: mealItems.foodId, n: mealItems.nutrientes }).from(mealItems).where(eq(mealItems.planId, id)), app.db);
    for (const l of linhas) expect(l.n).not.toHaveProperty('fonte');
    const congelado = (f: string) => lerCongelados(linhas.find((l) => l.foodId === f)!.n);
    expect(congelado(idTaco(3))).toMatchObject({ fonte: 'taco', fonteVersao: null, fonteOrigem: null, micros: null });
    expect(congelado(pao)).toMatchObject({ fonte: 'propria', micros: null });

    const plano = await carregarPlano(T.ctx, id, app.db);
    expect(plano!.refeicoes[0].itens.map((i) => [i.nome, i.fonte, i.origem, i.porCem.kcal])).toEqual([
      ['Arroz, tipo 1, cozido (na publicação)', 'taco', 'TACO', 128],
      ['Pão da casa (na publicação)', 'propria', 'Meu alimento', 250],
    ]);
  });

  it('o PDF de um plano publicado antes do deploy é gerado sem erro, com os nomes da cópia', async () => {
    const T = await novoTenant(app.db);
    const { id } = await publicadoComOFormatoAntigo(T);
    let pdf: Buffer | null = null;
    expect(await gerarPdfDoPlano({ tenantId: T.tenantId, planId: id }, { db: app.db, dataDir, now, ultimaTentativa: false, renderizar: async (d) => (pdf = await renderizarPlano(d)) })).toBe('pronto');
    const texto = textoDoPdf(pdf!);
    expect(texto).toContain('Arroz, tipo 1, cozido (na publica');
    expect(texto).toContain('Pão da casa (na publica');
  });

  it('cópia sem fonte nem `origem` conhecida (nunca gravada assim) não derruba a leitura: a fonte sai do alimento, o resto da cópia', async () => {
    const T = await novoTenant(app.db);
    const { id } = await publicadoComOFormatoAntigo(T);
    await withTenant(T.ctx, (tx) => tx.execute(sql`update meal_items set nutrientes = nutrientes - 'origem' where plan_id = ${id}`), app.db);
    const plano = await carregarPlano(T.ctx, id, app.db);
    expect(plano!.refeicoes[0].itens.map((i) => [i.nome, i.fonte, i.porCem.kcal])).toEqual([
      ['Arroz, tipo 1, cozido (na publicação)', 'taco', 128],
      ['Pão da casa (na publicação)', 'propria', 250],
    ]);
  });
});
