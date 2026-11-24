import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { stopBoss } from '@/jobs/boss';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { randomUUID } from 'node:crypto';
import { pacienteComConta } from '../../../test/portal';
import { closeDb, type Db } from '@/db/client';
import { user } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { arquivarPaciente, desarquivarPaciente } from '@/modules/pacientes/lgpd';
import { ENTIDADE_ROTULO, listAccessHistory, rotuloDaAcao } from '@/modules/plataforma/audit';
import { consultorioDoChat, esperarBloqueio as esperarTrava, mensagemDoDono, pacienteDoChat, recadoPara } from '../../../test/mensagens';
import { conversaNoPainel, liberarConversa, marcarLida, mensagensNaFaixa, minhaConversa, pausarConversa, retomarConversa, situacao } from './conversa';
import { enviarComoNutri, enviarComoPaciente } from './envio';
import { contadorDeMensagens } from './caixa';
import { salvarConfiguracao } from './horario';

/**
 * Plano 25, T2 (RN-441, RN-442, RN-447, RN-453, RN-465, CH-D39): liberar, pausar e retomar a conversa. O gatilho
 * chat_conversas_regras (0133) é a rede; o módulo confere antes e devolve os códigos da interface.
 */
const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  // T4: o envio dispara o motor de avisos (pg-boss) e enfileira e-mail
  await stopBoss();
  await closeDb();
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
  (await em(T.ctx, sql`select acao, entidade, entidade_id, actor_user_id from audit_log where patient_id = ${p} and entidade like 'chat%' and acao <> 'ler' order by criado_em, id`)) as {
    acao: string;
    entidade: string;
    entidade_id: string;
    actor_user_id: string | null;
  }[];
/** O "Histórico de acessos" do paciente, só os itens do chat: [rótulo da ação, rótulo da entidade]. */
const historico = async (T: TenantDeTeste, p: string) =>
  (await listAccessHistory(T.ctx, p, 1, app.db)).itens.filter((i) => i.entidade.startsWith('chat') && i.acao !== 'ler').map((i) => [rotuloDaAcao(i), ENTIDADE_ROTULO[i.entidade]]);
/**
 * O estado da conversa como as telas o recebem (`conversaNoPainel`; o `estadoDaConversa` saiu como código morto na revisão
 * final do PR 2). A abertura grava a leitura (`ler` de `chat`): `auditoria` e `historico` acima a deixam de fora, e as
 * leituras são conferidas por `leiturasAuditadas`.
 */
const estado = async (T: TenantDeTeste, p: string) => (await conversaNoPainel(T.ctx, p, {}, app.db)).estado;

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
    await expect(conversaNoPainel(T.ctx, p.id, {}, app.db)).rejects.toBeInstanceOf(PacienteNaoEncontradoError);
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

  it('estado da conversa: temConta pela conta ligada ao paciente', async () => {
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

  it('pausar e retomar esperam também quem segura o paciente com FOR KEY SHARE (é FOR UPDATE, não NO KEY UPDATE)', async () => {
    const T = await consultorio();
    const p = await novoPaciente(app.db, T.ctx);
    await liberarConversa(T.ctx, p.id, { forma: 'aceite_escrito', confirmou: true }, app.db);
    for (const acao of [pausarConversa, retomarConversa]) {
      const outra = await app.pool.connect();
      let fechada = false;
      try {
        // FOR KEY SHARE: a trava da FK (o INSERT de uma mensagem do paciente, o marcador de leitura); com FOR NO KEY UPDATE, a
        // pausa não esperaria
        await outra.query('begin');
        await outra.query(`select set_config('app.tenant_id', $1, true), set_config('app.role', 'nutri', true)`, [T.tenantId]);
        await outra.query('select 1 from patients where id = $1 for key share', [p.id]);
        const pid = (await outra.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid;
        const r = acao(T.ctx, p.id, app.db).then(
          (x) => x,
          (e: unknown) => e,
        );
        await esperarBloqueio(pid);
        await outra.query('commit');
        fechada = true;
        expect(await r).toBe('ok');
      } finally {
        if (!fechada) await outra.query('rollback').catch(() => undefined);
        outra.release();
      }
    }
  });

  it('CH-D74: a pausa guarda o nome e o CRN do momento; a retomada os limpa; sem carimbo → sem_carimbo e nada gravado', async () => {
    const T = await consultorio();
    await owner.pool.query('update tenants set nome_profissional = $1, crn = $2 where id = $3', ['Debora Rodrigues', 'CRN-4 12345', T.tenantId]);
    const p = await novoPaciente(app.db, T.ctx);
    await liberarConversa(T.ctx, p.id, { forma: 'aceite_escrito', confirmou: true }, app.db);
    const carimbos = async () =>
      (await em(T.ctx, sql`select liberada_nome, liberada_crn, pausada_nome, pausada_crn from chat_conversas where patient_id = ${p.id}`))[0];
    expect(await carimbos()).toEqual({ liberada_nome: 'Debora Rodrigues', liberada_crn: 'CRN-4 12345', pausada_nome: null, pausada_crn: null });
    expect(await pausarConversa(T.ctx, p.id, app.db)).toBe('ok');
    expect(await carimbos()).toMatchObject({ pausada_nome: 'Debora Rodrigues', pausada_crn: 'CRN-4 12345' });
    expect(await retomarConversa(T.ctx, p.id, app.db)).toBe('ok');
    expect(await carimbos()).toMatchObject({ pausada_nome: null, pausada_crn: null });
    await owner.pool.query('update tenants set crn = null where id = $1', [T.tenantId]);
    expect(await pausarConversa(T.ctx, p.id, app.db)).toBe('sem_carimbo');
    expect(await conversaDe(T, p.id)).toMatchObject({ pausada_em: null });
    expect((await auditoria(T, p.id)).filter((a) => a.entidade === 'chat_pausa')).toHaveLength(1);
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

// ——— T3: leitura, marcador, cursores e situação (RN-446, RN-448, RN-452, RN-453; CH-D40, CH-D72) ———

const chat = () => consultorioDoChat(app.db, owner.pool);
const leiturasDe = async (T: TenantDeTeste, p: string) =>
  (await em(T.ctx, sql`select lado, lida_ate::text as lida_ate from chat_leituras where patient_id = ${p} order by lado`)) as { lado: string; lida_ate: string }[];
const leiturasAuditadas = async (T: TenantDeTeste) =>
  (await em(T.ctx, sql`select patient_id, entidade_id, actor_user_id from audit_log where tenant_id = ${T.tenantId} and acao = 'ler' and entidade = 'chat' order by criado_em`)) as {
    patient_id: string;
    entidade_id: string | null;
    actor_user_id: string;
  }[];
const criadaEm = async (id: string) => (await owner.pool.query<{ t: string }>('select criada_em::text as t from chat_mensagens where id = $1', [id])).rows[0].t;

describe('Plano 25 — conversaNoPainel e minhaConversa (RN-446, RN-448, RN-453)', () => {
  it('uma leitura auditada por render (entidade chat, paciente da conversa, ator da sessão); as mensagens na ordem, sem caminho de arquivo', async () => {
    const T = await chat();
    const c = await pacienteDoChat(app.db, T);
    await enviarComoPaciente(c.P, { texto: 'Oi, Débora' }, app.db);
    await enviarComoNutri(T.ctx, c.p, { texto: 'Oi, Ana' }, app.db);
    const painel = await conversaNoPainel(T.ctx, c.p, {}, app.db);
    expect(painel.estado).toMatchObject({ existe: true, pausada: false, titular: 'ativo', temConta: true, carimbo: true });
    expect(painel.mensagens.map((m) => [m.autor, m.minha, m.texto])).toEqual([
      ['paciente', false, 'Oi, Débora'],
      ['nutri', true, 'Oi, Ana'],
    ]);
    expect(Object.keys(painel.mensagens[1]).sort()).toEqual(['anexo', 'autor', 'autorCrn', 'autorNome', 'criadaEm', 'duvidaEm', 'id', 'lida', 'minha', 'recado', 'risco', 'texto']);
    expect(painel.mensagens[1]).toMatchObject({ autorNome: 'Débora Nutricionista', autorCrn: 'CRN-3 12345', recado: false, anexo: null, risco: null });
    expect(painel.haAnteriores).toBe(false);
    const portal = await minhaConversa(c.P, {}, app.db);
    expect(portal.mensagens.map((m) => [m.autor, m.minha])).toEqual([
      ['paciente', true],
      ['nutri', false],
    ]);
    expect(await leiturasAuditadas(T)).toEqual([
      { patient_id: c.p, entidade_id: null, actor_user_id: T.nutriId },
      { patient_id: c.p, entidade_id: null, actor_user_id: c.u },
    ]);
    // situação e contador não auditam
    await situacao(T.ctx, { patientId: c.p, depois: painel.mensagens[1].id }, app.db);
    await situacao(c.P, { depois: portal.mensagens[1].id }, app.db);
    await contadorDeMensagens(T.ctx, app.db);
    expect(await leiturasAuditadas(T)).toHaveLength(2);
  });

  it('minhaConversa leva o horário (sem aviso_*), e a cópia de recado aparece mesmo sem a conversa liberada', async () => {
    const T = await chat();
    const c = await pacienteDoChat(app.db, T, { liberar: false });
    await recadoPara(app.db, T, [c.p], 'Feriado na segunda');
    await salvarConfiguracao(T.ctx, { horarioAtivo: true, avisoEmail: false, faixas: [1, 2, 3, 4, 5].map((d) => ({ diaSemana: d, inicioMin: 540, fimMin: 720 })) }, app.db);
    const r = await minhaConversa(c.P, {}, app.db);
    expect(r.estado).toMatchObject({ existe: true, liberadaEm: null });
    expect(r.mensagens).toEqual([expect.objectContaining({ autor: 'nutri', recado: true, texto: 'Feriado na segunda', minha: false })]);
    expect(Object.keys(r.horario).sort()).toEqual(['faixas', 'foraDoHorario', 'horarioAtivo', 'resumo']);
    expect(r.horario).toMatchObject({ horarioAtivo: true, resumo: 'segunda a sexta, 9h às 12h' });
    expect(JSON.stringify(r)).not.toMatch(/aviso/i);
  });

  it('titular anonimizado: abrir a conversa (painel e portal) não grava leitura de chat no audit_log nem o marcador', async () => {
    const T = await novoTenant(app.db);
    await owner.pool.query('update tenants set nome_profissional = $1, crn = $2 where id = $3', ['Débora Nutricionista', 'CRN-4 54321', T.tenantId]);
    const c = await pacienteDoChat(app.db, T);
    await enviarComoPaciente(c.P, { texto: 'Oi, Débora' }, app.db);
    // a conversa de quem a imagem antiga anonimizou sem conhecer o chat (§9.9), antes da rede de limpeza
    await owner.pool.query("update patients set status = 'bloqueado', bloqueado_em = now(), anonimizar_apos = '2026-01-01', anonimizado_em = now() where id = $1", [c.p]);
    const painel = await conversaNoPainel(T.ctx, c.p, {}, app.db);
    expect(painel.estado).toMatchObject({ titular: 'anonimizado' });
    expect((await minhaConversa(c.P, {}, app.db)).estado).toMatchObject({ titular: 'anonimizado' });
    expect(await leiturasAuditadas(T)).toEqual([]);
    expect(await leiturasDe(T, c.p)).toEqual([]);
  });

  it('sessão sem conta ou que não é de paciente → Error antes da transação; conversaNoPainel só na sessão nutri e só do próprio consultório', async () => {
    const T = await chat();
    const c = await pacienteDoChat(app.db, T);
    const semConta: TenantContext = { tenantId: T.tenantId, role: 'paciente', patientId: c.p, semConta: true };
    for (const ctx of [semConta, T.ctx]) {
      const { db, transaction } = semTransacao();
      await expect(minhaConversa(ctx, {}, db)).rejects.toThrow('mensagens: só a sessão de paciente com conta');
      expect(transaction).not.toHaveBeenCalled();
    }
    const { db, transaction } = semTransacao();
    await expect(conversaNoPainel(c.P, c.p, {}, db)).rejects.toThrow('mensagens: só a sessão nutri');
    await expect(situacao(semConta, { depois: null }, db)).rejects.toThrow('mensagens: só a sessão nutri ou de paciente com conta');
    expect(transaction).not.toHaveBeenCalled();
    const outro = await chat();
    await expect(conversaNoPainel(outro.ctx, c.p, {}, app.db)).rejects.toBeInstanceOf(PacienteNaoEncontradoError);
  });
});

describe('Plano 25 — marcador e cursores pelo id (CH-D40)', () => {
  it('regressão µs: duas mensagens no mesmo milissegundo — abrir mostra as duas, a situação seguinte dá 0 e o contador zera', async () => {
    const T = await chat();
    const c = await pacienteDoChat(app.db, T);
    await mensagemDoDono(owner.pool, T, c, { criadaEm: '2026-11-23T12:00:00.123456Z', texto: 'primeira' });
    await mensagemDoDono(owner.pool, T, c, { criadaEm: '2026-11-23T12:00:00.123789Z', texto: 'segunda' });
    expect(await contadorDeMensagens(T.ctx, app.db)).toBe(1);
    const r = await conversaNoPainel(T.ctx, c.p, {}, app.db);
    expect(r.mensagens.map((m) => m.texto)).toEqual(['primeira', 'segunda']);
    expect(await leiturasDe(T, c.p)).toEqual([{ lado: 'consultorio', lida_ate: '2026-11-23 12:00:00.123789+00' }]);
    expect(await situacao(T.ctx, { patientId: c.p, depois: r.mensagens[1].id }, app.db)).toEqual({ novas: 0, ultimaLida: null });
    expect(await situacao(T.ctx, { patientId: c.p, depois: r.mensagens[0].id }, app.db)).toMatchObject({ novas: 1 });
    expect(await contadorDeMensagens(T.ctx, app.db)).toBe(0);
  });

  it('?antes= com 120 mensagens de criada_em iguais: páginas de 50, sem pular nem repetir', async () => {
    const T = await chat();
    const c = await pacienteDoChat(app.db, T);
    await owner.pool.query(
      `insert into chat_mensagens (tenant_id, patient_id, autor, autor_user_id, texto, criada_em)
       select $1, $2, 'paciente', $3, 'm' || g, '2026-11-23T12:00:00.123456Z' from generate_series(1, 120) g`,
      [T.tenantId, c.p, c.u],
    );
    const vistos: string[] = [];
    let antes: string | undefined;
    const paginas: number[] = [];
    for (;;) {
      const r = await conversaNoPainel(T.ctx, c.p, antes ? { antes } : {}, app.db);
      paginas.push(r.mensagens.length);
      vistos.unshift(...r.mensagens.map((m) => m.id));
      if (!r.haAnteriores) break;
      antes = r.mensagens[0].id;
    }
    expect(paginas).toEqual([50, 50, 20]);
    expect(new Set(vistos).size).toBe(120);
    const ordem = (await owner.pool.query<{ id: string }>('select id from chat_mensagens where patient_id = $1 order by criada_em, id', [c.p])).rows.map((x) => x.id);
    expect(vistos).toEqual(ordem);
  });

  it('lida_ate nunca volta; "Lida"/ultimaLida só depois de o outro lado abrir', async () => {
    const T = await chat();
    const c = await pacienteDoChat(app.db, T);
    const a = (await enviarComoNutri(T.ctx, c.p, { texto: 'a' }, app.db)) as { id: string };
    expect(await situacao(T.ctx, { patientId: c.p, depois: a.id }, app.db)).toEqual({ novas: 0, ultimaLida: null });
    expect((await conversaNoPainel(T.ctx, c.p, {}, app.db)).ultimaLida).toBeNull();
    await minhaConversa(c.P, {}, app.db); // o paciente abre
    expect(await situacao(T.ctx, { patientId: c.p, depois: a.id }, app.db)).toEqual({ novas: 0, ultimaLida: a.id });
    const b = (await enviarComoNutri(T.ctx, c.p, { texto: 'b' }, app.db)) as { id: string };
    expect(await situacao(T.ctx, { patientId: c.p, depois: b.id }, app.db)).toEqual({ novas: 0, ultimaLida: a.id }); // b ainda não lida
    expect(await situacao(c.P, { depois: a.id }, app.db)).toEqual({ novas: 1, ultimaLida: null });
    await minhaConversa(c.P, {}, app.db);
    const lidoAte = (await leiturasDe(T, c.p)).find((l) => l.lado === 'paciente')!.lida_ate;
    expect(lidoAte).toBe(await criadaEm(b.id));
    // marcar com a mensagem antiga não volta o marcador
    await withTenant(c.P, (tx) => marcarLida(tx, 'paciente', c.p, a.id), app.db);
    expect((await leiturasDe(T, c.p)).find((l) => l.lado === 'paciente')!.lida_ate).toBe(lidoAte);
    expect(await situacao(T.ctx, { patientId: c.p, depois: b.id }, app.db)).toEqual({ novas: 0, ultimaLida: b.id });
    // o paciente responde; a nutricionista ainda não abriu → "Enviada"; abriu → "Lida"
    const p1 = (await enviarComoPaciente(c.P, { texto: 'ok' }, app.db)) as { id: string };
    expect((await situacao(c.P, { depois: p1.id }, app.db)).ultimaLida).toBeNull();
    await conversaNoPainel(T.ctx, c.p, {}, app.db);
    expect((await situacao(c.P, { depois: p1.id }, app.db)).ultimaLida).toBe(p1.id);
    // /code-review do PR 2 (I1): a consulta só aponta mensagens da tela (até `depois`); p1 depois dela não conta
    expect((await situacao(c.P, { depois: b.id }, app.db)).ultimaLida).toBeNull();
  });

  it('o marcador usa a última mensagem do OUTRO lado carregada, nunca a própria (CH-D72)', async () => {
    const T = await chat();
    const c = await pacienteDoChat(app.db, T);
    const doPaciente = await enviarComoPaciente(c.P, { texto: 'oi' }, app.db);
    await enviarComoNutri(T.ctx, c.p, { texto: 'resposta' }, app.db); // a última carregada é a própria
    await conversaNoPainel(T.ctx, c.p, {}, app.db);
    expect(await leiturasDe(T, c.p)).toEqual([{ lado: 'consultorio', lida_ate: await criadaEm((doPaciente as { id: string }).id) }]);
    // marcarLida com uma mensagem do próprio lado não mexe no marcador
    const propria = (await enviarComoNutri(T.ctx, c.p, { texto: 'mais' }, app.db)) as { id: string };
    await withTenant(T.ctx, (tx) => marcarLida(tx, 'consultorio', c.p, propria.id), app.db);
    expect(await leiturasDe(T, c.p)).toEqual([{ lado: 'consultorio', lida_ate: await criadaEm((doPaciente as { id: string }).id) }]);
  });

  it('ids de outra conversa em ?antes=, depois e marcarLida → lista vazia, novas = 0 e marcador parado; o auditRead grava o paciente aberto', async () => {
    const T = await chat();
    const c = await pacienteDoChat(app.db, T);
    const d = await pacienteDoChat(app.db, T);
    await enviarComoPaciente(c.P, { texto: 'de c' }, app.db);
    const deD = (await enviarComoPaciente(d.P, { texto: 'de d' }, app.db)) as { id: string };
    const r = await conversaNoPainel(T.ctx, c.p, { antes: deD.id }, app.db);
    expect(r).toMatchObject({ mensagens: [], haAnteriores: false });
    expect((await leiturasAuditadas(T)).map((a) => a.patient_id)).toEqual([c.p]);
    expect(await situacao(T.ctx, { patientId: c.p, depois: deD.id }, app.db)).toEqual({ novas: 0, ultimaLida: null });
    expect(await situacao(c.P, { patientId: d.p, depois: deD.id }, app.db)).toEqual({ novas: 0, ultimaLida: null }); // no portal, o paciente vem da sessão
    await withTenant(T.ctx, (tx) => marcarLida(tx, 'consultorio', c.p, deD.id), app.db);
    expect(await leiturasDe(T, c.p)).toEqual([]);
    expect(await leiturasDe(T, d.p)).toEqual([]);
    // id que não é uuid: lista vazia, sem erro de cast
    expect((await conversaNoPainel(T.ctx, c.p, { antes: 'x' }, app.db)).mensagens).toEqual([]);
    expect(await situacao(T.ctx, { patientId: c.p, depois: 'x' }, app.db)).toEqual({ novas: 0, ultimaLida: null });
  });

  it('CH-D72: a mensagem que commita DEPOIS da leitura do outro lado continua não lida (duas conexões)', async () => {
    const T = await chat();
    const c = await pacienteDoChat(app.db, T);
    const primeira = (await enviarComoPaciente(c.P, { texto: 'primeira' }, app.db)) as { id: string };
    const outra = await app.pool.connect();
    let fechada = false;
    try {
      // o envio do paciente com o INSERT feito (criada_em = clock_timestamp() de agora) e ainda sem commit
      await outra.query('begin');
      await outra.query(
        `select set_config('app.tenant_id', $1, true), set_config('app.role', 'paciente', true), set_config('app.patient_id', $2, true), set_config('app.user_id', $3, true)`,
        [T.tenantId, c.p, c.u],
      );
      await outra.query(`insert into chat_mensagens (tenant_id, patient_id, autor, autor_user_id, texto) values ($1, $2, 'paciente', $3, 'atrasada')`, [T.tenantId, c.p, c.u]);
      // a nutricionista abre a conversa agora: vê só a primeira
      const r = await conversaNoPainel(T.ctx, c.p, {}, app.db);
      expect(r.mensagens.map((m) => m.texto)).toEqual(['primeira']);
      await outra.query('commit');
      fechada = true;
    } finally {
      if (!fechada) await outra.query('rollback').catch(() => undefined);
      outra.release();
    }
    expect(await situacao(T.ctx, { patientId: c.p, depois: primeira.id }, app.db)).toMatchObject({ novas: 1 });
    expect(await contadorDeMensagens(T.ctx, app.db)).toBe(1);
  });

  it('CH-D72: dois envios do paciente se serializam (trava do paciente e da função do aviso) — a ordem de criada_em é a de commit', async () => {
    const T = await chat();
    const c = await pacienteDoChat(app.db, T);
    const outra = await app.pool.connect();
    let fechada = false;
    try {
      // como enviarComoPaciente: o paciente travado e a função do aviso chamada, ainda sem o INSERT
      await outra.query('begin');
      await outra.query(
        `select set_config('app.tenant_id', $1, true), set_config('app.role', 'paciente', true), set_config('app.patient_id', $2, true), set_config('app.user_id', $3, true)`,
        [T.tenantId, c.p, c.u],
      );
      await outra.query('select 1 from patients where id = $1 for update', [c.p]);
      await outra.query('select app_chat_aviso_nutri_devido(false)');
      const pid = (await outra.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid;
      const segundo = enviarComoPaciente(c.P, { texto: 'segundo' }, app.db);
      await esperarTrava(owner.pool, pid);
      await outra.query(`insert into chat_mensagens (tenant_id, patient_id, autor, autor_user_id, texto) values ($1, $2, 'paciente', $3, 'primeiro')`, [T.tenantId, c.p, c.u]);
      await outra.query('commit');
      fechada = true;
      await segundo;
    } finally {
      if (!fechada) await outra.query('rollback').catch(() => undefined);
      outra.release();
    }
    expect((await conversaNoPainel(T.ctx, c.p, {}, app.db)).mensagens.map((m) => m.texto)).toEqual(['primeiro', 'segundo']);
  });
});

describe('Plano 25, T7 — mensagensNaFaixa (o link "Mensagens" da faixa do portal, RN-473, US-443)', () => {
  it('sem conversa → null (sem link); com a conversa liberada → as mensagens da nutricionista não lidas pelo paciente (0 depois de abrir)', async () => {
    const T = await chat();
    const sem = await pacienteDoChat(app.db, T, { liberar: false });
    expect(await mensagensNaFaixa(sem.P, app.db)).toBeNull();
    const c = await pacienteDoChat(app.db, T);
    expect(await mensagensNaFaixa(c.P, app.db)).toBe(0);
    await enviarComoPaciente(c.P, { texto: 'Oi' }, app.db); // a própria mensagem não conta
    expect(await mensagensNaFaixa(c.P, app.db)).toBe(0);
    await enviarComoNutri(T.ctx, c.p, { texto: 'Oi, Ana' }, app.db);
    await enviarComoNutri(T.ctx, c.p, { texto: 'Tudo bem?' }, app.db);
    expect(await mensagensNaFaixa(c.P, app.db)).toBe(2);
    await minhaConversa(c.P, {}, app.db);
    expect(await mensagensNaFaixa(c.P, app.db)).toBe(0);
    // pausada: o link fica (o paciente lê), com as não lidas
    await enviarComoNutri(T.ctx, c.p, { texto: 'Vou pausar' }, app.db);
    expect(await pausarConversa(T.ctx, c.p, app.db)).toBe('ok');
    expect(await mensagensNaFaixa(c.P, app.db)).toBe(1);
  });

  it('só com recado (sem liberação) → o link, com o recado não lido; nada do outro consultório; sem auditRead; sessão sem conta ou da equipe → null, sem transação', async () => {
    const T = await chat();
    const c = await pacienteDoChat(app.db, T, { liberar: false });
    await recadoPara(app.db, T, [c.p], 'Feriado na sexta');
    expect(await mensagensNaFaixa(c.P, app.db)).toBe(1);
    const outro = await chat();
    const d = await pacienteDoChat(app.db, outro);
    await enviarComoNutri(outro.ctx, d.p, { texto: 'de outro consultório' }, app.db);
    expect(await mensagensNaFaixa(c.P, app.db)).toBe(1);
    expect(await leiturasAuditadas(T)).toEqual([]);
    const semConta: TenantContext = { tenantId: T.tenantId, role: 'paciente', patientId: c.p, semConta: true };
    for (const ctx of [semConta, T.ctx]) {
      const { db, transaction } = semTransacao();
      expect(await mensagensNaFaixa(ctx, db)).toBeNull();
      expect(transaction).not.toHaveBeenCalled();
    }
  });
});

// /code-review do PR 2 (I1): o "Lida" pela ORDEM — a `criada_em` de cada mensagem própria contra o `lida_ate` do outro
// lado, no SQL —, não por um id que precisa estar na lista `minhas` da tela
describe('Plano 25 — /code-review do PR 2: "Lida" pela ordem (RN-448, CH-D40)', () => {
  /** Outra nutricionista do mesmo consultório (a sessão dela). */
  async function outraNutri(T: TenantDeTeste): Promise<TenantContext> {
    const id = randomUUID();
    await app.db.insert(user).values({ id, name: 'Bia Nutricionista', email: `nutri-${id.slice(0, 8)}@teste.dev`, appRole: 'nutri', tenantId: T.tenantId });
    return { ...T.ctx, actorUserId: id };
  }
  /** `n` mensagens do `autor`, um minuto entre elas (a primeira é `m0`). */
  async function muitas(T: TenantDeTeste, c: Awaited<ReturnType<typeof pacienteDoChat>>, autor: 'nutri' | 'paciente', n: number) {
    const base = Date.parse('2026-11-20T12:00:00Z');
    const ids: string[] = [];
    for (let i = 0; i < n; i++) ids.push(await mensagemDoDono(owner.pool, T, c, { autor, texto: `m${i}`, criadaEm: new Date(base + i * 60_000).toISOString() }));
    return ids;
  }

  it('(a) duas nutricionistas: o "Lida" de cada uma é o da última mensagem DELA que o paciente já passou — no render e na consulta', async () => {
    const T = await chat();
    const c = await pacienteDoChat(app.db, T);
    const B = await outraNutri(T);
    const daA = (await enviarComoNutri(T.ctx, c.p, { texto: 'da A' }, app.db)) as { id: string };
    const daB = (await enviarComoNutri(B, c.p, { texto: 'da B' }, app.db)) as { id: string };
    await minhaConversa(c.P, {}, app.db); // o paciente lê as duas
    const r = await conversaNoPainel(T.ctx, c.p, {}, app.db);
    expect(r.mensagens.map((m) => [m.texto, m.minha, m.lida])).toEqual([
      ['da A', true, true],
      ['da B', false, false],
    ]);
    expect(r.ultimaLida).toBe(daA.id); // antes: o id da mensagem da B, fora de `minhas` → "Enviada" na da A
    expect(await situacao(T.ctx, { patientId: c.p, depois: daB.id }, app.db)).toEqual({ novas: 0, ultimaLida: daA.id });
    expect((await conversaNoPainel(B, c.p, {}, app.db)).ultimaLida).toBe(daB.id);
    expect(await situacao(B, { patientId: c.p, depois: daB.id }, app.db)).toEqual({ novas: 0, ultimaLida: daB.id });
    // a A escreve de novo: a nova ainda não foi lida; o "Lida" continua na anterior
    const nova = (await enviarComoNutri(T.ctx, c.p, { texto: 'mais' }, app.db)) as { id: string };
    const depois = await conversaNoPainel(T.ctx, c.p, {}, app.db);
    expect(depois.mensagens.find((m) => m.id === nova.id)?.lida).toBe(false);
    expect(depois.ultimaLida).toBe(daA.id);
    expect((await situacao(T.ctx, { patientId: c.p, depois: nova.id }, app.db)).ultimaLida).toBe(daA.id);
  });

  it('(b) painel, ?antes=: a última lida é mais nova que tudo na tela — as próprias da página são lidas, e o "Lida" fica na última delas', async () => {
    const T = await chat();
    const c = await pacienteDoChat(app.db, T);
    const ids = await muitas(T, c, 'nutri', 55);
    await minhaConversa(c.P, {}, app.db); // o paciente lê até a m54
    const ultimas = await conversaNoPainel(T.ctx, c.p, {}, app.db);
    expect(ultimas.ultimaLida).toBe(ids[54]);
    const anterior = await conversaNoPainel(T.ctx, c.p, { antes: ultimas.mensagens[0].id }, app.db);
    expect(anterior.mensagens.map((m) => m.texto)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4']);
    expect(anterior.mensagens.every((m) => m.minha && m.lida)).toBe(true);
    expect(anterior.ultimaLida).toBe(ids[4]); // antes: ids[54], fora da tela → "Enviada" em todas
  });

  it('(b) portal, ?antes=: o mesmo para as mensagens do paciente', async () => {
    const T = await chat();
    const c = await pacienteDoChat(app.db, T);
    const ids = await muitas(T, c, 'paciente', 55);
    await conversaNoPainel(T.ctx, c.p, {}, app.db); // a nutricionista lê até a m54
    const ultimas = await minhaConversa(c.P, {}, app.db);
    expect(ultimas.ultimaLida).toBe(ids[54]);
    const anterior = await minhaConversa(c.P, { antes: ultimas.mensagens[0].id }, app.db);
    expect(anterior.mensagens.every((m) => m.minha && m.lida)).toBe(true);
    expect(anterior.ultimaLida).toBe(ids[4]);
    // sem marcador da nutricionista: nada lido
    const d = await pacienteDoChat(app.db, T);
    await muitas(T, d, 'paciente', 2);
    const nada = await minhaConversa(d.P, {}, app.db);
    expect(nada.mensagens.map((m) => m.lida)).toEqual([false, false]);
    expect(nada.ultimaLida).toBeNull();
  });

  it('nit 3: minhaConversa diz se há recado (a regra do link da faixa)', async () => {
    const T = await chat();
    const sem = await pacienteDoChat(app.db, T, { liberar: false });
    expect((await minhaConversa(sem.P, {}, app.db)).temRecado).toBe(false);
    await recadoPara(app.db, T, [sem.p], 'Feriado');
    expect((await minhaConversa(sem.P, {}, app.db)).temRecado).toBe(true);
  });
});
