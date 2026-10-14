import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../test/db';
import { pacienteAutorizado, tarefaNoBanco } from '../../test/ia';
import { novoTenant } from '../../test/pacientes';
import { withTenant } from './tenant';

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

  it('meal_plans.ia_origem_em só em plano de paciente (RN-117)', async () => {
    const T = await novoTenant(app.db);
    await expect(withTenant(T.ctx, (tx) => tx.execute(sql`insert into meal_plans (tenant_id, is_template, titulo, ia_origem_em) values (${T.tenantId}, true, 'M', now())`), app.db)).rejects.toSatisfy(violaCheck('meal_plans_ia_origem_so_paciente'));
  });
});
