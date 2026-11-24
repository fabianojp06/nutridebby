import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { espiarErrosDoBanco, INVALIDOS, limpo, semErroDoBanco, sujo } from '../../../test/erros-do-banco';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { finCategorias, finLancamentos } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { criarCategoria, listarCategorias, salvarConfiguracoes } from './configuracoes';
import { cancelarLancamento, criarLancamento } from './lancamentos';

/**
 * SUS-110 (regra 3): o NUL e o surrogate UTF-16 sem par na descrição e no motivo do cancelamento do lançamento (que pode
 * citar o paciente) e no nome da categoria não chegam ao banco — o `text` recusaria o NUL (22021) com o texto no log e no
 * erro do app. O espião anota o SQLSTATE de todo erro do banco.
 */
const app = makeDb(inject('appDatabaseUrl'));
const errosDoBanco = espiarErrosDoBanco(app.pool);
afterAll(() => app.pool.end());
const deps = { db: app.db, agora: new Date('2026-11-18T01:30:00Z') };

describe('SUS-110: texto com NUL ou surrogate sem par no Financeiro', () => {
  it.each(INVALIDOS)('lançamento (descrição e motivo do cancelamento) e categoria (nome) com %s vão limpos', async (_nome, ch) => {
    const T = await novoTenant(app.db);
    await salvarConfiguracoes(T.ctx, T.tenant, { saldoInicialEm: '2026-11-01', saldoInicial: '1.500,00', valorConsulta: '250,00' }, deps);
    const consultas = (await listarCategorias(T.ctx, deps)).find((c) => c.nome === 'Consultas')!.id;
    const p = await novoPaciente(app.db, T.ctx);
    const { id } = await semErroDoBanco(errosDoBanco, () =>
      criarLancamento(T.ctx, T.tenant, { tipo: 'entrada', valor: '250,00', categoriaId: consultas, vencimento: '2026-11-20', pacienteId: p.id, descricao: sujo('Retorno', ch) }, deps),
    );
    await semErroDoBanco(errosDoBanco, () => cancelarLancamento(T.ctx, id, sujo('Lançado em dobro', ch), deps));
    const [l] = await withTenant(T.ctx, (tx) => tx.select({ d: finLancamentos.descricao, m: finLancamentos.motivoCancelamento }).from(finLancamentos).where(eq(finLancamentos.id, id)), app.db);
    expect(l).toEqual({ d: limpo('Retorno'), m: limpo('Lançado em dobro') });
    await semErroDoBanco(errosDoBanco, () => criarCategoria(T.ctx, { tipo: 'saida', nome: sujo('Cursos', ch) }, deps));
    const cs = await withTenant(T.ctx, (tx) => tx.select({ nome: finCategorias.nome }).from(finCategorias).where(and(eq(finCategorias.tipo, 'saida'), eq(finCategorias.nome, limpo('Cursos')))), app.db);
    expect(cs).toHaveLength(1);
  });
});
