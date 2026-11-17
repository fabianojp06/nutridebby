import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { consultaDireta, em, perdeCorridaNoBanco, semanaToda, SP } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { emailsNaFila, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { appointments, consents, notifications, patientCadastro, patients, publicBookingRequests, tenants, user } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { agendarLembretes, avisarPaciente } from '@/modules/notificacoes/agendar';
import { TERMO_PACIENTE } from '@/modules/pacientes/termo-paciente';
import { buscarTenantPorSlug } from '@/modules/plataforma/tenant-status';
import { MSG_TEXTO_ATUALIZADO } from '@/modules/plataforma/textos-versionados';
import {
  carregarPaginaPublica,
  confirmarCodigo,
  escolherOutroHorario,
  limparPedidosPublicos,
  MSG_PUBLICO,
  PublicoError,
  solicitarCodigo,
  type DepsPublico,
} from './agendamento-publico';
import { MSG_AGENDA } from './constantes';

const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  await owner.pool.end();
});
const agora = em('2026-10-14', '10:00');
/** Um IP por chamada (o limite de 10 por hora vale por IP): 16 milhões de combinações, sem colisão entre testes. */
const r254 = () => Math.floor(Math.random() * 254) + 1;
const ipUnico = () => `10.${r254()}.${r254()}.${r254()}`;
const deps = (extra: Partial<DepsPublico> = {}): DepsPublico => ({ db: app.db, agora, ip: ipUnico(), verificarTurnstile: async () => 'ok', appUrl: 'http://localhost:3000', ...extra });

async function consultorio(extra: Partial<typeof tenants.$inferInsert> = {}): Promise<TenantDeTeste & { slug: string }> {
  const T = await novoTenant(app.db, 'Debby Silva');
  // migration 0067: a página pública nasce desligada — o consultório destes testes a ligou
  const [t] = await app.db.update(tenants).set({ enderecoConsultorio: 'Rua das Flores, 10', agendamentoPublicoAtivo: true, ...extra }).where(eq(tenants.id, T.tenantId)).returning();
  await semanaToda(app.db, T.ctx);
  return { ...T, slug: t.slug };
}
const pedido = (inicio = em('2026-10-16', '09:00'), extra: Record<string, unknown> = {}) => ({
  nome: 'Ana Souza',
  email: `ana-${randomUUID().slice(0, 8)}@ex.com`,
  telefone: '(11) 91234-5678',
  maiorDeIdade: true,
  aceitouTermo: true,
  termoVersao: '1.0',
  whatsapp: true,
  inicio: inicio.toISOString(),
  modalidade: 'presencial',
  turnstileToken: 'tok',
  ...extra,
});
const codigoDe = async (email: string) => (await emailsNaFila('codigo_agendamento', email)).at(-1)!.codigo;
const falha = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof PublicoError) return { status: e.status, erros: e.erros };
    throw e;
  }
  throw new Error('esperava PublicoError');
};
const consultasDe = (T: TenantDeTeste, patientId: string) => withTenant(T.ctx, (tx) => tx.select().from(appointments).where(eq(appointments.patientId, patientId)), app.db);
const pacientesCom = (T: TenantDeTeste, email: string) => withTenant(T.ctx, (tx) => tx.select().from(patients).where(eq(patients.email, email)), app.db);
/** Recusa pela política da RLS (42501), não por outro motivo. */
const violaRls = (e: unknown) => {
  let c = e as { code?: string; cause?: unknown } | undefined;
  for (let i = 0; c && i < 5; i++, c = c.cause as typeof c) if (c.code === '42501') return true;
  return false;
};

describe('página pública (US-032, RN-16)', () => {
  it('ativa: nome e horários livres (só horas); desativada: "Agendamento online indisponível. Entre em contato."; inexistente', async () => {
    const T = await consultorio();
    const p = await carregarPaginaPublica(T.slug, { agora, db: app.db, semana: '2026-10-15' });
    expect(p).toMatchObject({ estado: 'ativa', tenantId: T.tenantId, nome: 'Debby Silva', temOnline: false, semana: '2026-10-12' });
    if (p.estado !== 'ativa') throw new Error();
    expect(p.horarios[0]).toEqual({ inicio: em('2026-10-15', '08:00').toISOString(), dia: 'qui., 15/10', data: '2026-10-15', hora: '08:00', modalidades: ['presencial'] });
    const D = await consultorio({ agendamentoPublicoAtivo: false });
    expect(await carregarPaginaPublica(D.slug, { agora, db: app.db })).toEqual({ estado: 'desativada', nome: 'Debby Silva' });
    const S = await consultorio({ status: 'suspensa' });
    expect(await carregarPaginaPublica(S.slug, { agora, db: app.db })).toEqual({ estado: 'suspensa', nome: 'Debby Silva' });
    expect(await carregarPaginaPublica('nao-existe-xyz', { agora, db: app.db })).toEqual({ estado: 'nao_encontrada' });
    expect(await carregarPaginaPublica('../x', { agora, db: app.db })).toEqual({ estado: 'nao_encontrada' });
    // a leitura de `tenants` é da plataforma (CLAUDE.md regra 1)
    expect((await buscarTenantPorSlug(app.db, T.slug))?.id).toBe(T.tenantId);
    expect(await buscarTenantPorSlug(app.db, "x' or '1'='1")).toBeNull();
  });

  it('?semana fora da janela do paciente (12 h–60 dias) ou inválida vira a primeira/última semana — nunca 500 (teto de datas)', async () => {
    const T = await consultorio();
    const pagina = (semana: unknown) => carregarPaginaPublica(T.slug, { agora, db: app.db, semana });
    const sem = async (semana: unknown) => {
      const p = await pagina(semana);
      if (p.estado !== 'ativa') throw new Error(p.estado);
      return { semana: p.semana, primeira: p.primeira, ultima: p.ultima, n: p.horarios.length };
    };
    // hoje (fuso do tenant) = 14/10/2026 (qua.); a janela vai até 13/12/2026 (dom.) → última semana começa em 07/12
    expect(await sem('9999-12-31')).toEqual({ semana: '2026-12-07', primeira: '2026-10-12', ultima: '2026-12-07', n: expect.any(Number) });
    expect(await sem('2026-02-30')).toMatchObject({ semana: '2026-10-12' });
    expect(await sem('2020-01-01')).toMatchObject({ semana: '2026-10-12' });
    expect(await sem('99999-01-01')).toMatchObject({ semana: '2026-10-12' });
    expect(await sem(['2026-11-02'])).toMatchObject({ semana: '2026-10-12' });
    expect(await sem('2026-11-04')).toMatchObject({ semana: '2026-11-02' });
    // na última semana, nada depois do fim da janela (agora + 60 dias)
    const ultima = await pagina('2026-12-07');
    if (ultima.estado !== 'ativa') throw new Error();
    expect(ultima.horarios.every((h) => h.inicio < new Date(agora.getTime() + 60 * 86_400_000).toISOString())).toBe(true);
  });

  it('fluxo feliz: código no e-mail → paciente novo sem nascimento/sexo, consulta, aceite do termo e aviso "novo paciente"', async () => {
    const T = await consultorio();
    const entrada = pedido();
    const { pedido: token } = await solicitarCodigo(T.slug, entrada, deps());
    const r = await confirmarCodigo(T.slug, { pedido: token, codigo: await codigoDe(entrada.email) }, deps());
    expect(r).toEqual({ estado: 'agendada', quando: 'sex., 16/10/2026 às 09:00 (horário de Brasília)' });
    const [p] = await pacientesCom(T, entrada.email);
    expect(p).toMatchObject({ nome: 'Ana Souza', origem: 'agendamento_publico', dataNascimento: null, sexo: null, telefoneE164: '+5511912345678', whatsappOptinOrigem: 'paciente', whatsappOptinEm: agora });
    const [c] = await consultasDe(T, p.id);
    expect(c).toMatchObject({ origem: 'paciente', status: 'agendada', inicio: em('2026-10-16', '09:00'), modalidade: 'presencial' });
    const [aceite] = await app.db.select().from(consents).where(eq(consents.patientId, p.id));
    expect(aceite).toMatchObject({ userId: null, tenantId: T.tenantId, termoVersao: 'termo-paciente-1.0' });
    // Plano 18 (US-260, RN-260): a página pública nunca cria o cadastro complementar
    expect(await withTenant(T.ctx, (tx) => tx.select().from(patientCadastro).where(eq(patientCadastro.patientId, p.id)), app.db)).toEqual([]);
    const [nutri] = await app.db.select({ email: user.email }).from(user).where(eq(user.id, T.nutriId));
    expect((await emailsNaFila('aviso_agenda', nutri.email)).map((m) => m.evento)).toEqual(['novo_paciente_publico']);
    // o pedido fica concluído e apontando para a consulta; repetir não marca outra
    const [pb] = await withTenant(T.ctx, (tx) => tx.select().from(publicBookingRequests).where(eq(publicBookingRequests.email, entrada.email)), app.db);
    expect(pb).toMatchObject({ appointmentId: c.id, concluidoEm: agora, verificadoEm: agora });
    expect(await falha(confirmarCodigo(T.slug, { pedido: token, codigo: '000000' }, deps()))).toEqual({ status: 410, erros: { geral: MSG_PUBLICO.codigoExpirado } });
    expect(await consultasDe(T, p.id)).toHaveLength(1);
  });

  it('no contexto publico, a consulta nova ganha lembretes (3 canais) e "Consulta marcada" (e-mail e push), sem erro do publico_sem_update', async () => {
    const T = await consultorio();
    const entrada = pedido(em('2026-10-17', '14:00'), { whatsapp: false });
    const { pedido: token } = await solicitarCodigo(T.slug, entrada, deps());
    await confirmarCodigo(T.slug, { pedido: token, codigo: await codigoDe(entrada.email) }, deps());
    const [p] = await pacientesCom(T, entrada.email);
    expect(p.whatsappOptinEm).toBeNull(); // sem opt-in marcado, nada de WhatsApp autorizado
    const ns = await withTenant(T.ctx, (tx) => tx.select().from(notifications).where(eq(notifications.patientId, p.id)), app.db);
    const resumo = ns.map((n) => `${n.tipo}/${n.canal}/${n.status}`).sort();
    expect(resumo).toEqual([
      'consulta_marcada/email/pendente',
      'consulta_marcada/push/pendente',
      'lembrete_24h/email/pendente',
      'lembrete_24h/push/pendente',
      'lembrete_24h/whatsapp/pendente',
      'lembrete_2h/email/pendente',
      'lembrete_2h/push/pendente',
      'lembrete_2h/whatsapp/pendente',
    ]);
  });

  it('publico × notifications: o FOR UPDATE de avisarPaciente não enxerga linhas (sem erro); o ON CONFLICT de agendarLembretes passa sem conflito e é recusado com conflito — por isso o fluxo público só grava consulta nova', async () => {
    const T = await consultorio();
    const ana = await novoPaciente(app.db, T.ctx);
    const inicio = em('2026-10-20', '10:00');
    const id = await consultaDireta(app.db, T.ctx, ana.id, inicio);
    const alvo = { tenantId: T.tenantId, patientId: ana.id, appointmentId: id, inicio };
    const pub = { tenantId: T.tenantId, role: 'publico' as const };
    // sem conflito (consulta sem nenhuma linha ainda): passa no publico
    await withTenant(pub, (tx) => agendarLembretes(tx, alvo, SP, agora), app.db);
    expect(await withTenant(T.ctx, (tx) => tx.select().from(notifications).where(eq(notifications.appointmentId, id)), app.db)).toHaveLength(6);
    // com conflito (as mesmas linhas de novo): o DO UPDATE exige a política de UPDATE → recusado pela RLS
    await expect(withTenant(pub, (tx) => agendarLembretes(tx, alvo, SP, agora), app.db)).rejects.toSatisfy(violaRls);
    // SELECT … FOR UPDATE no publico: as linhas existem (o SELECT simples vê), mas o FOR UPDATE as filtra, sem erro
    const vistas = await withTenant(pub, (tx) => tx.select({ id: notifications.id }).from(notifications).where(eq(notifications.appointmentId, id)), app.db);
    const travadas = await withTenant(pub, (tx) => tx.select({ id: notifications.id }).from(notifications).where(eq(notifications.appointmentId, id)).for('update'), app.db);
    expect(vistas).toHaveLength(6);
    expect(travadas).toEqual([]);
    // avisarPaciente no publico roda sem erro (numa consulta recém-criada não há aviso anterior para enxergar)
    await withTenant(pub, (tx) => avisarPaciente(tx, alvo, 'consulta_marcada', agora), app.db);
    // o publico não altera nem apaga notificações
    expect((await withTenant(pub, (tx) => tx.execute(sql`update notifications set status = 'ignorada', motivo_ignorada = 'prazo_passado' where appointment_id = ${id}`), app.db)).rowCount).toBe(0);
  });

  it('e-mail de paciente ativo: a consulta vai para ele (sem duplicar, aviso "marcada"); arquivado ou bloqueado → "Não foi possível agendar por aqui…" (nunca 500)', async () => {
    const T = await consultorio();
    const ana = await novoPaciente(app.db, T.ctx, { email: `ana-${randomUUID().slice(0, 8)}@ex.com` });
    const e1 = pedido(em('2026-10-16', '09:00'), { email: ana.email.toUpperCase() });
    const t1 = await solicitarCodigo(T.slug, e1, deps());
    await confirmarCodigo(T.slug, { pedido: t1.pedido, codigo: await codigoDe(ana.email) }, deps());
    expect(await consultasDe(T, ana.id)).toHaveLength(1);
    expect(await pacientesCom(T, ana.email)).toHaveLength(1);
    const [nutri] = await app.db.select({ email: user.email }).from(user).where(eq(user.id, T.nutriId));
    expect((await emailsNaFila('aviso_agenda', nutri.email)).map((m) => m.evento)).toEqual(['marcada']);
    for (const extra of [{ status: 'arquivado' }, { status: 'bloqueado', bloqueadoEm: agora }, { status: 'bloqueado', bloqueadoEm: agora, anonimizadoEm: agora }] as const) {
      const x = await novoPaciente(app.db, T.ctx, extra);
      const t2 = await solicitarCodigo(T.slug, pedido(em('2026-10-16', '10:00'), { email: x.email }), deps());
      expect(await falha(confirmarCodigo(T.slug, { pedido: t2.pedido, codigo: await codigoDe(x.email) }, deps()))).toEqual({ status: 409, erros: { geral: MSG_AGENDA.naoAgendavel } });
      expect(await consultasDe(T, x.id)).toEqual([]);
    }
  });

  it('3 consultas futuras: a 4ª é recusada só depois do código certo (não revela antes)', async () => {
    const T = await consultorio();
    const ana = await novoPaciente(app.db, T.ctx);
    for (const h of ['08:00', '09:00', '10:00']) await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-20', h));
    // consulta passada ou cancelada não conta
    await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-01', '10:00'));
    const t = await solicitarCodigo(T.slug, pedido(em('2026-10-16', '09:00'), { email: ana.email }), deps());
    expect(t).toEqual({ pedido: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) }); // mesma resposta de qualquer e-mail
    expect(await falha(confirmarCodigo(T.slug, { pedido: t.pedido, codigo: await codigoDe(ana.email) }, deps()))).toEqual({ status: 409, erros: { geral: MSG_AGENDA.limitePublico } });
    expect(await consultasDe(T, ana.id)).toHaveLength(4);
    // com uma das três canceladas, a próxima passa
    await withTenant(T.ctx, (tx) => tx.update(appointments).set({ status: 'cancelada', canceladoPor: 'nutri', canceladaEm: agora }).where(and(eq(appointments.patientId, ana.id), eq(appointments.inicio, em('2026-10-20', '08:00')))), app.db);
    const t2 = await solicitarCodigo(T.slug, pedido(em('2026-10-16', '11:00'), { email: ana.email }), deps({ agora: new Date(agora.getTime() + 61_000) }));
    expect(await confirmarCodigo(T.slug, { pedido: t2.pedido, codigo: await codigoDe(ana.email) }, deps({ agora: new Date(agora.getTime() + 61_000) }))).toMatchObject({ estado: 'agendada' });
  });

  it('código: errado 5 vezes bloqueia; expirado depois de 10 min; texto que não é um código não conta como tentativa', async () => {
    const T = await consultorio();
    const e = pedido();
    const t = await solicitarCodigo(T.slug, e, deps());
    const certo = await codigoDe(e.email);
    const errado = certo === '111111' ? '222222' : '111111';
    for (const lixo of ['', 'abc', '12345', '1234567', 42]) expect(await falha(confirmarCodigo(T.slug, { pedido: t.pedido, codigo: lixo }, deps()))).toEqual({ status: 422, erros: { codigo: MSG_PUBLICO.codigoIncorreto } });
    for (let i = 0; i < 5; i++) expect(await falha(confirmarCodigo(T.slug, { pedido: t.pedido, codigo: errado }, deps()))).toEqual({ status: 422, erros: { codigo: MSG_PUBLICO.codigoIncorreto } });
    expect(await falha(confirmarCodigo(T.slug, { pedido: t.pedido, codigo: certo }, deps()))).toEqual({ status: 410, erros: { geral: MSG_PUBLICO.codigoBloqueado } });
    const e2 = pedido(em('2026-10-16', '11:00'));
    const t2 = await solicitarCodigo(T.slug, e2, deps());
    const later = deps({ agora: new Date(agora.getTime() + 11 * 60_000) });
    expect(await falha(confirmarCodigo(T.slug, { pedido: t2.pedido, codigo: await codigoDe(e2.email) }, later))).toEqual({ status: 410, erros: { geral: MSG_PUBLICO.codigoExpirado } });
    // código com espaços (colado do e-mail) vale
    const e3 = pedido(em('2026-10-16', '12:00'));
    const t3 = await solicitarCodigo(T.slug, e3, deps());
    const c3 = await codigoDe(e3.email);
    expect(await confirmarCodigo(T.slug, { pedido: t3.pedido, codigo: `${c3.slice(0, 3)} ${c3.slice(3)}` }, deps())).toMatchObject({ estado: 'agendada' });
    // pedido inexistente ou que não é texto → expirado (410), sem 500
    for (const p of ['x'.repeat(43), 'nao-e-um-token', 123, null]) expect((await falha(confirmarCodigo(T.slug, { pedido: p, codigo: '123456' }, deps()))).status).toBe(410);
  });

  it('horário ocupado entre o pedido e o código: devolve outros horários; escolher outro conclui sem novo código (até 30 min)', async () => {
    const T = await consultorio();
    const e = pedido(em('2026-10-16', '14:00'));
    const t = await solicitarCodigo(T.slug, e, deps());
    await consultaDireta(app.db, T.ctx, (await novoPaciente(app.db, T.ctx)).id, em('2026-10-16', '14:00'));
    const r = await confirmarCodigo(T.slug, { pedido: t.pedido, codigo: await codigoDe(e.email) }, deps());
    expect(r.estado).toBe('horario_ocupado');
    if (r.estado !== 'horario_ocupado') throw new Error();
    expect(r.horarios.map((h) => h.data)).toContain('2026-10-16');
    expect(r.horarios.filter((h) => h.data === '2026-10-16').map((h) => h.hora)).not.toContain('14:00');
    expect(await pacientesCom(T, e.email)).toEqual([]); // nada gravado na tentativa que não marcou
    // um horário fora da janela (inclusive ano 9999) só devolve a lista de novo, presa à janela — nunca 500
    const fora = await escolherOutroHorario(T.slug, { pedido: t.pedido, inicio: '9999-12-31T10:00:00.000Z', modalidade: 'presencial' }, deps());
    expect(fora.estado).toBe('horario_ocupado');
    if (fora.estado !== 'horario_ocupado') throw new Error();
    expect(fora.horarios.every((h) => h.data <= '2026-12-13')).toBe(true);
    expect(await escolherOutroHorario(T.slug, { pedido: t.pedido, inicio: em('2026-10-16', '15:00').toISOString(), modalidade: 'presencial' }, deps())).toEqual({
      estado: 'agendada',
      quando: 'sex., 16/10/2026 às 15:00 (horário de Brasília)',
    });
    // concluído: não marca de novo
    expect((await falha(escolherOutroHorario(T.slug, { pedido: t.pedido, inicio: em('2026-10-16', '16:00').toISOString(), modalidade: 'presencial' }, deps()))).status).toBe(410);
    // pedido verificado há mais de 30 min (ocupado de novo) não serve mais, nem pelo /confirmar
    const e2 = pedido(em('2026-10-16', '17:00'));
    const t2 = await solicitarCodigo(T.slug, e2, deps());
    await consultaDireta(app.db, T.ctx, (await novoPaciente(app.db, T.ctx)).id, em('2026-10-16', '17:00'));
    expect((await confirmarCodigo(T.slug, { pedido: t2.pedido, codigo: await codigoDe(e2.email) }, deps())).estado).toBe('horario_ocupado');
    const depois = deps({ agora: new Date(agora.getTime() + 31 * 60_000) });
    expect(await falha(escolherOutroHorario(T.slug, { pedido: t2.pedido, inicio: em('2026-10-16', '18:00').toISOString(), modalidade: 'presencial' }, depois))).toEqual({ status: 410, erros: { geral: MSG_PUBLICO.codigoExpirado } });
    expect(await falha(confirmarCodigo(T.slug, { pedido: t2.pedido, codigo: '000000' }, depois))).toEqual({ status: 410, erros: { geral: MSG_PUBLICO.codigoExpirado } });
    // um pedido não verificado não escolhe outro horário (o código é obrigatório)
    const e3 = pedido(em('2026-10-16', '18:00'));
    const t3 = await solicitarCodigo(T.slug, e3, deps());
    expect((await falha(escolherOutroHorario(T.slug, { pedido: t3.pedido, inicio: em('2026-10-16', '19:00').toISOString(), modalidade: 'presencial' }, deps()))).status).toBe(410);
  });

  it('corrida no banco: outro paciente grava o mesmo horário entre a checagem e a gravação → "horário ocupado", sem paciente nem aceite órfão', async () => {
    const T = await consultorio();
    const outro = await novoPaciente(app.db, T.ctx);
    const e = pedido(em('2026-10-16', '13:00'));
    const t = await solicitarCodigo(T.slug, e, deps());
    const codigo = await codigoDe(e.email);
    let r: unknown;
    const erro = await perdeCorridaNoBanco({ app: app.pool, owner: owner.pool }, T, outro.id, em('2026-10-16', '13:00'), async () => {
      r = await confirmarCodigo(T.slug, { pedido: t.pedido, codigo }, deps());
    });
    expect(erro).toBeNull();
    expect(r).toMatchObject({ estado: 'horario_ocupado' });
    expect(await pacientesCom(T, e.email)).toEqual([]);
    // o pedido continua verificado: escolher outro horário conclui
    expect(await escolherOutroHorario(T.slug, { pedido: t.pedido, inicio: em('2026-10-16', '15:00').toISOString(), modalidade: 'presencial' }, deps())).toMatchObject({ estado: 'agendada' });
  });

  it('corrida com a nutricionista cadastrando o mesmo e-mail na mesma hora: a consulta vai para o paciente dela, sem 500', async () => {
    const T = await consultorio();
    const e = pedido(em('2026-10-16', '16:00'));
    const t = await solicitarCodigo(T.slug, e, deps());
    const codigo = await codigoDe(e.email);
    const outra = await app.pool.connect();
    let confirmada = false;
    try {
      await outra.query('begin');
      await outra.query(`select set_config('app.tenant_id', $1, true), set_config('app.role', 'nutri', true)`, [T.tenantId]);
      const { rows } = await outra.query<{ id: string }>(`insert into patients (tenant_id, nome, data_nascimento, sexo, email) values ($1, 'Ana da Nutri', '1990-01-01', 'F', $2) returning id`, [T.tenantId, e.email]);
      const pid = (await outra.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid;
      const resultado = confirmarCodigo(T.slug, { pedido: t.pedido, codigo }, deps()).then(
        (v) => v,
        (err: unknown) => err,
      );
      for (let i = 0; ; i++) {
        if ((await owner.pool.query('select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid))', [pid])).rowCount) break;
        if (i > 200) throw new Error('a gravação do paciente não ficou presa no índice único');
        await new Promise((res) => setTimeout(res, 10));
      }
      await outra.query('commit');
      confirmada = true;
      expect(await resultado).toEqual({ estado: 'agendada', quando: 'sex., 16/10/2026 às 16:00 (horário de Brasília)' });
      expect(await consultasDe(T, rows[0].id)).toHaveLength(1);
      expect(await pacientesCom(T, e.email)).toHaveLength(1);
    } finally {
      if (!confirmada) await outra.query('rollback').catch(() => undefined);
      outra.release();
    }
  });

  it('corrida com a nutricionista marcando o mesmo paciente no mesmo horário (paciente travado): com a pública forçada como vítima do 40P01 → "horário ocupado", sem 500', async () => {
    const T = await consultorio();
    const ana = await novoPaciente(app.db, T.ctx);
    const inicio = em('2026-10-16', '15:00');
    const t = await solicitarCodigo(T.slug, pedido(inicio, { email: ana.email }), deps());
    const codigo = await codigoDe(ana.email);
    const outra = await app.pool.connect();
    let encerrada = false;
    try {
      await outra.query('begin');
      await outra.query(`select set_config('app.tenant_id', $1, true), set_config('app.role', 'nutri', true)`, [T.tenantId]);
      await outra.query(`select set_config('deadlock_timeout', '10s', true)`); // a vítima do ciclo é a pública (P15-04, test/agenda.ts)
      await outra.query('select id from patients where id = $1 for update', [ana.id]); // como carregarPacienteParaEscrita
      const pid = (await outra.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid;
      const resultado = confirmarCodigo(T.slug, { pedido: t.pedido, codigo }, deps()).then(
        (v) => v,
        (err: unknown) => err,
      );
      // a pública já reservou o horário (EXCLUDE) e espera o paciente (FK da consulta nova)
      for (let i = 0; ; i++) {
        if ((await owner.pool.query('select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid))', [pid])).rowCount) break;
        if (i > 200) throw new Error('a página pública não ficou presa na trava do paciente');
        await new Promise((res) => setTimeout(res, 10));
      }
      // a nutricionista grava o mesmo horário: espera a pública, que espera por ela. Sem o deadlock_timeout longo daqui, o
      // detector podia desfazer qualquer uma das duas; com ele (10 s aqui, 1 s na pública), desfaz a pública desde que
      // este insert feche o ciclo dentro de 1 s de quando ela ficou presa (no PG16 cada espera confere uma vez só, depois
      // do próprio deadlock_timeout), e a nutricionista grava e confirma
      await outra.query(`insert into appointments (tenant_id, patient_id, inicio, fim, modalidade, origem) values ($1, $2, $3, $4, 'presencial', 'nutri')`, [
        T.tenantId,
        ana.id,
        inicio,
        new Date(inicio.getTime() + 3_600_000),
      ]);
      await outra.query('commit');
      encerrada = true;
      expect(await resultado).toMatchObject({ estado: 'horario_ocupado' });
      expect(await consultasDe(T, ana.id)).toMatchObject([{ origem: 'nutri', inicio }]);
    } finally {
      if (!encerrada) await outra.query('rollback').catch(() => undefined);
      outra.release();
    }
  });

  it('corrida com o pedido de exclusão atendido (paciente travado e bloqueado, ainda sem COMMIT): a pública espera a trava do paciente e reconfere — 409 "Não foi possível agendar…", sem consulta ativa', async () => {
    const T = await consultorio();
    const ana = await novoPaciente(app.db, T.ctx);
    const inicio = em('2026-10-16', '11:00');
    const t = await solicitarCodigo(T.slug, pedido(inicio, { email: ana.email }), deps());
    const codigo = await codigoDe(ana.email);
    const outra = await app.pool.connect();
    let encerrada = false;
    try {
      // como atenderPedidoExclusao: trava o paciente (carregarPacienteParaEscrita), bloqueia e cancela as futuras (nenhuma ainda)
      await outra.query('begin');
      await outra.query(`select set_config('app.tenant_id', $1, true), set_config('app.role', 'nutri', true)`, [T.tenantId]);
      await outra.query('select id from patients where id = $1 for update', [ana.id]);
      await outra.query(`update patients set status = 'bloqueado', bloqueado_em = now() where id = $1`, [ana.id]);
      const pid = (await outra.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid;
      // a pública leu o paciente ainda "ativo" (o UPDATE não tem COMMIT) e fica presa na trava dele
      const resultado = confirmarCodigo(T.slug, { pedido: t.pedido, codigo }, deps()).then(
        (v) => v,
        (err: unknown) => err,
      );
      for (let i = 0; ; i++) {
        if ((await owner.pool.query('select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid))', [pid])).rowCount) break;
        if (i > 200) throw new Error('a página pública não ficou presa na trava do paciente');
        await new Promise((res) => setTimeout(res, 10));
      }
      await outra.query('commit');
      encerrada = true;
      const r = await resultado;
      expect(r instanceof PublicoError ? { status: r.status, erros: r.erros } : r).toEqual({ status: 409, erros: { geral: MSG_AGENDA.naoAgendavel } });
      expect(await consultasDe(T, ana.id)).toEqual([]);
      expect(await withTenant(T.ctx, (tx) => tx.select().from(notifications).where(eq(notifications.patientId, ana.id)), app.db)).toEqual([]);
    } finally {
      if (!encerrada) await outra.query('rollback').catch(() => undefined);
      outra.release();
    }
  });

  it('validação, Turnstile e limites: nada é gravado antes do Turnstile; 11ª tentativa do IP → 429; código de novo em menos de 1 min → 429; 6º código do e-mail na hora → 429', async () => {
    const T = await consultorio();
    expect(await falha(solicitarCodigo(T.slug, pedido(undefined, { nome: 'A', email: 'x', telefone: '12', maiorDeIdade: false, aceitouTermo: false }), deps()))).toEqual({
      status: 422,
      erros: { nome: MSG_PUBLICO.nome, email: MSG_PUBLICO.email, telefone: MSG_PUBLICO.telefone, maiorDeIdade: MSG_PUBLICO.maioridade, aceitouTermo: MSG_PUBLICO.termo },
    });
    expect(await falha(solicitarCodigo(T.slug, pedido(undefined, { telefone: '', whatsapp: true }), deps()))).toEqual({ status: 422, erros: { telefone: MSG_PUBLICO.telefoneWhatsapp } });
    // P08-06: página aberta com outra versão do termo (deploy no meio) ou sem a versão → 422 no termo, nada gravado
    for (const termoVersao of ['0.1-provisorio', undefined]) {
      expect(await falha(solicitarCodigo(T.slug, pedido(undefined, { termoVersao }), deps()))).toEqual({ status: 422, erros: { aceitouTermo: MSG_TEXTO_ATUALIZADO } });
    }
    const e = pedido();
    let turnstileChamado = 0;
    const contar = (r: 'invalido' | 'indisponivel') => async () => {
      turnstileChamado++;
      return r;
    };
    expect(await falha(solicitarCodigo(T.slug, e, deps({ verificarTurnstile: contar('invalido') })))).toEqual({ status: 403, erros: { geral: 'Confirme que você não é um robô.' } });
    expect(await falha(solicitarCodigo(T.slug, e, deps({ verificarTurnstile: contar('indisponivel') })))).toEqual({ status: 503, erros: { geral: 'Tente novamente em alguns minutos' } });
    expect(turnstileChamado).toBe(2);
    expect(await withTenant(T.ctx, (tx) => tx.select().from(publicBookingRequests).where(eq(publicBookingRequests.email, e.email)), app.db)).toEqual([]);
    expect(await emailsNaFila('codigo_agendamento', e.email)).toEqual([]);
    // campos inválidos não chegam ao Turnstile (o token não é gasto)
    await falha(solicitarCodigo(T.slug, pedido(undefined, { nome: '' }), deps({ verificarTurnstile: contar('invalido') })));
    expect(turnstileChamado).toBe(2);
    const ip = ipUnico();
    for (let i = 0; i < 10; i++) await falha(solicitarCodigo(T.slug, pedido(undefined, { nome: '' }), deps({ ip })));
    expect(await falha(solicitarCodigo(T.slug, pedido(), deps({ ip })))).toEqual({ status: 429, erros: { geral: MSG_PUBLICO.muitasTentativas } });
    // o limite vale também para conferir o código (cada POST é uma tentativa do IP)
    expect((await falha(confirmarCodigo(T.slug, { pedido: 'x', codigo: '123456' }, deps({ ip })))).status).toBe(429);
    await solicitarCodigo(T.slug, e, deps());
    expect(await falha(solicitarCodigo(T.slug, { ...e, inicio: em('2026-10-16', '10:00').toISOString() }, deps({ agora: new Date(agora.getTime() + 30_000) })))).toEqual({ status: 429, erros: { geral: MSG_PUBLICO.aguarde } });
    // 5 códigos por e-mail na hora (o 1º acima já contou; o recusado pelo "aguarde" não — code-review do PR #7)
    for (let i = 1; i <= 4; i++) await solicitarCodigo(T.slug, { ...e, inicio: em('2026-10-16', `1${i}:00`).toISOString() }, deps({ agora: new Date(agora.getTime() + i * 61_000) }));
    expect(await falha(solicitarCodigo(T.slug, { ...e, inicio: em('2026-10-16', '15:00').toISOString() }, deps({ agora: new Date(agora.getTime() + 6 * 61_000) })))).toEqual({ status: 429, erros: { geral: MSG_PUBLICO.muitasTentativas } });
  });

  it('code-review do PR #7: cliques repetidos recusados pelo "aguarde" (1 código por minuto) não gastam a cota de 5 códigos do e-mail na hora', async () => {
    const T = await consultorio();
    const e = pedido();
    const em_ = (s: number) => deps({ agora: new Date(agora.getTime() + s * 1000) });
    await solicitarCodigo(T.slug, e, em_(0));
    for (let i = 1; i <= 4; i++) expect(await falha(solicitarCodigo(T.slug, e, em_(i * 10)))).toEqual({ status: 429, erros: { geral: MSG_PUBLICO.aguarde } });
    // passado o minuto: código novo (não "Muitas tentativas…")
    await solicitarCodigo(T.slug, e, em_(61));
    expect(await emailsNaFila('codigo_agendamento', e.email)).toHaveLength(2);
  });

  it('página desativada ou conta suspensa → 404 sem gravar nada; horário fora das regras ou da janela → 409', async () => {
    const D = await consultorio({ agendamentoPublicoAtivo: false });
    const ed = pedido();
    expect(await falha(solicitarCodigo(D.slug, ed, deps()))).toEqual({ status: 404, erros: { geral: MSG_PUBLICO.indisponivel } });
    const S = await consultorio({ status: 'suspensa' });
    expect((await falha(solicitarCodigo(S.slug, pedido(), deps()))).status).toBe(404);
    expect((await falha(solicitarCodigo('nao-existe-xyz', pedido(), deps()))).status).toBe(404);
    expect(await emailsNaFila('codigo_agendamento', ed.email)).toEqual([]);
    const T = await consultorio();
    expect(await falha(solicitarCodigo(T.slug, pedido(em('2026-10-16', '21:00')), deps()))).toEqual({ status: 409, erros: { inicio: MSG_AGENDA.indisponivel } });
    // antes da antecedência mínima (12 h), depois de 60 dias, ano 9999, lixo: sempre 409, nunca 500
    for (const inicio of [em('2026-10-14', '20:00').toISOString(), em('2026-12-14', '10:00').toISOString(), '9999-12-31T10:00:00.000Z', 'amanhã', 12]) {
      expect(await falha(solicitarCodigo(T.slug, pedido(undefined, { inicio }), deps())), String(inicio)).toEqual({ status: 409, erros: { inicio: MSG_AGENDA.indisponivel } });
    }
    expect(await falha(solicitarCodigo(T.slug, pedido(undefined, { modalidade: 'online' }), deps()))).toEqual({ status: 409, erros: { inicio: MSG_AGENDA.indisponivel } }); // sem link padrão, sem online
  });

  it('limpeza diária: pedidos com mais de 24 h somem (LGPD: minimização); os recentes ficam', async () => {
    const T = await consultorio();
    // datas de 2001: a limpeza varre todos os tenants e não pode alcançar as linhas dos outros arquivos de teste, que
    // rodam em paralelo no mesmo banco (isolamento.test.ts grava pedidos com now())
    const linha = (email: string, createdAt: Date) => ({
      id: randomUUID(),
      tenantId: T.tenantId,
      tokenHash: randomUUID(),
      codigoHash: 'x',
      email,
      nome: 'Ana Souza',
      inicio: em('2001-01-05', '09:00'),
      modalidade: 'presencial',
      termoVersao: TERMO_PACIENTE,
      expiraEm: new Date(createdAt.getTime() + 10 * 60_000),
      createdAt,
    });
    const velho = `velho-${randomUUID().slice(0, 8)}@ex.com`;
    const novo = `novo-${randomUUID().slice(0, 8)}@ex.com`;
    await withTenant(T.ctx, (tx) => tx.insert(publicBookingRequests).values([linha(velho, new Date('2001-01-01T00:00:00Z')), linha(novo, new Date('2001-01-02T12:00:00Z'))]), app.db);
    expect(await limparPedidosPublicos(app.db, new Date('2001-01-03T00:00:00Z'))).toBeGreaterThanOrEqual(1);
    const restam = await withTenant(T.ctx, (tx) => tx.select({ email: publicBookingRequests.email }).from(publicBookingRequests), app.db);
    expect(restam.map((r) => r.email)).toEqual([novo]);
  });
});
