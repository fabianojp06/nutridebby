import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { makeDb } from '../../../../test/db';
import { mensagemNoBanco } from '../../../../test/ia-nutri';
import { app, comoWorker, depsApp, depsDoJob, fecharHarnessDaConversa, finalOk, pronto } from '../../../../test/ia-nutri-conversa';
import { emailsNaFila, type TenantDeTeste } from '../../../../test/pacientes';
import { iaNutriMensagens, systemHeartbeat, user } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { logger } from '@/lib/logger';
import { listarTenantsParaVarredura } from '@/modules/plataforma/tenant-status';
import { provedorFake } from '../provedor-fake';
import { desativarNoApp } from './consentimento';
import { encaminhar, perguntar } from './conversa';
import { processarPerguntaIaNutri } from './job';
import { expurgarIaNutri, expurgarIaNutriDoTenant } from './retencao';

// Plano 15 (P15-10): a retenção da IA Nutri — RN-181 (D8 = 180 dias), D22 (aviso mínimo) e D32 (esqueleto da revogação).
// O gatilho ia_nutri_mensagens_sem_apagar confere `expira_em <= now()` pelo relógio do banco: cada teste vence a guarda NO
// BANCO (nunca com um `agora` adiantado). A varredura de todos os tenants passa só pelos tenants deste arquivo (os arquivos
// de teste rodam em paralelo no mesmo banco).
vi.mock('@/modules/plataforma/tenant-status', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/modules/plataforma/tenant-status')>();
  return { ...real, listarTenantsParaVarredura: vi.fn(real.listarTenantsParaVarredura) };
});

const dono = makeDb(inject('ownerDatabaseUrl'));
const MARCA = 'alerta_ia_nutri_risco';
beforeAll(async () => {
  await app.db.delete(systemHeartbeat).where(eq(systemHeartbeat.name, MARCA));
});
afterAll(async () => {
  await app.db.delete(systemHeartbeat).where(eq(systemHeartbeat.name, MARCA));
  await dono.pool.end();
  await fecharHarnessDaConversa();
});

const BANANA = 'o que posso comer no lugar da banana à tarde?';
const SUBSTITUICAO = { categoria: 'plano', tipo_resposta: 'substituicao', fontes: ['#S1'] };
const RISCO = 'depois do jantar eu vomito pra não engordar';

/** A pergunta respondida pelo job de verdade (provedor fake): a pergunta e a resposta `ia` que aponta para ela. */
async function perguntaRespondida(T: TenantDeTeste, ctxP: Parameters<typeof perguntar>[0]) {
  const { mensagemId } = await perguntar(ctxP, BANANA, depsApp);
  expect(await processarPerguntaIaNutri({ tenantId: T.tenantId, mensagemId: mensagemId! }, depsDoJob(provedorFake({ gerar: [finalOk(SUBSTITUICAO)] })))).toBe('respondida');
  const [r] = await comoWorker(T, sql`select id from ia_nutri_mensagens where responde_a = ${mensagemId}`);
  return { pergunta: mensagemId!, resposta: r.id as string };
}
/** Vence a guarda no relógio do banco (o gatilho de DELETE confere `expira_em <= now()`). */
const vencer = (T: TenantDeTeste, id: string) => comoWorker(T, sql`update ia_nutri_mensagens set expira_em = now() - interval '1 second' where id = ${id}`);
const linha = async (T: TenantDeTeste, id: string) =>
  (await comoWorker(T, sql`select id, texto, texto_fixo, risco, responde_a, revogada_em, resolvida_em, contou_no_limite,
    expira_em = created_at + interval '180 days' as guarda_de_180, expira_em from ia_nutri_mensagens where id = ${id}`))[0];
const expurgar = (T: TenantDeTeste) => expurgarIaNutriDoTenant(app.db, T.tenantId, new Date());

describe('expurgarIaNutri (RN-181, D8 = 180 dias, D22, D32)', () => {
  it('(a) vencidas sem dúvida aberta → apagadas; a pergunta antes da resposta: o responde_a da resposta vira nulo pela FK', async () => {
    const { T, ctxP } = await pronto();
    const { pergunta, resposta } = await perguntaRespondida(T, ctxP);
    const outra = await perguntaRespondida(T, ctxP);
    await vencer(T, pergunta); // só a pergunta venceu: a resposta fica, desligada dela
    expect(await expurgar(T)).toEqual({ apagadas: 1, esvaziadas: 0, riscosNaoAbertos: 0 });
    expect(await linha(T, pergunta)).toBeUndefined();
    expect(await linha(T, resposta)).toMatchObject({ responde_a: null });
    await vencer(T, resposta);
    await vencer(T, outra.pergunta);
    await vencer(T, outra.resposta); // a resposta junto da pergunta
    expect(await expurgar(T)).toEqual({ apagadas: 3, esvaziadas: 0, riscosNaoAbertos: 0 });
    expect(await comoWorker(T, sql`select id from ia_nutri_mensagens`)).toEqual([]);
  });

  it('nada vencido → nada muda (a guarda de 180 dias de quem conversa hoje)', async () => {
    const { T, ctxP } = await pronto();
    const { pergunta, resposta } = await perguntaRespondida(T, ctxP);
    expect(await expurgar(T)).toEqual({ apagadas: 0, esvaziadas: 0, riscosNaoAbertos: 0 });
    expect(await linha(T, pergunta)).toMatchObject({ texto: BANANA });
    expect((await linha(T, resposta)).texto).not.toBeNull();
  });

  it('(b) pergunta vencida com dúvida aberta → texto nulo, a linha fica; resolvida, sai na volta seguinte', async () => {
    const { T, ctxP } = await pronto();
    const { pergunta, resposta } = await perguntaRespondida(T, ctxP);
    expect(await encaminhar(ctxP, pergunta, depsApp)).toBe('encaminhada');
    await vencer(T, pergunta);
    await vencer(T, resposta);
    expect(await expurgar(T)).toEqual({ apagadas: 1, esvaziadas: 1, riscosNaoAbertos: 0 });
    expect(await linha(T, pergunta)).toMatchObject({ texto: null });
    expect(await linha(T, resposta)).toBeUndefined();
    // a volta seguinte não conta de novo a que já está sem texto
    expect(await expurgar(T)).toEqual({ apagadas: 0, esvaziadas: 0, riscosNaoAbertos: 0 });
    await withTenant(T.ctx, (tx) => tx.update(iaNutriMensagens).set({ abertaPelaNutriEm: new Date(), resolvidaEm: new Date(), resolvidaPor: T.nutriId, resolucao: 'vista' }).where(eq(iaNutriMensagens.id, pergunta)), app.db);
    expect(await expurgar(T)).toEqual({ apagadas: 1, esvaziadas: 0, riscosNaoAbertos: 0 });
    expect(await linha(T, pergunta)).toBeUndefined();
  });

  it('(c) D22: risco de quem revogou, não aberto, depois dos 30 dias → aviso mínimo (texto nulo, risco fica) até criação + 180 dias; (f) vencido, sai mesmo aberto e não resolvido', async () => {
    const { T, ctxP } = await pronto();
    const r = await perguntar(ctxP, RISCO, depsApp);
    expect(r.codigo).toBe('risco');
    const id = r.mensagemId!;
    expect(await desativarNoApp(ctxP, depsApp)).toBe('desativada');
    const [teto] = await comoWorker(T, sql`select revogada_em is not null as revogada, expira_em <= now() + interval '30 days' as ate_30 from ia_nutri_mensagens where id = ${id}`);
    expect(teto).toEqual({ revogada: true, ate_30: true });
    // dentro dos 30 dias: nada muda (a nutricionista ainda pode abrir)
    expect(await expurgar(T)).toMatchObject({ apagadas: 0, esvaziadas: 0 });
    expect(await linha(T, id)).toMatchObject({ texto: RISCO });
    await vencer(T, id); // passaram os 30 dias
    expect(await expurgar(T)).toMatchObject({ apagadas: 0, esvaziadas: 1 });
    expect(await linha(T, id)).toMatchObject({ texto: null, risco: 'transtorno_alimentar', guarda_de_180: true });
    // o aviso mínimo não volta a ser contado nem apagado antes da guarda
    expect(await expurgar(T)).toMatchObject({ apagadas: 0, esvaziadas: 0 });
    // (f) "e depois nada": aberto pela equipe e não resolvido, o aviso mínimo vencido sai assim mesmo (não pede ação)
    await withTenant(T.ctx, (tx) => tx.update(iaNutriMensagens).set({ abertaPelaNutriEm: new Date() }).where(eq(iaNutriMensagens.id, id)), app.db);
    await vencer(T, id);
    expect(await expurgar(T)).toMatchObject({ apagadas: 1 });
    expect(await linha(T, id)).toBeUndefined();
  });

  it('(d) risco não aberto há mais de 72 h → contado, e um e-mail sem dados aos admins (alerta_ia, risco_ia_nutri), no máximo um por dia', async () => {
    const { T, p } = await pronto();
    const agora = new Date();
    const dias = (n: number) => new Date(agora.getTime() - n * 86_400_000);
    const base = { autor: 'paciente' as const, status: 'respondida', contouNoLimite: false, risco: 'emergencia' } as const;
    await mensagemNoBanco(app.db, T.tenantId, p.id, { ...base, texto: 'a', encaminhadaEm: dias(4), createdAt: dias(4) }); // conta
    await mensagemNoBanco(app.db, T.tenantId, p.id, { ...base, texto: 'a', encaminhadaEm: dias(2), createdAt: dias(2) }); // 48 h: não
    await mensagemNoBanco(app.db, T.tenantId, p.id, { ...base, texto: 'a', encaminhadaEm: dias(5), createdAt: dias(5), abertaPelaNutriEm: dias(4) }); // aberta: não
    await mensagemNoBanco(app.db, T.tenantId, p.id, { ...base, texto: 'a', createdAt: dias(5) }); // não foi à fila (acima de 10 no dia): não
    expect(await expurgar(T)).toEqual({ apagadas: 0, esvaziadas: 0, riscosNaoAbertos: 1 });

    const admin = `admin-ia-nutri-${randomUUID().slice(0, 8)}@teste.dev`;
    await app.db.insert(user).values({ id: randomUUID(), name: 'Admin', email: admin, appRole: 'admin' });
    const so = () => vi.mocked(listarTenantsParaVarredura).mockResolvedValueOnce([{ id: T.tenantId, fuso: T.tenant.fuso }]);
    so();
    expect(await expurgarIaNutri(app.db, agora, 'https://app.teste')).toEqual({ apagadas: 0, esvaziadas: 0, riscosNaoAbertos: 1 });
    expect(await emailsNaFila('alerta_ia', admin)).toEqual([{ tipo: 'alerta_ia', para: admin, motivo: 'risco_ia_nutri', painelUrl: 'https://app.teste/admin' }]);
    // "Um por dia" é o dia de Brasília, não 24 h (revisão da T10): o cron de 04:15 começa com segundos de variação. Datas
    // fixas (Brasília = UTC-3, sem horário de verão), longe de hoje, para o teste não depender da hora em que roda.
    const volta = async (iso: string, total: number) => {
      so();
      await expurgarIaNutri(app.db, new Date(iso), 'https://app.teste');
      expect(await emailsNaFila('alerta_ia', admin), iso).toHaveLength(total);
    };
    await volta('2030-03-10T07:15:20Z', 2); // outro dia, 04:15:20 em Brasília: sai
    await volta('2030-03-10T07:25:20Z', 2); // a nova tentativa do job (retryDelay 600 s), no mesmo dia: nada a mais
    await volta('2030-03-10T22:15:00Z', 2); // 19:15 do mesmo dia: nada a mais
    await volta('2030-03-11T07:15:05Z', 3); // a volta do dia seguinte 15 s mais cedo (23h59m45s depois): sai de novo
    await volta('2030-03-12T02:59:00Z', 3); // 23h59 do dia 11 em Brasília (já 12 em UTC): o dia é o de Brasília
    // sem risco pendente, nada
    const [{ beat_at: antes }] = (await app.db.select({ beat_at: systemHeartbeat.beatAt }).from(systemHeartbeat).where(eq(systemHeartbeat.name, MARCA)));
    const vazio = await pronto();
    vi.mocked(listarTenantsParaVarredura).mockResolvedValueOnce([{ id: vazio.T.tenantId, fuso: vazio.T.tenant.fuso }]);
    expect(await expurgarIaNutri(app.db, new Date('2030-03-13T07:15:00Z'), 'https://app.teste')).toMatchObject({ riscosNaoAbertos: 0 });
    expect(await emailsNaFila('alerta_ia', admin)).toHaveLength(3);
    expect((await app.db.select({ beat_at: systemHeartbeat.beatAt }).from(systemHeartbeat).where(eq(systemHeartbeat.name, MARCA)))[0].beat_at).toEqual(antes);
  });

  it('(e) D32: o esqueleto da revogação (guarda = fim do mês no fuso do consultório) sai depois do mês — os limites do mês seguinte começam do zero', async () => {
    const { T, p, ctxP } = await pronto();
    const { pergunta, resposta } = await perguntaRespondida(T, ctxP);
    expect(await desativarNoApp(ctxP, depsApp)).toBe('desativada');
    const [esqueleto] = await comoWorker(T, sql`select texto, contou_no_limite,
      expira_em = (date_trunc('month', now() at time zone ${T.tenant.fuso}) + interval '1 month') at time zone ${T.tenant.fuso} as fim_do_mes
      from ia_nutri_mensagens where id = ${pergunta}`);
    expect(esqueleto).toEqual({ texto: null, contou_no_limite: true, fim_do_mes: true });
    expect(await expurgar(T)).toMatchObject({ apagadas: 0 }); // ainda no mês: o esqueleto conta no limite
    await vencer(T, pergunta);
    await vencer(T, resposta); // virou o mês
    expect(await expurgar(T)).toMatchObject({ apagadas: 2 });
    const [{ n }] = await comoWorker(T, sql`select count(*)::int as n from ia_nutri_mensagens where patient_id = ${p.id} and contou_no_limite`);
    expect(n).toBe(0);
  });

  it('DP-10: paciente ocupado (perguntar, revogar, o job) fica para a próxima volta — a retenção não espera nem trava fora de ordem', async () => {
    const { T, p, ctxP } = await pronto();
    const { pergunta, resposta } = await perguntaRespondida(T, ctxP);
    await vencer(T, pergunta);
    await vencer(T, resposta);
    const outra = await dono.pool.connect();
    try {
      await outra.query('begin');
      await outra.query('select id from patients where id = $1 for update', [p.id]);
      expect(await expurgar(T)).toEqual({ apagadas: 0, esvaziadas: 0, riscosNaoAbertos: 0 });
      await outra.query('commit');
    } finally {
      outra.release();
    }
    expect(await expurgar(T)).toMatchObject({ apagadas: 2 });
  });

  it('um consultório com erro não para os outros; a volta termina com erro (nova tentativa do job) e só com o código no log', async () => {
    const ok = await pronto();
    const { pergunta, resposta } = await perguntaRespondida(ok.T, ok.ctxP);
    await vencer(ok.T, pergunta);
    await vencer(ok.T, resposta);
    vi.mocked(listarTenantsParaVarredura).mockResolvedValueOnce([{ id: 'nao-e-uuid', fuso: 'America/Sao_Paulo' }, { id: ok.T.tenantId, fuso: ok.T.tenant.fuso }]);
    const erro = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    try {
      await expect(expurgarIaNutri(app.db, new Date(), 'https://app.teste')).rejects.toThrow('falha na retenção da IA Nutri em 1 consultório');
      expect(erro).toHaveBeenCalledWith({ tenantId: 'nao-e-uuid', err: expect.any(String) }, 'falha na retenção da IA Nutri');
    } finally {
      erro.mockRestore();
    }
    expect(await linha(ok.T, pergunta)).toBeUndefined();
  });
});
