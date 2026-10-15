import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import { makeDb } from '../../../../test/db';
import { IA_TESTE, iaPronta } from '../../../../test/ia';
import { aceiteNoBanco, iaNutriPronta } from '../../../../test/ia-nutri';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../../test/pacientes';
import { pacienteComConta } from '../../../../test/portal';
import { closeDb } from '@/db/client';
import { auditLog, iaNutriParticipacoes, patients, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { MSG_IA_NUTRI } from './constantes';
import { ativarIaNutri, bloquearPaciente, ConfirmarPesoOcultoError, desativarIaNutri, IaNutriError, liberarPaciente, situacaoNaFicha, temParticipacao } from './participacao';

// ★ DO-2 trocada (D37): sem trava de texto em produção — o ambiente "de produção" só quando o teste pede (molde de contas.test.ts)
const ambiente = vi.hoisted(() => ({ producao: null as boolean | null }));
vi.mock('@/env', async (orig) => {
  const real = await orig<typeof import('@/env')>();
  return { ...real, emProducao: (e: Parameters<typeof real.emProducao>[0]) => ambiente.producao ?? real.emProducao(e) };
});

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});

const ativadaEm = async (tenantId: string) => (await app.db.select({ em: tenants.iaNutriAtivadaEm }).from(tenants).where(eq(tenants.id, tenantId)))[0].em;
const erro = (pr: Promise<unknown>) => pr.then(() => null, (e: unknown) => (e instanceof IaNutriError ? e.mensagem : e));

describe('US-170 — ativar e desligar a IA Nutri no consultório', () => {
  it('★ DO-2 trocada (D37): com o aditivo 1.2, grava ia_nutri_ativada_em mesmo em produção; ativar de novo não muda a data; desativar → nulo', async () => {
    ambiente.producao = true;
    const { emProducao } = await import('@/env');
    expect(emProducao({ NODE_ENV: 'test', APP_URL: 'http://localhost:3100' })).toBe(true);
    const T = await novoTenant(app.db);
    await iaPronta(app.db, T.tenantId, { aditivo: '1.2' });
    try {
      await ativarIaNutri(T.ctx, { ia: IA_TESTE, db: app.db });
    } finally {
      ambiente.producao = null;
    }
    const primeira = await ativadaEm(T.tenantId);
    expect(primeira).toBeInstanceOf(Date);
    await ativarIaNutri(T.ctx, { ia: IA_TESTE, db: app.db });
    expect((await ativadaEm(T.tenantId))?.getTime()).toBe(primeira!.getTime());
    await desativarIaNutri(T.ctx, { db: app.db });
    expect(await ativadaEm(T.tenantId)).toBeNull();
  });

  it('aditivo 1.1 → "leia e aceite a nova versão"; também com a IA Nutri pausada (aba antiga ou POST direto, /code-review do PR #37)', async () => {
    const T = await novoTenant(app.db);
    await iaPronta(app.db, T.tenantId, { aditivo: '1.1' });
    expect(await erro(ativarIaNutri(T.ctx, { ia: IA_TESTE, db: app.db }))).toBe(MSG_IA_NUTRI.aditivoNovo);
    expect(await erro(ativarIaNutri(T.ctx, { ia: { ...IA_TESTE, nutriDesligada: true }, db: app.db }))).toBe(MSG_IA_NUTRI.aditivoNovo);
    expect(await erro(ativarIaNutri(T.ctx, { ia: { ...IA_TESTE, destino: null }, db: app.db }))).toBe(MSG_IA_NUTRI.aditivoNovo);
    expect(await ativadaEm(T.tenantId)).toBeNull();
  });

  it('aditivo 1.2 com a IA Nutri pausada (IA_NUTRI_DESLIGADA) → ativa (a pausa não impede ativar)', async () => {
    const T = await novoTenant(app.db);
    await iaPronta(app.db, T.tenantId, { aditivo: '1.2' });
    await ativarIaNutri(T.ctx, { ia: { ...IA_TESTE, nutriDesligada: true }, db: app.db });
    expect(await ativadaEm(T.tenantId)).toBeInstanceOf(Date);
  });

  it('IA do consultório não liberada pelo suporte, não ativada ou sem retenção aceita → "não está disponível"', async () => {
    const T = await novoTenant(app.db);
    await iaPronta(app.db, T.tenantId, { aditivo: '1.2' });
    await app.db.update(tenants).set({ iaLiberada: false }).where(eq(tenants.id, T.tenantId));
    expect(await erro(ativarIaNutri(T.ctx, { ia: IA_TESTE, db: app.db }))).toBe(MSG_IA_NUTRI.naoDisponivel);
    await app.db.update(tenants).set({ iaLiberada: true, iaAtivadaEm: null }).where(eq(tenants.id, T.tenantId));
    expect(await erro(ativarIaNutri(T.ctx, { ia: IA_TESTE, db: app.db }))).toBe(MSG_IA_NUTRI.naoDisponivel);
    await app.db.update(tenants).set({ iaAtivadaEm: new Date() }).where(eq(tenants.id, T.tenantId));
    expect(await erro(ativarIaNutri(T.ctx, { ia: { ...IA_TESTE, retencao: null }, db: app.db }))).toBe(MSG_IA_NUTRI.naoDisponivel);
    expect(await ativadaEm(T.tenantId)).toBeNull();
  });
});

describe('US-170 / D6 / D33 — liberar e bloquear o paciente', () => {
  it('peso oculto no app → pede confirmação; confirmado → liberado em nome da nutricionista; bloquear e liberar de novo → bloqueada_em nula', async () => {
    const T = await novoTenant(app.db);
    await iaNutriPronta(app.db, T.tenantId);
    const p = await novoPaciente(app.db, T.ctx, { pesoOcultoNoAppEm: new Date() });
    const linha = async () => (await withTenant(T.ctx, (tx) => tx.select().from(iaNutriParticipacoes).where(eq(iaNutriParticipacoes.patientId, p.id)), app.db))[0];
    await expect(liberarPaciente(T.ctx, p.id, { confirmarPesoOculto: false, db: app.db })).rejects.toBeInstanceOf(ConfirmarPesoOcultoError);
    expect(await linha()).toBeUndefined();
    await liberarPaciente(T.ctx, p.id, { confirmarPesoOculto: true, db: app.db });
    expect(await linha()).toMatchObject({ liberadaPor: T.nutriId, bloqueadaEm: null });
    await bloquearPaciente(T.ctx, p.id, app.db);
    expect((await linha()).bloqueadaEm).toBeInstanceOf(Date);
    await liberarPaciente(T.ctx, p.id, { confirmarPesoOculto: true, db: app.db });
    expect((await linha()).bloqueadaEm).toBeNull();
    // RN-183: a liberação no histórico (gatilho de auditoria, entidade ia_nutri_liberacao)
    const audit = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.patientId, p.id), eq(auditLog.entidade, 'ia_nutri_liberacao'))), app.db);
    expect(audit.map((a) => a.acao).sort()).toEqual(['alterar', 'alterar', 'criar']);
    expect(audit.every((a) => a.actorUserId === T.nutriId)).toBe(true);
  });

  it('paciente bloqueado por pedido de exclusão ou de outro consultório → recusado; sessão sem a nutricionista → recusada', async () => {
    const T = await novoTenant(app.db);
    const bloqueado = await novoPaciente(app.db, T.ctx, { status: 'bloqueado' });
    await expect(liberarPaciente(T.ctx, bloqueado.id, { confirmarPesoOculto: true, db: app.db })).rejects.toBeInstanceOf(PacienteBloqueadoError);
    const outro = await novoTenant(app.db);
    const p = await novoPaciente(app.db, outro.ctx);
    await expect(liberarPaciente(T.ctx, p.id, { confirmarPesoOculto: true, db: app.db })).rejects.toBeInstanceOf(PacienteNaoEncontradoError);
    await expect(liberarPaciente(ctxPaciente(outro.tenantId, p.id), p.id, { confirmarPesoOculto: true, db: app.db })).rejects.toThrow('liberarPaciente: só a sessão da nutricionista');
  });
});

describe('situacaoNaFicha e temParticipacao (a aba "IA Nutri" da ficha)', () => {
  it('nao → aguardando (sem consentimento) → em_uso (com) → bloqueada; o peso oculto e o que desativar (DP-17)', async () => {
    const T = await novoTenant(app.db);
    await iaNutriPronta(app.db, T.tenantId);
    const { paciente: p, userId } = await pacienteComConta(app.db, T, { pesoOcultoNoAppEm: new Date() });
    const ficha = () => situacaoNaFicha(T.ctx, p.id, 'teste', app.db);
    expect(await temParticipacao(T.ctx, p.id, app.db)).toBe(false);
    expect(await ficha()).toEqual({ liberacao: 'nao', pesoOculto: true, podeRegistrarDesativacao: false });
    await liberarPaciente(T.ctx, p.id, { confirmarPesoOculto: true, db: app.db });
    expect(await temParticipacao(T.ctx, p.id, app.db)).toBe(true);
    expect(await ficha()).toEqual({ liberacao: 'aguardando', pesoOculto: true, podeRegistrarDesativacao: false });
    await aceiteNoBanco(app.db, ctxPaciente(T.tenantId, p.id, userId));
    expect(await ficha()).toEqual({ liberacao: 'em_uso', pesoOculto: true, podeRegistrarDesativacao: true });
    expect(await situacaoNaFicha(T.ctx, p.id, 'anthropic-us', app.db)).toMatchObject({ liberacao: 'aguardando', podeRegistrarDesativacao: true });
    await bloquearPaciente(T.ctx, p.id, app.db);
    expect(await ficha()).toEqual({ liberacao: 'bloqueada', pesoOculto: true, podeRegistrarDesativacao: true });
    expect(await temParticipacao(T.ctx, p.id, app.db)).toBe(true);
  });

  it('R6: o paciente bloqueado por pedido de exclusão também tem a aba (DP-17); fora do consultório ou id inválido → não encontrado', async () => {
    const T = await novoTenant(app.db);
    await iaNutriPronta(app.db, T.tenantId);
    const { paciente: p, userId } = await pacienteComConta(app.db, T);
    await liberarPaciente(T.ctx, p.id, { confirmarPesoOculto: false, db: app.db });
    await aceiteNoBanco(app.db, ctxPaciente(T.tenantId, p.id, userId));
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado' }).where(eq(patients.id, p.id)), app.db);
    expect(await situacaoNaFicha(T.ctx, p.id, 'teste', app.db)).toEqual({ liberacao: 'em_uso', pesoOculto: false, podeRegistrarDesativacao: true });
    const outro = await novoTenant(app.db);
    await expect(situacaoNaFicha(outro.ctx, p.id, 'teste', app.db)).rejects.toBeInstanceOf(PacienteNaoEncontradoError);
    await expect(situacaoNaFicha(T.ctx, 'x', 'teste', app.db)).rejects.toBeInstanceOf(PacienteNaoEncontradoError);
    expect(await temParticipacao(outro.ctx, p.id, app.db)).toBe(false);
    expect(await temParticipacao(T.ctx, 'x', app.db)).toBe(false);
    expect(await temParticipacao(T.ctx, randomUUID(), app.db)).toBe(false);
  });
});
