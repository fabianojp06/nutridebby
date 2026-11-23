import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { consultaDireta, pedidoDireto } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { documentoNoBanco } from '../../../test/documentos';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import type { Db } from '@/db/client';
import { accessEvents, auditLog, diaryEntries, locaisAtendimento, privacyRequests, tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { situacaoDoWhatsapp } from '@/modules/notificacoes/whatsapp/conexao';
import { situacaoDaCota } from '@/modules/notificacoes/whatsapp/cota';
import { pedidosDoTitularAbertos } from '@/modules/pacientes/lgpd';
import { metricasDeSucesso } from '@/modules/plataforma/metricas-sucesso';
import { contarDiariosNaoVistos } from '@/modules/portal/diario-nutri';
import { lerInicio, MSG_INICIO, resumoDoDia, resumoDoDiaNaTransacao, textoSemProxima } from './inicio';
import { contarPendenciasDePresenca, indicadoresDaAgenda, novidadesDaAgenda } from './presenca';

const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl')); // só para levar a leitura de hoje para ontem (o app não altera o audit_log)
afterAll(() => Promise.all([app.pool.end(), owner.pool.end()]));
const fuso = 'America/Sao_Paulo';
const agora = new Date('2026-10-20T15:00:00Z'); // 12:00 em São Paulo
const as = (h: number) => new Date(Date.UTC(2026, 9, 20, h + 3, 0)); // hora local → UTC

/** O `db` com a contagem das transações abertas por ele (cada withTenant abre uma). */
function contandoTransacoes(db: Db): { db: Db; n: () => number } {
  let n = 0;
  const contado = new Proxy(db, {
    get(alvo, chave, rec) {
      if (chave === 'transaction') return (...a: Parameters<Db['transaction']>) => (n++, alvo.transaction(...a));
      return Reflect.get(alvo, chave, rec);
    },
  });
  return { db: contado, n: () => n };
}
const leiturasDoDiario = (ctx: TenantContext, patientId: string) =>
  withTenant(ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.patientId, patientId), eq(auditLog.entidade, 'diario'), eq(auditLog.acao, 'ler'))), app.db);

describe('Início em bento (D22)', () => {
  it('próxima consulta: a primeira de hoje que ainda não terminou; nº da consulta; diário e portal em 7 dias (só contagens)', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const bia = await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' });
    await consultaDireta(app.db, T.ctx, ana.id, new Date('2026-09-20T13:00:00Z'), 60, { status: 'realizada' });
    await consultaDireta(app.db, T.ctx, bia.id, as(9), 60, { status: 'confirmada' }); // já terminou
    await consultaDireta(app.db, T.ctx, ana.id, as(15), 60, { status: 'confirmada' });
    await consultaDireta(app.db, T.ctx, bia.id, as(17), 60, { pedidoRemarcacaoEm: agora });
    await withTenant(T.ctx, async (tx) => {
      await tx.insert(diaryEntries).values([
        { tenantId: T.tenantId, patientId: ana.id, refeicao: 'Almoço', texto: 'arroz', dataHora: new Date('2026-10-18T15:00:00Z') },
        { tenantId: T.tenantId, patientId: ana.id, refeicao: 'Jantar', texto: 'sopa', dataHora: new Date('2026-10-01T22:00:00Z') }, // fora dos 7 dias
      ]);
      await tx.insert(accessEvents).values([
        { tenantId: T.tenantId, patientId: ana.id, dia: '2026-10-19' },
        { tenantId: T.tenantId, patientId: ana.id, dia: '2026-10-20' },
      ]);
    }, app.db);
    const r = await resumoDoDia(T.ctx, fuso, agora, app.db);
    expect(r.proxima?.consulta.patientId).toBe(ana.id);
    expect(r.proxima).toMatchObject({ numero: 2, diario7d: 1, portal7d: 2 });
    expect(r.hoje).toEqual({ total: 3, confirmadas: 2, pedidosRemarcacao: 1 });
    expect(r.agenda.map((c) => c.inicio.toISOString())).toEqual([as(9), as(15), as(17)].map((d) => d.toISOString()));
    expect(await contarDiariosNaoVistos(T.ctx, app.db)).toBe(2);
  });
  it('cancelada fica fora da agenda, dos totais e do nº da consulta; realizada ou falta de hoje não é a próxima', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const bia = await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' });
    await consultaDireta(app.db, T.ctx, ana.id, new Date('2026-09-20T13:00:00Z'), 60, { status: 'cancelada', canceladoPor: 'nutri', canceladaEm: agora });
    await consultaDireta(app.db, T.ctx, ana.id, new Date('2026-09-27T13:00:00Z'), 60, { status: 'realizada' });
    await consultaDireta(app.db, T.ctx, bia.id, as(13), 60, { status: 'cancelada', canceladoPor: 'nutri', canceladaEm: agora }); // ainda vai começar, mas cancelada
    await consultaDireta(app.db, T.ctx, bia.id, as(11), 120, { status: 'faltou' }); // termina às 13h, mas já tem desfecho
    await consultaDireta(app.db, T.ctx, ana.id, as(14), 60);
    const r = await resumoDoDia(T.ctx, fuso, agora, app.db);
    expect(r.agenda.map((c) => c.inicio.toISOString())).toEqual([as(11), as(14)].map((d) => d.toISOString()));
    expect(r.hoje).toEqual({ total: 2, confirmadas: 0, pedidosRemarcacao: 0 });
    expect(r.proxima).toMatchObject({ consulta: { patientId: ana.id }, numero: 2, diario7d: 0, portal7d: 0 });
  });
  it('Plano 23 (T6a, §4.3): o pedido de hoje aparece na agenda com o selo, mas não conta no número nem é a próxima', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const bia = await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' });
    await pedidoDireto(app.db, T, bia.id, as(13));
    await consultaDireta(app.db, T.ctx, ana.id, as(15), 60, { status: 'confirmada' });
    const r = await resumoDoDia(T.ctx, fuso, agora, app.db);
    expect(r.agenda.map((c) => [c.inicio.toISOString(), c.status])).toEqual([[as(13).toISOString(), 'solicitada'], [as(15).toISOString(), 'confirmada']]);
    expect(r.hoje).toEqual({ total: 1, confirmadas: 1, pedidosRemarcacao: 0 });
    expect(r.proxima).toMatchObject({ consulta: { patientId: ana.id }, numero: 1 });
  });
  it('achado 6 do /code-review do PR #12: o nº da consulta não conta faltas (só agendada, confirmada e realizada)', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    await consultaDireta(app.db, T.ctx, ana.id, new Date('2026-09-06T13:00:00Z'), 60, { status: 'faltou' });
    await consultaDireta(app.db, T.ctx, ana.id, new Date('2026-09-13T13:00:00Z'), 60, { status: 'realizada' });
    await consultaDireta(app.db, T.ctx, ana.id, new Date('2026-09-20T13:00:00Z'), 60, { status: 'faltou' });
    await consultaDireta(app.db, T.ctx, ana.id, new Date('2026-09-27T13:00:00Z'), 60, { status: 'cancelada', canceladoPor: 'nutri', canceladaEm: agora });
    await consultaDireta(app.db, T.ctx, ana.id, as(14), 60, { status: 'confirmada' });
    expect((await resumoDoDia(T.ctx, fuso, agora, app.db)).proxima).toMatchObject({ numero: 2 });
  });
  it('achado 7 (regra 8): a contagem do diário de um paciente nomeado é leitura auditada, na mesma transação', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const bia = await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' });
    await consultaDireta(app.db, T.ctx, ana.id, as(14), 60);
    await consultaDireta(app.db, T.ctx, bia.id, as(16), 60);
    await resumoDoDia(T.ctx, fuso, agora, app.db);
    const lidas = await leiturasDoDiario(T.ctx, ana.id);
    expect(lidas).toHaveLength(1);
    expect(lidas[0]).toMatchObject({ actorUserId: T.nutriId, entidadeId: null });
    expect(await leiturasDoDiario(T.ctx, bia.id)).toEqual([]); // só a da próxima consulta aparece
    // sem próxima consulta, nada de leitura
    const U = await novoTenant(app.db);
    const caio = await novoPaciente(app.db, U.ctx, { nome: 'Caio' });
    await consultaDireta(app.db, U.ctx, caio.id, as(9), 60, { status: 'confirmada' }); // já terminou
    await resumoDoDia(U.ctx, fuso, agora, app.db);
    expect(await leiturasDoDiario(U.ctx, caio.id)).toEqual([]);
  });
  it('decisão do dono (04/10/2026): a leitura do diário entra no histórico no máximo uma vez por paciente por dia (fuso do tenant)', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    await consultaDireta(app.db, T.ctx, ana.id, as(14), 60);
    for (let i = 0; i < 3; i++) await resumoDoDia(T.ctx, fuso, agora, app.db);
    const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId));
    await lerInicio(T.ctx, tenant, agora, { whatsappLigado: false }, app.db); // o Início inteiro passa pelo mesmo caminho
    const lidas = await leiturasDoDiario(T.ctx, ana.id);
    expect(lidas).toHaveLength(1);
    // dia seguinte no fuso do tenant: a leitura de hoje vira de ontem (1 min antes da meia-noite de São Paulo)
    await owner.db.execute(sql`update audit_log set criado_em = (date_trunc('day', clock_timestamp() at time zone ${fuso}) at time zone ${fuso}) - interval '1 minute' where id = ${lidas[0].id}`);
    for (let i = 0; i < 3; i++) await resumoDoDia(T.ctx, fuso, agora, app.db);
    expect(await leiturasDoDiario(T.ctx, ana.id)).toHaveLength(2);
    // duas aberturas ao mesmo tempo: a 2ª espera a 1ª terminar (trava por paciente) e vê a leitura dela — uma linha só
    const V = await novoTenant(app.db);
    const bia = await novoPaciente(app.db, V.ctx, { nome: 'Bia Lima' });
    await consultaDireta(app.db, V.ctx, bia.id, as(16), 60);
    let leu!: () => void;
    let soltar!: () => void;
    const primeiraLeu = new Promise<void>((r) => (leu = r));
    const segura = new Promise<void>((r) => (soltar = r));
    const primeira = withTenant(V.ctx, async (tx) => {
      await resumoDoDiaNaTransacao(tx, fuso, agora); // gravou a leitura, ainda sem commit
      leu();
      await segura;
    }, app.db);
    await primeiraLeu;
    const segunda = resumoDoDia(V.ctx, fuso, agora, app.db);
    await new Promise((r) => setTimeout(r, 300));
    soltar();
    await Promise.all([primeira, segunda]);
    expect(await leiturasDoDiario(V.ctx, bia.id)).toHaveLength(1);
    // a leitura do próprio paciente no portal hoje (outro ator) não esconde a da nutricionista
    const W = await novoTenant(app.db);
    const caio = await novoPaciente(app.db, W.ctx, { nome: 'Caio' });
    await consultaDireta(app.db, W.ctx, caio.id, as(16), 60);
    await owner.db.insert(auditLog).values({ tenantId: W.tenantId, actorUserId: crypto.randomUUID(), acao: 'ler', entidade: 'diario', patientId: caio.id });
    await resumoDoDia(W.ctx, fuso, agora, app.db);
    await resumoDoDia(W.ctx, fuso, agora, app.db);
    expect((await leiturasDoDiario(W.ctx, caio.id)).filter((l) => l.actorUserId === W.nutriId)).toHaveLength(1);
  });
  it('achado 3: o Início inteiro numa transação só (pool de 10), com o mesmo resultado das leituras separadas', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    await consultaDireta(app.db, T.ctx, ana.id, new Date('2026-10-13T13:00:00Z'), 60); // sem registro de presença
    await consultaDireta(app.db, T.ctx, ana.id, as(14), 60, { status: 'confirmada', pedidoRemarcacaoEm: agora });
    await withTenant(T.ctx, (tx) => tx.insert(privacyRequests).values({ tenantId: T.tenantId, patientId: ana.id, tipo: 'exportacao', prazo: '2026-11-04' }), app.db);
    await app.db.update(tenants).set({ goLiveEm: '2026-10-01' }).where(eq(tenants.id, T.tenantId));
    const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId));
    const c = contandoTransacoes(app.db);
    const r = await lerInicio(T.ctx, tenant, agora, { whatsappLigado: true }, c.db);
    expect(c.n()).toBe(1);
    const { proxima, ...semProxima } = await resumoDoDia(T.ctx, fuso, agora, app.db);
    expect(r).toEqual({
      whatsapp: await situacaoDoWhatsapp(T.ctx, true, app.db),
      cota: await situacaoDaCota(T.ctx, tenant, agora, app.db),
      indicadores: await indicadoresDaAgenda(T.ctx, fuso, agora, app.db),
      pendentes: await contarPendenciasDePresenca(T.ctx, agora, app.db),
      novidades: await novidadesDaAgenda(T.ctx, agora, app.db),
      pedidos: await pedidosDoTitularAbertos(T.ctx, app.db),
      dia: { proxima, ...semProxima },
      naoVistos: await contarDiariosNaoVistos(T.ctx, app.db),
      metricas: await metricasDeSucesso(T.ctx, tenant, agora, app.db),
      documentosAguardando: null, // D20: sem a liberação, nem conta
      solicitacoes: 0, // Plano 23 (US-409): nenhum pedido
    });
    expect(r.pendentes).toBe(1);
    expect(r.pedidos).toHaveLength(1);
    expect(r.novidades.pedidosRemarcacao).toHaveLength(1);
    // sem WhatsApp ligado, a cota nem é lida (RN-09)
    expect((await lerInicio(T.ctx, tenant, agora, { whatsappLigado: false }, app.db)).cota).toBeNull();
    // P-B8 / D20: com os documentos liberados, o cartão conta os que aguardam assinatura (na mesma transação)
    await documentoNoBanco(app.db, T.ctx, ana.id, { status: 'aguardando_assinatura' });
    const liberado = { ...tenant, documentosLiberados: true };
    const c2 = contandoTransacoes(app.db);
    expect((await lerInicio(T.ctx, liberado, agora, { whatsappLigado: false }, c2.db)).documentosAguardando).toBe(1);
    expect(c2.n()).toBe(1);
  });
  it('Plano 23 (US-409, T8): "Solicitações (3)" com 3 pedidos no prazo (o vencido e o respondido fora), na mesma transação; sem pendente, 0', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const [antes] = await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId));
    expect((await lerInicio(T.ctx, antes, agora, { whatsappLigado: false }, app.db)).solicitacoes).toBe(0);
    for (const dia of [22, 23, 24]) await pedidoDireto(app.db, T, ana.id, new Date(Date.UTC(2026, 9, dia, 12, 0)));
    await pedidoDireto(app.db, T, ana.id, new Date(Date.UTC(2026, 9, 20, 23, 0))); // 20:00 de hoje: vence às 08:00 (antecedência 12 h)
    const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId));
    const c = contandoTransacoes(app.db);
    expect((await lerInicio(T.ctx, tenant, agora, { whatsappLigado: false }, c.db)).solicitacoes).toBe(3);
    expect(c.n()).toBe(1);
  });
  it('Plano 23 (AG-D45): consultório sem local — abrir o Início cria o "Consultório" principal uma vez', async () => {
    const T = await novoTenant(app.db);
    await app.db.update(tenants).set({ enderecoConsultorio: 'Rua do Início, 7' }).where(eq(tenants.id, T.tenantId));
    const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId));
    await Promise.all([lerInicio(T.ctx, tenant, agora, { whatsappLigado: false }, app.db), lerInicio(T.ctx, tenant, agora, { whatsappLigado: false }, app.db)]);
    await lerInicio(T.ctx, tenant, agora, { whatsappLigado: false }, app.db);
    const locais = await withTenant(T.ctx, (tx) => tx.select().from(locaisAtendimento), app.db);
    expect(locais.map((l) => ({ nome: l.nome, tipo: l.tipo, endereco: l.endereco, principal: l.principal, agendamentoOnline: l.agendamentoOnline }))).toEqual([
      { nome: 'Consultório', tipo: 'presencial', endereco: 'Rua do Início, 7', principal: true, agendamentoOnline: true },
    ]);
  });
  it('achado 4: sem próxima consulta, o cartão diz "pela frente" quando já houve consulta hoje', () => {
    expect(textoSemProxima({ total: 0, confirmadas: 0, pedidosRemarcacao: 0 })).toBe('Nenhuma consulta hoje.');
    expect(textoSemProxima({ total: 2, confirmadas: 1, pedidosRemarcacao: 0 })).toBe('Nenhuma consulta pela frente hoje.');
    expect(MSG_INICIO.semConsultaHoje).toBe('Nenhuma consulta hoje.');
  });
  it('sem consulta hoje: proxima null e totais zerados', async () => {
    const T = await novoTenant(app.db);
    expect(await resumoDoDia(T.ctx, fuso, agora, app.db)).toEqual({ proxima: null, hoje: { total: 0, confirmadas: 0, pedidosRemarcacao: 0 }, agenda: [] });
  });
});
