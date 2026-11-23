import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import { em } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { planoEmRascunho, planoPublicado, type RefeicaoDeTeste } from '../../../test/plano';
import { pacienteComConta } from '../../../test/portal';
import { closeDb, type Db } from '@/db/client';
import { diaryEntries, lembretesRotina, lembretesRotinaEnvios, meals, patients, pushSubscriptions, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { logger } from '@/lib/logger';
import type { InscricaoPush, ProvedorPush, ResultadoPush } from '@/modules/notificacoes/push';
import { registrarNoDiario } from '@/modules/portal/diario';
import { rotuloDaRefeicao } from '@/modules/portal/diario-constantes';
import { CONCORRENCIA_ENVIO, processarLembretes, type DepsLembretes } from './envio';

/**
 * Plano 17 (§5.2, §5.5, Tarefa 4): o job `lembretes-rotina` — a cada minuto, o slot devido de cada paciente sai por push,
 * no máximo uma vez, com o texto fixo da tela de bloqueio (nunca o nome do suplemento, o texto livre nem a refeição digitada).
 */
const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss(); // publicarPlano enfileira o PDF
  await closeDb();
  await app.pool.end();
});

const TODOS = [0, 1, 2, 3, 4, 5, 6];
/** Antes do dia dos testes (terça, 17/11/2026): o `updated_at` do lembrete não esconde nenhum slot. */
const ANTES = new Date('2026-11-16T03:00:00Z');
const APP = 'http://localhost:3000';
const seg = (d: Date, s: number) => new Date(d.getTime() + s * 1000);
const as = (hora: string, s = 0, fuso?: string) => seg(em('2026-11-17', hora, fuso), s);

type Enviado = { endpoint: string; bruto: string; payload: { titulo: string; corpo: string; url: string }; ttl: number };
function pushFalso(resposta: (i: InscricaoPush) => ResultadoPush | Promise<ResultadoPush> = () => ({ ok: true })): ProvedorPush & { enviados: Enviado[] } {
  const enviados: Enviado[] = [];
  return {
    enviados,
    async enviar(i, payload, ttl) {
      enviados.push({ endpoint: i.endpoint, bruto: payload, payload: JSON.parse(payload), ttl });
      return resposta(i);
    },
  };
}

const deps = (agora: Date, push: ProvedorPush | null): DepsLembretes => ({ db: app.db, agora: () => agora, appUrl: APP, push });
const rodar = (T: TenantDeTeste, agora: Date, push: ProvedorPush | null) => processarLembretes(deps(agora, push), { tenantId: T.tenantId });
const url = (T: TenantDeTeste, caminho: string) => `${APP}${caminho}?v=${T.tenantId}`;

const inscrever = (T: TenantDeTeste, patientId: string, endpoint = `https://push.example.test/${randomUUID()}`) =>
  withTenant(T.ctx, (tx) => tx.insert(pushSubscriptions).values({ tenantId: T.tenantId, patientId, endpoint, p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) }).returning(), app.db).then((r) => r[0]);

type Novo = { tipo: string; config: Record<string, unknown>; texto?: string; ligado?: boolean; updatedAt?: Date };
const lembrete = (T: TenantDeTeste, patientId: string, l: Novo) =>
  withTenant(T.ctx, (tx) => tx.insert(lembretesRotina).values({ tenantId: T.tenantId, patientId, criadoPor: T.nutriId, updatedAt: ANTES, ...l }).returning(), app.db).then((r) => r[0]);
const agua = (inicio: string, fim = '21:00', intervaloMin = 60): Novo => ({ tipo: 'agua', config: { inicio, fim, intervaloMin, dias: TODOS } });
const refeicoes = (antecedenciaMin: number, diarioDepoisMin: number | null = null): Novo => ({ tipo: 'refeicoes', config: { antecedenciaMin, diarioDepoisMin } });
const horarios = (tipo: 'suplemento' | 'livre', hs: string[], texto: string): Novo => ({ tipo, texto, config: { horarios: hs, dias: TODOS } });

/** Paciente com conta (convite aceito) e um aparelho com notificação; o tenant pode ter outro fuso. */
async function cenario(o: { fuso?: string; T?: TenantDeTeste } = {}) {
  const T = o.T ?? (await novoTenant(app.db));
  if (o.fuso) await app.db.update(tenants).set({ fuso: o.fuso }).where(eq(tenants.id, T.tenantId));
  const { paciente: p, userId } = await pacienteComConta(app.db, T);
  const inscricao = await inscrever(T, p.id);
  return { T, p, userId, inscricao };
}
const comPlano = async (T: TenantDeTeste, patientId: string, refeicoesDoPlano: RefeicaoDeTeste[]) => planoPublicado(app.db, T, patientId, { refeicoes: refeicoesDoPlano });
const noDiario = (T: TenantDeTeste, patientId: string, userId: string, v: { refeicao: string; dataHora: Date; refeicaoDoPlano?: string; refeicaoSlot?: string }) =>
  withTenant(
    ctxPaciente(T.tenantId, patientId, userId),
    (tx) =>
      tx.insert(diaryEntries).values({
        tenantId: T.tenantId,
        patientId,
        refeicao: v.refeicao,
        dataHora: v.dataHora,
        refeicaoSlot: v.refeicaoSlot ?? null,
        ...(v.refeicaoDoPlano ? { resposta: 'como_no_plano', refeicaoDoPlano: v.refeicaoDoPlano } : { texto: 'arroz e feijão' }),
      }),
    app.db,
  );
/**
 * A corrida de verdade, sem depender do relógio da máquina: cada transação espera a próxima para começarem juntas — as
 * leituras das duas execuções começam juntas, e a marca de uma só começa quando a outra também terminou de ler.
 */
function transacoesEmPares(db: Db): Db {
  let esperando: (() => void)[] = [];
  return new Proxy(db, {
    get(alvo, prop) {
      if (prop === 'transaction') {
        return async (...args: Parameters<Db['transaction']>) => {
          await new Promise<void>((ok) => {
            esperando.push(ok);
            if (esperando.length === 2) {
              for (const f of esperando) f();
              esperando = [];
            }
          });
          return alvo.transaction(...args);
        };
      }
      const v = Reflect.get(alvo, prop, alvo);
      return typeof v === 'function' ? v.bind(alvo) : v;
    },
  });
}
const marcas = (T: TenantDeTeste) => withTenant({ tenantId: T.tenantId, role: 'worker' }, (tx) => tx.select().from(lembretesRotinaEnvios), app.db);

describe('lembretes de rotina: o slot devido sai uma vez (§5.2, §5.5)', () => {
  it('envia a água das 10:00 às 10:00:30 (título, texto, tela do consultório, TTL de 1800 s) e não reenvia às 10:01', async () => {
    const { T, p, inscricao } = await cenario();
    const l = await lembrete(T, p.id, agua('10:00'));
    const push = pushFalso();
    expect(await rodar(T, as('10:00', 30), push)).toEqual({ enviados: 1, pulados: 0, falhas: 0 });
    expect(push.enviados).toEqual([{ endpoint: inscricao.endpoint, bruto: expect.any(String), payload: { titulo: 'NutriDebby', corpo: 'Hora de beber água 💧', url: url(T, '/p/inicio') }, ttl: 1800 }]);
    expect(await marcas(T)).toEqual([expect.objectContaining({ lembreteId: l.id, patientId: p.id, ultimoSlotEm: as('10:00') })]);
    expect(await rodar(T, as('10:01'), push)).toEqual({ enviados: 0, pulados: 0, falhas: 0 });
    expect(push.enviados).toHaveLength(1);
  });

  it('Review Focus 4: parado 30 min não envia atrasado — às 10:31, com 10:00 e 10:30 pendentes, só o das 10:30', async () => {
    const { T, p } = await cenario();
    await lembrete(T, p.id, agua('10:00'));
    await lembrete(T, p.id, horarios('livre', ['10:30'], 'Caminhar 20 minutos'));
    const push = pushFalso();
    await rodar(T, as('10:31'), push);
    await rodar(T, as('10:32'), push);
    expect(push.enviados.map((e) => e.payload.corpo)).toEqual(['Você tem um lembrete do seu plano']);
    expect(push.enviados[0].payload.url).toBe(url(T, '/p/perfil/lembretes'));
  });

  it('atraso de 1 min não perde a refeição: às 12:01:30 sai a refeição das 12:00; às 12:02, o diário das 12:01', async () => {
    const { T, p } = await cenario();
    await lembrete(T, p.id, refeicoes(0, 30));
    await comPlano(T, p.id, [
      { nome: 'Lanche da manhã', horario: '11:31' },
      { nome: 'Almoço', horario: '12:00' },
    ]);
    const push = pushFalso();
    await rodar(T, as('12:01', 30), push);
    expect(push.enviados.map((e) => e.payload)).toEqual([{ titulo: 'NutriDebby', corpo: 'Hora de: Almoço', url: url(T, '/p/plano') }]);
    await rodar(T, as('12:02'), push);
    expect(push.enviados.map((e) => e.payload).at(-1)).toEqual({ titulo: 'NutriDebby', corpo: 'Registre sua refeição no diário', url: url(T, '/p/diario') });
    await rodar(T, as('12:03'), push);
    expect(push.enviados).toHaveLength(2);
  });

  it('duas execuções simultâneas não duplicam (as duas leem antes de qualquer marca: só o upsert condicional segura)', async () => {
    const { T, p } = await cenario();
    await lembrete(T, p.id, agua('10:00'));
    const push = pushFalso();
    const d = { ...deps(as('10:00', 30), push), db: transacoesEmPares(app.db) };
    const [a, b] = await Promise.all([processarLembretes(d, { tenantId: T.tenantId }), processarLembretes(d, { tenantId: T.tenantId })]);
    expect(push.enviados).toHaveLength(1);
    expect(a.enviados + b.enviados).toBe(1);
  });

  it('lembrete salvo às 10:03 não envia a água das 10:00', async () => {
    const { T, p } = await cenario();
    await lembrete(T, p.id, { ...agua('10:00'), updatedAt: as('10:03') });
    const push = pushFalso();
    await rodar(T, as('10:05'), push);
    expect(push.enviados).toEqual([]);
    expect(await marcas(T)).toEqual([]);
  });

  it('push desligado na plataforma (sem VAPID): nada sai e nenhuma marca é gravada', async () => {
    const { T, p } = await cenario();
    await lembrete(T, p.id, agua('10:00'));
    expect(await rodar(T, as('10:00', 30), null)).toEqual({ enviados: 0, pulados: 0, falhas: 0 });
    expect(await marcas(T)).toEqual([]);
  });
});

describe('refeições do plano (Review Focus 2) e textos da tela de bloqueio', () => {
  it('sem plano publicado (só rascunho) não há refeição nem diário', async () => {
    const { T, p } = await cenario();
    await lembrete(T, p.id, refeicoes(0, 30));
    await planoEmRascunho(app.db, T, p.id, { refeicoes: [{ nome: 'Almoço', horario: '12:00' }] });
    const push = pushFalso();
    await rodar(T, as('12:00', 10), push);
    await rodar(T, as('12:30', 10), push);
    expect(push.enviados).toEqual([]);
  });

  it('plano republicado com Almoço de 12:00 para 12:05 depois do envio das 12:00 envia o das 12:05, não repete o das 12:00', async () => {
    const { T, p } = await cenario();
    await lembrete(T, p.id, refeicoes(0));
    await comPlano(T, p.id, [{ nome: 'Almoço', horario: '12:00' }]);
    const push = pushFalso();
    await rodar(T, as('12:00', 10), push);
    expect(push.enviados).toHaveLength(1);
    await comPlano(T, p.id, [{ nome: 'Almoço', horario: '12:05' }]);
    await rodar(T, as('12:03'), push);
    expect(push.enviados).toHaveLength(1);
    await rodar(T, as('12:05', 10), push);
    await rodar(T, as('12:06'), push);
    expect(push.enviados.map((e) => e.payload.corpo)).toEqual(['Hora de: Almoço', 'Hora de: Almoço']);
  });

  it('corpo da refeição: antecedência 15 → "Está chegando a hora: Almoço"; 0 → "Hora de: Almoço"; "almoco" sem acento → "Hora de: Almoço"', async () => {
    const T = await novoTenant(app.db);
    const casos = [
      { antecedencia: 15, nome: 'Almoço', hora: '12:15', corpo: 'Está chegando a hora: Almoço' },
      { antecedencia: 0, nome: 'Almoço', hora: '12:30', corpo: 'Hora de: Almoço' },
      { antecedencia: 0, nome: 'almoco', hora: '12:30', corpo: 'Hora de: Almoço' },
    ];
    for (const c of casos) {
      const { p } = await cenario({ T });
      await lembrete(T, p.id, refeicoes(c.antecedencia));
      await comPlano(T, p.id, [{ nome: c.nome, horario: '12:30' }]);
    }
    const push = pushFalso();
    await rodar(T, as('12:15', 5), push);
    await rodar(T, as('12:30', 5), push);
    expect(push.enviados.map((e) => e.payload.corpo).sort()).toEqual(casos.map((c) => c.corpo).sort());
    expect(new Set(push.enviados.map((e) => e.payload.url))).toEqual(new Set([url(T, '/p/plano')]));
  });

  it('refeição com nome fora da lista vai com texto genérico (o nome digitado nunca vai ao push)', async () => {
    const T = await novoTenant(app.db);
    for (const antecedencia of [0, 15]) {
      const { p } = await cenario({ T });
      await lembrete(T, p.id, refeicoes(antecedencia));
      await comPlano(T, p.id, [{ nome: 'Lanche sem lactose', horario: antecedencia ? '12:15' : '12:00' }]);
    }
    const push = pushFalso();
    await rodar(T, as('12:00', 5), push);
    expect(push.enviados.map((e) => e.payload.corpo).sort()).toEqual(['Está chegando a hora da sua refeição', 'Hora da sua refeição']);
    for (const e of push.enviados) expect(e.bruto).not.toMatch(/lactose|Lanche/i);
  });

  it('diário já registrado não pede registro — pela refeição do plano ou só pela refeição da lista fechada', async () => {
    const T = await novoTenant(app.db);
    const pelaRefeicaoDoPlano = await cenario({ T });
    const soPelaLista = await cenario({ T });
    const semRegistro = await cenario({ T });
    for (const c of [pelaRefeicaoDoPlano, soPelaLista, semRegistro]) {
      await lembrete(T, c.p.id, refeicoes(0, 30));
      await comPlano(T, c.p.id, [{ nome: 'Almoço', horario: '12:00' }]);
    }
    await noDiario(T, pelaRefeicaoDoPlano.p.id, pelaRefeicaoDoPlano.userId, { refeicao: 'Almoço', refeicaoDoPlano: 'Almoço · 12:00', dataHora: as('12:10') });
    await noDiario(T, soPelaLista.p.id, soPelaLista.userId, { refeicao: 'Almoço', dataHora: as('12:20') });
    const push = pushFalso();
    await rodar(T, as('12:30', 5), push);
    expect(push.enviados.map((e) => e.endpoint)).toEqual([semRegistro.inscricao.endpoint]);
    expect(push.enviados[0].payload.corpo).toBe('Registre sua refeição no diário');
  });

  it('refeição fora da lista registrada sem resposta não recebe o pedido do diário (pela refeição do plano escolhida, refeicao_slot)', async () => {
    const T = await novoTenant(app.db);
    const registrou = await cenario({ T });
    const semRegistro = await cenario({ T });
    for (const c of [registrou, semRegistro]) {
      await lembrete(T, c.p.id, refeicoes(0, 30));
      await comPlano(T, c.p.id, [{ nome: 'Colação', horario: '10:00' }]);
    }
    // pelo link da refeição do plano, com texto e sem resposta: refeicao 'Outro', refeicao_do_plano nulo
    const [colacao] = await withTenant(T.ctx, (tx) => tx.select({ id: meals.id }).from(meals).where(eq(meals.patientId, registrou.p.id)), app.db);
    await registrarNoDiario(ctxPaciente(T.tenantId, registrou.p.id, registrou.userId), { fuso: 'America/Sao_Paulo' }, { refeicao: null, texto: 'pão de queijo', foto: null, refeicaoId: colacao.id }, { db: app.db, agora: as('10:10') });
    const push = pushFalso();
    await rodar(T, as('10:00', 10), push);
    await rodar(T, as('10:30', 10), push);
    const doDiario = push.enviados.filter((e) => e.payload.corpo === 'Registre sua refeição no diário');
    expect(doDiario.map((e) => e.endpoint)).toEqual([semRegistro.inscricao.endpoint]);
    expect(push.enviados.filter((e) => e.endpoint === registrou.inscricao.endpoint).map((e) => e.payload.corpo)).toEqual(['Hora da sua refeição']);
  });

  it('TRI-17-20 #14: refeições de mesmo nome — o registro do "Lanche · 10:00" (refeicao_slot) não derruba o pedido do diário do "Lanche · 16:00"', async () => {
    const { T, p, userId, inscricao } = await cenario();
    await lembrete(T, p.id, refeicoes(0, 30));
    await comPlano(T, p.id, [
      { nome: 'Lanche', horario: '10:00' },
      { nome: 'Lanche', horario: '16:00' },
    ]);
    await noDiario(T, p.id, userId, { refeicao: 'Outro', refeicaoSlot: rotuloDaRefeicao('Lanche', '10:00'), dataHora: as('10:10') });
    const push = pushFalso();
    for (const h of ['10:00', '10:30', '16:00', '16:30']) await rodar(T, as(h, 10), push);
    expect(push.enviados.map((e) => e.endpoint)).toEqual(Array(3).fill(inscricao.endpoint));
    expect(push.enviados.map((e) => e.payload.corpo)).toEqual(['Hora da sua refeição', 'Hora da sua refeição', 'Registre sua refeição no diário']);
    expect((await marcas(T))[0].ultimoSlotEm).toEqual(as('16:30'));
  });

  it('TRI-17-20 #14: a refeição da lista fechada só casa o registro sem refeicao_slot nem refeicao_do_plano', async () => {
    const T = await novoTenant(app.db);
    const comSlot = await cenario({ T });
    const semSlot = await cenario({ T });
    for (const c of [comSlot, semSlot]) {
      await lembrete(T, c.p.id, refeicoes(0, 30));
      await comPlano(T, c.p.id, [
        { nome: 'Almoço', horario: '12:00' },
        { nome: 'Almoço', horario: '19:00' },
      ]);
    }
    // pelo link da refeição das 12:00: a refeição da lista ('Almoço') não marca também a das 19:00
    await noDiario(T, comSlot.p.id, comSlot.userId, { refeicao: 'Almoço', refeicaoSlot: rotuloDaRefeicao('Almoço', '12:00'), dataHora: as('12:10') });
    // registro livre, sem refeição do plano (comportamento antigo, preservado): casa as duas pela lista fechada
    await noDiario(T, semSlot.p.id, semSlot.userId, { refeicao: 'Almoço', dataHora: as('12:20') });
    const push = pushFalso();
    for (const h of ['12:30', '19:30']) await rodar(T, as(h, 10), push);
    const doDiario = push.enviados.filter((e) => e.payload.corpo === 'Registre sua refeição no diário');
    expect(doDiario.map((e) => e.endpoint)).toEqual([comSlot.inscricao.endpoint]);
    expect((await marcas(T)).find((m) => m.patientId === comSlot.p.id)?.ultimoSlotEm).toEqual(as('19:30'));
  });

  it('Review Focus 1: o dia do diário é o do tenant — em America/Manaus, o Almoço das 23:30 do dia 16 (03:30Z do 17) não conta para o 17', async () => {
    const M = 'America/Manaus';
    const { T, p, userId } = await cenario({ fuso: M });
    await lembrete(T, p.id, refeicoes(0, 30));
    await comPlano(T, p.id, [{ nome: 'Almoço', horario: '12:00' }]);
    await noDiario(T, p.id, userId, { refeicao: 'Almoço', refeicaoDoPlano: 'Almoço · 12:00', dataHora: new Date('2026-11-17T03:30:00Z') });
    const push = pushFalso();
    await rodar(T, as('12:00', 10, M), push);
    await rodar(T, as('12:30', 10, M), push);
    expect(push.enviados.map((e) => e.payload.corpo)).toEqual(['Hora de: Almoço', 'Registre sua refeição no diário']);
    // a hora é a local: 12:30 em Manaus é 16:30Z
    expect((await marcas(T))[0].ultimoSlotEm).toEqual(new Date('2026-11-17T16:30:00Z'));
  });
});

describe('quem não recebe', () => {
  it('paciente pausado, lembrete desligado pelo paciente ou pela equipe, paciente arquivado ou sem conta → nada', async () => {
    const T = await novoTenant(app.db);
    const pausado = await cenario({ T });
    await lembrete(T, pausado.p.id, agua('10:00'));
    await withTenant(ctxPaciente(T.tenantId, pausado.p.id, pausado.userId), (tx) => tx.update(patients).set({ lembretesPausadosEm: new Date() }).where(eq(patients.id, pausado.p.id)), app.db);
    const desligou = await cenario({ T });
    const l = await lembrete(T, desligou.p.id, agua('10:00'));
    await withTenant(ctxPaciente(T.tenantId, desligou.p.id, desligou.userId), (tx) => tx.update(lembretesRotina).set({ desligadoPeloPacienteEm: new Date() }).where(eq(lembretesRotina.id, l.id)), app.db);
    const equipeDesligou = await cenario({ T });
    await lembrete(T, equipeDesligou.p.id, { ...agua('10:00'), ligado: false });
    const arquivado = await cenario({ T });
    await lembrete(T, arquivado.p.id, agua('10:00'));
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'arquivado' }).where(eq(patients.id, arquivado.p.id)), app.db);
    const semConta = await novoPaciente(app.db, T.ctx);
    await inscrever(T, semConta.id);
    await lembrete(T, semConta.id, agua('10:00'));
    const semAparelho = await pacienteComConta(app.db, T);
    await lembrete(T, semAparelho.paciente.id, agua('10:00'));
    const push = pushFalso();
    expect(await rodar(T, as('10:00', 30), push)).toEqual({ enviados: 0, pulados: 0, falhas: 0 });
    expect(push.enviados).toEqual([]);
    expect(await marcas(T)).toEqual([]);
  });

  it('tenant suspenso → nada', async () => {
    const { T, p } = await cenario();
    await lembrete(T, p.id, agua('10:00'));
    await app.db.update(tenants).set({ status: 'suspensa' }).where(eq(tenants.id, T.tenantId));
    const push = pushFalso();
    await rodar(T, as('10:00', 30), push);
    expect(push.enviados).toEqual([]);
    expect(await marcas(T)).toEqual([]);
  });

  it('config inválida é pulada e contada; as outras linhas do tenant continuam saindo (log só com tenantId e contagem)', async () => {
    const T = await novoTenant(app.db);
    const a = await cenario({ T });
    const b = await cenario({ T });
    await lembrete(T, a.p.id, { tipo: 'agua', config: { inicio: '05:00', fim: '21:00', intervaloMin: 60, dias: TODOS } }); // antes das 06:00
    await lembrete(T, a.p.id, horarios('livre', ['10:00'], 'Caminhar'));
    await lembrete(T, b.p.id, { tipo: 'suplemento', texto: 'Ômega 3', config: { horarios: ['10:00'], dias: [] } }); // sem dia
    await lembrete(T, b.p.id, agua('10:00'));
    const aviso = vi.spyOn(logger, 'warn');
    try {
      const push = pushFalso();
      expect(await rodar(T, as('10:00', 30), push)).toEqual({ enviados: 2, pulados: 2, falhas: 0 });
      expect(push.enviados.map((e) => e.payload.corpo).sort()).toEqual(['Hora de beber água 💧', 'Você tem um lembrete do seu plano']);
      const chamada = aviso.mock.calls.find((c) => c[1] === 'lembretes de rotina com configuração inválida');
      expect(chamada?.[0]).toEqual({ tenantId: T.tenantId, invalidos: 2 });
    } finally {
      aviso.mockRestore();
    }
  });
});

describe('isolamento e minimização', () => {
  it('Review Focus 3: paciente em dois consultórios — o push do tenant A só vai às inscrições do vínculo A (e vice-versa)', async () => {
    const A = await cenario();
    const B = await novoTenant(app.db);
    const { paciente: pb } = await pacienteComConta(app.db, B, { userId: A.userId });
    const inscricaoB = await inscrever(B, pb.id);
    await lembrete(A.T, A.p.id, agua('10:00'));
    await lembrete(B, pb.id, horarios('livre', ['10:00'], 'Caminhar'));
    const pushA = pushFalso();
    await rodar(A.T, as('10:00', 30), pushA);
    expect(pushA.enviados.map((e) => [e.endpoint, e.payload.corpo, e.payload.url])).toEqual([[A.inscricao.endpoint, 'Hora de beber água 💧', url(A.T, '/p/inicio')]]);
    const pushB = pushFalso();
    await rodar(B, as('10:00', 30), pushB);
    expect(pushB.enviados.map((e) => [e.endpoint, e.payload.corpo, e.payload.url])).toEqual([[inscricaoB.endpoint, 'Você tem um lembrete do seu plano', url(B, '/p/perfil/lembretes')]]);
  });

  it('payload e log de suplemento não contêm o nome', async () => {
    const { T, p } = await cenario();
    await inscrever(T, p.id); // um segundo aparelho, cujo provedor falha (o aviso vai para o log)
    await lembrete(T, p.id, horarios('suplemento', ['10:00'], 'Vitamina Secreta'));
    const espioes = (['info', 'warn', 'error'] as const).map((n) => vi.spyOn(logger, n));
    try {
      let n = 0;
      const push = pushFalso(() => {
        if (n++ === 0) return { ok: true };
        throw new Error('Vitamina Secreta caiu');
      });
      await rodar(T, as('10:00', 30), push);
      expect(push.enviados.map((e) => e.payload)).toEqual(Array(2).fill({ titulo: 'NutriDebby', corpo: 'Hora do seu suplemento', url: url(T, '/p/perfil/lembretes') }));
      for (const e of push.enviados) expect(e.bruto).not.toContain('Secreta');
      const logado = JSON.stringify(espioes.flatMap((s) => s.mock.calls));
      expect(logado).toContain(T.tenantId);
      expect(logado).not.toContain('Secreta');
      expect(logado).not.toContain('push.example.test');
    } finally {
      for (const s of espioes) s.mockRestore();
    }
  });

  it('inscrição 410 é apagada; a outra continua (via enviarAosDispositivos)', async () => {
    const { T, p, inscricao } = await cenario();
    const morta = await inscrever(T, p.id);
    await lembrete(T, p.id, agua('10:00'));
    const push = pushFalso((i) => (i.endpoint === morta.endpoint ? { ok: false, remover: true, definitivo: true, codigo: 'http_410' } : { ok: true }));
    expect(await rodar(T, as('10:00', 30), push)).toEqual({ enviados: 1, pulados: 0, falhas: 0 });
    const restantes = await withTenant(T.ctx, (tx) => tx.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.patientId, p.id)), app.db);
    expect(restantes).toEqual([{ id: inscricao.id }]);
  });

  it(`no máximo ${CONCORRENCIA_ENVIO} envios ao mesmo tempo, em fila de trabalho (quem termina pega o próximo)`, async () => {
    const T = await novoTenant(app.db);
    const total = CONCORRENCIA_ENVIO + 2;
    for (let i = 0; i < total; i++) {
      const { p } = await cenario({ T });
      await lembrete(T, p.id, agua('10:00'));
    }
    const pendentes: (() => void)[] = [];
    let emAndamento = 0;
    let maximo = 0;
    const push = pushFalso(
      () =>
        new Promise<ResultadoPush>((ok) => {
          emAndamento++;
          maximo = Math.max(maximo, emAndamento);
          pendentes.push(() => {
            emAndamento--;
            ok({ ok: true });
          });
        }),
    );
    const execucao = rodar(T, as('10:00', 30), push);
    await vi.waitFor(() => expect(push.enviados).toHaveLength(CONCORRENCIA_ENVIO));
    await new Promise((r) => setTimeout(r, 50));
    expect(push.enviados).toHaveLength(CONCORRENCIA_ENVIO); // o 11º espera vaga
    pendentes.shift()!(); // um termina → o próximo começa, sem esperar os outros 9
    await vi.waitFor(() => expect(push.enviados).toHaveLength(CONCORRENCIA_ENVIO + 1));
    while (push.enviados.length < total || pendentes.length) {
      if (pendentes.length) pendentes.shift()!();
      else await new Promise((r) => setTimeout(r, 5));
    }
    expect(await execucao).toEqual({ enviados: total, pulados: 0, falhas: 0 });
    expect(maximo).toBe(CONCORRENCIA_ENVIO);
  });
});
