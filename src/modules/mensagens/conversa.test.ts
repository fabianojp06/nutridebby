import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { pacienteComConta } from '../../../test/portal';
import type { Db } from '@/db/client';
import { withTenant, type TenantContext } from '@/db/tenant';
import { PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { arquivarPaciente, desarquivarPaciente } from '@/modules/pacientes/lgpd';
import { ENTIDADE_ROTULO, listAccessHistory, rotuloDaAcao } from '@/modules/plataforma/audit';
import { estadoDaConversa, liberarConversa, pausarConversa, retomarConversa } from './conversa';

/**
 * Plano 25, T2 (RN-441, RN-442, RN-447, RN-453, RN-465, CH-D39): liberar, pausar e retomar a conversa. O gatilho
 * chat_conversas_regras (0128) é a rede; o módulo confere antes e devolve os códigos da interface.
 */
const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  await app.pool.end();
  await owner.pool.end();
});

const CARIMBO = { nome: 'Débora Nutricionista', crn: 'CRN-3 12345' };
type Row = Record<string, unknown>;
const em = async (ctx: TenantContext, q: SQL): Promise<Row[]> => (await withTenant(ctx, (tx) => tx.execute(q), app.db)).rows as Row[];

async function consultorio(carimbo = true): Promise<TenantDeTeste> {
  const T = await novoTenant(app.db);
  if (carimbo) await owner.pool.query('update tenants set nome_profissional = $1, crn = $2 where id = $3', [CARIMBO.nome, CARIMBO.crn, T.tenantId]);
  return T;
}
const conversaDe = async (T: TenantDeTeste, p: string) =>
  (await em(T.ctx, sql`select id, liberada_em, liberada_por, tcle_forma, pausada_em, pausada_por from chat_conversas where patient_id = ${p}`))[0] as
    | { id: string; liberada_em: string | null; liberada_por: string | null; tcle_forma: string | null; pausada_em: string | null; pausada_por: string | null }
    | undefined;
const auditoria = async (T: TenantDeTeste, p: string) =>
  (await em(T.ctx, sql`select acao, entidade, entidade_id, actor_user_id from audit_log where patient_id = ${p} and entidade like 'chat%' order by criado_em, id`)) as {
    acao: string;
    entidade: string;
    entidade_id: string;
    actor_user_id: string | null;
  }[];
/** O "Histórico de acessos" do paciente, só os itens do chat: [rótulo da ação, rótulo da entidade]. */
const historico = async (T: TenantDeTeste, p: string) =>
  (await listAccessHistory(T.ctx, p, 1, app.db)).itens.filter((i) => i.entidade.startsWith('chat')).map((i) => [rotuloDaAcao(i), ENTIDADE_ROTULO[i.entidade]]);
const estado = (T: TenantDeTeste, p: string) => withTenant(T.ctx, (tx) => estadoDaConversa(tx, p), app.db);

/** Um Db que falha se alguém abrir transação: prova que a recusa vem antes do withTenant. */
const semTransacao = () => {
  const transaction = vi.fn(() => {
    throw new Error('abriu transação');
  });
  return { db: { transaction } as unknown as Db, transaction };
};

/** Espera até `pid` ficar bloqueado por outra sessão (pg_blocking_pids). */
async function esperarBloqueio(pidQueSegura: number) {
  for (let i = 0; ; i++) {
    if ((await owner.pool.query('select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid))', [pidQueSegura])).rowCount) return;
    if (i > 300) throw new Error('ninguém ficou preso na trava');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('Plano 25 — liberarConversa (US-440, RN-441, CH-D39)', () => {
  it('grava liberada_em, liberada_por e tcle_forma; o Histórico mostra "Liberou a conversa por mensagens" e nenhum "Criou"/"Alterou" da conversa', async () => {
    const T = await consultorio();
    const p = await novoPaciente(app.db, T.ctx);
    expect(await liberarConversa(T.ctx, p.id, { forma: 'aceite_escrito', confirmou: true }, app.db)).toBe('ok');
    const c = (await conversaDe(T, p.id))!;
    expect(c).toMatchObject({ liberada_por: T.nutriId, tcle_forma: 'aceite_escrito', pausada_em: null, pausada_por: null });
    expect(c.liberada_em).not.toBeNull();
    // no audit_log: o gatilho (entidade neutra chat_conversa) e o ato (chat_liberacao) com o ator da sessão
    expect(await auditoria(T, p.id)).toEqual([
      { acao: 'criar', entidade: 'chat_conversa', entidade_id: c.id, actor_user_id: T.nutriId },
      { acao: 'criar', entidade: 'chat_liberacao', entidade_id: c.id, actor_user_id: T.nutriId },
    ]);
    expect(await historico(T, p.id)).toEqual([['Liberou a conversa por mensagens', 'Mensagens (conversa com o paciente)']]);
    const e = await estado(T, p.id);
    expect(Math.abs(e.liberadaEm!.getTime() - new Date(c.liberada_em!).getTime())).toBeLessThan(1);
    expect(e).toEqual({
      existe: true,
      liberadaEm: expect.any(Date),
      formaDoTcle: 'aceite_escrito',
      pausada: false,
      titular: 'ativo',
      temConta: false,
      carimbo: true,
    });
  });

  it('conversa nascida de um recado (sem liberação): a liberação é um UPDATE da mesma linha, com o mesmo Histórico', async () => {
    const T = await consultorio();
    const p = await novoPaciente(app.db, T.ctx);
    const [{ id }] = (await em(T.ctx, sql`insert into chat_conversas (tenant_id, patient_id) values (${T.tenantId}, ${p.id}) returning id`)) as { id: string }[];
    expect(await estado(T, p.id)).toMatchObject({ existe: true, liberadaEm: null, formaDoTcle: null });
    expect(await liberarConversa(T.ctx, p.id, { forma: 'termo_assinado', confirmou: true }, app.db)).toBe('ok');
    expect(await conversaDe(T, p.id)).toMatchObject({ id, liberada_por: T.nutriId, tcle_forma: 'termo_assinado' });
    expect((await auditoria(T, p.id)).map((a) => [a.acao, a.entidade, a.entidade_id])).toEqual([
      ['criar', 'chat_conversa', id],
      ['alterar', 'chat_conversa', id],
      ['criar', 'chat_liberacao', id],
    ]);
    expect(await historico(T, p.id)).toEqual([['Liberou a conversa por mensagens', 'Mensagens (conversa com o paciente)']]);
  });

  it('já liberada → ja_liberada, sem trocar a forma nem gravar outro "Liberou"', async () => {
    const T = await consultorio();
    const p = await novoPaciente(app.db, T.ctx);
    await liberarConversa(T.ctx, p.id, { forma: 'aceite_escrito', confirmou: true }, app.db);
    const antes = await conversaDe(T, p.id);
    expect(await liberarConversa(T.ctx, p.id, { forma: 'termo_assinado', confirmou: true }, app.db)).toBe('ja_liberada');
    expect(await conversaDe(T, p.id)).toEqual(antes);
    expect((await auditoria(T, p.id)).filter((a) => a.entidade === 'chat_liberacao')).toHaveLength(1);
  });

  it('duas liberações ao mesmo tempo: uma "ok", a outra "ja_liberada"', async () => {
    const T = await consultorio();
    const p = await novoPaciente(app.db, T.ctx);
    const r = await Promise.all([
      liberarConversa(T.ctx, p.id, { forma: 'aceite_escrito', confirmou: true }, app.db),
      liberarConversa(T.ctx, p.id, { forma: 'termo_assinado', confirmou: true }, app.db),
    ]);
    expect([...r].sort()).toEqual(['ja_liberada', 'ok']);
    expect((await auditoria(T, p.id)).filter((a) => a.entidade === 'chat_liberacao')).toHaveLength(1);
  });

  it('sem nome profissional ou sem CRN → sem_carimbo e nada gravado (RN-475)', async () => {
    for (const faltando of ['nome_profissional', 'crn'] as const) {
      const T = await consultorio();
      await owner.pool.query(`update tenants set ${faltando} = null where id = $1`, [T.tenantId]);
      const p = await novoPaciente(app.db, T.ctx);
      expect(await estado(T, p.id)).toMatchObject({ existe: false, carimbo: false });
      expect(await liberarConversa(T.ctx, p.id, { forma: 'aceite_escrito', confirmou: true }, app.db)).toBe('sem_carimbo');
      expect(await conversaDe(T, p.id)).toBeUndefined();
      expect(await auditoria(T, p.id)).toEqual([]);
    }
  });

  it('titular arquivado, bloqueado ou anonimizado → titular_inativo e nada gravado', async () => {
    const T = await consultorio();
    const arquivado = await novoPaciente(app.db, T.ctx);
    await arquivarPaciente(T.ctx, arquivado.id, app.db);
    const bloqueado = await novoPaciente(app.db, T.ctx);
    await owner.pool.query("update patients set status = 'bloqueado', bloqueado_em = now(), anonimizar_apos = '2046-11-23' where id = $1", [bloqueado.id]);
    const anonimizado = await novoPaciente(app.db, T.ctx);
    await owner.pool.query("update patients set status = 'bloqueado', bloqueado_em = now(), anonimizar_apos = '2026-01-01', anonimizado_em = now() where id = $1", [anonimizado.id]);
    for (const [p, titular] of [[arquivado, 'arquivado'], [bloqueado, 'bloqueado'], [anonimizado, 'anonimizado']] as const) {
      expect(await estado(T, p.id)).toMatchObject({ existe: false, titular });
      expect(await liberarConversa(T.ctx, p.id, { forma: 'aceite_escrito', confirmou: true }, app.db)).toBe('titular_inativo');
      expect(await conversaDe(T, p.id)).toBeUndefined();
      expect(await auditoria(T, p.id)).toEqual([]);
    }
  });

  it('paciente de outro consultório ou id inválido → PacienteNaoEncontradoError', async () => {
    const T = await consultorio();
    const outro = await consultorio();
    const p = await novoPaciente(app.db, outro.ctx);
    await expect(liberarConversa(T.ctx, p.id, { forma: 'aceite_escrito', confirmou: true }, app.db)).rejects.toBeInstanceOf(PacienteNaoEncontradoError);
    await expect(liberarConversa(T.ctx, 'nao-e-uuid', { forma: 'aceite_escrito', confirmou: true }, app.db)).rejects.toBeInstanceOf(PacienteNaoEncontradoError);
    await expect(pausarConversa(T.ctx, p.id, app.db)).rejects.toBeInstanceOf(PacienteNaoEncontradoError);
    await expect(retomarConversa(T.ctx, p.id, app.db)).rejects.toBeInstanceOf(PacienteNaoEncontradoError);
    await expect(withTenant(T.ctx, (tx) => estadoDaConversa(tx, p.id), app.db)).rejects.toBeInstanceOf(PacienteNaoEncontradoError);
    expect(await conversaDe(outro, p.id)).toBeUndefined();
  });

  it('forma do TCLE fora da lista (inclusive a verbal) ou sem a confirmação → Error antes da transação', async () => {
    const T = await consultorio();
    const p = await novoPaciente(app.db, T.ctx);
    const { db, transaction } = semTransacao();
    for (const i of [{ forma: 'verbal', confirmou: true }, { forma: 'aceite_escrito', confirmou: false }, { forma: 'termo_assinado' }]) {
      await expect(liberarConversa(T.ctx, p.id, i as never, db)).rejects.toThrow('mensagens: forma do TCLE ou confirmação inválida');
    }
    expect(transaction).not.toHaveBeenCalled();
  });

  it('só a sessão nutri libera, pausa e retoma: Error antes de abrir a transação', async () => {
    const T = await consultorio();
    const p = await novoPaciente(app.db, T.ctx);
    for (const ctx of [ctxPaciente(T.tenantId, p.id), { tenantId: T.tenantId, role: 'worker' as const }, { tenantId: T.tenantId, role: 'publico' as const }]) {
      const { db, transaction } = semTransacao();
      await expect(liberarConversa(ctx, p.id, { forma: 'aceite_escrito', confirmou: true }, db)).rejects.toThrow('mensagens: só a sessão nutri');
      await expect(pausarConversa(ctx, p.id, db)).rejects.toThrow('mensagens: só a sessão nutri');
      await expect(retomarConversa(ctx, p.id, db)).rejects.toThrow('mensagens: só a sessão nutri');
      expect(transaction).not.toHaveBeenCalled();
    }
  });

  it('estadoDaConversa: temConta pela conta ligada ao paciente', async () => {
    const T = await consultorio();
    const { paciente } = await pacienteComConta(app.db, T);
    expect(await estado(T, paciente.id)).toEqual({
      existe: false,
      liberadaEm: null,
      formaDoTcle: null,
      pausada: false,
      titular: 'ativo',
      temConta: true,
      carimbo: true,
    });
  });
});

describe('Plano 25 — liberar × arquivar (RN-447: o paciente FOR SHARE antes da conversa)', () => {
  it('o arquivar que já segura o paciente faz a liberação esperar, e ela vê o titular arquivado: titular_inativo, sem 40P01', async () => {
    const T = await consultorio();
    const p = await novoPaciente(app.db, T.ctx);
    const outra = await app.pool.connect();
    let fechada = false;
    try {
      // como arquivarPaciente: o paciente travado e o status trocado, ainda sem commit
      await outra.query('begin');
      await outra.query(`select set_config('app.tenant_id', $1, true), set_config('app.role', 'nutri', true), set_config('app.user_id', $2, true)`, [T.tenantId, T.nutriId]);
      await outra.query("update patients set status = 'arquivado' where id = $1", [p.id]);
      const pid = (await outra.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid;
      const liberacao = liberarConversa(T.ctx, p.id, { forma: 'aceite_escrito', confirmou: true }, app.db).then(
        (r) => r,
        (e: unknown) => e,
      );
      await esperarBloqueio(pid);
      await outra.query('commit');
      fechada = true;
      expect(await liberacao).toBe('titular_inativo');
    } finally {
      if (!fechada) await outra.query('rollback').catch(() => undefined);
      outra.release();
    }
    expect(await conversaDe(T, p.id)).toBeUndefined();
  });

  it('a liberação que já segura o paciente faz o arquivar esperar; a conversa fica liberada e o titular arquivado', async () => {
    const T = await consultorio();
    const p = await novoPaciente(app.db, T.ctx);
    const outra = await app.pool.connect();
    let fechada = false;
    try {
      // como liberarConversa: o paciente FOR SHARE e a conversa gravada, ainda sem commit
      await outra.query('begin');
      await outra.query(`select set_config('app.tenant_id', $1, true), set_config('app.role', 'nutri', true), set_config('app.user_id', $2, true)`, [T.tenantId, T.nutriId]);
      await outra.query('select 1 from patients where id = $1 for share', [p.id]);
      await outra.query(`insert into chat_conversas (tenant_id, patient_id, liberada_em, liberada_por, tcle_forma) values ($1, $2, now(), $3, 'aceite_escrito')`, [
        T.tenantId,
        p.id,
        T.nutriId,
      ]);
      const pid = (await outra.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid;
      const arquivar = arquivarPaciente(T.ctx, p.id, app.db).then(
        () => null,
        (e: unknown) => e,
      );
      await esperarBloqueio(pid);
      await outra.query('commit');
      fechada = true;
      expect(await arquivar).toBeNull();
    } finally {
      if (!fechada) await outra.query('rollback').catch(() => undefined);
      outra.release();
    }
    expect(await estado(T, p.id)).toMatchObject({ existe: true, formaDoTcle: 'aceite_escrito', titular: 'arquivado' });
  });

  it('em paralelo, sem trava manual: sem 40P01, e o resultado é coerente com a ordem', async () => {
    for (let i = 0; i < 5; i++) {
      const T = await consultorio();
      const p = await novoPaciente(app.db, T.ctx);
      const [r, a] = await Promise.allSettled([liberarConversa(T.ctx, p.id, { forma: 'aceite_escrito', confirmou: true }, app.db), arquivarPaciente(T.ctx, p.id, app.db)]);
      expect(a.status).toBe('fulfilled');
      expect(r.status).toBe('fulfilled');
      const res = (r as PromiseFulfilledResult<string>).value;
      expect(['ok', 'titular_inativo']).toContain(res);
      expect(!!(await conversaDe(T, p.id))?.liberada_em).toBe(res === 'ok');
    }
  });
});

describe('Plano 25 — pausar e retomar (US-450, RN-442, CH-D39)', () => {
  it('pausar grava pausada_em/pausada_por; retomar anula os dois sem novo TCLE; o Histórico mostra os dois atos', async () => {
    const T = await consultorio();
    const p = await novoPaciente(app.db, T.ctx);
    await liberarConversa(T.ctx, p.id, { forma: 'aceite_escrito', confirmou: true }, app.db);
    const liberada = (await conversaDe(T, p.id))!;
    expect(await pausarConversa(T.ctx, p.id, app.db)).toBe('ok');
    const pausada = (await conversaDe(T, p.id))!;
    expect(pausada).toMatchObject({ pausada_por: T.nutriId, liberada_em: liberada.liberada_em, tcle_forma: 'aceite_escrito' });
    expect(pausada.pausada_em).not.toBeNull();
    expect(await estado(T, p.id)).toMatchObject({ pausada: true });
    expect(await pausarConversa(T.ctx, p.id, app.db)).toBe('ja_pausada');

    expect(await retomarConversa(T.ctx, p.id, app.db)).toBe('ok');
    expect(await conversaDe(T, p.id)).toEqual({ ...liberada, pausada_em: null, pausada_por: null });
    expect(await estado(T, p.id)).toMatchObject({ pausada: false, formaDoTcle: 'aceite_escrito' });
    expect(await retomarConversa(T.ctx, p.id, app.db)).toBe('nao_pausada');

    // mais recente primeiro; nenhum "Alterou" da linha da conversa
    expect(await historico(T, p.id)).toEqual([
      ['Retomou a conversa por mensagens', 'Mensagens (conversa com o paciente)'],
      ['Pausou a conversa por mensagens', 'Mensagens (conversa com o paciente)'],
      ['Liberou a conversa por mensagens', 'Mensagens (conversa com o paciente)'],
    ]);
    expect((await auditoria(T, p.id)).filter((a) => a.entidade.startsWith('chat_') && a.entidade !== 'chat_conversa')).toEqual([
      { acao: 'criar', entidade: 'chat_liberacao', entidade_id: liberada.id, actor_user_id: T.nutriId },
      { acao: 'criar', entidade: 'chat_pausa', entidade_id: liberada.id, actor_user_id: T.nutriId },
      { acao: 'criar', entidade: 'chat_retomada', entidade_id: liberada.id, actor_user_id: T.nutriId },
    ]);
  });

  it('sem conversa ou sem liberação: pausar → nao_liberada, retomar → nao_pausada, nada gravado', async () => {
    const T = await consultorio();
    const p = await novoPaciente(app.db, T.ctx);
    expect(await pausarConversa(T.ctx, p.id, app.db)).toBe('nao_liberada');
    expect(await retomarConversa(T.ctx, p.id, app.db)).toBe('nao_pausada');
    await em(T.ctx, sql`insert into chat_conversas (tenant_id, patient_id) values (${T.tenantId}, ${p.id})`); // nascida de recado
    expect(await pausarConversa(T.ctx, p.id, app.db)).toBe('nao_liberada');
    expect(await retomarConversa(T.ctx, p.id, app.db)).toBe('nao_pausada');
    expect((await auditoria(T, p.id)).map((a) => a.entidade)).toEqual(['chat_conversa']);
  });

  it('pausar e retomar travam o paciente (FOR UPDATE) antes da conversa', async () => {
    const T = await consultorio();
    const p = await novoPaciente(app.db, T.ctx);
    await liberarConversa(T.ctx, p.id, { forma: 'aceite_escrito', confirmou: true }, app.db);
    for (const acao of [pausarConversa, retomarConversa]) {
      const outra = await app.pool.connect();
      let fechada = false;
      try {
        // quem segura o paciente FOR SHARE (a liberação, o envio da nutricionista) bloqueia o FOR UPDATE da pausa
        await outra.query('begin');
        await outra.query(`select set_config('app.tenant_id', $1, true), set_config('app.role', 'nutri', true)`, [T.tenantId]);
        await outra.query('select 1 from patients where id = $1 for share', [p.id]);
        const pid = (await outra.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid;
        const r = acao(T.ctx, p.id, app.db).then(
          (x) => x,
          (e: unknown) => e,
        );
        await esperarBloqueio(pid);
        // a pausa espera o paciente SEM ter pegado a conversa: quem segura o paciente ainda a trava sem esperar
        await outra.query('select 1 from chat_conversas where patient_id = $1 for update nowait', [p.id]);
        await outra.query('commit');
        fechada = true;
        expect(await r).toBe('ok');
      } finally {
        if (!fechada) await outra.query('rollback').catch(() => undefined);
        outra.release();
      }
    }
  });

  it('titular arquivado ou bloqueado: pausar e retomar → titular_inativo (conversa só para consulta)', async () => {
    const T = await consultorio();
    const p = await novoPaciente(app.db, T.ctx);
    await liberarConversa(T.ctx, p.id, { forma: 'aceite_escrito', confirmou: true }, app.db);
    await arquivarPaciente(T.ctx, p.id, app.db);
    expect(await pausarConversa(T.ctx, p.id, app.db)).toBe('titular_inativo');
    expect(await retomarConversa(T.ctx, p.id, app.db)).toBe('titular_inativo');
    await owner.pool.query("update patients set status = 'bloqueado', bloqueado_em = now(), anonimizar_apos = '2046-11-23' where id = $1", [p.id]);
    expect(await pausarConversa(T.ctx, p.id, app.db)).toBe('titular_inativo');
    expect(await conversaDe(T, p.id)).toMatchObject({ pausada_em: null });
  });
});

describe('Plano 25 — RN-465: arquivar e desarquivar', () => {
  it('arquivar deixa a conversa só para consulta; desarquivar a devolve como estava (liberada, pausada, mesma forma), sem nova liberação', async () => {
    const T = await consultorio();
    for (const pausar of [false, true]) {
      const p = await novoPaciente(app.db, T.ctx);
      await liberarConversa(T.ctx, p.id, { forma: 'termo_assinado', confirmou: true }, app.db);
      if (pausar) await pausarConversa(T.ctx, p.id, app.db);
      const antes = await conversaDe(T, p.id);
      const estadoAntes = await estado(T, p.id);

      await arquivarPaciente(T.ctx, p.id, app.db);
      expect(await estado(T, p.id)).toEqual({ ...estadoAntes, titular: 'arquivado' });
      // só leitura: o banco recusa a mensagem da nutricionista (gatilho chat_mensagens_regras)
      await expect(
        em(
          T.ctx,
          sql`insert into chat_mensagens (tenant_id, patient_id, autor, autor_user_id, texto) values (${T.tenantId}, ${p.id}, 'nutri', ${T.nutriId}, 'Oi')`,
        ),
      ).rejects.toThrow();
      expect(await liberarConversa(T.ctx, p.id, { forma: 'aceite_escrito', confirmou: true }, app.db)).toBe('titular_inativo');

      await desarquivarPaciente(T.ctx, p.id, app.db);
      expect(await estado(T, p.id)).toEqual(estadoAntes);
      expect(await conversaDe(T, p.id)).toEqual(antes);
      expect((await auditoria(T, p.id)).filter((a) => a.entidade === 'chat_liberacao')).toHaveLength(1);
    }
  });
});
