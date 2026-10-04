import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { user } from '@/db/schema';
import { gravarTema, lerGuia, marcarGuia, PreferenciaError } from './preferencias';
import { proximoTema } from './preferencias-tipos';

const owner = makeDb(inject('ownerDatabaseUrl')); // a tabela user não tem RLS; o owner só cria as contas de teste
const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});
async function conta(): Promise<string> {
  const id = randomUUID();
  await owner.db.insert(user).values({ id, name: 'Debby Silva', email: `pref-${id.slice(0, 8)}@teste.dev`, appRole: 'nutri' });
  return id;
}

describe('preferências da usuária (D17)', () => {
  it('nasce em "sistema" e com o guia vazio', async () => {
    const id = await conta();
    const [u] = await app.db.select({ tema: user.tema, guia: user.guia }).from(user).where(eq(user.id, id));
    expect(u).toEqual({ tema: 'sistema', guia: {} });
  });
  it('gravarTema aceita só os três valores e grava só na conta indicada', async () => {
    const [a, b] = [await conta(), await conta()];
    await gravarTema(a, 'escuro', app.db);
    await expect(gravarTema(a, 'roxo', app.db)).rejects.toBeInstanceOf(PreferenciaError);
    const temas = await app.db.select({ id: user.id, tema: user.tema }).from(user).where(eq(user.id, b));
    expect(temas[0].tema).toBe('sistema');
  });
  it('marcarGuia: atômico (duas abas não se apagam), idempotente, "visto" não rebaixa "concluido" da mesma versão e versão menor não sobrescreve', async () => {
    const id = await conta();
    await Promise.all([marcarGuia(id, 'boas-vindas', 1, 'concluido', app.db), marcarGuia(id, 'agenda', 1, 'dispensado', app.db)]);
    await marcarGuia(id, 'boas-vindas', 1, 'visto', app.db);
    expect(await lerGuia(id, app.db)).toEqual({ 'boas-vindas': { v: 1, estado: 'concluido' }, agenda: { v: 1, estado: 'dispensado' } });
    await marcarGuia(id, 'boas-vindas', 2, 'visto', app.db); // versão nova do tour: volta a "visto"
    expect((await lerGuia(id, app.db))['boas-vindas']).toEqual({ v: 2, estado: 'visto' });
    // aba aberta antes do deploy (GUIAS antigo): versão menor nunca sobrescreve a maior, nem com "concluido"
    await marcarGuia(id, 'boas-vindas', 1, 'concluido', app.db);
    await marcarGuia(id, 'agenda', 2, 'concluido', app.db);
    await marcarGuia(id, 'agenda', 1, 'visto', app.db);
    expect(await lerGuia(id, app.db)).toEqual({ 'boas-vindas': { v: 2, estado: 'visto' }, agenda: { v: 2, estado: 'concluido' } });
  });
  it('id fora do formato ou versão inválida → PreferenciaError (nada de chave arbitrária no jsonb)', async () => {
    const id = await conta();
    await expect(marcarGuia(id, '__proto__', 1, 'visto', app.db)).rejects.toBeInstanceOf(PreferenciaError);
    await expect(marcarGuia(id, 'agenda', 0, 'visto', app.db)).rejects.toBeInstanceOf(PreferenciaError);
  });
  it('proximoTema: claro↔escuro; "sistema" vira o oposto do que o aparelho mostra', () => {
    expect(proximoTema('claro', true)).toBe('escuro');
    expect(proximoTema('escuro', false)).toBe('claro');
    expect(proximoTema('sistema', true)).toBe('claro');
    expect(proximoTema('sistema', false)).toBe('escuro');
  });
});
