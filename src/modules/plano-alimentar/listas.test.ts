import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { listasSubstituicao, listasSubstituicaoItens } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { criarAlimento, editarAlimento, excluirAlimento } from '@/modules/alimentos/alimentos';
import { idTaco } from '@/modules/alimentos/taco';
import { MAX_GRUPOS_LISTA, MAX_ITENS_GRUPO, MAX_LISTAS, MSG_LISTAS } from './biblioteca-constantes';
import { MSG_PLANO } from './constantes';
import { travarConsultorio } from './biblioteca';
import { carregarLista, excluirLista, ListaError, listarListas, salvarLista } from './listas';

// Plano 19, Tarefa 8 (P19-08, US-238, RN-251/RN-258): listas de substituição do consultório.
const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await app.pool.end();
});
const deps = { db: app.db };

const erros = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof ListaError) return e.erros;
    throw e;
  }
  throw new Error('esperava ListaError');
};

const COLHER = { nome: 'colher de sopa cheia', plural: 'colheres de sopa cheias', gramas: 25, qtd: 4 };
const BATATA = { nome: 'Batata-doce assada', grupo: 'Verduras, hortaliças e derivados', kcal: '90', proteinaG: '2', carboidratoG: '21', lipidioG: '0,1', fibraG: '3' };
const item = (foodId: string, quantidadeG = '100', medida: typeof COLHER | null = null) => ({ id: randomUUID(), foodId, quantidadeG, medida });
const grupo = (nome: string, itens: ReturnType<typeof item>[]) => ({ id: randomUUID(), nome, itens });
const trocas = (itens = [item(idTaco(3), '100', COLHER), item(idTaco(53), '50')]) => ({
  nome: 'Trocas do dia a dia',
  orientacao: 'Troque um item do grupo por outro do mesmo grupo.',
  grupos: [grupo('Carboidratos — 1 porção', itens)],
});
const linhas = (T: TenantDeTeste) => withTenant(T.ctx, (tx) => tx.select().from(listasSubstituicao), app.db);


/**
 * Sem TOCTOU: com o consultório travado por outra transação (como um salvamento em curso), `acao` espera a trava antes
 * de contar — continua pendente até a trava sair. Devolve se terminou antes de soltar e o resultado.
 */
async function esperaATravaDoConsultorio<R>(T: TenantDeTeste, acao: () => Promise<R>): Promise<{ antes: boolean; resultado: R }> {
  let soltar!: () => void;
  const solto = new Promise<void>((r) => (soltar = r));
  let travou!: () => void;
  const travado = new Promise<void>((r) => (travou = r));
  const trava = withTenant(T.ctx, async (tx) => {
    await travarConsultorio(tx, T.tenantId);
    travou();
    await solto;
  }, app.db);
  await travado;
  let terminou = false;
  const p = acao().finally(() => (terminou = true));
  await new Promise((r) => setTimeout(r, 300));
  const antes = terminou;
  soltar();
  await trava;
  return { antes, resultado: await p };
}

describe('listas de substituição (US-238, RN-251)', () => {
  it('"Criar lista": o grupo com os itens (quantidade, medida caseira) e a energia de cada um, calculada agora', async () => {
    const T = await novoTenant(app.db);
    const { id: batata } = await criarAlimento(T.ctx, BATATA, deps);
    const { id } = await salvarLista(T.ctx, null, trocas([item(idTaco(3), '100', COLHER), item(batata, '150')]), deps);
    const l = (await carregarLista(T.ctx, id, app.db))!;
    expect(l).toMatchObject({ nome: 'Trocas do dia a dia', orientacao: 'Troque um item do grupo por outro do mesmo grupo.' });
    expect(l.grupos.map((g) => g.nome)).toEqual(['Carboidratos — 1 porção']);
    const [arroz, b] = l.grupos[0].itens;
    expect(arroz).toMatchObject({ foodId: idTaco(3), quantidadeG: 100, medida: COLHER, medidaCaseiraTxt: '4 colheres de sopa cheias', substituiItemId: null });
    expect(arroz.kcal).toBeCloseTo((arroz.porCem.kcal! * 100) / 100, 6);
    expect(b).toMatchObject({ foodId: batata, quantidadeG: 150, kcal: 135, fonte: 'propria' });
    // energia na hora: o alimento mudou, a lista mostra o valor de hoje
    await editarAlimento(T.ctx, batata, { ...BATATA, kcal: '100' }, deps);
    expect((await carregarLista(T.ctx, id, app.db))!.grupos[0].itens[1].kcal).toBe(150);
    expect(await listarListas(T.ctx, app.db)).toEqual([{ id, nome: 'Trocas do dia a dia', grupos: 1, itens: 2 }]);
    expect(MSG_LISTAS.contagem(1, 2)).toBe('1 grupo · 2 itens');
  });

  it('nome único no consultório; nome, orientação (até 1000), grupo sem nome ou sem item e quantidade → erro no campo; nada gravado', async () => {
    const T = await novoTenant(app.db);
    await salvarLista(T.ctx, null, trocas(), deps);
    expect(await erros(salvarLista(T.ctx, null, trocas(), deps))).toEqual({ nome: MSG_LISTAS.nomeRepetido });
    const ruim = item(idTaco(3), '0');
    const vazio = grupo('Frutas', []);
    const semNome = grupo('  ', [item(idTaco(3))]);
    expect(await erros(salvarLista(T.ctx, null, { nome: '', orientacao: 'x'.repeat(1001), grupos: [grupo('Carboidratos', [ruim]), vazio, semNome] }, deps))).toEqual({
      nome: MSG_LISTAS.nome,
      orientacao: MSG_LISTAS.orientacao,
      [`item:${ruim.id}:quantidadeG`]: MSG_PLANO.quantidade,
      [`grupo:${vazio.id}:itens`]: MSG_LISTAS.grupoVazio,
      [`grupo:${semNome.id}:nome`]: MSG_LISTAS.grupoNome,
    });
    expect(await erros(salvarLista(T.ctx, null, { nome: 'Sem grupos', orientacao: '', grupos: [] }, deps))).toEqual({ geral: MSG_LISTAS.semGrupo });
    // outro consultório pode ter uma lista com o mesmo nome
    const B = await novoTenant(app.db);
    await salvarLista(B.ctx, null, trocas(), deps);
    expect(await linhas(T)).toHaveLength(1);
  });

  it('21º grupo e 31º item recusados ("A lista pode ter até 20 grupos e 30 itens por grupo."); 20 × 30 passa', async () => {
    const T = await novoTenant(app.db);
    expect(MSG_LISTAS.limite).toBe('A lista pode ter até 20 grupos e 30 itens por grupo.');
    const grupos = (n: number, itens: number) => Array.from({ length: n }, (_, k) => grupo(`Grupo ${k + 1}`, Array.from({ length: itens }, () => item(idTaco(3), '10'))));
    expect(await erros(salvarLista(T.ctx, null, { nome: 'Grande', orientacao: '', grupos: grupos(MAX_GRUPOS_LISTA + 1, 1) }, deps))).toEqual({ geral: MSG_LISTAS.limite });
    expect(await erros(salvarLista(T.ctx, null, { nome: 'Grande', orientacao: '', grupos: grupos(1, MAX_ITENS_GRUPO + 1) }, deps))).toEqual({ geral: MSG_LISTAS.limite });
    expect(await linhas(T)).toEqual([]);
    const { id } = await salvarLista(T.ctx, null, { nome: 'Grande', orientacao: '', grupos: grupos(MAX_GRUPOS_LISTA, MAX_ITENS_GRUPO) }, deps);
    expect(await listarListas(T.ctx, app.db)).toEqual([{ id, nome: 'Grande', grupos: 20, itens: 600 }]);
  });

  it('101ª lista recusada, também com duas criações ao mesmo tempo no limite (tenant travado, sem TOCTOU)', async () => {
    const T = await novoTenant(app.db);
    await withTenant(T.ctx, (tx) => tx.insert(listasSubstituicao).values(Array.from({ length: MAX_LISTAS - 1 }, (_, k) => ({ tenantId: T.tenantId, nome: `Lista ${k}` }))), app.db);
    const resultados = await Promise.allSettled([salvarLista(T.ctx, null, { ...trocas(), nome: 'A' }, deps), salvarLista(T.ctx, null, { ...trocas(), nome: 'B' }, deps)]);
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const recusada = resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(recusada.reason).toBeInstanceOf(ListaError);
    expect(recusada.reason.erros).toEqual({ geral: MSG_LISTAS.limiteConsultorio });
    expect(await linhas(T)).toHaveLength(MAX_LISTAS);
    // a contagem espera a trava do consultório: com ele travado por outra transação, a criação fica pendente
    const B = await novoTenant(app.db);
    const { antes, resultado } = await esperaATravaDoConsultorio(B, () => salvarLista(B.ctx, null, trocas(), deps));
    expect(antes).toBe(false);
    expect(resultado.id).toBeTruthy();
    // alterar uma lista existente no limite continua valendo
    const [primeira] = await listarListas(T.ctx, app.db);
    await salvarLista(T.ctx, primeira.id, { ...trocas(), nome: primeira.nome }, deps);
  });

  it('RN-258: "Meu alimento" de outro consultório → erro no campo do item e nada gravado; a exclusão do dono não fica presa', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const { id: doB } = await criarAlimento(B.ctx, BATATA, deps);
    const intruso = item(doB, '50');
    expect(await erros(salvarLista(A.ctx, null, trocas([item(idTaco(3)), intruso]), deps))).toEqual({ [`item:${intruso.id}:foodId`]: MSG_PLANO.alimento });
    expect(await linhas(A)).toEqual([]);
    await excluirAlimento(B.ctx, doB, deps);
  });

  it('alterar regrava grupos e itens; excluir leva grupos e itens; outro consultório não vê, não altera nem exclui', async () => {
    const T = await novoTenant(app.db);
    const { id } = await salvarLista(T.ctx, null, trocas(), deps);
    const B = await novoTenant(app.db);
    expect(await carregarLista(B.ctx, id, app.db)).toBeNull();
    expect(await listarListas(B.ctx, app.db)).toEqual([]);
    expect(await erros(salvarLista(B.ctx, id, trocas(), deps))).toEqual({ geral: MSG_LISTAS.naoEncontrada });
    expect(await erros(excluirLista(B.ctx, id, deps))).toEqual({ geral: MSG_LISTAS.naoEncontrada });

    await salvarLista(T.ctx, id, { nome: 'Trocas', orientacao: '', grupos: [grupo('Frutas', [item(idTaco(3), '80')]), grupo('Pães', [item(idTaco(53), '50')])] }, deps);
    const l = (await carregarLista(T.ctx, id, app.db))!;
    expect(l.grupos.map((g) => [g.nome, g.itens.map((i) => i.quantidadeG)])).toEqual([['Frutas', [80]], ['Pães', [50]]]);
    await excluirLista(T.ctx, id, deps);
    expect(await carregarLista(T.ctx, id, app.db)).toBeNull();
    expect(await withTenant(T.ctx, (tx) => tx.select().from(listasSubstituicaoItens), app.db)).toEqual([]);
  });

  it('"Paciente não vê a biblioteca": a sessão do paciente lê zero linhas da lista, dos grupos e dos itens (staff_only)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await salvarLista(T.ctx, null, trocas(), deps);
    const paciente = ctxPaciente(T.tenantId, p.id);
    for (const t of ['listas_substituicao', 'listas_substituicao_grupos', 'listas_substituicao_itens']) {
      expect((await withTenant(T.ctx, (tx) => tx.execute(sql`select 1 from ${sql.identifier(t)}`), app.db)).rows.length, t).toBeGreaterThan(0);
      expect((await withTenant(paciente, (tx) => tx.execute(sql`select 1 from ${sql.identifier(t)}`), app.db)).rows, t).toEqual([]);
    }
    expect(await listarListas(paciente, app.db)).toEqual([]);
  });
});
