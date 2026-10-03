import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { mealPlans } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { idTaco } from '@/modules/alimentos/taco';
import { publicarPlano } from '@/modules/plano-alimentar/publicacao';
import { criarRascunho, salvarRascunho } from '@/modules/plano-alimentar/rascunho';
import { listaDoPlano } from './lista-compras';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});

describe('lista do plano (US-045)', () => {
  it('só o plano publicado e só os itens principais: a substituição não entra; rascunho → null', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const ctx = ctxPaciente(T.tenantId, p.id);
    const { id } = await criarRascunho(T.ctx, p.id, { db: app.db });
    expect(await listaDoPlano(ctx, 7, app.db)).toBeNull();
    const [r] = await withTenant(T.ctx, (tx) => tx.select({ revisao: mealPlans.revisao }).from(mealPlans).where(eq(mealPlans.id, id)), app.db);
    const [almoco, arroz, sub] = [randomUUID(), randomUUID(), randomUUID()];
    await salvarRascunho(T.ctx, id, {
      revisao: r.revisao, envio: randomUUID(), titulo: 'Plano', metaKcal: '', mostrarCalorias: false, orientacoes: '',
      refeicoes: [{ id: almoco, nome: 'Almoço', horario: '12:00', observacao: '', itens: [
        { id: arroz, foodId: idTaco(3), quantidadeG: '100', medida: null, substituiItemId: null },
        { id: sub, foodId: idTaco(112), quantidadeG: '150', medida: null, substituiItemId: arroz },
      ] }],
    }, { db: app.db });
    await publicarPlano(T.ctx, p.id, id, { db: app.db });
    const lista = await listaDoPlano(ctx, 7, app.db);
    expect(lista!.grupos).toEqual([{ grupo: 'Cereais e derivados', itens: [{ nome: 'Arroz, tipo 1, cozido', gramas: 700, texto: '700 g' }] }]);
  });
});
