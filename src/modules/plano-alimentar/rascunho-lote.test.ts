import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import * as schema from '@/db/schema';
import { idTaco } from '@/modules/alimentos/taco';
import { carregarPlano } from './carregar';
import { criarRascunho, salvarRascunho } from './rascunho';
import type { CorpoSalvamento } from './tipos';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

/** D04-2: um plano grande (2 refeições × 10 principais + 5 substituições) salvo de uma vez. */
function grande(revisao: number): CorpoSalvamento {
  const refeicoes = ['Café da manhã', 'Almoço'].map((nome, k) => {
    const principais = Array.from({ length: 10 }, () => ({ id: randomUUID(), foodId: idTaco(3), quantidadeG: '100', medida: null, substituiItemId: null }));
    const subs = principais.slice(0, 5).map((p) => ({ id: randomUUID(), foodId: idTaco(3), quantidadeG: '50', medida: null, substituiItemId: p.id }));
    return { id: randomUUID(), nome, horario: k ? '12:00' : '07:00', observacao: '', itens: [...principais, ...subs] };
  });
  return { revisao, envio: randomUUID(), titulo: 'Plano', metaKcal: '', mostrarCalorias: false, orientacoes: '', refeicoes };
}

describe('salvarRascunho em lote (D04-2)', () => {
  it('30 itens novos: 1 INSERT de refeições e 2 de itens; reenviar igual não grava nada; mudar 1 item = 1 UPDATE', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const { id } = await criarRascunho(T.ctx, p.id, { db: app.db });
    const consultas: string[] = [];
    const db = drizzle({ client: app.pool, schema, logger: { logQuery: (q) => void consultas.push(q) } });
    const corpo = grande(0);
    const { revisao } = await salvarRascunho(T.ctx, id, corpo, { db });
    const contar = (re: RegExp) => consultas.filter((q) => re.test(q)).length;
    expect(contar(/^insert into "meals"/)).toBe(1);
    expect(contar(/^insert into "meal_items"/)).toBe(2);
    const plano = (await carregarPlano(T.ctx, id, app.db))!;
    expect(plano.refeicoes.map((r) => r.itens.length)).toEqual([15, 15]);
    expect(plano.refeicoes[0].itens.filter((i) => i.substituiItemId).length).toBe(5);

    consultas.length = 0;
    const mesmo = { ...corpo, revisao, envio: randomUUID() };
    const r2 = await salvarRascunho(T.ctx, id, mesmo, { db });
    expect(contar(/^(insert into|update) "meal(s|_items)"/)).toBe(0);

    consultas.length = 0;
    const mudado = structuredClone({ ...mesmo, revisao: r2.revisao, envio: randomUUID() });
    mudado.refeicoes[1].itens[3].quantidadeG = '120';
    await salvarRascunho(T.ctx, id, mudado, { db });
    expect(contar(/^update "meal_items"/)).toBe(1);
  });
});
