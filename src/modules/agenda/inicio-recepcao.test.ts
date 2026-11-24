import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { consultaDireta } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { auditLog } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { inicioDaRecepcao, PRESENCA_NO_INICIO } from './inicio-recepcao';

/**
 * Plano 26 (RN-514, RE-D63, US-490): o Início da recepção na sessão dela, no banco de verdade (a RLS esconde o paciente
 * bloqueado). Só agenda: as chaves não têm indicador do mês, armazenamento, WhatsApp, IA, exames nem dúvidas.
 */
const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl')); // só para gravar o pedido do paciente (a nutricionista e o worker não criam `solicitada`)
afterAll(() => Promise.all([app.pool.end(), owner.pool.end()]));
const agora = new Date('2026-10-20T15:00:00Z'); // 12:00 em São Paulo
const as = (h: number, dia = 20) => new Date(Date.UTC(2026, 9, dia, h + 3, 0)); // hora local → UTC

let T: TenantDeTeste;
let rec: TenantContext;
let ana: string;
let bia: string;
const ids: Record<string, string> = {};

/** O pedido do paciente (Plano 23): `solicitada`, origem `paciente`, gravado sem contexto (o gatilho do pedido deixa). */
const pedido = async (patientId: string, inicio: Date) => {
  const r = await owner.pool.query<{ id: string }>(
    `insert into appointments (tenant_id, patient_id, inicio, fim, modalidade, origem, status) values ($1, $2, $3, $4, 'presencial', 'paciente', 'solicitada') returning id`,
    [T.tenantId, patientId, inicio, new Date(inicio.getTime() + 3_600_000)],
  );
  return r.rows[0].id;
};

beforeAll(async () => {
  T = await novoTenant(app.db);
  const recId = randomUUID();
  await owner.pool.query(`insert into "user" (id, name, email, app_role, tenant_id) values ($1, 'Carla Lima', $2, 'recepcao', $3)`, [recId, `rec-${recId.slice(0, 8)}@teste.dev`, T.tenantId]);
  await withTenant(T.ctx, (tx) => tx.execute(sql`insert into equipe_membros (tenant_id, user_id, papel, convidada_por) values (${T.tenantId}, ${recId}, 'recepcao', ${T.nutriId})`), app.db);
  rec = { tenantId: T.tenantId, role: 'recepcao', actorUserId: recId, ip: '203.0.113.36' };
  ana = (await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' })).id;
  bia = (await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' })).id;
  // hoje: duas da Ana (uma já começou), uma cancelada e uma da Bia (que vai ser bloqueada)
  ids.hoje10 = await consultaDireta(app.db, T.ctx, ana, as(10), 60, { status: 'confirmada' });
  ids.hoje14 = await consultaDireta(app.db, T.ctx, ana, as(14));
  ids.cancelada = await consultaDireta(app.db, T.ctx, ana, as(16), 60, { status: 'cancelada', canceladoPor: 'nutri', canceladaEm: agora, motivoCancelamento: 'motivo da nutricionista' });
  ids.biaHoje = await consultaDireta(app.db, T.ctx, bia, as(17));
  // sem registro de presença (terminou há mais de 24 h): sete da Ana e uma da Bia
  for (let d = 10; d <= 16; d++) ids[`pendente${d}`] = await consultaDireta(app.db, T.ctx, ana, as(9, d));
  ids.biaPendente = await consultaDireta(app.db, T.ctx, bia, as(9, 9));
  // pedidos: um no prazo (antecedência de 12 h), um fora do prazo, um hoje e um da Bia
  ids.pedido = await pedido(ana, as(10, 23));
  ids.pedidoForaDoPrazo = await pedido(ana, new Date(agora.getTime() + 3 * 3_600_000));
  ids.pedidoBia = await pedido(bia, as(11, 23));
  // o que o paciente fez na agenda: marcou pelo app (origem paciente, agendada)
  ids.peloPaciente = await consultaDireta(app.db, T.ctx, ana, as(9, 27), 60, { origem: 'paciente' });
  await withTenant({ tenantId: T.tenantId, role: 'worker' }, (tx) => tx.execute(sql`update patients set status = 'bloqueado', bloqueado_em = now(), anonimizar_apos = '2046-01-01' where id = ${bia}`), app.db);
});

describe('inicioDaRecepcao (RN-514)', () => {
  it('só as chaves do trabalho do dia (RE-D63): sem indicadores, armazenamento, WhatsApp, IA, exames, dúvidas ou diário', async () => {
    const r = await inicioDaRecepcao(rec, { fuso: 'America/Sao_Paulo', antecedenciaMinH: 12 }, agora, app.db);
    expect(Object.keys(r).sort()).toEqual(['agendaDeHoje', 'novidades', 'presenca', 'solicitacoes']);
    expect(Object.keys(r.novidades).sort()).toEqual(['canceladasPeloPaciente', 'marcadasPeloPaciente', 'pedidosRemarcacao']);
    const consultas = [...r.agendaDeHoje, ...r.presenca.consultas, ...Object.values(r.novidades).flat()];
    expect(consultas.length).toBeGreaterThan(0);
    for (const c of consultas) {
      expect(Object.keys(c).sort()).toEqual(
        ['canceladoPor', 'confirmadaVia', 'fim', 'id', 'inicio', 'linkOnline', 'modalidade', 'origem', 'paciente', 'pacienteNovoPublico', 'patientId', 'pedidoRemarcacaoEm', 'remarcadaDe', 'status'].sort(),
      );
      expect(JSON.stringify(c)).not.toContain('motivo da nutricionista');
    }
  });

  it('agenda de hoje sem canceladas e sem o paciente bloqueado; presença a registrar com o total e as mais antigas; pedidos no prazo', async () => {
    const r = await inicioDaRecepcao(rec, { fuso: 'America/Sao_Paulo', antecedenciaMinH: 12 }, agora, app.db);
    expect(r.agendaDeHoje.map((c) => c.id)).toEqual([ids.hoje10, ids.hoje14]);
    expect(r.presenca.total).toBe(7); // a da Bia fica de fora (RLS da recepção, RE-D40)
    expect(r.presenca.consultas.map((c) => c.id)).toEqual([10, 11, 12, 13, 14].map((d) => ids[`pendente${d}`]));
    expect(r.presenca.consultas).toHaveLength(PRESENCA_NO_INICIO);
    expect(r.solicitacoes).toBe(1); // nem o fora do prazo, nem o da Bia
    expect(r.novidades.marcadasPeloPaciente.map((c) => c.id)).toEqual([ids.peloPaciente]);
    // a nutricionista, no mesmo banco, vê a Bia (a diferença é só a RLS da recepção)
    const [n] = (await withTenant(T.ctx, (tx) => tx.execute(sql`select count(*)::int as n from appointments where status = 'solicitada'`), app.db)).rows as { n: number }[];
    expect(n.n).toBe(3);
  });

  it('não grava leitura nenhuma no Histórico de acessos (a agenda não é leitura auditada, D10)', async () => {
    await inicioDaRecepcao(rec, { fuso: 'America/Sao_Paulo', antecedenciaMinH: 12 }, agora, app.db);
    const leituras = await withTenant(T.ctx, (tx) => tx.select({ id: auditLog.id }).from(auditLog).where(and(eq(auditLog.actorUserId, rec.actorUserId!), eq(auditLog.acao, 'ler'))), app.db);
    expect(leituras).toEqual([]);
  });

  it('é só da sessão da recepção: a nutricionista tem o Início dela (lerInicio)', async () => {
    await expect(inicioDaRecepcao(T.ctx, { fuso: 'America/Sao_Paulo', antecedenciaMinH: 12 }, agora, app.db)).rejects.toThrow('só da sessão da recepção');
  });
});
