import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novoConteudo } from '../../../test/conteudos';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { meals } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { idTaco } from '@/modules/alimentos/taco';
import { despublicarConteudo, excluirConteudo } from '@/modules/conteudo/conteudos';
import { conteudoDoPaciente, feedDeConteudos } from '@/modules/portal/conteudos';
import { planoDoPaciente } from '@/modules/portal/plano';
import { carregarPlano } from './carregar';
import { MSG_PLANO } from './constantes';
import { PlanoError } from './erros';
import { salvarComoModelo } from './modelos';
import { editarPublicado, publicarPlano } from './publicacao';
import { criarRascunho, salvarRascunho } from './rascunho';
import type { CorpoSalvamento } from './tipos';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
const deps = { db: app.db, appUrl: 'https://nutri.exemplo.com' };

/** Rascunho com "Café da manhã 07:00 · arroz 100 g", com ou sem a receita sugerida. */
function corpo(revisao: number, cafe: string, item: string, receita: string | null): CorpoSalvamento {
  return {
    revisao,
    envio: randomUUID(),
    titulo: 'Plano da Ana',
    metaKcal: '',
    mostrarCalorias: true,
    orientacoes: '',
    refeicoes: [{ id: cafe, nome: 'Café da manhã', horario: '07:00', observacao: '', recipeContentId: receita, itens: [{ id: item, foodId: idTaco(3), quantidadeG: '100', medida: null, substituiItemId: null }] }],
  };
}
const erros = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof PlanoError) return e.erros;
    throw e;
  }
  throw new Error('esperava PlanoError');
};
async function cenario() {
  const T: TenantDeTeste = await novoTenant(app.db);
  const ana = await novoPaciente(app.db, T.ctx);
  const bia = await novoPaciente(app.db, T.ctx);
  // a receita é só da Bia: a Ana a vê pelo plano (exceção da RN-12)
  const panqueca = await novoConteudo(app.db, T, { tipo: 'receita', titulo: 'Panqueca de aveia', visibilidade: 'pacientes', pacientes: [bia.id], receita: { rendimento: 1000, porcao: 250, ingredientes: [{ foodId: idTaco(3), g: 200 }] } });
  const { id } = await criarRascunho(T.ctx, ana.id, { db: app.db });
  return { T, ana, panqueca, id, cafe: randomUUID(), item: randomUUID() };
}

describe('"Sugestão de receita" (US-054)', () => {
  it('anexa só receita publicada do consultório: rascunho de receita, orientação, id inventado ou receita de outro tenant → "Receita não encontrada." na refeição', async () => {
    const { T, id, cafe, item } = await cenario();
    const rascunho = await novoConteudo(app.db, T, { tipo: 'receita', titulo: 'Em preparo', status: 'rascunho' });
    const orientacao = await novoConteudo(app.db, T);
    // isolamento: receita PUBLICADA de outro consultório (a RLS esconde; a FK composta também barraria)
    const deFora = await novoConteudo(app.db, await novoTenant(app.db), { tipo: 'receita', titulo: 'De outro consultório' });
    for (const ruim of [rascunho.id, orientacao.id, randomUUID(), deFora.id])
      expect(await erros(salvarRascunho(T.ctx, id, corpo(0, cafe, item, ruim), deps)), ruim).toEqual({ [`refeicao:${cafe}:receita`]: MSG_PLANO.receita });
    expect(await erros(salvarRascunho(T.ctx, id, corpo(0, cafe, item, 'lixo'), deps))).toEqual({ [`refeicao:${cafe}:receita`]: MSG_PLANO.receita });
  });

  it('a Ana vê o cartão mesmo fora da audiência; a receita não entra no total; despublicada, o cartão some e o editor mostra "indisponível" — e salvar de novo não falha', async () => {
    const { T, ana, panqueca, id, cafe, item } = await cenario();
    await salvarRascunho(T.ctx, id, corpo(0, cafe, item, panqueca.id), deps);
    expect((await carregarPlano(T.ctx, id, app.db))!.refeicoes[0].receita).toEqual({ id: panqueca.id, titulo: 'Panqueca de aveia', disponivel: true });
    await publicarPlano(T.ctx, ana.id, id, deps);
    const comoAna = ctxPaciente(T.tenantId, ana.id);
    const plano = (await planoDoPaciente(comoAna, 'America/Sao_Paulo', { db: app.db }))!;
    expect(plano.refeicoes[0].receita).toEqual({ id: panqueca.id, titulo: 'Panqueca de aveia' });
    expect(plano.totalKcal).toBe('128 kcal'); // só o arroz (100 g): "é só sugestão"
    // a exceção da RN-12 vale só no caminho do plano: no feed da Ana a receita (só da Bia) não aparece
    expect((await feedDeConteudos(comoAna, {}, app.db)).itens).toEqual([]);
    expect(await conteudoDoPaciente(comoAna, panqueca.id, app.db, { doPlano: true })).toMatchObject({ soPeloPlano: true });
    await despublicarConteudo(T.ctx, panqueca.id, { db: app.db });
    expect((await planoDoPaciente(comoAna, 'America/Sao_Paulo', { db: app.db }))!.refeicoes[0].receita).toBeUndefined();
    const { id: nova } = await editarPublicado(T.ctx, ana.id, id, deps); // "Editar" copia a sugestão
    expect((await carregarPlano(T.ctx, nova, app.db))!.refeicoes[0].receita).toEqual({ id: panqueca.id, titulo: 'Panqueca de aveia', disponivel: false });
    const r = (await carregarPlano(T.ctx, nova, app.db))!;
    const mantido = corpo(r.revisao, r.refeicoes[0].id, r.refeicoes[0].itens[0].id, panqueca.id);
    // anexar a despublicada numa refeição NOVA é recusado só nela — a que só manteve a sugestão não é marcada
    const almoco = randomUUID();
    const comNova = { ...mantido, refeicoes: [...mantido.refeicoes, { id: almoco, nome: 'Almoço', horario: '12:00', observacao: '', recipeContentId: panqueca.id, itens: [] }] };
    expect(await erros(salvarRascunho(T.ctx, nova, comNova, deps))).toEqual({ [`refeicao:${almoco}:receita`]: MSG_PLANO.receita });
    await salvarRascunho(T.ctx, nova, mantido, deps); // a sugestão que já estava, mesmo despublicada, não barra o salvamento
    // D13: e continua gravada (o editor mostra "indisponível"; republicada, o cartão volta)
    expect((await carregarPlano(T.ctx, nova, app.db))!.refeicoes[0].receita).toEqual({ id: panqueca.id, titulo: 'Panqueca de aveia', disponivel: false });
  });

  it('modelo leva a sugestão; excluir a receita solta a sugestão (SET NULL) sem apagar a refeição', async () => {
    const { T, panqueca, id, cafe, item } = await cenario();
    await salvarRascunho(T.ctx, id, corpo(0, cafe, item, panqueca.id), deps);
    const { id: modelo } = await salvarComoModelo(T.ctx, id, 'Modelo com panqueca', deps);
    expect((await carregarPlano(T.ctx, modelo, app.db))!.refeicoes[0].receita?.id).toBe(panqueca.id);
    await excluirConteudo(T.ctx, panqueca.id, { db: app.db });
    const [m] = await withTenant(T.ctx, (tx) => tx.select({ receita: meals.recipeContentId }).from(meals).where(eq(meals.id, cafe)), app.db);
    expect(m).toEqual({ receita: null });
    expect((await carregarPlano(T.ctx, id, app.db))!.refeicoes[0].receita).toBeUndefined();
  });
});
