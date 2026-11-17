import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import { count, eq, sql } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { novaEtiqueta, novoConteudo } from '../../../test/conteudos';
import { documentoNoBanco, liberarDocumentos } from '../../../test/documentos';
import { envioNoBanco } from '../../../test/exames-enviados';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { pacienteComConta } from '../../../test/portal';
import { closeDb } from '@/db/client';
import { accessEvents, anthropometry, auditLog, consultations, diaryEntries, examSubmissions, iaNutriParticipacoes, invites, lembretesRotina, patients, pushSubscriptions, tenants, type TenantRow } from '@/db/schema';
import { TenantContextError, withTenant, type TenantContext } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { sha256 } from '@/lib/crypto';
import { textoDoAcesso } from '@/app/painel/pacientes/valores';
import { idTaco } from '@/modules/alimentos/taco';
import { documentosDoPaciente } from '@/modules/documentos/portal';
import { lembretesDoPaciente } from '@/modules/lembretes/equipe';
import { desligarMeuLembrete, pausarMeusLembretes } from '@/modules/lembretes/paciente';
import { listarAntropometrias } from '@/modules/pacientes/antropometria';
import { situacaoDoAcesso } from '@/modules/pacientes/convite-paciente';
import { hojeNoFuso } from '@/modules/pacientes/datas';
import { definirPesoOculto } from '@/modules/pacientes/peso-oculto';
import { feedDeConteudos } from '@/modules/portal/conteudos';
import { diarioDoPaciente } from '@/modules/portal/diario';
import { evolucaoParaPaciente } from '@/modules/portal/evolucao';
import { meusEnvios } from '@/modules/portal/exames-enviados';
import { jornadaDoPaciente } from '@/modules/portal/jornada';
import { listaDoPlano } from '@/modules/portal/lista-compras';
import { planoDoPaciente } from '@/modules/portal/plano';
import { noAppDoPaciente } from './no-app';
import { SECOES_DA_FICHA } from './secoes';

// Quem abriu o contexto do paciente sem login (o `withTenant` de verdade, só anotando): para provar que ele não abre
// (e, com `antes`, o que muda no banco entre a transação da sessão `nutri` e a do paciente)
const aberturas = vi.hoisted(() => ({ semConta: [] as string[], antes: null as null | (() => Promise<unknown>) }));
vi.mock('@/db/tenant', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/db/tenant')>();
  const withTenant: typeof real.withTenant = async (ctx, fn, db) => {
    if (ctx.semConta) {
      aberturas.semConta.push(ctx.patientId ?? '');
      if (aberturas.antes) await aberturas.antes();
    }
    return real.withTenant(ctx, fn, db);
  };
  return { ...real, withTenant };
});

// Plano 18 (D16, D24, RN-279, RN-281; Review Focus 2, CS-261): o "No app" conta o que o portal devolve ao mesmo paciente
// na sessão dele (com login) — contagens e selos iguais —, sem trilha de leitura e só pela sessão da nutricionista.
const app = makeDb(inject('appDatabaseUrl'));
const dono = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  await dono.pool.end();
});

const FUSO = 'America/Sao_Paulo';
const DIA = 24 * 60 * 60 * 1000;
const AGORA = new Date();

/** Plano direto no banco (com refeições e itens), como os testes de conteudos.test.ts: sem a publicação nem a fila do PDF. */
async function plano(
  T: TenantDeTeste,
  patientId: string,
  o: { status: 'publicado' | 'arquivado'; versao: number; publicadoEm: Date; refeicoes: { receita?: string; itens: { substitui?: number }[] }[] },
): Promise<string> {
  return withTenant(
    T.ctx,
    async (tx) => {
      const [p] = (
        await tx.execute(sql`insert into meal_plans (tenant_id, patient_id, titulo, status, versao, publicado_em)
          values (${T.tenantId}, ${patientId}, 'Plano de teste', ${o.status}, ${o.versao}, ${o.publicadoEm}) returning id`)
      ).rows as { id: string }[];
      for (const [ordem, r] of o.refeicoes.entries()) {
        const refeicao = randomUUID();
        await tx.execute(sql`insert into meals (id, tenant_id, patient_id, plan_id, nome, horario, ordem, recipe_content_id)
          values (${refeicao}, ${T.tenantId}, ${patientId}, ${p.id}, ${`Refeição ${ordem + 1}`}, '12:00', ${ordem}, ${r.receita ?? null})`);
        const ids = r.itens.map(() => randomUUID());
        for (const [k, item] of r.itens.entries())
          await tx.execute(sql`insert into meal_items (id, tenant_id, patient_id, plan_id, meal_id, food_id, quantidade_g, ordem, substitui_item_id)
            values (${ids[k]}, ${T.tenantId}, ${patientId}, ${p.id}, ${refeicao}, ${idTaco(3)}, 100, ${k}, ${item.substitui === undefined ? null : ids[item.substitui]})`);
      }
      return p.id;
    },
    app.db,
  );
}

const inserir = <R>(ctx: TenantContext, fn: Parameters<typeof withTenant<R>>[1]) => withTenant(ctx, fn, app.db);

/**
 * Cenário único (Review Focus 2): Ana com conta e sem a etiqueta "gestante"; conteúdo e receita só para "gestante";
 * plano arquivado e publicado (receita "gestante", receita para todos e receita despublicada); documento emitido, cancelado,
 * rascunho e um anonimizado; envio cancelado e recebido; peso oculto; diário dentro e fora dos 30 dias; lembretes (um ligado,
 * um desligado pelo paciente, a pausa); um aparelho; WhatsApp autorizado. Mais: Bia arquivada (com conta), Caio com o plano
 * publicado sem item principal e sem lembrete, e Duda com o convite pendente.
 */
async function montar() {
  const T = await novoTenant(app.db);
  await liberarDocumentos(app.db, T.tenantId);
  await app.db.update(tenants).set({ mostrarPercGorduraPaciente: true, examesPacienteAtivadoEm: new Date() }).where(eq(tenants.id, T.tenantId));
  const { paciente: ana, userId } = await pacienteComConta(app.db, T, { whatsappOptinEm: new Date(), whatsappOptinOrigem: 'nutri' });
  const ctxAna = ctxPaciente(T.tenantId, ana.id, userId);

  const gestante = await novaEtiqueta(app.db, T, 'gestante');
  const paraTodos = await novoConteudo(app.db, T, { titulo: 'Para todos' });
  await novoConteudo(app.db, T, { titulo: 'Só gestante', visibilidade: 'etiquetas', tags: [gestante] });
  await novoConteudo(app.db, T, { titulo: 'Rascunho', status: 'rascunho' });
  const receitaGestante = await novoConteudo(app.db, T, { tipo: 'receita', titulo: 'Panqueca', visibilidade: 'etiquetas', tags: [gestante], receita: { rendimento: 1000, porcao: 250 } });
  const receitaTodos = await novoConteudo(app.db, T, { tipo: 'receita', titulo: 'Salada', receita: { rendimento: 500, porcao: 250 } });
  const receitaRascunho = await novoConteudo(app.db, T, { tipo: 'receita', titulo: 'Sopa', status: 'rascunho', receita: { rendimento: 500, porcao: 250 } });

  const arquivado = await plano(T, ana.id, { status: 'arquivado', versao: 1, publicadoEm: new Date('2026-09-01T15:00:00Z'), refeicoes: [{ itens: [{}] }] });
  // 02h UTC de 10/11 = 23h de 09/11 em São Paulo: a data é a do fuso
  const publicado = await plano(T, ana.id, {
    status: 'publicado',
    versao: 2,
    publicadoEm: new Date('2026-11-10T02:00:00Z'),
    refeicoes: [{ receita: receitaGestante.id, itens: [{}, { substitui: 0 }] }, { receita: receitaTodos.id, itens: [{}] }, { receita: receitaRascunho.id, itens: [] }, { receita: receitaTodos.id, itens: [] }],
  });

  const emitido = await documentoNoBanco(app.db, T.ctx, ana.id, { status: 'assinado' });
  const cancelado = await documentoNoBanco(app.db, T.ctx, ana.id, { status: 'cancelado', tipo: 'parecer' });
  const rascunho = await documentoNoBanco(app.db, T.ctx, ana.id, { status: 'rascunho' });
  const anonimizado = await documentoNoBanco(app.db, T.ctx, ana.id, { status: 'assinado' });
  // a marca de anonimização só nasce com o titular bloqueado (app_anonimizar_documentos): aqui, direto, para exercitar o
  // filtro de `anonimizado_em` que o portal aplica em TypeScript
  await dono.db.transaction(async (tx) => {
    await tx.execute(sql`set local session_replication_role = replica`);
    await tx.execute(sql`update signed_documents set anonimizado_em = now() where id = ${anonimizado.id}`);
  });

  const envioCancelado = await envioNoBanco(app.db, T.ctx, ana.id, { status: 'cancelado' });
  const envioRecebido = await envioNoBanco(app.db, T.ctx, ana.id, { status: 'recebido' });

  const [av1, av2] = await inserir(T.ctx, (tx) =>
    tx
      .insert(anthropometry)
      .values([
        { tenantId: T.tenantId, patientId: ana.id, data: '2026-10-01', pesoKg: 70, alturaCm: 170, percGordura: 25 },
        { tenantId: T.tenantId, patientId: ana.id, data: '2026-11-01', pesoKg: 69, alturaCm: 170 },
      ])
      .returning({ id: anthropometry.id }),
  );
  const [at1, at2] = await inserir(T.ctx, (tx) =>
    tx
      .insert(consultations)
      .values([
        { tenantId: T.tenantId, patientId: ana.id, data: '2026-10-01', orientacoesPaciente: 'Beber água' },
        { tenantId: T.tenantId, patientId: ana.id, data: '2026-11-01' },
      ])
      .returning({ id: consultations.id }),
  );
  await definirPesoOculto(T.ctx, ana.id, true, { db: app.db });

  await inserir(ctxAna, (tx) =>
    tx.insert(diaryEntries).values([
      { tenantId: T.tenantId, patientId: ana.id, refeicao: 'Almoço', texto: 'arroz', dataHora: new Date(AGORA.getTime() - 10 * DIA) },
      { tenantId: T.tenantId, patientId: ana.id, refeicao: 'Jantar', texto: 'sopa', dataHora: new Date(AGORA.getTime() - 40 * DIA) },
    ]),
  );
  await inserir(ctxAna, (tx) => tx.insert(accessEvents).values({ tenantId: T.tenantId, patientId: ana.id, dia: '2026-11-14' }));
  await inserir(ctxAna, (tx) => tx.insert(accessEvents).values({ tenantId: T.tenantId, patientId: ana.id, dia: '2026-11-12' }));
  await inserir(T.ctx, (tx) => tx.insert(pushSubscriptions).values({ tenantId: T.tenantId, patientId: ana.id, endpoint: `https://push.example.test/${randomUUID()}`, p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) }));

  const TODOS = [0, 1, 2, 3, 4, 5, 6];
  await inserir(T.ctx, (tx) =>
    tx.insert(lembretesRotina).values({ tenantId: T.tenantId, patientId: ana.id, criadoPor: T.nutriId, tipo: 'agua', config: { inicio: '08:00', fim: '21:00', intervaloMin: 60, dias: TODOS } }),
  );
  const [suplemento] = await inserir(T.ctx, (tx) =>
    tx
      .insert(lembretesRotina)
      .values({ tenantId: T.tenantId, patientId: ana.id, criadoPor: T.nutriId, tipo: 'suplemento', texto: 'Vitamina D', config: { horarios: ['09:00'], dias: TODOS } })
      .returning({ id: lembretesRotina.id }),
  );
  await desligarMeuLembrete(ctxAna, suplemento.id, true, { db: app.db });
  await pausarMeusLembretes(ctxAna, true, { db: app.db });

  const { paciente: bia, userId: biaUser } = await pacienteComConta(app.db, T, { status: 'arquivado' });
  const { paciente: caio, userId: caioUser } = await pacienteComConta(app.db, T);
  await plano(T, caio.id, { status: 'publicado', versao: 1, publicadoEm: new Date('2026-11-05T15:00:00Z'), refeicoes: [{ itens: [] }] });
  const duda = await novoPaciente(app.db, T.ctx);
  await app.db.insert(invites).values({ tipo: 'paciente', tenantId: T.tenantId, patientId: duda.id, tokenHash: sha256(randomUUID()), expiraEm: new Date(AGORA.getTime() + 3 * DIA) });

  const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId));
  return {
    T,
    tenant: tenant as TenantRow,
    ana,
    ctxAna,
    bia,
    ctxBia: ctxPaciente(T.tenantId, bia.id, biaUser),
    caio,
    ctxCaio: ctxPaciente(T.tenantId, caio.id, caioUser),
    duda,
    ids: {
      planos: [arquivado, publicado],
      documentos: [emitido.id, cancelado.id, rascunho.id, anonimizado.id],
      envios: [envioCancelado, envioRecebido],
      avaliacoes: [av1.id, av2.id],
      atendimentos: [at1.id, at2.id],
      paraTodos: paraTodos.id,
    },
  };
}

let cenario: ReturnType<typeof montar> | undefined;
const oCenario = () => (cenario ??= montar());

/** O que cada seção com `noApp` tem no cenário: os ids mostrados no Início e o que o portal devolve à Ana (contagem e ids). */
type Caso = { pedidos: (c: Awaited<ReturnType<typeof montar>>) => string[]; portal: (c: Awaited<ReturnType<typeof montar>>) => Promise<{ total: number; ids: string[] }> };
const CASOS: Record<string, Caso> = {
  'plano-alimentar': {
    pedidos: (c) => c.ids.planos,
    portal: async (c) => {
      const p = await planoDoPaciente(c.ctxAna, FUSO, { db: app.db });
      return { total: p ? 1 : 0, ids: p ? [p.id] : [] };
    },
  },
  antropometria: {
    pedidos: (c) => c.ids.avaliacoes,
    portal: async (c) => ({
      total: (await evolucaoParaPaciente(c.ctxAna, c.tenant, app.db)).avaliacoes,
      ids: (await listarAntropometrias(c.ctxAna, c.ana.id, app.db)).map((a) => a.id),
    }),
  },
  atendimentos: {
    pedidos: (c) => c.ids.atendimentos,
    portal: async (c) => {
      const j = await jornadaDoPaciente(c.ctxAna, c.tenant, AGORA, app.db);
      // a Jornada não devolve o id do atendimento: os ids que a sessão da Ana lê da mesma tabela
      const ids = await withTenant(c.ctxAna, (tx) => tx.select({ id: consultations.id }).from(consultations).where(eq(consultations.patientId, c.ana.id)), app.db);
      return { total: j.marcos.filter((m) => m.tipo === 'atendimento').length, ids: ids.map((i) => i.id) };
    },
  },
  documentos: {
    pedidos: (c) => c.ids.documentos,
    portal: async (c) => {
      const d = await documentosDoPaciente(c.ctxAna, app.db);
      return { total: d.length, ids: d.map((x) => x.id) };
    },
  },
  'exames-enviados': {
    pedidos: (c) => c.ids.envios,
    portal: async (c) => {
      const e = await meusEnvios(c.ctxAna, { db: app.db });
      return { total: e.length, ids: e.map((x) => x.id) };
    },
  },
};

const pedidosDe = (c: Awaited<ReturnType<typeof montar>>) => Object.fromEntries(Object.entries(CASOS).map(([id, k]) => [id, k.pedidos(c)]));
const semOrdem = (xs: string[]) => [...xs].sort();

describe('noAppDoPaciente (Plano 18, D16, RN-281)', () => {
  it('cobertura: toda seção de SECOES_DA_FICHA com `noApp` tem o caso no cenário de paridade (RNF-263 b)', () => {
    const comNoApp = SECOES_DA_FICHA.filter((s) => s.noApp).map((s) => s.id);
    expect(semOrdem(Object.keys(CASOS))).toEqual(semOrdem(comNoApp));
    expect(comNoApp).toEqual(expect.arrayContaining(['plano-alimentar', 'antropometria', 'atendimentos', 'documentos', 'exames-enviados']));
  });

  it('paridade: cada contagem e cada selo = o que a função do portal devolve à Ana na sessão dela (Review Focus 2)', async () => {
    const c = await oCenario();
    const r = await noAppDoPaciente(c.T.ctx, c.ana.id, pedidosDe(c), { db: app.db, agora: AGORA });
    expect(r.contagens).not.toBeNull();
    for (const [id, caso] of Object.entries(CASOS)) {
      const portal = await caso.portal(c);
      expect(r.contagens![id], id).toBe(portal.total);
      // o selo, item a item: dos ids mostrados no Início, os que o portal devolve
      const pedidos = caso.pedidos(c);
      expect(semOrdem(r.visiveis[id] ?? []), id).toEqual(semOrdem(pedidos.filter((i) => portal.ids.includes(i))));
    }
    // os casos do cenário, para o teste não passar com tudo zerado
    expect(r.contagens).toMatchObject({ 'plano-alimentar': 1, antropometria: 2, atendimentos: 2, documentos: 2, 'exames-enviados': 1 });
    expect(r.visiveis['plano-alimentar']).toEqual([c.ids.planos[1]]); // o arquivado (que a RLS entrega) fica sem selo
    expect(semOrdem(r.visiveis.documentos)).toEqual(semOrdem(c.ids.documentos.slice(0, 2))); // sem o rascunho e o anonimizado
    expect(r.visiveis['exames-enviados']).toEqual([c.ids.envios[1]]); // sem o cancelado

    // conteúdos: o feed (a audiência pela RLS; a etiqueta "gestante" fica fora, a receita sugerida no plano também)
    const feed = await feedDeConteudos(c.ctxAna, {}, app.db);
    expect(r.contagens!.conteudos).toBe(feed.itens.length);
    expect(feed.itens.map((i) => i.titulo).sort()).toEqual(['Para todos', 'Salada']);
    // diário: os registros dos últimos 30 dias
    const desde = AGORA.getTime() - 30 * DIA;
    const diario = (await diarioDoPaciente(c.ctxAna, { db: app.db })).filter((d) => d.dataHora.getTime() >= desde);
    expect(r.contagens!.diario30d).toBe(diario.length);
    expect(diario).toHaveLength(1);
  });

  it('exames enviados acima do teto da lista do portal: a contagem e o selo param nos mesmos 50 mais recentes de `meusEnvios`', async () => {
    const c = await oCenario();
    const { paciente: eva, userId } = await pacienteComConta(app.db, c.T);
    const ctxEva = ctxPaciente(c.T.tenantId, eva.id, userId);
    // 51 envios (nascem "processando", que o portal lista), um por minuto: o mais antigo fica fora da lista do portal
    const ids = await inserir(c.T.ctx, (tx) =>
      tx
        .insert(examSubmissions)
        .values(
          Array.from({ length: 51 }, (_, i) => ({
            tenantId: c.T.tenantId,
            patientId: eva.id,
            enviadoPor: userId,
            dataColeta: '2026-09-28',
            nome: 'Hemograma',
            createdAt: new Date(AGORA.getTime() - (i + 1) * 60_000),
          })),
        )
        .returning({ id: examSubmissions.id }),
    );
    const maisRecente = ids[0].id;
    const maisAntigo = ids[50].id;
    const portal = await meusEnvios(ctxEva, { db: app.db });
    expect(portal).toHaveLength(50);
    expect(portal.map((e) => e.id)).not.toContain(maisAntigo);
    const r = await noAppDoPaciente(c.T.ctx, eva.id, { 'exames-enviados': [maisRecente, maisAntigo] }, { db: app.db, agora: AGORA });
    expect(r.contagens!['exames-enviados']).toBe(portal.length);
    expect(r.visiveis['exames-enviados']).toEqual([maisRecente]);
  });

  it('D24: receitas sugeridas no contexto `nutri` = as do cartão do plano no app (com a de fora da audiência; sem a despublicada)', async () => {
    const c = await oCenario();
    const r = await noAppDoPaciente(c.T.ctx, c.ana.id, {}, { db: app.db, agora: AGORA });
    const p = await planoDoPaciente(c.ctxAna, FUSO, { db: app.db });
    const noCartao = new Set(p!.refeicoes.flatMap((x) => (x.receita ? [x.receita.id] : [])));
    expect(r.receitasSugeridas).toBe(noCartao.size);
    expect(r.receitasSugeridas).toBe(2);
    // sem plano publicado: null
    expect((await noAppDoPaciente(c.T.ctx, c.duda.id, {}, { db: app.db, agora: AGORA })).receitasSugeridas).toBeNull();
  });

  it('plano: a data da publicação no fuso e a lista de compras com a regra de `listaDoPlano`', async () => {
    const c = await oCenario();
    const ana = await noAppDoPaciente(c.T.ctx, c.ana.id, {}, { db: app.db, agora: AGORA });
    expect(ana.plano).toEqual({ publicadoEm: '2026-11-09', listaDeCompras: true });
    expect((await listaDoPlano(c.ctxAna, 7, app.db))!.grupos.length > 0).toBe(true);
    // plano publicado sem item principal: sem lista (no app, a lista vem vazia)
    const caio = await noAppDoPaciente(c.T.ctx, c.caio.id, {}, { db: app.db, agora: AGORA });
    expect(caio.plano).toEqual({ publicadoEm: hojeNoFuso(FUSO, new Date('2026-11-05T15:00:00Z')), listaDeCompras: false });
    expect((await listaDoPlano(c.ctxCaio, 7, app.db))!.grupos).toEqual([]);
  });

  it('lembretes e aparelhos: os mesmos números da seção "Lembretes no app" do Plano 17; sem lembrete → null', async () => {
    const c = await oCenario();
    const r = await noAppDoPaciente(c.T.ctx, c.ana.id, {}, { db: app.db, agora: AGORA });
    const v = await lembretesDoPaciente(c.T.ctx, c.ana.id, { fuso: FUSO }, { db: app.db, agora: AGORA });
    expect(r.lembretes).toEqual({
      ligados: v.lembretes.filter((l) => l.ligado && !l.desligadoPeloPacienteEm).length,
      desligadosPeloPaciente: v.lembretes.filter((l) => l.desligadoPeloPacienteEm).length,
      pausados: v.pausadoEm !== null,
    });
    expect(r.lembretes).toEqual({ ligados: 1, desligadosPeloPaciente: 1, pausados: true });
    expect(r.notificacoes).toEqual({ aparelhos: v.aparelhosComNotificacao, whatsapp: true });
    expect(r.notificacoes.aparelhos).toBe(1);
    expect((await noAppDoPaciente(c.T.ctx, c.caio.id, {}, { db: app.db, agora: AGORA })).lembretes).toBeNull();
  });

  it('acesso: ativo com o último dia de acesso; peso oculto, % de gordura e IA Nutri (null sem a ativação no consultório)', async () => {
    const c = await oCenario();
    const r = await noAppDoPaciente(c.T.ctx, c.ana.id, {}, { db: app.db, agora: AGORA });
    expect(r.acesso).toEqual({ estado: 'ativo', ultimoAcesso: '2026-11-14', textoDoConvite: null });
    expect(r.pesoOculto).toBe(true);
    expect(r.gorduraNoApp).toBe(true);
    expect(r.iaNutri).toBeNull();
    // nunca acessou
    expect((await noAppDoPaciente(c.T.ctx, c.caio.id, {}, { db: app.db, agora: AGORA })).acesso.ultimoAcesso).toBeNull();
  });

  it('IA Nutri ativada no consultório: "ligada" com a participação liberada, "desligada" sem ela', async () => {
    const T = await novoTenant(app.db);
    await app.db.update(tenants).set({ iaNutriAtivadaEm: new Date() }).where(eq(tenants.id, T.tenantId));
    const { paciente: com } = await pacienteComConta(app.db, T);
    const { paciente: sem } = await pacienteComConta(app.db, T);
    await inserir(T.ctx, (tx) => tx.insert(iaNutriParticipacoes).values({ tenantId: T.tenantId, patientId: com.id, liberadaEm: new Date(), liberadaPor: T.nutriId }));
    expect((await noAppDoPaciente(T.ctx, com.id, {}, { db: app.db })).iaNutri).toBe('ligada');
    expect((await noAppDoPaciente(T.ctx, sem.id, {}, { db: app.db })).iaNutri).toBe('desligada');
  });

  it('convite pendente: sem contagens, com o texto do convite do Perfil (`textoDoAcesso`)', async () => {
    const c = await oCenario();
    const r = await noAppDoPaciente(c.T.ctx, c.duda.id, {}, { db: app.db, agora: AGORA });
    expect(r.acesso.estado).toBe('pendente');
    expect(r.acesso.textoDoConvite).toBe(textoDoAcesso(await situacaoDoAcesso(c.T.ctx, c.duda, app.db, AGORA), FUSO, 'ativo'));
    expect(r.contagens).toBeNull();
    expect(r.visiveis).toEqual({});
  });

  it('arquivado: estado "arquivado", contagens nulas e nenhum selo (mesmo com conta)', async () => {
    const c = await oCenario();
    const r = await noAppDoPaciente(c.T.ctx, c.bia.id, { antropometria: [randomUUID()] }, { db: app.db, agora: AGORA });
    expect(r.acesso.estado).toBe('arquivado');
    expect(r.contagens).toBeNull();
    expect(r.visiveis).toEqual({});
  });

  it('conteúdos (positivos): o da etiqueta que a paciente TEM e o "pacientes" com ela na audiência entram, como no feed', async () => {
    const T = await novoTenant(app.db);
    const { paciente: eva, userId } = await pacienteComConta(app.db, T);
    const outra = await novoPaciente(app.db, T.ctx);
    const gestante = await novaEtiqueta(app.db, T, 'gestante', [eva.id]);
    await novoConteudo(app.db, T, { titulo: 'Da etiqueta', visibilidade: 'etiquetas', tags: [gestante] });
    await novoConteudo(app.db, T, { titulo: 'Só da Eva', visibilidade: 'pacientes', pacientes: [eva.id] });
    await novoConteudo(app.db, T, { titulo: 'Só da outra', visibilidade: 'pacientes', pacientes: [outra.id] });
    const r = await noAppDoPaciente(T.ctx, eva.id, {}, { db: app.db, agora: AGORA });
    const feed = await feedDeConteudos(ctxPaciente(T.tenantId, eva.id, userId), {}, app.db);
    expect(feed.itens.map((i) => i.titulo).sort()).toEqual(['Da etiqueta', 'Só da Eva']);
    expect(r.contagens!.conteudos).toBe(feed.itens.length);
  });

  it('documentos com `documentos_liberados` desligado: 0 e sem selo, como o portal (que não mostra nada)', async () => {
    const T = await novoTenant(app.db);
    await liberarDocumentos(app.db, T.tenantId);
    const { paciente: gil, userId } = await pacienteComConta(app.db, T);
    const doc = await documentoNoBanco(app.db, T.ctx, gil.id, { status: 'assinado' });
    const ligado = await noAppDoPaciente(T.ctx, gil.id, { documentos: [doc.id] }, { db: app.db, agora: AGORA });
    expect(ligado.contagens!.documentos).toBe(1); // controle: com a liberação, conta
    await app.db.update(tenants).set({ documentosLiberados: false }).where(eq(tenants.id, T.tenantId));
    const r = await noAppDoPaciente(T.ctx, gil.id, { documentos: [doc.id] }, { db: app.db, agora: AGORA });
    expect(await documentosDoPaciente(ctxPaciente(T.tenantId, gil.id, userId), app.db)).toEqual([]);
    expect(r.contagens!.documentos).toBe(0);
    expect(r.visiveis.documentos ?? []).toEqual([]);
  });

  it('convite vencido: estado "expirado", o texto do Perfil (`textoDoAcesso`) e sem contagens', async () => {
    const c = await oCenario();
    const ivo = await novoPaciente(app.db, c.T.ctx);
    await app.db.insert(invites).values({ tipo: 'paciente', tenantId: c.T.tenantId, patientId: ivo.id, tokenHash: sha256(randomUUID()), expiraEm: new Date(AGORA.getTime() - DIA) });
    const r = await noAppDoPaciente(c.T.ctx, ivo.id, {}, { db: app.db, agora: AGORA });
    expect(r.acesso.estado).toBe('expirado');
    expect(r.acesso.textoDoConvite).toBe(textoDoAcesso(await situacaoDoAcesso(c.T.ctx, ivo, app.db, AGORA), FUSO, 'ativo'));
    expect(r.acesso.textoDoConvite).toBe('Convite expirado. Reenvie para o paciente conseguir entrar.');
    expect(r.contagens).toBeNull();
  });

  it('lembrete desligado pela equipe: fora dos ligados e dos desligados pelo paciente, como na seção do Plano 17', async () => {
    const T = await novoTenant(app.db);
    const { paciente: lia } = await pacienteComConta(app.db, T);
    const TODOS = [0, 1, 2, 3, 4, 5, 6];
    await inserir(T.ctx, (tx) =>
      tx.insert(lembretesRotina).values([
        { tenantId: T.tenantId, patientId: lia.id, criadoPor: T.nutriId, tipo: 'agua', config: { inicio: '08:00', fim: '21:00', intervaloMin: 60, dias: TODOS } },
        { tenantId: T.tenantId, patientId: lia.id, criadoPor: T.nutriId, tipo: 'suplemento', texto: 'Ômega 3', ligado: false, config: { horarios: ['09:00'], dias: TODOS } },
      ]),
    );
    const r = await noAppDoPaciente(T.ctx, lia.id, {}, { db: app.db, agora: AGORA });
    const v = await lembretesDoPaciente(T.ctx, lia.id, { fuso: FUSO }, { db: app.db, agora: AGORA });
    expect(r.lembretes).toEqual({
      ligados: v.lembretes.filter((l) => l.ligado && !l.desligadoPeloPacienteEm).length,
      desligadosPeloPaciente: v.lembretes.filter((l) => l.desligadoPeloPacienteEm).length,
      pausados: v.pausadoEm !== null,
    });
    expect(r.lembretes).toEqual({ ligados: 1, desligadosPeloPaciente: 0, pausados: false });
  });

  describe('sem acesso (arquivado, bloqueado, anonimizado — com conta): só a linha do acesso, nada mais lido', () => {
    beforeEach(() => {
      aberturas.semConta = [];
    });

    /** Paciente com conta e com tudo o que a página mostraria (push, WhatsApp, plano, lembrete, peso oculto, avaliação). */
    async function comTudo(T: TenantDeTeste) {
      const { paciente, userId } = await pacienteComConta(app.db, T, { whatsappOptinEm: new Date(), whatsappOptinOrigem: 'nutri' });
      await inserir(T.ctx, (tx) => tx.insert(pushSubscriptions).values({ tenantId: T.tenantId, patientId: paciente.id, endpoint: `https://push.example.test/${randomUUID()}`, p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) }));
      await inserir(T.ctx, (tx) => tx.insert(lembretesRotina).values({ tenantId: T.tenantId, patientId: paciente.id, criadoPor: T.nutriId, tipo: 'agua', config: { inicio: '08:00', fim: '21:00', intervaloMin: 60, dias: [1] } }));
      await inserir(T.ctx, (tx) => tx.insert(iaNutriParticipacoes).values({ tenantId: T.tenantId, patientId: paciente.id, liberadaEm: new Date(), liberadaPor: T.nutriId }));
      await inserir(ctxPaciente(T.tenantId, paciente.id, userId), (tx) => tx.insert(accessEvents).values({ tenantId: T.tenantId, patientId: paciente.id, dia: '2026-11-14' }));
      const [av] = await inserir(T.ctx, (tx) =>
        tx.insert(anthropometry).values({ tenantId: T.tenantId, patientId: paciente.id, data: '2026-11-01', pesoKg: 70, alturaCm: 170 }).returning({ id: anthropometry.id }),
      );
      await plano(T, paciente.id, { status: 'publicado', versao: 1, publicadoEm: new Date('2026-11-05T15:00:00Z'), refeicoes: [{ itens: [{}] }] });
      await definirPesoOculto(T.ctx, paciente.id, true, { db: app.db });
      return { paciente, avaliacao: av.id };
    }

    const NEUTRO = {
      notificacoes: { aparelhos: 0, whatsapp: false },
      plano: { publicadoEm: null, listaDeCompras: false },
      lembretes: null,
      pesoOculto: false,
      gorduraNoApp: false,
      iaNutri: null,
      contagens: null,
      receitasSugeridas: null,
      visiveis: {},
    };

    it('arquivado, bloqueado e anonimizado: o resto neutro (mesmo com os dados no banco), sem selo e sem abrir o contexto sem login', async () => {
      const T = await novoTenant(app.db);
      await app.db.update(tenants).set({ mostrarPercGorduraPaciente: true, iaNutriAtivadaEm: new Date() }).where(eq(tenants.id, T.tenantId));
      const arq = await comTudo(T);
      const blo = await comTudo(T);
      const ano = await comTudo(T);
      const ati = await comTudo(T);
      await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'arquivado' }).where(eq(patients.id, arq.paciente.id)), app.db);
      await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado' }).where(eq(patients.id, blo.paciente.id)), app.db);
      // a anonimização de verdade apaga a conta e o resto (lgpd.ts); aqui só a marca, com a conta ainda ligada, para
      // provar que a marca sozinha basta para nada ser lido
      await dono.db.transaction(async (tx) => {
        await tx.execute(sql`set local session_replication_role = replica`);
        await tx.execute(sql`update patients set status = 'bloqueado', anonimizado_em = now() where id = ${ano.paciente.id}`);
      });

      // controle: o ativo com os mesmos dados mostra tudo e abre o contexto sem login
      const ativo = await noAppDoPaciente(T.ctx, ati.paciente.id, { antropometria: [ati.avaliacao] }, { db: app.db, agora: AGORA });
      expect(ativo).toMatchObject({ notificacoes: { aparelhos: 1, whatsapp: true }, lembretes: { ligados: 1 }, pesoOculto: true, gorduraNoApp: true, iaNutri: 'ligada' });
      expect(ativo.visiveis.antropometria).toEqual([ati.avaliacao]);
      expect(aberturas.semConta).toEqual([ati.paciente.id]);
      aberturas.semConta = [];

      for (const [x, estado] of [[arq, 'arquivado'], [blo, 'bloqueado'], [ano, 'bloqueado']] as const) {
        const r = await noAppDoPaciente(T.ctx, x.paciente.id, { antropometria: [x.avaliacao] }, { db: app.db, agora: AGORA });
        expect(r, estado).toEqual({ acesso: { estado, ultimoAcesso: null, textoDoConvite: null }, ...NEUTRO });
      }
      expect(aberturas.semConta).toEqual([]);
    });

    it('arquivado ou anonimizado entre as transações: o contexto do paciente reconfere a situação e devolve sem acesso', async () => {
      const T = await novoTenant(app.db);
      const arq = await comTudo(T);
      const ano = await comTudo(T);
      try {
        aberturas.antes = () => withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'arquivado' }).where(eq(patients.id, arq.paciente.id)), app.db);
        const r = await noAppDoPaciente(T.ctx, arq.paciente.id, { antropometria: [arq.avaliacao] }, { db: app.db, agora: AGORA });
        expect(r).toEqual({ acesso: { estado: 'arquivado', ultimoAcesso: null, textoDoConvite: null }, ...NEUTRO });
        aberturas.antes = () =>
          dono.db.transaction(async (tx) => {
            await tx.execute(sql`set local session_replication_role = replica`);
            await tx.execute(sql`update patients set anonimizado_em = now() where id = ${ano.paciente.id}`);
          });
        const s = await noAppDoPaciente(T.ctx, ano.paciente.id, { antropometria: [ano.avaliacao] }, { db: app.db, agora: AGORA });
        expect(s).toEqual({ acesso: { estado: 'bloqueado', ultimoAcesso: null, textoDoConvite: null }, ...NEUTRO });
        // o contexto do paciente abriu (a mudança veio depois da primeira transação), e a reconferência fechou
        expect(aberturas.semConta).toEqual([arq.paciente.id, ano.paciente.id]);
      } finally {
        aberturas.antes = null;
      }
    });
  });

  it('sem trilha: nenhuma linha nova no audit_log (controle positivo: uma leitura auditada grava)', async () => {
    const c = await oCenario();
    const linhas = () => withTenant(c.T.ctx, async (tx) => (await tx.select({ n: count() }).from(auditLog).where(eq(auditLog.tenantId, c.T.tenantId)))[0].n, app.db);
    const antes = await linhas();
    await noAppDoPaciente(c.T.ctx, c.ana.id, pedidosDe(c), { db: app.db, agora: AGORA });
    expect(await linhas()).toBe(antes);
    // controle positivo: a mesma contagem enxerga uma leitura auditada
    await listarAntropometrias(c.T.ctx, c.ana.id, app.db);
    expect(await linhas()).toBe(antes + 1);
  });

  it('papel: só a sessão da nutricionista; paciente de outro consultório → não encontrado', async () => {
    const c = await oCenario();
    await expect(noAppDoPaciente(c.ctxAna, c.ana.id, {}, { db: app.db })).rejects.toThrow(TenantContextError);
    await expect(noAppDoPaciente({ tenantId: c.T.tenantId, role: 'worker' }, c.ana.id, {}, { db: app.db })).rejects.toThrow(TenantContextError);
    const outro = await novoTenant(app.db);
    await expect(noAppDoPaciente(outro.ctx, c.ana.id, {}, { db: app.db })).rejects.toThrow('Paciente não encontrado');
  });
});
