import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { planoPublicado } from '../../../test/plano';
import { closeDb } from '@/db/client';
import { mealPlans } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { idTaco } from '@/modules/alimentos/taco';
import { publicarPlano } from '@/modules/plano-alimentar/publicacao';
import { criarRascunho, salvarRascunho } from '@/modules/plano-alimentar/rascunho';
import { listaDoPlano, MSG_COMPRAS } from './lista-compras';

const SP = 'America/Sao_Paulo';

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
    expect(await listaDoPlano(ctx, SP, 7, { db: app.db })).toBeNull();
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
    const lista = await listaDoPlano(ctx, SP, 7, { db: app.db });
    expect(lista!.grupos).toEqual([{ grupo: 'Cereais e derivados', itens: [{ nome: 'Arroz, tipo 1, cozido', gramas: 700, texto: '700 g' }] }]);
    expect(lista).toMatchObject({ semAlimentos: false, textoLivreFora: false });
  });

  it('RN-248 (Plano 19): por dia da janela a partir de hoje no fuso — 7 dias a partir de uma quarta: o almoço de seg–sex 5 vezes, o de sábado 1', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await planoPublicado(app.db, T, p.id, {
      refeicoes: [
        { nome: 'Almoço', horario: '12:00', dias: [1, 2, 3, 4, 5], itens: [{ gramas: 100 }] },
        { nome: 'Almoço', horario: '12:30', dias: [6], itens: [{ gramas: 150 }] },
      ],
    });
    const quarta = new Date('2026-11-18T15:00:00Z'); // quarta, 18/11/2026, 12:00 em São Paulo
    const lista = await listaDoPlano(ctxPaciente(T.tenantId, p.id), SP, 7, { db: app.db, agora: quarta });
    expect(lista!.grupos).toEqual([{ grupo: 'Cereais e derivados', itens: [{ nome: 'Arroz, tipo 1, cozido', gramas: 650, texto: '650 g' }] }]);
    const tres = await listaDoPlano(ctxPaciente(T.tenantId, p.id), SP, 3, { db: app.db, agora: quarta }); // qua, qui, sex
    expect(tres!.grupos[0].itens[0].gramas).toBe(300);
  });

  it('RN-248: plano em texto livre → semAlimentos ("Este plano não tem alimentos com quantidade, então não há lista de compras.")', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await planoPublicado(app.db, T, p.id, { modo: 'livre', refeicoes: [{ nome: 'Almoço', horario: '12:00', descricaoLivre: 'Arroz e feijão.', itens: [] }] });
    expect(await listaDoPlano(ctxPaciente(T.tenantId, p.id), SP, 7, { db: app.db })).toMatchObject({ grupos: [], semAlimentos: true, textoLivreFora: false });
    expect(MSG_COMPRAS.semAlimentos).toBe('Este plano não tem alimentos com quantidade, então não há lista de compras.');
    expect(MSG_COMPRAS.textoLivreFora).toBe('As refeições em texto livre não entram na lista.');
  });
});
