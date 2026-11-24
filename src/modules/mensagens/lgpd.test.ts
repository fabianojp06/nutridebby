import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import { makeDb } from '../../../test/db';
import { anexoDoDono, bloqueadoVencido, consultorioDoChat, esperarBloqueio, naSessao, pacienteDoChat, recadoPara, type PacienteDoChat } from '../../../test/mensagens';
import { type TenantDeTeste } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { withTenant, type TenantContext } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { anonimizarVencidos } from '@/modules/pacientes/lgpd';
import { listarTenantsParaVarredura } from '@/modules/plataforma/tenant-status';
import { pausarConversa } from './conversa';
import { enviarComoNutri, enviarComoPaciente } from './envio';
import { anexosDeChatRestantes, apagarConversaDoTitular, mensagensParaExportacao } from './lgpd';

vi.mock('@/modules/plataforma/tenant-status', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/modules/plataforma/tenant-status')>();
  return { ...real, listarTenantsParaVarredura: vi.fn(real.listarTenantsParaVarredura) };
});
// o teste "anexo de chat no meio" põe um anexo novo logo depois do passo do chat da anonimização
vi.mock('./lgpd', async (importOriginal) => {
  const real = await importOriginal<typeof import('./lgpd')>();
  return { ...real, apagarConversaDoTitular: vi.fn(real.apagarConversaDoTitular) };
});

/**
 * Plano 25, T5 (RN-445, RN-465, RN-466, RN-467; CH-D2, CH-D25, CH-D41, CH-D59, CH-D74): a conversa do titular na exportação
 * e na anonimização, a rede de limpeza dos já anonimizados (volta atrás, §9.9) e a reconferência da transação final.
 */
const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-chat-lgpd-'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  await owner.pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});

const CRN = 'CRN-4 54321';
/** Consultório com o carimbo CRN-4 (o `crn` já vem com o prefixo). */
async function consultorio(): Promise<TenantDeTeste> {
  const T = await consultorioDoChat(app.db, owner.pool);
  await owner.pool.query('update tenants set crn = $1 where id = $2', [CRN, T.tenantId]);
  return T;
}
const worker = (T: TenantDeTeste): TenantContext => ({ tenantId: T.tenantId, role: 'worker' });
const anonimizarSo = (...ts: TenantDeTeste[]) => {
  vi.mocked(listarTenantsParaVarredura).mockResolvedValueOnce(ts.map((t) => ({ id: t.tenantId, fuso: t.tenant.fuso })));
  return anonimizarVencidos(app.db, new Date(), { dataDir });
};
/** O que sobrou do chat do titular (pelo dono, sem RLS). */
async function sobras(T: TenantDeTeste, c: PacienteDoChat) {
  const n = async (q: string) => Number((await owner.pool.query<{ n: string }>(q, [T.tenantId, c.p])).rows[0].n);
  return {
    conversas: await n('select count(*) as n from chat_conversas where tenant_id = $1 and patient_id = $2'),
    mensagens: await n('select count(*) as n from chat_mensagens where tenant_id = $1 and patient_id = $2'),
    leituras: await n('select count(*) as n from chat_leituras where tenant_id = $1 and patient_id = $2'),
    arquivos: await n("select count(*) as n from stored_files where tenant_id = $1 and patient_id = $2 and tipo in ('chat_anexo', 'chat_anexo_original')"),
  };
}
/** O código e a mensagem do erro do Postgres (o drizzle embrulha em `cause`). */
function doBanco(e: unknown): { code?: string; message: string } {
  let x = e as { code?: string; message?: string; cause?: unknown } | undefined;
  // como em banco.test.ts: o erro saneado guarda a mensagem original do Postgres em `cause`
  for (let i = 0; x && i < 5; i++, x = x.cause as typeof x) if (x.code) return { code: x.code, message: (x.cause as { message?: string } | undefined)?.message ?? x.message ?? '' };
  return { message: '' };
}
const NADA = { conversas: 0, mensagens: 0, leituras: 0, arquivos: 0 };
const statusDe = async (id: string) => (await owner.pool.query<{ anexo_status: string }>('select anexo_status from chat_mensagens where id = $1', [id])).rows[0]?.anexo_status;
const anonimizadoEm = async (patientId: string) => (await owner.pool.query<{ anonimizado_em: Date | null }>('select anonimizado_em from patients where id = $1', [patientId])).rows[0].anonimizado_em;

/** Conversa com texto dos dois lados, marcador de leitura dos dois lados, cópia de recado e os três anexos da CH-D59. */
async function conversaCompleta(T: TenantDeTeste) {
  const c = await pacienteDoChat(app.db, T);
  await enviarComoNutri(T.ctx, c.p, { texto: 'Bom dia, Ana!' }, app.db);
  await enviarComoPaciente(c.P, { texto: 'Posso trocar a banana?' }, app.db);
  await owner.pool.query(
    `insert into chat_leituras (tenant_id, patient_id, lado, lida_ate) values ($1, $2, 'consultorio', now()), ($1, $2, 'paciente', now())
     on conflict do nothing`,
    [T.tenantId, c.p],
  );
  const recadoId = await recadoPara(app.db, T, [c.p]);
  const anexos = {
    pronto: await anexoDoDono(owner.pool, dataDir, T, c, 'pronto'),
    processando: await anexoDoDono(owner.pool, dataDir, T, c, 'processando'),
    comOriginal: await anexoDoDono(owner.pool, dataDir, T, c, 'pronto_com_original'),
    falhouComOriginal: await anexoDoDono(owner.pool, dataDir, T, c, 'falhou_com_original'),
  };
  const caminhos = Object.values(anexos).flatMap((a) => a.caminhos);
  for (const x of caminhos) expect(existsSync(path.join(dataDir, x))).toBe(true);
  return { c, recadoId, anexos, caminhos };
}

describe('Plano 25 — mensagensParaExportacao (RN-467; CH-D74)', () => {
  it('a conversa (liberação e pausa com nome e CRN, forma do TCLE) e as mensagens: autor, carimbo só da nutricionista, recado, dúvida e risco pelo rótulo', async () => {
    const T = await consultorio();
    const c = await pacienteDoChat(app.db, T);
    await enviarComoNutri(T.ctx, c.p, { texto: 'Bom dia, Ana!' }, app.db);
    await enviarComoPaciente(c.P, { texto: 'meu peito dói' }, app.db);
    await recadoPara(app.db, T, [c.p], 'Feriado na segunda');
    await owner.pool.query(
      `insert into chat_mensagens (tenant_id, patient_id, autor, autor_user_id, autor_nome, autor_crn, texto, duvida_em)
       values ($1, $2, 'nutri', $3, 'Débora Nutricionista', $4, 'Pode trocar por maçã.', '2026-11-20T13:00:00Z')`,
      [T.tenantId, c.p, T.nutriId, CRN],
    );
    await pausarConversa(T.ctx, c.p, app.db);
    const r = await withTenant(worker(T), (tx) => mensagensParaExportacao(tx, c.p), app.db);
    const carimbo = { nome: 'Débora Nutricionista', crn: CRN, profissao: 'Nutricionista' }; // Res. CFN 594/2017, art. 8º, II
    expect(r.conversa).toEqual({ liberadaEm: expect.any(String), formaDoTcle: 'Aceite por escrito (mensagem ou e-mail)', liberadaPor: carimbo, pausadaEm: expect.any(String), pausadaPor: carimbo });
    expect(new Date(r.conversa!.liberadaEm!).toISOString()).toBe(r.conversa!.liberadaEm);
    // a cópia do recado leva o carimbo que o gatilho grava na mensagem (o do consultório na hora do envio)
    expect(r.mensagens).toEqual([
      { criadaEm: expect.any(String), autor: 'nutricionista', autorNome: 'Débora Nutricionista', autorCrn: CRN, texto: 'Bom dia, Ana!', recado: false },
      { criadaEm: expect.any(String), autor: 'paciente', texto: 'meu peito dói', recado: false, risco: 'Sinal de risco detectado automaticamente pelo app (sintoma agudo)' },
      { criadaEm: expect.any(String), autor: 'nutricionista', autorNome: 'Débora Nutricionista', autorCrn: CRN, texto: 'Feriado na segunda', recado: true },
      { criadaEm: expect.any(String), autor: 'nutricionista', autorNome: 'Débora Nutricionista', autorCrn: CRN, texto: 'Pode trocar por maçã.', recado: false, respostaADuvidaDe: '2026-11-20T13:00:00.000Z' },
    ]);
    // nunca "CRN " na frente do valor (o crn já vem com o prefixo)
    expect(JSON.stringify(r)).not.toContain('CRN CRN');
  });

  it('sem conversa → conversa nula e nenhuma mensagem; não lê nem grava audit_log', async () => {
    const T = await consultorio();
    const c = await pacienteDoChat(app.db, T, { liberar: false });
    const antes = await naSessao(app.db, T.ctx, sql`select count(*)::int as n from audit_log`);
    expect(await withTenant(worker(T), (tx) => mensagensParaExportacao(tx, c.p), app.db)).toEqual({ conversa: null, mensagens: [] });
    expect(await naSessao(app.db, T.ctx, sql`select count(*)::int as n from audit_log`)).toEqual(antes);
    expect(readFileSync('src/modules/mensagens/lgpd.ts', 'utf8')).not.toMatch(/audit_log|auditLog|auditRead/);
  });
});

describe('Plano 25 — apagarConversaDoTitular (RN-466; CH-D41, CH-D59)', () => {
  it('titular na anonimização: anexo pronto, em processamento, pronto com o original sobrando e falho com original → nenhuma linha nem arquivo; o recado fica sem a cópia', async () => {
    const T = await consultorio();
    const { c, recadoId, caminhos } = await conversaCompleta(T);
    await bloqueadoVencido(owner.pool, c.p);
    await apagarConversaDoTitular(worker(T), c.p, { db: app.db, dataDir });
    expect(await sobras(T, c)).toEqual(NADA);
    for (const x of caminhos) expect(existsSync(path.join(dataDir, x)), x).toBe(false);
    expect((await owner.pool.query('select destinatarios from recados where id = $1', [recadoId])).rows).toEqual([{ destinatarios: 1 }]);
    // idempotente: sem conversa, nada a fazer
    await apagarConversaDoTitular(worker(T), c.p, { db: app.db, dataDir });
  });

  it('bloqueado ainda no prazo de guarda → recusa, e nada muda (o anexo em processamento continua em processamento); a função do banco também recusa', async () => {
    const T = await consultorio();
    const { c, anexos, caminhos } = await conversaCompleta(T);
    await owner.pool.query("update patients set status = 'bloqueado', bloqueado_em = now(), anonimizar_apos = current_date + 1 where id = $1", [c.p]);
    const antes = await sobras(T, c);
    await expect(apagarConversaDoTitular(worker(T), c.p, { db: app.db, dataDir })).rejects.toThrow();
    expect(await sobras(T, c)).toEqual(antes);
    expect(await statusDe(anexos.processando.id)).toBe('processando');
    for (const x of caminhos) expect(existsSync(path.join(dataDir, x)), x).toBe(true);
    const e = await withTenant(worker(T), (tx) => tx.execute(sql`select app_chat_apagar_do_titular(${c.p})`), app.db).catch((x: unknown) => x);
    expect(doBanco(e)).toEqual({ code: '42501', message: expect.stringContaining('o titular não está na anonimização') });
  });

  it('o caminho do processo web (papel worker, titular ativo) não apaga nada', async () => {
    const T = await consultorio();
    const { c, anexos, caminhos } = await conversaCompleta(T);
    const antes = await sobras(T, c);
    await expect(apagarConversaDoTitular(worker(T), c.p, { db: app.db, dataDir })).rejects.toThrow();
    expect(await sobras(T, c)).toEqual(antes);
    expect(await statusDe(anexos.processando.id)).toBe('processando');
    for (const x of caminhos) expect(existsSync(path.join(dataDir, x)), x).toBe(true);
  });

  it('passo (1) × job concorrente (o job segura o paciente FOR SHARE e conclui a imagem): o passo espera, sem 40P01, e tudo sai', async () => {
    const T = await consultorio();
    const c = await pacienteDoChat(app.db, T);
    const m = await anexoDoDono(owner.pool, dataDir, T, c, 'processando');
    // o JPEG que o job grava (a linha de stored_files nasce no salvarArquivo do job; aqui, antes, pelo dono)
    const convertido = `${T.tenantId}/chat_anexo/convertido-${c.p}.jpg`;
    await owner.pool.query("insert into stored_files (tenant_id, tipo, caminho, bytes, mime, patient_id) values ($1, 'chat_anexo', $2, 64, 'image/jpeg', $3)", [T.tenantId, convertido, c.p]);
    await bloqueadoVencido(owner.pool, c.p);
    const job = await app.pool.connect();
    let fechada = false;
    try {
      await job.query('begin');
      await job.query(`select set_config('app.tenant_id', $1, true), set_config('app.role', 'worker', true)`, [T.tenantId]);
      await job.query('select 1 from patients where id = $1 for share', [c.p]);
      const pid = (await job.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid;
      const apagar = apagarConversaDoTitular(worker(T), c.p, { db: app.db, dataDir }).then(
        () => 'ok',
        (e: unknown) => e,
      );
      await esperarBloqueio(owner.pool, pid);
      await job.query("update chat_mensagens set anexo_status = 'pronto', anexo_path = $2 where id = $1", [m.id, convertido]);
      await job.query('commit');
      fechada = true;
      expect(await apagar).toBe('ok');
    } finally {
      if (!fechada) await job.query('rollback').catch(() => undefined);
      job.release();
    }
    expect(await sobras(T, c)).toEqual(NADA);
  });

  it('revisão da T5, M2: o ponteiro some entre a leitura e a soltura (o job soltou o original) → a soltura desiste sem erro, e tudo sai', async () => {
    const T = await consultorio();
    const c = await pacienteDoChat(app.db, T);
    const m = await anexoDoDono(owner.pool, dataDir, T, c, 'pronto_com_original');
    const [, original] = m.caminhos;
    await bloqueadoVencido(owner.pool, c.p);
    const job = await app.pool.connect();
    let fechada = false;
    try {
      // como o job do anexo ao terminar: solta o original (a mensagem fica travada) e apaga o arquivo, ainda sem commit
      await job.query('begin');
      await job.query(`select set_config('app.tenant_id', $1, true), set_config('app.role', 'worker', true)`, [T.tenantId]);
      await job.query('select app_chat_soltar_anexo($1, $2)', [m.id, original]);
      await job.query('delete from stored_files where caminho = $1', [original]);
      const pid = (await job.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid;
      const apagar = apagarConversaDoTitular(worker(T), c.p, { db: app.db, dataDir }).then(
        () => 'ok',
        (e: unknown) => e,
      );
      await esperarBloqueio(owner.pool, pid);
      await job.query('commit');
      fechada = true;
      expect(await apagar).toBe('ok');
    } finally {
      if (!fechada) await job.query('rollback').catch(() => undefined);
      job.release();
    }
    expect(await sobras(T, c)).toEqual(NADA);
  });

  it('anexosDeChatRestantes: só com anexo apontado ou em processamento', async () => {
    const T = await consultorio();
    const c = await pacienteDoChat(app.db, T);
    await enviarComoNutri(T.ctx, c.p, { texto: 'Oi' }, app.db);
    const restam = () => withTenant(worker(T), (tx) => anexosDeChatRestantes(tx, c.p), app.db);
    expect(await restam()).toBe(false);
    await anexoDoDono(owner.pool, dataDir, T, c, 'pronto');
    expect(await restam()).toBe(true);
  });
});

describe('Plano 25 — na anonimização (anonimizarVencidos, RN-466; volta atrás, §9.9)', () => {
  it('o titular vencido com conversa e anexos é anonimizado, sem deixar linha nem arquivo do chat', async () => {
    const T = await consultorio();
    const { c, caminhos } = await conversaCompleta(T);
    await bloqueadoVencido(owner.pool, c.p);
    expect((await anonimizarSo(T)).anonimizados).toBe(1);
    expect(await anonimizadoEm(c.p)).not.toBeNull();
    expect(await sobras(T, c)).toEqual(NADA);
    for (const x of caminhos) expect(existsSync(path.join(dataDir, x)), x).toBe(false);
  });

  it('volta atrás: titular marcado anonimizado pela imagem antiga (conversa e anexo de pé) → a próxima varredura limpa pela rede', async () => {
    const T = await consultorio();
    const { c, caminhos } = await conversaCompleta(T);
    // a imagem anterior ao Plano 25 anonimizou sem conhecer o chat
    await owner.pool.query(
      "update patients set status = 'bloqueado', bloqueado_em = now(), anonimizar_apos = current_date - 2, anonimizado_em = now(), nome = 'Paciente anonimizado', user_id = null where id = $1",
      [c.p],
    );
    await anonimizarSo(T);
    expect(await sobras(T, c)).toEqual(NADA);
    for (const x of caminhos) expect(existsSync(path.join(dataDir, x)), x).toBe(false);
  });

  it('anexo de chat que surge depois do passo do chat desfaz a transação final; o dia seguinte termina', async () => {
    const T = await consultorio();
    const { c } = await conversaCompleta(T);
    await bloqueadoVencido(owner.pool, c.p);
    const real = (await vi.importActual<typeof import('./lgpd')>('./lgpd')).apagarConversaDoTitular;
    let novo: { caminhos: string[] } | undefined;
    vi.mocked(apagarConversaDoTitular).mockImplementationOnce(async (ctx, patientId, deps) => {
      await real(ctx, patientId, deps);
      // entre o passo do chat e a transação final (só o dono consegue: o titular está bloqueado)
      await owner.pool.query("insert into chat_conversas (tenant_id, patient_id) values ($1, $2) on conflict do nothing", [T.tenantId, c.p]);
      novo = await anexoDoDono(owner.pool, dataDir, T, c, 'pronto');
    });
    expect((await anonimizarSo(T)).anonimizados).toBe(0);
    expect(await anonimizadoEm(c.p)).toBeNull();
    expect(await sobras(T, c)).toMatchObject({ mensagens: 1, arquivos: 1 });
    expect((await anonimizarSo(T)).anonimizados).toBe(1);
    expect(await sobras(T, c)).toEqual(NADA);
    for (const x of novo!.caminhos) expect(existsSync(path.join(dataDir, x)), x).toBe(false);
  });
});
