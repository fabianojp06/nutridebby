import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { auditLog, mealPlans } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { lerMensagem } from '@/app/sw-regras';
import { idTaco } from '@/modules/alimentos/taco';
import { MAX_REFEICOES } from '@/modules/plano-alimentar/constantes';
import { publicarPlano } from '@/modules/plano-alimentar/publicacao';
import { criarRascunho, salvarRascunho } from '@/modules/plano-alimentar/rascunho';
import { closeDb } from '@/db/client';
import { stopBoss } from '@/jobs/boss';
import { caminhoDoPdf, planoDoPaciente, proximaRefeicao, quantidadeDoItem, versaoDaCopiaOffline } from './plano';

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

  it('próxima refeição no fuso do tenant: 10:00 de Brasília → almoço; 21:00 → o café do dia seguinte', async () => {
    const { T, p } = await planoPublicado();
    const ctx = ctxPaciente(T.tenantId, p.id);
    const as10 = await planoDoPaciente(ctx, SP, { db: app.db, agora: new Date('2026-10-05T13:00:00Z') }); // 10:00 em SP
    expect(as10!.refeicoes.find((r) => r.id === as10!.proximaRefeicaoId)!.nome).toBe('Almoço');
    const as21 = await planoDoPaciente(ctx, SP, { db: app.db, agora: new Date('2026-10-06T00:00:00Z') }); // 21:00 em SP
    expect(as21!.refeicoes.find((r) => r.id === as21!.proximaRefeicaoId)!.nome).toBe('Café da manhã');
    expect(proximaRefeicao([], '10:00')).toBeNull();
    expect(proximaRefeicao([{ id: 'x', horario: '12:30' }], '12:30')).toBe('x'); // na hora ainda é a próxima
  });

  it('Plano 16: refeição sem horário não é a "próxima" (vai para o fim da sanfona e nunca ao mural, RN-196)', () => {
    expect(proximaRefeicao([{ id: 'ceia', horario: '' }, { id: 'almoco', horario: '12:30' }], '10:00')).toBe('almoco');
    expect(proximaRefeicao([{ id: 'ceia', horario: '' }], '10:00')).toBeNull();
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
