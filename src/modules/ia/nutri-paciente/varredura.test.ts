import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { app, comoWorker, fecharHarnessDaConversa } from '../../../../test/ia-nutri-conversa';
import { iaNutriPronta, mensagemNoBanco } from '../../../../test/ia-nutri';
import { novoPaciente, novoTenant, type TenantDeTeste } from '../../../../test/pacientes';
import { withTenant } from '@/db/tenant';
import { reservar } from '../cota';
import { PROMPT_VERSAO_CONVERSA } from './instrucoes';
import { expirarPerguntasDoTenant } from './varredura';

// Plano 15 (P15-09): a varredura de minuto em minuto (RN-180, DP-10) — presa → falhou (interrompida) e a conciliação das
// reservas. Só nos tenants deste teste (expirarPerguntasDoTenant): a varredura de todos os tenants (expirarPerguntasIaNutri)
// mexeria nas perguntas dos outros arquivos de teste, que rodam em paralelo no mesmo banco.
afterAll(fecharHarnessDaConversa);

const minutos = (n: number) => new Date(Date.now() - n * 60_000);
async function consultorio() {
  const T = await novoTenant(app.db);
  await iaNutriPronta(app.db, T.tenantId);
  return T;
}
async function pergunta(T: TenantDeTeste, o: { status: string; criadaHaMin: number; enviada?: boolean; reservada?: boolean }) {
  const p = await novoPaciente(app.db, T.ctx);
  const criada = minutos(o.criadaHaMin);
  const id = await mensagemNoBanco(app.db, T.tenantId, p.id, {
    status: o.status, createdAt: criada, sessaoInicio: criada, ...(o.enviada ? { enviadoEm: criada, saiuEm: criada, destino: 'teste' } : {}),
    ...(o.reservada ? { modelo: 'claude-haiku-5-5', promptVersao: PROMPT_VERSAO_CONVERSA, reservaMicroUsd: 5500 } : {}),
  });
  if (o.reservada) {
    await withTenant(
      { tenantId: T.tenantId, role: 'worker' },
      (tx) => reservar(tx, { tenantId: T.tenantId, tarefaId: id, tipo: 'conversa_paciente', modelo: 'claude-haiku-5-5', promptVersao: PROMPT_VERSAO_CONVERSA, microUsd: 5500, agora: new Date(), tetoGlobalMicroUsd: 50_000_000_000 }),
      app.db,
    );
  }
  return { id, patientId: p.id };
}
const situacao = async (T: TenantDeTeste, id: string) =>
  (await comoWorker(T, sql`select status, motivo_tecnico from ia_nutri_mensagens where id = ${id}`))[0];
const resposta = (T: TenantDeTeste, id: string) =>
  comoWorker(T, sql`select r.texto_fixo, r.motivo_tecnico, r.modelo, r.sessao_inicio = q.sessao_inicio and r.expira_em = q.expira_em as mesma from ia_nutri_mensagens r join ia_nutri_mensagens q on q.id = r.responde_a where q.id = ${id}`);
const usoDe = async (T: TenantDeTeste, id: string) => (await comoWorker(T, sql`select situacao from ia_uso where tarefa_id = ${id}`))[0]?.situacao;

describe('expirarPerguntasDoTenant (RN-180, DP-10)', () => {
  it('processando há 4 min: sem enviado_em → falhou (interrompida), texto fixo de falha e estorno; com enviado_em → incerto', async () => {
    const T = await consultorio();
    const naoSaiu = await pergunta(T, { status: 'processando', criadaHaMin: 4, reservada: true });
    const saiu = await pergunta(T, { status: 'processando', criadaHaMin: 4, reservada: true, enviada: true });
    expect(await expirarPerguntasDoTenant(app.db, T.tenantId, new Date())).toBe(2);
    for (const q of [naoSaiu, saiu]) {
      expect(await situacao(T, q.id)).toEqual({ status: 'falhou', motivo_tecnico: 'interrompida' });
      expect(await resposta(T, q.id)).toEqual([{ texto_fixo: 'falha', motivo_tecnico: 'interrompida', modelo: 'claude-haiku-5-5', mesma: true }]);
    }
    expect(await usoDe(T, naoSaiu.id)).toBe('estornado');
    expect(await usoDe(T, saiu.id)).toBe('incerto');
    // de novo: nada mais a fazer
    expect(await expirarPerguntasDoTenant(app.db, T.tenantId, new Date())).toBe(0);
  });

  it('na fila há 4 min (sem reserva) → falhou com o texto fixo; na fila ou processando de 1 min → intocadas', async () => {
    const T = await consultorio();
    const velha = await pergunta(T, { status: 'na_fila', criadaHaMin: 4 });
    const nova = await pergunta(T, { status: 'processando', criadaHaMin: 1, reservada: true });
    const novaNaFila = await pergunta(T, { status: 'na_fila', criadaHaMin: 1 });
    expect(await expirarPerguntasDoTenant(app.db, T.tenantId, new Date())).toBe(1);
    expect(await situacao(T, velha.id)).toEqual({ status: 'falhou', motivo_tecnico: 'interrompida' });
    expect(await resposta(T, velha.id)).toEqual([{ texto_fixo: 'falha', motivo_tecnico: 'interrompida', modelo: null, mesma: true }]);
    expect(await usoDe(T, velha.id)).toBeUndefined();
    expect(await situacao(T, nova.id)).toEqual({ status: 'processando', motivo_tecnico: null });
    expect(await usoDe(T, nova.id)).toBe('reservado');
    expect(await situacao(T, novaNaFila.id)).toEqual({ status: 'na_fila', motivo_tecnico: null });
    expect(await resposta(T, nova.id)).toEqual([]);
  });

  it('conciliação: cancelada (revogação) ou falhou com ia_uso ainda reservado → estornado (não saiu) ou incerto (saiu), sem resposta nova', async () => {
    const T = await consultorio();
    const cancelada = await pergunta(T, { status: 'cancelada', criadaHaMin: 1, reservada: true });
    const falhouSaiu = await pergunta(T, { status: 'falhou', criadaHaMin: 1, reservada: true, enviada: true });
    expect(await expirarPerguntasDoTenant(app.db, T.tenantId, new Date())).toBe(2);
    expect(await usoDe(T, cancelada.id)).toBe('estornado');
    expect(await usoDe(T, falhouSaiu.id)).toBe('incerto');
    expect(await situacao(T, cancelada.id)).toEqual({ status: 'cancelada', motivo_tecnico: null });
    expect(await resposta(T, cancelada.id)).toEqual([]);
    expect(await resposta(T, falhouSaiu.id)).toEqual([]);
  });

  it('DP-10: com o paciente travado por outra transação, a varredura não espera e deixa a presa para a próxima volta', async () => {
    const T = await consultorio();
    const presa = await pergunta(T, { status: 'processando', criadaHaMin: 4, reservada: true });
    const cliente = await app.pool.connect();
    try {
      await cliente.query('begin');
      await cliente.query(`select set_config('app.tenant_id', $1, true), set_config('app.role', 'worker', true)`, [T.tenantId]);
      await cliente.query('select id from patients where id = $1 for update', [presa.patientId]);
      const n = await Promise.race([
        expirarPerguntasDoTenant(app.db, T.tenantId, new Date()),
        new Promise<'esperou'>((r) => setTimeout(() => r('esperou'), 5_000)),
      ]);
      expect(n).toBe(0);
      expect(await situacao(T, presa.id)).toEqual({ status: 'processando', motivo_tecnico: null });
    } finally {
      await cliente.query('rollback');
      cliente.release();
    }
    // solto o paciente, a volta seguinte resolve
    expect(await expirarPerguntasDoTenant(app.db, T.tenantId, new Date())).toBe(1);
    expect(await usoDe(T, presa.id)).toBe('estornado');
  });
});
