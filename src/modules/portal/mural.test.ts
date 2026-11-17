import { afterAll, describe, expect, inject, it } from 'vitest';
import { and, count, eq } from 'drizzle-orm';
import { consultaDireta } from '../../../test/agenda';
import { novoConteudo } from '../../../test/conteudos';
import { makeDb } from '../../../test/db';
import { envioNoBanco } from '../../../test/exames-enviados';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { planoPublicado } from '../../../test/plano';
import { closeDb } from '@/db/client';
import { auditLog, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { partesNoFuso } from '@/modules/agenda/fuso';
import { diaDaSemanaNoFuso } from '@/modules/plano-alimentar/dias';
import { registrarNoDiario } from './diario';
import { comentarRegistro } from './diario-nutri';
import { muralDoPaciente } from './mural';
import type { ItemDoMural, Mural } from './mural-regras';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss(); // a publicação do plano enfileira o PDF; o comentário, o push
  await closeDb();
  await app.pool.end();
});

const SP = 'America/Sao_Paulo';
const todos = (m: Mural): ItemDoMural[] => [...m.anteriores.flatMap((d) => d.itens), ...m.hoje];
const tenantDe = async (id: string) => (await app.db.select().from(tenants).where(eq(tenants.id, id)))[0];
const leituras = async (T: { tenantId: string; ctx: Parameters<typeof withTenant>[0] }, patientId: string) => {
  const r = await withTenant(
    T.ctx,
    (tx) => tx.select({ entidade: auditLog.entidade, n: count() }).from(auditLog).where(and(eq(auditLog.patientId, patientId), eq(auditLog.acao, 'ler'))).groupBy(auditLog.entidade),
    app.db,
  );
  return Object.fromEntries(r.map((x) => [x.entidade, x.n]));
};
/** HH:MM de daqui a 30 min em São Paulo (perto da meia-noite, 23:59: a refeição é sempre de hoje e já está na janela de 90 min). */
const horarioProximo = (agora: Date) => {
  const p = partesNoFuso(new Date(agora.getTime() + 30 * 60_000), SP);
  return p.data === partesNoFuso(agora, SP).data ? p.hora : '23:59';
};

describe('muralDoPaciente (Plano 16, RN-199, RN-200, RNF-190)', () => {
  it('junta as fontes do vínculo e audita a leitura uma vez por entidade com dado de saúde (plano, diário, exames enviados)', async () => {
    const agora = new Date();
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx, { nome: 'Marina Souza' });
    const ctx = ctxPaciente(T.tenantId, p.id);
    const { refeicoes } = await planoPublicado(app.db, T, p.id, { refeicoes: [{ nome: 'Almoço', horario: horarioProximo(agora) }] });
    const registro = await registrarNoDiario(ctx, { fuso: SP }, { refeicao: 'Café da manhã', texto: 'pão com ovo', foto: null }, { db: app.db });
    await comentarRegistro(T.ctx, registro.id, 'Ótima combinação!', { db: app.db });
    await envioNoBanco(app.db, T.ctx, p.id, { status: 'recebido', nome: 'Hemograma' });
    await consultaDireta(app.db, T.ctx, p.id, new Date(agora.getTime() + 26 * 3600_000), 60, { modalidade: 'online', linkOnline: 'https://meet.example/abc' });
    await novoConteudo(app.db, T, { titulo: 'Lanches para levar' });
    const antes = await leituras(T, p.id);

    const mural = await muralDoPaciente(ctx, await tenantDe(T.tenantId), agora, app.db);

    expect(mural.primeiroNome).toBe('Marina');
    const porTipo = new Map(todos(mural).map((i) => [i.tipo, i]));
    expect(porTipo.get('refeicao')).toMatchObject({ refeicaoId: refeicoes[0].id, respondida: false });
    expect(porTipo.get('registro')).toMatchObject({ autor: 'voce', texto: 'pão com ovo' });
    expect(porTipo.get('comentario')).toMatchObject({ autor: 'nutricionista', texto: 'Ótima combinação!' });
    expect(porTipo.get('exame')).toMatchObject({ texto: 'Hemograma: Aguardando sua nutricionista' });
    expect(porTipo.get('consulta')).toMatchObject({ podeConfirmar: true });
    expect(porTipo.get('plano')).toMatchObject({ texto: 'Seu novo plano alimentar está disponível.' });
    expect(porTipo.get('conteudo')).toMatchObject({ titulo: 'Lanches para levar' });
    expect(porTipo.has('documentos')).toBe(false); // documentos não liberados no consultório (D20 do 10A)

    const depois = await leituras(T, p.id);
    const novas = Object.fromEntries(Object.entries(depois).map(([k, n]) => [k, n - (antes[k] ?? 0)]).filter(([, n]) => n !== 0));
    expect(novas).toEqual({ plano_alimentar: 1, diario: 1, exames_enviados: 1 });
  });

  it('isolamento: nada de outro paciente do consultório, de outro consultório, nem conteúdo fora da audiência', async () => {
    const agora = new Date();
    const T = await novoTenant(app.db);
    const [p, outro] = [await novoPaciente(app.db, T.ctx), await novoPaciente(app.db, T.ctx)];
    const U = await novoTenant(app.db);
    const deU = await novoPaciente(app.db, U.ctx);
    await registrarNoDiario(ctxPaciente(T.tenantId, outro.id), { fuso: SP }, { refeicao: 'Jantar', texto: 'segredo do outro', foto: null }, { db: app.db });
    await registrarNoDiario(ctxPaciente(U.tenantId, deU.id), { fuso: SP }, { refeicao: 'Jantar', texto: 'segredo de outro consultório', foto: null }, { db: app.db });
    await envioNoBanco(app.db, T.ctx, outro.id, { status: 'recebido', nome: 'Exame do outro' });
    await consultaDireta(app.db, T.ctx, outro.id, new Date(agora.getTime() + 26 * 3600_000));
    await novoConteudo(app.db, T, { titulo: 'Só para o outro', visibilidade: 'pacientes', pacientes: [outro.id] });
    const mural = await muralDoPaciente(ctxPaciente(T.tenantId, p.id), await tenantDe(T.tenantId), agora, app.db);
    expect(JSON.stringify(mural)).not.toMatch(/segredo|Exame do outro|Só para o outro/);
    expect(mural.vazio).toBe(true);
    expect(await leituras(T, p.id)).toEqual({}); // nada lido, nada auditado
  });

  it('o "Comi assim" de hoje marca a refeição como respondida; envio cancelado não entra', async () => {
    const agora = new Date();
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const ctx = ctxPaciente(T.tenantId, p.id);
    const { refeicoes } = await planoPublicado(app.db, T, p.id, { refeicoes: [{ nome: 'Almoço', horario: horarioProximo(agora) }] });
    await registrarNoDiario(ctx, { fuso: SP }, { refeicao: null, texto: '', foto: null, refeicaoId: refeicoes[0].id, resposta: 'como_no_plano' }, { db: app.db });
    await envioNoBanco(app.db, T.ctx, p.id, { status: 'cancelado', nome: 'Cancelado' });
    const mural = await muralDoPaciente(ctx, await tenantDe(T.tenantId), agora, app.db);
    expect(todos(mural).find((i) => i.tipo === 'refeicao')).toMatchObject({ respondida: true });
    expect(todos(mural).find((i) => i.tipo === 'registro')).toMatchObject({ resposta: 'como_no_plano' });
    expect(JSON.stringify(mural)).not.toContain('Cancelado');
  });

  it('Plano 19 (RN-247 b, CS-233): só as refeições que valem hoje; sem nenhuma hoje, semRefeicaoHoje ("Seu plano não tem refeições para hoje.")', async () => {
    const agora = new Date();
    const hoje = diaDaSemanaNoFuso(agora, SP);
    const T = await novoTenant(app.db);
    const [p, q] = [await novoPaciente(app.db, T.ctx), await novoPaciente(app.db, T.ctx)];
    const outrosDias = [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== hoje);
    await planoPublicado(app.db, T, p.id, { refeicoes: [{ nome: 'Almoço de outro dia', horario: horarioProximo(agora), dias: outrosDias }] });
    const semHoje = await muralDoPaciente(ctxPaciente(T.tenantId, p.id), await tenantDe(T.tenantId), agora, app.db);
    expect(todos(semHoje).filter((i) => i.tipo === 'refeicao')).toEqual([]);
    expect(semHoje).toMatchObject({ semPlano: false, semRefeicaoHoje: true });
    const { refeicoes } = await planoPublicado(app.db, T, q.id, {
      refeicoes: [
        { nome: 'Almoço de hoje', horario: horarioProximo(agora), dias: [hoje] },
        { nome: 'Almoço de outro dia', horario: horarioProximo(agora), dias: outrosDias },
      ],
    });
    const comHoje = await muralDoPaciente(ctxPaciente(T.tenantId, q.id), await tenantDe(T.tenantId), agora, app.db);
    expect(todos(comHoje).filter((i) => i.tipo === 'refeicao').map((i) => i.tipo === 'refeicao' && i.refeicaoId)).toEqual([refeicoes[0].id]);
    expect(comHoje.semRefeicaoHoje).toBe(false);
  });

  it('só em sessão de paciente', async () => {
    const T = await novoTenant(app.db);
    await expect(muralDoPaciente(T.ctx, await tenantDe(T.tenantId), new Date(), app.db)).rejects.toThrow(/sessão de paciente/);
  });
});
