import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../test/db';
import { pacienteAutorizado, tarefaNoBanco } from '../../test/ia';
import { novoTenant } from '../../test/pacientes';
import { iaTarefas } from './schema';
import { withTenant, type TenantContext } from './tenant';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
const causa = (e: unknown) => ((e as { cause?: unknown }).cause ?? e) as { code?: string; message?: string; constraint?: string };
const violaCheck = (nome: string) => (e: unknown) => causa(e).code === '23514' && causa(e).constraint === nome;
const violaUnico = (nome: string) => (e: unknown) => causa(e).code === '23505' && causa(e).constraint === nome;
const negadoPor = (t: string) => (e: unknown) => causa(e).code === '42501' && String(causa(e).message).includes(t);
const CARIMBO = 'a'.repeat(64);

describe('0113/0114: resumo e rascunho em ia_tarefas (RN-103, RN-120, §11)', () => {
  it('os tipos novos entram; um em andamento por paciente e tipo (o índice sem exame, C2); a leitura segue por exame', async () => {
    const T = await novoTenant(app.db);
    const p = await pacienteAutorizado(app.db, T.ctx);
    await tarefaNoBanco(app.db, T.ctx, p.id, null, { tipo: 'resumo_historico', carimboDados: CARIMBO });
    await expect(tarefaNoBanco(app.db, T.ctx, p.id, null, { tipo: 'resumo_historico', carimboDados: CARIMBO, status: 'processando' })).rejects.toSatisfy(violaUnico('ia_tarefas_em_andamento_sem_exame_idx'));
    await tarefaNoBanco(app.db, T.ctx, p.id, null, { tipo: 'rascunho_plano' }); // outro tipo: pode
    await tarefaNoBanco(app.db, T.ctx, p.id, null, { tipo: 'resumo_historico', carimboDados: CARIMBO, status: 'falhou', erro: 'interrompida' }); // encerrada: não conta
    await expect(tarefaNoBanco(app.db, T.ctx, p.id, null, { tipo: 'parecer' })).rejects.toSatisfy(violaCheck('ia_tarefas_tipo_valido'));
  });

  it('carimbo só no resumo, com 64 caracteres hex; e não muda depois de gravado', async () => {
    const T = await novoTenant(app.db);
    const p = await pacienteAutorizado(app.db, T.ctx);
    await expect(tarefaNoBanco(app.db, T.ctx, p.id, null, { tipo: 'rascunho_plano', carimboDados: CARIMBO })).rejects.toSatisfy(violaCheck('ia_tarefas_carimbo_so_resumo'));
    await expect(tarefaNoBanco(app.db, T.ctx, p.id, null, { tipo: 'resumo_historico', carimboDados: 'curto' })).rejects.toSatisfy(violaCheck('ia_tarefas_carimbo_so_resumo'));
    const id = await tarefaNoBanco(app.db, T.ctx, p.id, null, { tipo: 'resumo_historico', carimboDados: CARIMBO });
    await expect(withTenant(T.ctx, (tx) => tx.execute(sql`update ia_tarefas set carimbo_dados = ${'b'.repeat(64)} where id = ${id}`), app.db)).rejects.toSatisfy(negadoPor('coluna fixa da tarefa de IA'));
  });

  it('o carimbo só muda pelo worker, no portão: em processando, ainda não enviada, junto com enviado_em (o carimbo do que saiu, RN-120)', async () => {
    const T = await novoTenant(app.db);
    const p = await pacienteAutorizado(app.db, T.ctx);
    const worker: TenantContext = { tenantId: T.tenantId, role: 'worker' };
    const [B, C] = ['b'.repeat(64), 'c'.repeat(64)];
    const trocar = (ctx: TenantContext, id: string, carimbo: string, comEnvio: boolean) =>
      withTenant(ctx, (tx) => tx.execute(comEnvio ? sql`update ia_tarefas set carimbo_dados = ${carimbo}, enviado_em = now() where id = ${id}` : sql`update ia_tarefas set carimbo_dados = ${carimbo} where id = ${id}`), app.db);
    const lida = async (id: string) =>
      (await withTenant(worker, (tx) => tx.select({ carimbo: iaTarefas.carimboDados, enviadoEm: iaTarefas.enviadoEm }).from(iaTarefas).where(eq(iaTarefas.id, id)), app.db))[0];

    const id = await tarefaNoBanco(app.db, T.ctx, p.id, null, { tipo: 'resumo_historico', carimboDados: CARIMBO, status: 'processando' });
    // a equipe nunca troca, nem junto com enviado_em
    await expect(trocar(T.ctx, id, B, true)).rejects.toSatisfy(negadoPor('coluna fixa da tarefa de IA'));
    // o worker, sem marcar o envio, também não
    await expect(trocar(worker, id, B, false)).rejects.toSatisfy(negadoPor('coluna fixa da tarefa de IA'));
    // o worker no portão (processando, sem enviado_em, marcando o envio): troca
    await trocar(worker, id, B, true);
    expect(await lida(id)).toMatchObject({ carimbo: B, enviadoEm: expect.any(Date) });
    // depois de enviada, nem o worker
    await expect(trocar(worker, id, C, true)).rejects.toSatisfy(negadoPor('coluna fixa da tarefa de IA'));
    // o provedor não recebeu (nao_enviado/repetir): enviado_em volta a nulo e a volta seguinte do portão grava o carimbo do novo pedido
    await withTenant(worker, (tx) => tx.update(iaTarefas).set({ enviadoEm: null }).where(eq(iaTarefas.id, id)), app.db);
    await trocar(worker, id, C, true);
    expect((await lida(id)).carimbo).toBe(C);
    // o CHECK vale também na troca do worker
    await withTenant(worker, (tx) => tx.update(iaTarefas).set({ enviadoEm: null }).where(eq(iaTarefas.id, id)), app.db);
    await expect(trocar(worker, id, 'curto', true)).rejects.toSatisfy(violaCheck('ia_tarefas_carimbo_so_resumo'));

    // fora de processando (na fila; encerrada), o worker não troca
    const p2 = await pacienteAutorizado(app.db, T.ctx);
    const naFila = await tarefaNoBanco(app.db, T.ctx, p2.id, null, { tipo: 'resumo_historico', carimboDados: CARIMBO });
    await expect(trocar(worker, naFila, B, true)).rejects.toSatisfy(negadoPor('coluna fixa da tarefa de IA'));
    const encerrada = await tarefaNoBanco(app.db, T.ctx, p2.id, null, { tipo: 'resumo_historico', carimboDados: CARIMBO, status: 'falhou', erro: 'interrompida' });
    await expect(trocar(worker, encerrada, B, true)).rejects.toSatisfy(negadoPor('coluna fixa da tarefa de IA'));
  });

  it('meal_plans.ia_origem_em só em plano de paciente (RN-117)', async () => {
    const T = await novoTenant(app.db);
    await expect(withTenant(T.ctx, (tx) => tx.execute(sql`insert into meal_plans (tenant_id, is_template, titulo, ia_origem_em) values (${T.tenantId}, true, 'M', now())`), app.db)).rejects.toSatisfy(violaCheck('meal_plans_ia_origem_so_paciente'));
  });
});
