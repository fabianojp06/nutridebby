import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novaEtiqueta, novoConteudo } from '../../../test/conteudos';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { pacienteComConta } from '../../../test/portal';
import { closeDb } from '@/db/client';
import { notifications } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { avisarConteudoNovo } from './aviso';
import { publicarConteudo } from './conteudos';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
const SP = 'America/Sao_Paulo';
const meioDia = new Date('2026-10-20T15:00:00Z'); // 12:00 em Brasília

async function cenario() {
  const T = await novoTenant(app.db);
  const { paciente: ana } = await pacienteComConta(app.db, T, { nome: 'Ana' });
  const { paciente: arquivada } = await pacienteComConta(app.db, T, { nome: 'Arquivada', status: 'arquivado' });
  const semConta = await novoPaciente(app.db, T.ctx, { nome: 'Sem conta' });
  return { T, ana, arquivada, semConta };
}
const avisos = (T: { ctx: Parameters<typeof withTenant>[0] }) =>
  withTenant(T.ctx, (tx) => tx.select().from(notifications).where(eq(notifications.tipo, 'conteudo_novo')).orderBy(notifications.createdAt), app.db);
const despublicar = (T: { ctx: Parameters<typeof withTenant>[0] }, id: string) =>
  withTenant(T.ctx, (tx) => tx.execute(sql`update contents set status = 'rascunho', publicado_em = null where id = ${id}`), app.db);

describe('aviso de conteúdo novo (US-053, D4, D5)', () => {
  it('só paciente ativo, com conta no portal e na audiência; push pendente agora', async () => {
    const { T, ana } = await cenario();
    const c = await novoConteudo(app.db, T, { status: 'rascunho', titulo: 'Como ler rótulos', corpoMd: 'x' });
    const r = await publicarConteudo(T.ctx, c.id, { avisar: true }, { db: app.db, agora: meioDia });
    expect(r).toEqual({ avisados: 1 });
    const [n] = await avisos(T);
    expect(n).toMatchObject({ patientId: ana.id, canal: 'push', status: 'pendente', appointmentId: null, agendadaPara: meioDia });
  });

  it('"no máximo 1 push de conteúdo por paciente a cada 24 h": o 2º conteúdo na mesma hora não avisa; 25 h depois, avisa', async () => {
    const { T } = await cenario();
    const aviso = (contentId: string, agora: Date) => withTenant(T.ctx, (tx) => avisarConteudoNovo(tx, { tenantId: T.tenantId, contentId, visibilidade: 'todos', fuso: SP }, agora), app.db);
    const c = await novoConteudo(app.db, T);
    expect(await aviso(c.id, meioDia)).toBe(1);
    expect(await aviso(c.id, new Date(meioDia.getTime() + 3_600_000))).toBe(0);
    expect(await aviso(c.id, new Date(meioDia.getTime() + 25 * 3_600_000))).toBe(1);
    expect(await avisos(T)).toHaveLength(2);
  });

  it('publicado às 22h (horário silencioso) → agendado para as 08:00 do dia seguinte', async () => {
    const { T } = await cenario();
    const c = await novoConteudo(app.db, T);
    const vinteDuas = new Date('2026-10-21T01:00:00Z'); // 22:00 de 20/10 em Brasília
    await withTenant(T.ctx, (tx) => avisarConteudoNovo(tx, { tenantId: T.tenantId, contentId: c.id, visibilidade: 'todos', fuso: SP }, vinteDuas), app.db);
    expect((await avisos(T))[0].agendadaPara).toEqual(new Date('2026-10-21T11:00:00Z'));
  });

  it('audiência por etiqueta: só quem está nela (a Ana, sem a etiqueta, não)', async () => {
    const { T } = await cenario();
    const { paciente: bia } = await pacienteComConta(app.db, T, { nome: 'Bia' });
    const gestante = await novaEtiqueta(app.db, T, 'gestante', [bia.id]);
    const c = await novoConteudo(app.db, T, { visibilidade: 'etiquetas', tags: [gestante] });
    expect(await withTenant(T.ctx, (tx) => avisarConteudoNovo(tx, { tenantId: T.tenantId, contentId: c.id, visibilidade: 'etiquetas', fuso: SP }, meioDia), app.db)).toBe(1);
    expect((await avisos(T)).map((n) => n.patientId)).toEqual([bia.id]);
  });

  it('sem "Avisar pacientes": nada; duas publicações ao mesmo tempo: um aviso só por paciente', async () => {
    const { T } = await cenario();
    const a = await novoConteudo(app.db, T, { status: 'rascunho', corpoMd: 'a' });
    const b = await novoConteudo(app.db, T, { status: 'rascunho', titulo: 'Outro', corpoMd: 'b' });
    expect(await publicarConteudo(T.ctx, a.id, { avisar: false }, { db: app.db, agora: meioDia })).toEqual({ avisados: 0 });
    await despublicar(T, a.id);
    await Promise.all([a.id, b.id].map((id) => publicarConteudo(T.ctx, id, { avisar: true }, { db: app.db, agora: meioDia })));
    expect(await avisos(T)).toHaveLength(1);
  });
});
