import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { consultaDireta, em, localPrincipal, novoLocal, tenantAgenda } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { availabilityBlocks } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { agendaParaImprimir, CAMPOS_DA_IMPRESSAO } from './impressao';
import type { FiltrosDaAgenda } from './visoes';

/** Plano 23 (US-406, RN-418, RN-419): a impressão leva só a lista fechada de campos e grava um `exportar` sem paciente. */
const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl')); // só para ler o audit_log do teste
afterAll(async () => {
  await app.pool.end();
  await owner.pool.end();
});

const agora = new Date('2026-11-17T15:00:00Z');
const deps = { db: app.db, agora };
const filtros = (f: Partial<FiltrosDaAgenda> = {}): FiltrosDaAgenda => ({ visao: 'semana', data: '2026-11-17', horas24: false, retorno: false, aniversario: false, ...f });
const exportacoes = async (T: TenantDeTeste) =>
  (await owner.db.execute<{ acao: string; entidade: string; entidade_id: string; patient_id: string | null; actor_user_id: string | null }>(
    sql`select acao, entidade, entidade_id, patient_id, actor_user_id from audit_log where tenant_id = ${T.tenantId} and acao = 'exportar' order by criado_em`,
  )).rows;

async function cenario() {
  const T = await novoTenant(app.db);
  const principal = await localPrincipal(app.db, T.ctx);
  const video = await novoLocal(app.db, T.ctx, { nome: 'Videoconferência', tipo: 'online', linkSala: 'https://sala.exemplo.test/segredo' });
  const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza', email: 'ana.souza@exemplo.test', telefoneE164: '+5581999990000' });
  await consultaDireta(app.db, T.ctx, ana.id, em('2026-11-02', '10:00'), 60, { status: 'realizada' });
  await consultaDireta(app.db, T.ctx, ana.id, em('2026-11-17', '08:40'), 50, { localId: principal, status: 'confirmada', confirmadaVia: 'link' });
  await consultaDireta(app.db, T.ctx, ana.id, em('2026-11-18', '09:00'), 90, { localId: video, modalidade: 'online', linkOnline: 'https://sala.exemplo.test/segredo' });
  await consultaDireta(app.db, T.ctx, ana.id, em('2026-11-19', '14:00'), 60, { status: 'cancelada', canceladoPor: 'nutri', canceladaEm: agora, motivoCancelamento: 'Observação sigilosa' });
  await withTenant(T.ctx, (tx) => tx.insert(availabilityBlocks).values({ tenantId: T.tenantId, inicio: em('2026-11-20', '08:00'), fim: em('2026-11-20', '12:00'), motivo: 'Congresso secreto' }), app.db);
  return { ...T, principal, video, ana };
}

describe('impressão da agenda (US-406)', () => {
  it('cada linha tem exatamente as chaves de CAMPOS_DA_IMPRESSAO; bloqueio sem motivo; nada de contato, link, observação ou valor', async () => {
    const C = await cenario();
    const r = await agendaParaImprimir(C.ctx, tenantAgenda(C), filtros(), deps);
    expect(r.titulo).toBe('Agenda de 16/11/2026 a 22/11/2026');
    expect(r.local).toBe('Todos os locais');
    const linhas = r.dias.flatMap((d) => d.linhas);
    const consultas = linhas.filter((l) => !('bloqueado' in l));
    expect(consultas.length).toBe(2); // a cancelada fica fora da Semana (RN-413)
    for (const l of consultas) expect(Object.keys(l).sort()).toEqual([...CAMPOS_DA_IMPRESSAO].sort());
    expect(r.dias.find((d) => d.dia === '2026-11-17')?.linhas).toEqual([
      { hora: '08:40–09:30', paciente: 'Ana Souza', tipoConsulta: 'Retorno', local: 'Consultório', modalidade: 'Presencial', situacao: 'Confirmada' },
    ]);
    expect(r.dias.find((d) => d.dia === '2026-11-18')?.linhas).toEqual([
      { hora: '09:00–10:30', paciente: 'Ana Souza', tipoConsulta: 'Retorno', local: 'Videoconferência', modalidade: 'Online', situacao: 'Agendada' },
    ]);
    expect(r.dias.find((d) => d.dia === '2026-11-20')?.linhas).toEqual([{ bloqueado: '08:00–12:00' }]);
    const tudo = JSON.stringify(r);
    for (const proibido of ['ana.souza@exemplo.test', '+5581999990000', '99999', 'https://', 'segredo', 'Congresso', 'Observação sigilosa', 'R$']) {
      expect(tudo, proibido).not.toContain(proibido);
    }
  });

  it('Lista leva a cancelada (situação, sem o motivo); filtro de local no título', async () => {
    const C = await cenario();
    const r = await agendaParaImprimir(C.ctx, tenantAgenda(C), filtros({ visao: 'lista', local: C.principal }), deps);
    expect(r.local).toBe('Consultório');
    const linhas = r.dias.flatMap((d) => d.linhas).filter((l) => !('bloqueado' in l));
    expect(linhas.map((l) => ('situacao' in l ? l.situacao : ''))).toEqual(['Confirmada']); // só o Consultório
    const todas = await agendaParaImprimir(C.ctx, tenantAgenda(C), filtros({ visao: 'lista' }), deps);
    expect(todas.dias.flatMap((d) => d.linhas).some((l) => 'situacao' in l && l.situacao === 'Cancelada')).toBe(true);
    expect(JSON.stringify(todas)).not.toContain('Observação sigilosa');
  });

  it('grava um "exportar" da entidade agenda, sem paciente, com o período e o local em entidade_id (RN-419)', async () => {
    const C = await cenario();
    await agendaParaImprimir(C.ctx, tenantAgenda(C), filtros({ paciente: C.ana.id }), deps);
    await agendaParaImprimir(C.ctx, tenantAgenda(C), filtros({ visao: 'mes', local: C.video }), deps);
    expect(await exportacoes(C)).toEqual([
      { acao: 'exportar', entidade: 'agenda', entidade_id: '2026-11-16..2026-11-22|todos', patient_id: null, actor_user_id: C.nutriId },
      { acao: 'exportar', entidade: 'agenda', entidade_id: `2026-11-01..2026-11-30|${C.video}`, patient_id: null, actor_user_id: C.nutriId },
    ]);
    // nenhuma leitura auditada (AG-D30): só os dois "exportar"
    const ler = await owner.db.execute(sql`select 1 from audit_log where tenant_id = ${C.tenantId} and acao = 'ler'`);
    expect(ler.rows).toEqual([]);
  });

  it('só a sessão da nutricionista; nada é gravado na recusa', async () => {
    const C = await cenario();
    await expect(agendaParaImprimir(ctxPaciente(C.tenantId, C.ana.id), tenantAgenda(C), filtros(), deps)).rejects.toThrow('agenda: só a sessão nutri');
    expect(await exportacoes(C)).toEqual([]);
  });
});
