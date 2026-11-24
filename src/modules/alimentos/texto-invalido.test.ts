import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { espiarErrosDoBanco, INVALIDOS, semErroDoBanco } from '../../../test/erros-do-banco';
import { novoTenant } from '../../../test/pacientes';
import { buscarAlimentos, palavrasDaBusca } from './busca';

/**
 * SUS-110 (regra 3): o NUL e o surrogate UTF-16 sem par no termo da busca de alimentos não chegam ao banco — o NUL daria
 * 22021 (um 500, com o termo no erro). O espião anota o SQLSTATE de todo erro do banco.
 */
const app = makeDb(inject('appDatabaseUrl'));
const errosDoBanco = espiarErrosDoBanco(app.pool);
afterAll(() => app.pool.end());

describe('SUS-110: busca de alimentos com NUL ou surrogate sem par', () => {
  it.each(INVALIDOS)('o termo com %s busca sem erro do banco e acha o mesmo que o termo limpo', async (_nome, ch) => {
    const T = await novoTenant(app.db);
    const limpos = await buscarAlimentos(T.ctx, 'arroz cozido', app.db);
    expect(limpos.length).toBeGreaterThan(0);
    const achados = await semErroDoBanco(errosDoBanco, () => buscarAlimentos(T.ctx, `arr${ch}oz cozido${ch}`, app.db));
    expect(achados.map((a) => a.id)).toEqual(limpos.map((a) => a.id));
  });

  it('as palavras saem sem os inválidos, também o meio emoji deixado pelo corte em 60', () => {
    expect(palavrasDaBusca('arr\u0000oz \ud800cozido \udc00')).toEqual(['arroz', 'cozido']);
    expect(palavrasDaBusca(`${'x'.repeat(59)}🙂`)).toEqual(['x'.repeat(59)]);
  });
});
