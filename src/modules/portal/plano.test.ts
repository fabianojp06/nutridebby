import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { novoConteudo } from '../../../test/conteudos';
import { planoEmRascunho, planoPublicado as publicadoDeTeste, type RefeicaoDeTeste } from '../../../test/plano';
import { auditLog, mealPlans, referenciasNutrientes, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { lerMensagem } from '@/app/sw-regras';
import { criarAlimento } from '@/modules/alimentos/alimentos';
import { idTaco } from '@/modules/alimentos/taco';
import { despublicarConteudo } from '@/modules/conteudo/conteudos';
import { MAX_REFEICOES } from '@/modules/plano-alimentar/constantes';
import { ligarConteudo, ligarLista } from '@/modules/plano-alimentar/ligados';
import { salvarLista } from '@/modules/plano-alimentar/listas';
import { publicarPlano } from '@/modules/plano-alimentar/publicacao';
import { criarRascunho, salvarRascunho } from '@/modules/plano-alimentar/rascunho';
import { closeDb } from '@/db/client';
import { stopBoss } from '@/jobs/boss';
import { listaDoPlano } from './lista-compras';
import { muralDoPaciente } from './mural';
import { caminhoDoPdf, planoDoPaciente, proximaRefeicao, quantidadeDoItem, versaoDaCopiaOffline, type PlanoDoPaciente } from './plano';
import { perfilDoDia } from './plano-regras';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss(); // publicarPlano enfileira o PDF
  await closeDb();
  await app.pool.end();
});
const SP = 'America/Sao_Paulo';

/** Plano publicado com café (07:00, pão + substituição) e almoço (12:30, arroz 100 g). */
async function planoPublicado(o: { iaOrigemEm?: Date } = {}) {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx);
  const { id } = await criarRascunho(T.ctx, p.id, { db: app.db });
  // Plano 14B (RN-117): a marca de "Usar como rascunho" (o caminho real está em rascunho-ia.test.ts)
  if (o.iaOrigemEm) await withTenant(T.ctx, (tx) => tx.update(mealPlans).set({ iaOrigemEm: o.iaOrigemEm }).where(eq(mealPlans.id, id)), app.db);
  const [r] = await withTenant(T.ctx, (tx) => tx.select({ revisao: mealPlans.revisao }).from(mealPlans).where(eq(mealPlans.id, id)), app.db);
  const [cafe, almoco, pao, sub, arroz] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  await salvarRascunho(
    T.ctx,
    id,
    {
      revisao: r.revisao,
      envio: randomUUID(),
      titulo: 'Plano de setembro',
      metaKcal: '',
      mostrarCalorias: true,
      orientacoes: 'Beba água.',
      refeicoes: [
        { id: cafe, nome: 'Café da manhã', horario: '07:00', observacao: '', itens: [
          { id: pao, foodId: idTaco(3), quantidadeG: '50', medida: { nome: 'colher de sopa', plural: 'colheres de sopa', gramas: 25, qtd: 2 }, substituiItemId: null },
          { id: sub, foodId: idTaco(3), quantidadeG: '30', medida: null, substituiItemId: pao },
        ] },
        { id: almoco, nome: 'Almoço', horario: '12:30', observacao: 'Sem pressa', itens: [
          { id: arroz, foodId: idTaco(3), quantidadeG: '100', medida: null, substituiItemId: null },
        ] },
      ],
    },
    { db: app.db },
  );
  await publicarPlano(T.ctx, p.id, id, { db: app.db });
  return { T, p, planId: id };
}

describe('Meu plano (US-041)', () => {
  it('refeições em ordem de horário, medida caseira e gramas, substituições no item, kcal se o plano mostra', async () => {
    const { T, p } = await planoPublicado();
    const plano = await planoDoPaciente(ctxPaciente(T.tenantId, p.id), SP, { db: app.db, agora: new Date('2026-10-05T13:00:00Z') });
    expect(plano!.refeicoes.map((r) => [r.nome, r.horario])).toEqual([['Café da manhã', '07:00'], ['Almoço', '12:30']]);
    const pao = plano!.refeicoes[0].itens[0];
    expect(pao).toMatchObject({ nome: 'Arroz, tipo 1, cozido', quantidade: '2 colheres de sopa (50 g)', kcal: '64 kcal' });
    expect(pao.substituicoes).toEqual([expect.objectContaining({ quantidade: '30 g' })]);
    expect(plano!.refeicoes[0].itens).toHaveLength(1); // a substituição não vira item principal
    expect(plano!.orientacoes).toBe('Beba água.');
    // US-054: sem sugestão de receita, a refeição sai sem a chave (o portal não mostra o cartão)
    expect(plano!.refeicoes[0]).not.toHaveProperty('receita');
    // Plano 16 (RN-213): o total da refeição (sem as substituições), só com "mostrar calorias"
    expect(plano!.refeicoes.map((r) => r.kcal)).toEqual(['64 kcal', '128 kcal']);
    expect(plano!.mostrarCalorias).toBe(true);
    expect(plano!.seloIa).toBe(false); // RN-117: plano feito à mão, sem selo
  });

  it('selo (RN-117, A-D13): o plano publicado que nasceu do rascunho da IA tem seloIa', async () => {
    const { T, p } = await planoPublicado({ iaOrigemEm: new Date('2026-10-05T12:00:00Z') });
    expect(await planoDoPaciente(ctxPaciente(T.tenantId, p.id), SP, { db: app.db })).toMatchObject({ seloIa: true });
  });

  it('próxima refeição no fuso do tenant: 10:00 de Brasília → almoço; 21:00 → o café do dia seguinte ("Próxima: amanhã às 07:00")', async () => {
    const { T, p } = await planoPublicado();
    const ctx = ctxPaciente(T.tenantId, p.id);
    const as10 = await planoDoPaciente(ctx, SP, { db: app.db, agora: new Date('2026-10-05T13:00:00Z') }); // 10:00 em SP
    expect(as10!.refeicoes.find((r) => r.id === as10!.proxima?.id)!.nome).toBe('Almoço');
    expect(as10!.proxima?.texto).toBe('Próxima, daqui a 2 h 30 min');
    const as21 = await planoDoPaciente(ctx, SP, { db: app.db, agora: new Date('2026-10-06T00:00:00Z') }); // 21:00 em SP
    expect(as21!.refeicoes.find((r) => r.id === as21!.proxima?.id)!.nome).toBe('Café da manhã');
    expect(as21!.proxima?.texto).toBe('Próxima: amanhã às 07:00'); // RN-247 (d): daquiA só para hoje
    const TODOS = [0, 1, 2, 3, 4, 5, 6];
    expect(proximaRefeicao([], { dia: 1, minutos: 600 })).toBeNull();
    expect(proximaRefeicao([{ id: 'x', horario: '12:30', dias: TODOS }], { dia: 1, minutos: 750 })).toEqual({ id: 'x', texto: 'Próxima, agora' }); // na hora ainda é a próxima
  });

  it('Plano 16: refeição sem horário não é a "próxima" (vai para o fim da sanfona e nunca ao mural, RN-196)', () => {
    const TODOS = [0, 1, 2, 3, 4, 5, 6];
    expect(proximaRefeicao([{ id: 'ceia', horario: '', dias: TODOS }, { id: 'almoco', horario: '12:30', dias: TODOS }], { dia: 1, minutos: 600 })?.id).toBe('almoco');
    expect(proximaRefeicao([{ id: 'ceia', horario: '', dias: TODOS }], { dia: 1, minutos: 600 })).toBeNull();
  });

  it('RN-247 (d): a próxima com dias — mesma semana, a semana seguinte e só o mesmo dia da semana que vem', () => {
    const sabado = [{ id: 'almoco-sab', horario: '12:00', dias: [6] }];
    expect(proximaRefeicao(sabado, { dia: 6, minutos: 13 * 60 })).toEqual({ id: 'almoco-sab', texto: 'Próxima: sáb às 12:00' }); // depois da única, a do sábado que vem
    expect(proximaRefeicao(sabado, { dia: 4, minutos: 0 })).toEqual({ id: 'almoco-sab', texto: 'Próxima: sáb às 12:00' });
    expect(proximaRefeicao(sabado, { dia: 5, minutos: 23 * 60 })).toEqual({ id: 'almoco-sab', texto: 'Próxima: amanhã às 12:00' });
  });

  it('sem plano publicado → null (o rascunho não aparece: paciente_sem_rascunho)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await criarRascunho(T.ctx, p.id, { db: app.db });
    expect(await planoDoPaciente(ctxPaciente(T.tenantId, p.id), SP, { db: app.db })).toBeNull();
  });

  it('leitura auditada com o paciente como ator (D22); PDF pronto devolve o caminho, senão pendente', async () => {
    const { T, p, planId } = await planoPublicado();
    const ctx = { ...ctxPaciente(T.tenantId, p.id), actorUserId: T.nutriId }; // qualquer conta serve para conferir o ator
    await planoDoPaciente(ctx, SP, { db: app.db });
    const lidas = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.patientId, p.id), eq(auditLog.acao, 'ler'), eq(auditLog.entidade, 'plano_alimentar'))), app.db);
    expect(lidas.at(-1)?.actorUserId).toBe(T.nutriId);
    expect(await caminhoDoPdf(ctxPaciente(T.tenantId, p.id), app.db)).toEqual({ estado: 'pendente' }); // o worker não rodou
    await withTenant(T.ctx, (tx) => tx.update(mealPlans).set({ pdfStatus: 'pronto', pdfPath: null }).where(eq(mealPlans.id, planId)), app.db);
    expect(await caminhoDoPdf(ctxPaciente(T.tenantId, p.id), app.db)).toEqual({ estado: 'indisponivel' });
  });

  it('D6 + US-054: a versão da cópia offline com 15 refeições, todas com receita, passa por lerMensagem e muda quando uma sugestão sai ou é renomeada', () => {
    const refeicoes = Array.from({ length: MAX_REFEICOES }, (_, i) => ({ receita: { id: randomUUID(), titulo: `Receita ${i}`.padEnd(120, 'x') } }));
    const plano = { id: randomUUID(), refeicoes };
    const versao = versaoDaCopiaOffline(plano);
    expect(versao.length).toBeLessThanOrEqual(100);
    expect(lerMensagem({ tipo: 'plano', dono: randomUUID(), versao })).not.toBeNull();
    const semUma = versaoDaCopiaOffline({ ...plano, refeicoes: [{}, ...refeicoes.slice(1)] });
    expect(semUma).not.toBe(versao);
    expect(semUma.startsWith(`${plano.id}:`)).toBe(true);
    // a receita renomeada muda o cartão: a cópia offline também é trocada (achado do /code-review do PR #10)
    const renomeada = versaoDaCopiaOffline({ ...plano, refeicoes: [{ receita: { ...refeicoes[0].receita, titulo: 'Panqueca de banana' } }, ...refeicoes.slice(1)] });
    expect(renomeada).not.toBe(versao);
    expect(renomeada.length).toBeLessThanOrEqual(100);
    expect(versaoDaCopiaOffline(null)).toBe('sem-plano');
  });

  it('quantidadeDoItem: medida caseira com os gramas; sem medida, só os gramas com vírgula', () => {
    expect(quantidadeDoItem({ quantidadeG: 50, medidaCaseiraTxt: '2 colheres de sopa' })).toBe('2 colheres de sopa (50 g)');
    expect(quantidadeDoItem({ quantidadeG: 12.5, medidaCaseiraTxt: null })).toBe('12,5 g');
  });
});

const MANAUS = 'America/Manaus';
/** O tenant com o fuso de Manaus (UTC−4), sem mudar o banco: o mural só lê `fuso` e `cancelamentoMinH`. */
const tenantEm = async (tenantId: string, fuso: string) => ({ ...(await app.db.select().from(tenants).where(eq(tenants.id, tenantId)))[0], fuso });
const deps = { db: app.db };
/** "Meu alimento" com 100 kcal em 100 g e um micro de valor inconfundível (CS-232: ele nunca pode aparecer no app). */
const MICRO = '87654';
const meuAlimento = (T: { ctx: Parameters<typeof criarAlimento>[0] }) =>
  criarAlimento(T.ctx, { nome: 'Pão da casa', grupo: 'Cereais e derivados', kcal: '100', proteinaG: '5', carboidratoG: '15', lipidioG: '2', fibraG: '1', micros: { calcio_mg: MICRO } }, deps);
const umaLista = (foodId: string) => ({
  nome: 'Trocas do dia a dia',
  orientacao: 'Troque um item do grupo por outro.',
  grupos: [{ id: randomUUID(), nome: 'Carboidratos — 1 porção', itens: [{ id: randomUUID(), foodId, quantidadeG: '100', medida: null }] }],
});
const publicar = async (T: Awaited<ReturnType<typeof novoTenant>>, patientId: string, planId: string) => {
  const r = await publicarPlano(T.ctx, patientId, planId, deps);
  if (r.avisos) await publicarPlano(T.ctx, patientId, planId, deps, { confirmarAvisos: r.avisos });
};
const deHoje = (plano: PlanoDoPaciente) => perfilDoDia(plano.perfis, plano.hoje)?.refeicaoIds.map((id) => plano.refeicoes.find((r) => r.id === id)!.nome) ?? [];

describe('Plano 19 — o app do paciente (RN-240, RN-247, RN-252, RN-253)', () => {
  it('CS-232: projeção fechada do Plano, do mural e da lista de compras; nenhum micro nem perfil; conteúdo despublicado some (nem a cópia do título)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const ctx = ctxPaciente(T.tenantId, p.id);
    const { id: foodId } = await meuAlimento(T);
    const plano = await planoEmRascunho(app.db, T, p.id, { mostrarCalorias: true, refeicoes: [{ nome: 'Almoço', horario: '12:30', observacao: 'Sem pressa', itens: [{ gramas: 100, foodId }, { gramas: 50, foodId, substitui: 0 }] }] });
    const dono = { planId: plano.planId, patientId: p.id };
    const [perfil] = await withTenant(T.ctx, (tx) => tx.insert(referenciasNutrientes).values({ tenantId: T.tenantId, nome: 'Perfil sigiloso da Ana', fonte: 'Fonte sigilosa DRI', valores: { calcio_mg: { meta: 1000 } } }).returning(), app.db);
    await withTenant(T.ctx, (tx) => tx.update(mealPlans).set({ referenciaId: perfil.id, nutrientesExibidos: ['calcio_mg'], mostrarMicrosPdf: true }).where(eq(mealPlans.id, plano.planId)), app.db);
    const { id: listaId } = await salvarLista(T.ctx, null, umaLista(foodId), deps);
    await ligarLista(T.ctx, dono, listaId, deps);
    const fica = await novoConteudo(app.db, T, { titulo: 'Como montar o prato' });
    const sai = await novoConteudo(app.db, T, { titulo: 'Material que saiu do ar' });
    const doRascunho = await novoConteudo(app.db, T, { titulo: 'Material ainda em rascunho', status: 'rascunho' });
    for (const c of [fica, sai, doRascunho]) await ligarConteudo(T.ctx, dono, c.id, deps);
    await publicar(T, p.id, plano.planId);
    await despublicarConteudo(T.ctx, sai.id, deps);

    const r = (await planoDoPaciente(ctx, SP, { db: app.db }))!;
    expect(Object.keys(r).sort()).toEqual(['conteudos', 'hoje', 'id', 'listas', 'mostrarCalorias', 'orientacoes', 'pdf', 'perfis', 'proxima', 'refeicoes', 'seloIa', 'titulo']);
    expect(Object.keys(r.refeicoes[0]).sort()).toEqual(['descricaoLivre', 'dias', 'horario', 'id', 'itens', 'kcal', 'nome', 'observacao']);
    expect(Object.keys(r.refeicoes[0].itens[0]).sort()).toEqual(['id', 'kcal', 'nome', 'quantidade', 'substituicoes']);
    expect(Object.keys(r.refeicoes[0].itens[0].substituicoes[0]).sort()).toEqual(['id', 'kcal', 'nome', 'quantidade']);
    expect(Object.keys(r.perfis[0]).sort()).toEqual(['dias', 'refeicaoIds', 'titulo', 'totalKcal']);
    expect(Object.keys(r.listas[0]).sort()).toEqual(['grupos', 'nome', 'orientacao']);
    expect(Object.keys(r.listas[0].grupos[0]).sort()).toEqual(['itens', 'nome']);
    expect(Object.keys(r.listas[0].grupos[0].itens[0]).sort()).toEqual(['kcal', 'nome', 'quantidade']);
    // RN-253: só o publicado; o despublicado e o rascunho ligados não saem, nem o título copiado na ligação
    expect(r.conteudos).toEqual([{ id: fica.id, titulo: 'Como montar o prato', tipo: 'orientacao' }]);
    expect(r.listas).toEqual([{ nome: 'Trocas do dia a dia', orientacao: 'Troque um item do grupo por outro.', grupos: [{ nome: 'Carboidratos — 1 porção', itens: [{ nome: 'Pão da casa', quantidade: '100 g', kcal: '100 kcal' }] }] }]);

    const mural = await muralDoPaciente(ctx, await tenantEm(T.tenantId, SP), new Date(), app.db);
    expect(Object.keys(mural).sort()).toEqual(['anteriores', 'hoje', 'primeiroNome', 'semPlano', 'semRefeicaoHoje', 'vazio']);
    const compras = (await listaDoPlano(ctx, SP, 7, { db: app.db }))!;
    expect(Object.keys(compras).sort()).toEqual(['grupos', 'planoId', 'semAlimentos']);
    expect(Object.keys(compras.grupos[0]).sort()).toEqual(['grupo', 'itens']);
    expect(Object.keys(compras.grupos[0].itens[0]).sort()).toEqual(['gramas', 'nome', 'texto']);

    for (const [nome, resposta] of Object.entries({ plano: r, mural, compras })) {
      const json = JSON.stringify(resposta);
      expect(json, nome).not.toContain(MICRO);
      expect(json, nome).not.toMatch(/calcio|micros|referencia|nutrientesExibidos|listaOrigemId|foodId|sigilos/i);
      expect(json, nome).not.toMatch(/Material que saiu|Material ainda em rascunho/);
    }
  });

  it('CS-233 (Review Focus 3): America/Manaus — domingo 23:59 → as de domingo; segunda 00:00 → as de segunda (Plano e mural)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const ctx = ctxPaciente(T.tenantId, p.id);
    await publicadoDeTeste(app.db, T, p.id, {
      refeicoes: [
        { nome: 'Ceia de domingo', horario: '23:30', dias: [0] },
        { nome: 'Lanche de segunda', horario: '00:30', dias: [1] },
        { nome: 'Café da semana', horario: '07:30', dias: [1, 2, 3, 4, 5] },
      ],
    });
    const tenant = await tenantEm(T.tenantId, MANAUS);
    const domingo2359 = new Date('2026-11-16T03:59:00Z'); // domingo, 15/11/2026, 23:59 em Manaus (UTC−4)
    const segunda0000 = new Date('2026-11-16T04:00:00Z');
    const dom = (await planoDoPaciente(ctx, MANAUS, { db: app.db, agora: domingo2359 }))!;
    expect(dom.hoje).toBe(0);
    expect(deHoje(dom)).toEqual(['Ceia de domingo']);
    expect(dom.proxima?.texto).toBe('Próxima: amanhã às 00:30');
    const seg = (await planoDoPaciente(ctx, MANAUS, { db: app.db, agora: segunda0000 }))!;
    expect(seg.hoje).toBe(1);
    expect(deHoje(seg)).toEqual(['Lanche de segunda', 'Café da semana']);
    expect(seg.perfis.map((x) => x.titulo)).toEqual(['Segunda', 'Terça, quarta, quinta e sexta', 'Domingo']); // sábado sem refeição: fora dos perfis

    const refeicoesDoMural = async (agora: Date) => (await muralDoPaciente(ctx, tenant, agora, app.db)).hoje.flatMap((i) => (i.tipo === 'refeicao' ? [i.texto] : []));
    expect((await refeicoesDoMural(domingo2359)).join(' ')).toMatch(/Ceia de domingo/);
    expect((await refeicoesDoMural(domingo2359)).join(' ')).not.toMatch(/Lanche de segunda/); // 00:30 de segunda não é de domingo
    const doMuralSegunda = (await refeicoesDoMural(segunda0000)).join(' ');
    expect(doMuralSegunda).toMatch(/Lanche de segunda/);
    expect(doMuralSegunda).not.toMatch(/Ceia/);
  });

  it('RN-247 (d) / CS-233: depois da última de sábado, sem refeição no domingo → "Próxima: seg às 07:30"', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await publicadoDeTeste(app.db, T, p.id, {
      refeicoes: [
        { nome: 'Almoço de sábado', horario: '12:00', dias: [6] },
        { nome: 'Café da semana', horario: '07:30', dias: [1, 2, 3, 4, 5] },
      ],
    });
    const sabado21h = new Date('2026-11-15T01:00:00Z'); // sábado, 14/11/2026, 21:00 em Manaus
    const r = (await planoDoPaciente(ctxPaciente(T.tenantId, p.id), MANAUS, { db: app.db, agora: sabado21h }))!;
    expect(r.proxima).toEqual({ id: r.refeicoes.find((x) => x.nome === 'Café da semana')!.id, texto: 'Próxima: seg às 07:30' });
  });

  it('RN-247 (c): total do dia por perfil — num sábado, com dois "Almoço" (seg–sex 600 kcal, sáb–dom 800 kcal), só o de 800', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const { id: foodId } = await meuAlimento(T);
    await publicadoDeTeste(app.db, T, p.id, {
      mostrarCalorias: true,
      refeicoes: [
        { nome: 'Almoço', horario: '12:00', dias: [1, 2, 3, 4, 5], itens: [{ gramas: 600, foodId }] },
        { nome: 'Almoço', horario: '12:30', dias: [0, 6], itens: [{ gramas: 800, foodId }] },
      ],
    });
    const sabado = new Date('2026-11-14T15:00:00Z');
    const r = (await planoDoPaciente(ctxPaciente(T.tenantId, p.id), SP, { db: app.db, agora: sabado }))!;
    expect(r.hoje).toBe(6);
    expect(perfilDoDia(r.perfis, r.hoje)).toMatchObject({ titulo: 'Sábado e domingo', totalKcal: '800 kcal' });
    expect(r.perfis.map((x) => [x.titulo, x.totalKcal])).toEqual([['Segunda a sexta', '600 kcal'], ['Sábado e domingo', '800 kcal']]);
  });

  it('RN-252: a energia de cada item da lista ligada só com "mostrar calorias"; sem ele, nenhuma kcal na lista', async () => {
    const T = await novoTenant(app.db);
    const { id: listaId } = await salvarLista(T.ctx, null, umaLista(idTaco(3)), deps);
    const leitura = async (mostrarCalorias: boolean) => {
      const p = await novoPaciente(app.db, T.ctx);
      const plano = await planoEmRascunho(app.db, T, p.id, { mostrarCalorias });
      await ligarLista(T.ctx, { planId: plano.planId, patientId: p.id }, listaId, deps);
      await publicar(T, p.id, plano.planId);
      return (await planoDoPaciente(ctxPaciente(T.tenantId, p.id), SP, { db: app.db }))!.listas;
    };
    expect((await leitura(true))[0].grupos[0].itens).toEqual([{ nome: 'Arroz, tipo 1, cozido', quantidade: '100 g', kcal: '128 kcal' }]);
    const sem = await leitura(false);
    expect(sem[0].grupos[0].itens).toEqual([{ nome: 'Arroz, tipo 1, cozido', quantidade: '100 g', kcal: null }]);
    expect(JSON.stringify(sem)).not.toMatch(/\d kcal/);
  });

  it('RN-243: plano em texto livre — o texto da refeição sai, sem kcal (nem com "mostrar calorias" gravado), sem itens', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const refeicoes: RefeicaoDeTeste[] = [{ nome: 'Almoço', horario: '12:00', descricaoLivre: 'Arroz, feijão e salada à vontade.', itens: [] }];
    await publicadoDeTeste(app.db, T, p.id, { modo: 'livre', mostrarCalorias: true, refeicoes });
    const r = (await planoDoPaciente(ctxPaciente(T.tenantId, p.id), SP, { db: app.db }))!;
    expect(r.mostrarCalorias).toBe(false);
    expect(r.refeicoes[0]).toMatchObject({ descricaoLivre: 'Arroz, feijão e salada à vontade.', kcal: null, itens: [] });
    expect(r.perfis[0].totalKcal).toBeNull();
  });

  it('versaoDaCopiaOffline muda ao despublicar um conteúdo ligado e ao atualizar a lista', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const ctx = ctxPaciente(T.tenantId, p.id);
    const plano = await planoEmRascunho(app.db, T, p.id);
    const material = await novoConteudo(app.db, T, { titulo: 'Como ler rótulos' });
    await ligarConteudo(T.ctx, { planId: plano.planId, patientId: p.id }, material.id, deps);
    const { id: listaId } = await salvarLista(T.ctx, null, umaLista(idTaco(3)), deps);
    await ligarLista(T.ctx, { planId: plano.planId, patientId: p.id }, listaId, deps);
    await publicar(T, p.id, plano.planId);
    const antes = (await planoDoPaciente(ctx, SP, { db: app.db }))!;
    const versao = versaoDaCopiaOffline(antes);
    await despublicarConteudo(T.ctx, material.id, deps);
    const depois = (await planoDoPaciente(ctx, SP, { db: app.db }))!;
    expect(depois.conteudos).toEqual([]);
    expect(versaoDaCopiaOffline(depois)).not.toBe(versao);
    // a lista do publicado é uma cópia congelada: só muda num plano novo; a versão acompanha qualquer mudança da cópia
    const outraLista = { ...antes, listas: [{ ...antes.listas[0], grupos: [{ nome: 'Carboidratos — 1 porção', itens: [{ nome: 'Batata', quantidade: '150 g', kcal: null }] }] }] };
    expect(versaoDaCopiaOffline(outraLista)).not.toBe(versao);
    expect(versaoDaCopiaOffline({ ...antes, listas: [{ ...antes.listas[0], orientacao: 'Outra' }] })).not.toBe(versao);
    expect(versaoDaCopiaOffline(outraLista).length).toBeLessThanOrEqual(100);
  });
});
