import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { stopBoss } from '@/jobs/boss';
import { consultorioDoChat, esperarBloqueio, mensagemDoDono, naSessao, pacienteDoChat } from '../../../test/mensagens';
import { novoPaciente, type TenantDeTeste } from '../../../test/pacientes';
import { closeDb, type Db } from '@/db/client';
import type { TenantContext } from '@/db/tenant';
import { PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { MSG_MENSAGENS, MSG_PORTAL_MENSAGENS } from './constantes';
import { minhaConversa, pausarConversa } from './conversa';
import { avisoNoHorario, enviarComoNutri, enviarComoPaciente } from './envio';
import { salvarConfiguracao } from './horario';

/**
 * Plano 25, T3 (RN-443, RN-444, RN-447, RN-449, RN-458; CH-D70, CH-D72): o envio de texto pelos dois lados. O gatilho
 * chat_mensagens_regras e a política paciente_chat_envio (0128) são a rede; o módulo confere antes e devolve os erros da tela.
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

const consultorio = () => consultorioDoChat(app.db, owner.pool);
const mensagensDe = async (T: TenantDeTeste, p: string) =>
  (await naSessao(app.db, T.ctx, sql`select autor, autor_user_id, autor_nome, autor_crn, texto, risco from chat_mensagens where patient_id = ${p} order by criada_em, id`)) as {
    autor: string;
    autor_user_id: string;
    autor_nome: string | null;
    autor_crn: string | null;
    texto: string;
    risco: string | null;
  }[];
const avisoDe = async (T: TenantDeTeste) =>
  (await naSessao(app.db, T.ctx, sql`select aviso_email, aviso_nutri_em from chat_avisos_nutri`)) as { aviso_email: boolean; aviso_nutri_em: string | null }[];
const semTransacao = () => {
  const transaction = vi.fn(() => {
    throw new Error('abriu transação');
  });
  return { db: { transaction } as unknown as Db, transaction };
};
/** Horário ligado o tempo todo: p_no_horario = true em qualquer hora do teste. */
const sempreNoHorario = (T: TenantDeTeste) =>
  salvarConfiguracao(T.ctx, { horarioAtivo: true, avisoEmail: true, faixas: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ diaSemana: d, inicioMin: 0, fimMin: 1440 })) }, app.db);

describe('Plano 25 — enviarComoNutri (RN-443, RN-447, RN-475)', () => {
  it('grava a mensagem da nutricionista com o carimbo do consultório, em nome da usuária, com o texto sem espaços nas pontas', async () => {
    const T = await consultorio();
    const c = await pacienteDoChat(app.db, T);
    const r = await enviarComoNutri(T.ctx, c.p, { texto: '  Bom dia, Ana!\n' }, app.db);
    expect(r).toEqual({ id: expect.any(String) });
    expect(await mensagensDe(T, c.p)).toEqual([
      { autor: 'nutri', autor_user_id: T.nutriId, autor_nome: 'Débora Nutricionista', autor_crn: 'CRN-3 12345', texto: 'Bom dia, Ana!', risco: null },
    ]);
  });

  it('vazio, longo, conversa pausada ou não liberada, titular arquivado e sem carimbo → erro com o texto da §6.2 e nada gravado', async () => {
    const T = await consultorio();
    const c = await pacienteDoChat(app.db, T);
    const E = MSG_MENSAGENS.erros;
    expect(await enviarComoNutri(T.ctx, c.p, { texto: '   ' }, app.db)).toEqual({ erro: 'vazio', mensagem: E.semConteudo });
    expect(await enviarComoNutri(T.ctx, c.p, { texto: 'a'.repeat(2001) }, app.db)).toEqual({ erro: 'longo', mensagem: E.textoLongo });
    // 2.000 caracteres contados como o Postgres conta (pontos de código), não como o JS (unidades UTF-16)
    expect(await enviarComoNutri(T.ctx, c.p, { texto: '😀'.repeat(2000) }, app.db)).toEqual({ id: expect.any(String) });
    await pausarConversa(T.ctx, c.p, app.db);
    expect(await enviarComoNutri(T.ctx, c.p, { texto: 'Oi' }, app.db)).toEqual({ erro: 'conversa', mensagem: E.conversaFechada });
    const naoLiberada = await pacienteDoChat(app.db, T, { liberar: false });
    expect(await enviarComoNutri(T.ctx, naoLiberada.p, { texto: 'Oi' }, app.db)).toEqual({ erro: 'conversa', mensagem: E.conversaFechada });
    const arquivado = await pacienteDoChat(app.db, T);
    await owner.pool.query("update patients set status = 'arquivado' where id = $1", [arquivado.p]);
    expect(await enviarComoNutri(T.ctx, arquivado.p, { texto: 'Oi' }, app.db)).toEqual({ erro: 'conversa', mensagem: E.conversaFechada });
    const outra = await pacienteDoChat(app.db, T);
    await owner.pool.query('update tenants set crn = null where id = $1', [T.tenantId]);
    expect(await enviarComoNutri(T.ctx, outra.p, { texto: 'Oi' }, app.db)).toEqual({ erro: 'carimbo', mensagem: E.semCarimbo });
    expect(await mensagensDe(T, c.p)).toHaveLength(1); // só a de 2.000 emojis
    for (const x of [naoLiberada, arquivado, outra]) expect(await mensagensDe(T, x.p)).toEqual([]);
  });

  it('paciente de outro consultório → PacienteNaoEncontradoError; sessão que não é nutri → Error antes da transação', async () => {
    const T = await consultorio();
    const outro = await consultorio();
    const c = await pacienteDoChat(app.db, outro);
    await expect(enviarComoNutri(T.ctx, c.p, { texto: 'Oi' }, app.db)).rejects.toBeInstanceOf(PacienteNaoEncontradoError);
    for (const ctx of [c.P, { tenantId: outro.tenantId, role: 'worker' as const }]) {
      const { db, transaction } = semTransacao();
      await expect(enviarComoNutri(ctx, c.p, { texto: 'Oi' }, db)).rejects.toThrow('mensagens: só a sessão nutri');
      expect(transaction).not.toHaveBeenCalled();
    }
  });
});

describe('Plano 25 — enviarComoPaciente (RN-443, RN-447, RN-449)', () => {
  it('grava a mensagem do paciente sem carimbo, em nome da conta; sem risco, textoFixo nulo', async () => {
    const T = await consultorio();
    const c = await pacienteDoChat(app.db, T);
    expect(await enviarComoPaciente(c.P, { texto: ' Posso trocar a banana? ' }, app.db)).toEqual({ id: expect.any(String), textoFixo: null });
    expect(await mensagensDe(T, c.p)).toEqual([{ autor: 'paciente', autor_user_id: c.u, autor_nome: null, autor_crn: null, texto: 'Posso trocar a banana?', risco: null }]);
  });

  it('sintoma agudo grava `sintoma_agudo` e devolve o texto fixo; autolesão grava `emergencia`; transtorno, `transtorno_alimentar`', async () => {
    const T = await consultorio();
    const c = await pacienteDoChat(app.db, T);
    expect(await enviarComoPaciente(c.P, { texto: 'meu peito dói' }, app.db)).toMatchObject({ textoFixo: 'sintoma_agudo' });
    expect(await enviarComoPaciente(c.P, { texto: 'eu me mato' }, app.db)).toMatchObject({ textoFixo: 'risco_emergencia' });
    expect(await enviarComoPaciente(c.P, { texto: 'vomito depois de comer pra não engordar' }, app.db)).toMatchObject({ textoFixo: 'risco_transtorno' });
    expect((await mensagensDe(T, c.p)).map((m) => m.risco)).toEqual(['sintoma_agudo', 'emergencia', 'transtorno_alimentar']);
  });

  it('limites: 30 na última hora e 200 no dia (no fuso do consultório) → "muitas", nada gravado; as de ontem não contam', async () => {
    const T = await consultorio();
    const hora = await pacienteDoChat(app.db, T);
    for (let i = 0; i < 30; i++) await mensagemDoDono(owner.pool, T, hora, { criadaEm: new Date(Date.now() - (i + 1) * 60_000).toISOString() });
    expect(await enviarComoPaciente(hora.P, { texto: 'Oi' }, app.db)).toEqual({ erro: 'muitas', mensagem: MSG_PORTAL_MENSAGENS.erros.muitas });
    expect(await mensagensDe(T, hora.p)).toHaveLength(30);

    const inicio = `(date_trunc('day', now() at time zone '${T.tenant.fuso}') at time zone '${T.tenant.fuso}')`;
    const dia = await pacienteDoChat(app.db, T);
    await owner.pool.query(
      `insert into chat_mensagens (tenant_id, patient_id, autor, autor_user_id, texto, criada_em)
       select $1, $2, 'paciente', $3, 'Oi', ${inicio} from generate_series(1, 200)`,
      [T.tenantId, dia.p, dia.u],
    );
    expect(await enviarComoPaciente(dia.P, { texto: 'Oi' }, app.db)).toMatchObject({ erro: 'muitas' });

    const ontem = await pacienteDoChat(app.db, T);
    await owner.pool.query(
      `insert into chat_mensagens (tenant_id, patient_id, autor, autor_user_id, texto, criada_em)
       select $1, $2, 'paciente', $3, 'Oi', least(${inicio} - interval '1 second', now() - interval '61 minutes') from generate_series(1, 200)`,
      [T.tenantId, ontem.p, ontem.u],
    );
    expect(await enviarComoPaciente(ontem.P, { texto: 'Oi' }, app.db)).toMatchObject({ textoFixo: null });
  });

  it('M8: recusado por "muitas" com sinal de risco no texto → o erro leva o textoFixo do socorro; nada é gravado', async () => {
    const T = await consultorio();
    const c = await pacienteDoChat(app.db, T);
    for (let i = 0; i < 30; i++) await mensagemDoDono(owner.pool, T, c, { criadaEm: new Date(Date.now() - (i + 1) * 60_000).toISOString() });
    expect(await enviarComoPaciente(c.P, { texto: 'meu peito dói' }, app.db)).toEqual({ erro: 'muitas', mensagem: MSG_PORTAL_MENSAGENS.erros.muitas, textoFixo: 'sintoma_agudo' });
    expect(await enviarComoPaciente(c.P, { texto: 'Oi' }, app.db)).toEqual({ erro: 'muitas', mensagem: MSG_PORTAL_MENSAGENS.erros.muitas });
    expect(await mensagensDe(T, c.p)).toHaveLength(30);
  });

  it('conversa pausada ou não liberada, vazio e longo → erro com o texto do portal e nada gravado', async () => {
    const T = await consultorio();
    const c = await pacienteDoChat(app.db, T);
    const E = MSG_PORTAL_MENSAGENS.erros;
    expect(await enviarComoPaciente(c.P, { texto: '' }, app.db)).toEqual({ erro: 'vazio', mensagem: E.semConteudo });
    expect(await enviarComoPaciente(c.P, { texto: 'a'.repeat(2001) }, app.db)).toEqual({ erro: 'longo', mensagem: E.textoLongo });
    await pausarConversa(T.ctx, c.p, app.db);
    expect(await enviarComoPaciente(c.P, { texto: 'Oi' }, app.db)).toEqual({ erro: 'conversa', mensagem: E.pausadaNoEnvio });
    const naoLiberada = await pacienteDoChat(app.db, T, { liberar: false });
    expect(await enviarComoPaciente(naoLiberada.P, { texto: 'Oi' }, app.db)).toEqual({ erro: 'conversa', mensagem: E.pausadaNoEnvio });
    expect(await mensagensDe(T, c.p)).toEqual([]);
    expect(await mensagensDe(T, naoLiberada.p)).toEqual([]);
  });

  it('sessão sem conta, da nutricionista ou do worker → Error antes da transação', async () => {
    const T = await consultorio();
    const p = await novoPaciente(app.db, T.ctx);
    const semConta: TenantContext = { tenantId: T.tenantId, role: 'paciente', patientId: p.id, semConta: true };
    for (const ctx of [semConta, T.ctx, { tenantId: T.tenantId, role: 'worker' as const }]) {
      const { db, transaction } = semTransacao();
      await expect(enviarComoPaciente(ctx, { texto: 'Oi' }, db)).rejects.toThrow('mensagens: só a sessão de paciente com conta');
      expect(transaction).not.toHaveBeenCalled();
    }
  });
});

describe('Plano 25 — aviso à nutricionista no envio do paciente (RN-458; CH-D70, CH-D72)', () => {
  it('app_chat_aviso_nutri_devido roda em todo envio gravado (a linha do aviso nasce no primeiro), e nunca num envio recusado', async () => {
    const T = await consultorio();
    const c = await pacienteDoChat(app.db, T);
    expect(await enviarComoPaciente(c.P, { texto: '' }, app.db)).toMatchObject({ erro: 'vazio' });
    await pausarConversa(T.ctx, c.p, app.db);
    expect(await enviarComoPaciente(c.P, { texto: 'Oi' }, app.db)).toMatchObject({ erro: 'conversa' });
    expect(await avisoDe(T)).toEqual([]); // recusado: a função não foi chamada
    const d = await pacienteDoChat(app.db, T);
    expect(await enviarComoPaciente(d.P, { texto: 'Oi' }, app.db)).toMatchObject({ textoFixo: null });
    expect(await avisoDe(T)).toHaveLength(1); // chamada mesmo com o horário desligado (p_no_horario pode ser falso)
  });

  it('canal lateral: com o e-mail devido (true) ou não (false), a resposta ao paciente é a mesma — mesmas chaves, mesmos valores', async () => {
    const T = await consultorio();
    await sempreNoHorario(T);
    const c = await pacienteDoChat(app.db, T);
    const devido = await enviarComoPaciente(c.P, { texto: 'Oi' }, app.db);
    const marca = (await avisoDe(T))[0].aviso_nutri_em;
    expect(marca).not.toBeNull(); // a função devolveu true e marcou a janela
    const naoDevido = await enviarComoPaciente(c.P, { texto: 'Oi' }, app.db);
    expect((await avisoDe(T))[0].aviso_nutri_em).toBe(marca); // dentro das 2 h: false, a marca não mudou
    await salvarConfiguracao(T.ctx, { horarioAtivo: true, avisoEmail: false, faixas: [] }, app.db);
    const desligado = await enviarComoPaciente(c.P, { texto: 'Oi' }, app.db);
    const semId = (r: object) => ({ ...r, id: 'x' });
    expect(Object.keys(devido).sort()).toEqual(['id', 'textoFixo']);
    expect(Object.keys(naoDevido).sort()).toEqual(Object.keys(devido).sort());
    expect(Object.keys(desligado).sort()).toEqual(Object.keys(devido).sort());
    expect(semId(naoDevido)).toEqual(semId(devido));
    expect(semId(desligado)).toEqual(semId(devido));
  });

  it('envio do paciente × configuração travada: o horário do aviso é lido sem trava, e o envio termina antes do commit de quem segura chat_configuracoes', async () => {
    const T = await consultorio();
    await salvarConfiguracao(T.ctx, { horarioAtivo: true, avisoEmail: true, faixas: [{ diaSemana: 1, inicioMin: 480, fimMin: 720 }] }, app.db);
    const c = await pacienteDoChat(app.db, T);
    const outra = await app.pool.connect();
    try {
      // como salvarConfiguracao: a linha da configuração travada, sem commit
      await outra.query('begin');
      await outra.query(`select set_config('app.tenant_id', $1, true), set_config('app.role', 'nutri', true), set_config('app.user_id', $2, true)`, [T.tenantId, T.nutriId]);
      await outra.query('select 1 from chat_configuracoes where tenant_id = $1 for update', [T.tenantId]);
      const r = await Promise.race([enviarComoPaciente(c.P, { texto: 'Oi' }, app.db), new Promise<'preso'>((ok) => setTimeout(() => ok('preso'), 3000))]);
      expect(r).toMatchObject({ textoFixo: null });
    } finally {
      await outra.query('rollback').catch(() => undefined);
      outra.release();
    }
    expect(await mensagensDe(T, c.p)).toHaveLength(1);
  });

  it('M7: o horário do aviso — dentro das faixas com o horário ligado; desligado ou ligado sem faixas, fora das 21h–8h', () => {
    const fuso = 'America/Sao_Paulo';
    const as = (h: string) => new Date(`2026-11-23T${h}:00-03:00`); // segunda
    const faixas = [{ diaSemana: 1, inicioMin: 9 * 60, fimMin: 12 * 60 }];
    expect(avisoNoHorario({ horarioAtivo: true, faixas }, fuso, as('10:00'))).toBe(true);
    expect(avisoNoHorario({ horarioAtivo: true, faixas }, fuso, as('14:00'))).toBe(false);
    for (const h of [{ horarioAtivo: false, faixas }, { horarioAtivo: true, faixas: [] }]) {
      expect(avisoNoHorario(h, fuso, as('14:00'))).toBe(true);
      expect(avisoNoHorario(h, fuso, as('08:00'))).toBe(true);
      expect(avisoNoHorario(h, fuso, as('21:00'))).toBe(false);
      expect(avisoNoHorario(h, fuso, as('07:59'))).toBe(false);
    }
  });
});

describe('Plano 25 — concorrência do envio (RN-447)', () => {
  it('pausar × envio do paciente: o envio que começou depois da pausa espera o paciente e é recusado, sem 40P01', async () => {
    const T = await consultorio();
    const c = await pacienteDoChat(app.db, T);
    const outra = await app.pool.connect();
    let fechada = false;
    try {
      // como pausarConversa: o paciente FOR UPDATE, depois a conversa pausada, ainda sem commit
      await outra.query('begin');
      await outra.query(`select set_config('app.tenant_id', $1, true), set_config('app.role', 'nutri', true), set_config('app.user_id', $2, true)`, [T.tenantId, T.nutriId]);
      await outra.query('select 1 from patients where id = $1 for update', [c.p]);
      await outra.query('update chat_conversas set pausada_em = now(), pausada_por = $2 where patient_id = $1', [c.p, T.nutriId]);
      const pid = (await outra.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid;
      const envio = enviarComoPaciente(c.P, { texto: 'Oi' }, app.db).then(
        (x) => x,
        (e: unknown) => e,
      );
      await esperarBloqueio(owner.pool, pid);
      await outra.query('commit');
      fechada = true;
      expect(await envio).toEqual({ erro: 'conversa', mensagem: MSG_PORTAL_MENSAGENS.erros.pausadaNoEnvio });
    } finally {
      if (!fechada) await outra.query('rollback').catch(() => undefined);
      outra.release();
    }
    expect(await mensagensDe(T, c.p)).toEqual([]);
  });

  it('envio da nutricionista em curso (enviarComoNutri parado depois do INSERT, com as travas) não segura o render do paciente; o envio do paciente espera', async () => {
    const T = await consultorio();
    const c = await pacienteDoChat(app.db, T);
    await enviarComoNutri(T.ctx, c.p, { texto: 'Primeira' }, app.db);
    let soltar!: () => void;
    let parou!: () => void;
    const parado = new Promise<void>((ok) => (parou = ok));
    const envioNutri = enviarComoNutri(T.ctx, c.p, { texto: 'Segunda' }, app.db, {
      aposGravar: () => {
        parou();
        return new Promise<void>((ok) => (soltar = ok));
      },
    });
    await parado;
    try {
      // o render do paciente (auditRead + marcarLida, com o FOR KEY SHARE da FK na conversa) passa sem esperar
      const tela = await Promise.race([minhaConversa(c.P, {}, app.db), new Promise<'preso'>((ok) => setTimeout(() => ok('preso'), 3000))]);
      expect(tela).not.toBe('preso');
      expect((tela as Awaited<ReturnType<typeof minhaConversa>>).mensagens.map((m) => m.texto)).toEqual(['Primeira']);
      // o envio do paciente (paciente FOR UPDATE) espera o FOR SHARE do envio da nutricionista
      const envioPaciente = enviarComoPaciente(c.P, { texto: 'Resposta' }, app.db);
      const r = await Promise.race([envioPaciente, new Promise<'preso'>((ok) => setTimeout(() => ok('preso'), 300))]);
      expect(r).toBe('preso');
      soltar();
      expect(await envioNutri).toEqual({ id: expect.any(String) });
      expect(await envioPaciente).toMatchObject({ textoFixo: null });
    } finally {
      soltar?.();
    }
    expect((await mensagensDe(T, c.p)).map((m) => m.texto)).toEqual(['Primeira', 'Segunda', 'Resposta']);
  });

  it('M2: quem segura o paciente FOR SHARE (como o envio da nutricionista) faz o envio do paciente esperar', async () => {
    const T = await consultorio();
    const c = await pacienteDoChat(app.db, T);
    const outra = await app.pool.connect();
    let fechada = false;
    try {
      await outra.query('begin');
      await outra.query(`select set_config('app.tenant_id', $1, true), set_config('app.role', 'nutri', true), set_config('app.user_id', $2, true)`, [T.tenantId, T.nutriId]);
      await outra.query('select 1 from patients where id = $1 for share', [c.p]);
      const pid = (await outra.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid;
      const envio = enviarComoPaciente(c.P, { texto: 'Oi' }, app.db).then(
        (x) => x,
        (e: unknown) => e,
      );
      await esperarBloqueio(owner.pool, pid);
      expect(await mensagensDe(T, c.p)).toEqual([]);
      await outra.query('commit');
      fechada = true;
      expect(await envio).toMatchObject({ textoFixo: null });
    } finally {
      if (!fechada) await outra.query('rollback').catch(() => undefined);
      outra.release();
    }
    expect(await mensagensDe(T, c.p)).toHaveLength(1);
  });
  it('em paralelo, sem trava manual: envios dos dois lados e renders do paciente sem 40P01', async () => {
    const T = await consultorio();
    const c = await pacienteDoChat(app.db, T);
    const r = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) =>
        i % 3 === 0 ? enviarComoNutri(T.ctx, c.p, { texto: `n${i}` }, app.db) : i % 3 === 1 ? enviarComoPaciente(c.P, { texto: `p${i}` }, app.db) : minhaConversa(c.P, {}, app.db),
      ),
    );
    expect(r.filter((x) => x.status === 'rejected')).toEqual([]);
    expect(await mensagensDe(T, c.p)).toHaveLength(8);
  });
});
