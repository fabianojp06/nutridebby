import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { autorizacaoNoBanco, IA_TESTE, iaPronta, PDF_MINIMO } from '../../../test/ia';
import { ctxPaciente, emailsNaFila, novoPaciente, novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { auditLog, iaAutorizacoes, patients, storedFiles, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getBoss, stopBoss } from '@/jobs/boss';
import { inicioDoDia } from '@/modules/agenda/fuso';
import { PacienteBloqueadoError } from '@/modules/pacientes/base';
import { hojeNoFuso } from '@/modules/pacientes/datas';
import { MSG_COTA_ESGOTADA } from '@/modules/plataforma/armazenamento';
import {
  AutorizacaoError, autorizacaoDoPaciente, autorizarNoApp, blocoIaDoApp, caminhoDoTermo, enviarPedidoPorEmail, painelDaAutorizacao, registrarRetiradaPelaNutri, registrarTermoEmPapel,
  retirarNoApp, secaoIaVisivel,
} from './autorizacao';
import { lerLinkAutorizacao } from './autorizacao-token';
import { MSG_AUTORIZACAO, MSG_FALHA, MSG_IA } from './constantes';

const app = makeDb(inject('appDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-ia-esc-'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});
const PERFIL = { nomeProfissional: 'Debora Silva', crn: 'CRN-3 12345', contatoEmail: 'contato@debby.test' };
async function cenario(o: { perfil?: boolean; ia?: boolean } = {}) {
  const T = await novoTenant(app.db);
  if (o.ia !== false) await iaPronta(app.db, T.tenantId);
  if (o.perfil !== false) await app.db.update(tenants).set(PERFIL).where(eq(tenants.id, T.tenantId));
  const p = await novoPaciente(app.db, T.ctx);
  const conta = randomUUID();
  const P = ctxPaciente(T.tenantId, p.id, conta);
  const deps = (extra: Partial<Parameters<typeof autorizarNoApp>[1]> = {}) => ({ ia: IA_TESTE, appUrl: 'https://app.test', db: app.db, dataDir, ...extra });
  const eventos = () => withTenant(T.ctx, (tx) => tx.select().from(iaAutorizacoes).where(eq(iaAutorizacoes.patientId, p.id)), app.db);
  return { T, p, P, conta, deps, eventos };
}
/** R2: conta só arquivos (o salvarArquivo cria os diretórios do tenant antes da transação e não os tira na falha). */
const arquivosEm = (dir: string) => readdirSync(dir, { recursive: true, withFileTypes: true }).filter((d) => d.isFile()).length;
const erros = (pr: Promise<unknown>) => pr.then(() => null, (e: unknown) => (e instanceof AutorizacaoError ? e.erros : e));

describe('US-106 — autorizar no app', () => {
  it('grava canal app, a conta, o IP e o user-agent (até 300), versão, os usos da versão (só a leitura de laudos, F2) e o destino; manda a confirmação com o link de retirada', async () => {
    const { p, P, conta, deps, eventos } = await cenario();
    expect(await autorizarNoApp(P, deps({ ip: '203.0.113.9', userAgent: 'U'.repeat(400) }))).toBe('registrada');
    const [e] = await eventos();
    expect(e).toMatchObject({ evento: 'autorizou', canal: 'app', registradoPor: conta, ip: '203.0.113.9', versao: '0.1-provisorio', destino: 'teste', usos: ['leitura_laudos'] });
    expect(e.userAgent).toHaveLength(300);
    expect(e.em.getTime()).toBe(e.registradoEm.getTime());
    const [m] = await emailsNaFila('autorizacao_ia_confirmada', p.email!);
    expect(m).toMatchObject({ consultorio: expect.any(String), destino: 'Provedor de teste', versao: '0.1-provisorio' });
    const token = m.link.split('/autorizacao-ia/')[1];
    expect(lerLinkAutorizacao(token)).toMatchObject({ tipo: 'retirada', autorizacaoId: e.id });
    expect(await autorizarNoApp(P, deps())).toBe('ja_vigente'); // clique duplo: nada novo
    expect(await eventos()).toHaveLength(1);
  });

  it('D10: com a IA não ativa no consultório → indisponível; perfil profissional incompleto → o texto do desvio 7', async () => {
    const semIa = await cenario({ ia: false });
    expect(await erros(autorizarNoApp(semIa.P, semIa.deps()))).toEqual({ geral: MSG_IA.indisponivel });
    const semPerfil = await cenario({ perfil: false });
    expect(await erros(autorizarNoApp(semPerfil.P, semPerfil.deps()))).toEqual({ geral: MSG_AUTORIZACAO.perfilIncompleto });
    expect(await semPerfil.eventos()).toHaveLength(0);
  });
});

describe('US-109 — retirar no app', () => {
  it('grava a retirada (canal app) e enfileira o job ia-retirada na mesma transação; sem nada a retirar, nada', async () => {
    const { T, p, P, conta, deps, eventos } = await cenario();
    expect(await retirarNoApp(P, deps())).toBe('nada_a_retirar');
    await autorizarNoApp(P, deps());
    expect(await retirarNoApp(P, deps({ ip: '203.0.113.9' }))).toBe('retirada');
    const ret = (await eventos()).find((e) => e.evento === 'retirou')!;
    expect(ret).toMatchObject({ canal: 'app', registradoPor: conta, ip: '203.0.113.9' });
    const jobs = await (await getBoss()).findJobs<{ tenantId: string; patientId: string; retiradaId: string }>('ia-retirada');
    expect(jobs.find((j) => j.data.retiradaId === ret.id)?.data).toEqual({ tenantId: T.tenantId, patientId: p.id, retiradaId: ret.id });
    expect(await retirarNoApp(P, deps())).toBe('nada_a_retirar');
  });

  it('a retirada funciona com a IA desativada no consultório (US-106 "Retirar sempre possível")', async () => {
    const { T, P, deps } = await cenario();
    await autorizarNoApp(P, deps());
    await app.db.update(tenants).set({ iaAtivadaEm: null }).where(eq(tenants.id, T.tenantId));
    expect(await retirarNoApp(P, deps())).toBe('retirada');
  });
});

describe('US-105 — pedido por e-mail', () => {
  it('grava pedido_email (canal link, quem pediu, HMAC do e-mail) e enfileira o e-mail com o link de 7 dias; o segundo é recusado enquanto o link vale', async () => {
    const { T, p, deps, eventos } = await cenario();
    const agora = new Date();
    const { validoAte } = await enviarPedidoPorEmail(T.ctx, p.id, deps({ agora }));
    expect(validoAte.getTime() - agora.getTime()).toBe(7 * 86_400_000);
    const [e] = await eventos();
    expect(e).toMatchObject({ evento: 'pedido_email', canal: 'link', registradoPor: T.nutriId, versao: '0.1-provisorio', ip: null });
    expect(e.emailHmac).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [m] = await emailsNaFila('autorizacao_ia', p.email!);
    expect(lerLinkAutorizacao(m.link.split('/autorizacao-ia/')[1])).toMatchObject({ tipo: 'pedido', tenantId: T.tenantId, patientId: p.id });
    const r = await erros(enviarPedidoPorEmail(T.ctx, p.id, deps()));
    expect(r).toEqual({ geral: expect.stringMatching(/^Já há um pedido por e-mail válido até \d{2}\/\d{2}\/\d{4}\. Aguarde a resposta do paciente ou registre o termo em papel\.$/) });
  });

  it('D13: com o e-mail corrigido, o pedido antigo (link morto) não bloqueia o novo', async () => {
    const { T, p, deps, eventos } = await cenario();
    await enviarPedidoPorEmail(T.ctx, p.id, deps());
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ email: `novo-${p.id.slice(0, 8)}@ex.com` }).where(eq(patients.id, p.id)), app.db);
    await enviarPedidoPorEmail(T.ctx, p.id, deps());
    expect((await eventos()).filter((e) => e.evento === 'pedido_email')).toHaveLength(2);
  });

  it('sem e-mail → "Cadastre o e-mail…"; arquivado → indisponível; bloqueado → PacienteBloqueadoError; nada gravado', async () => {
    const { T, deps } = await cenario();
    const semEmail = await novoPaciente(app.db, T.ctx, { email: '' }); // patients.email é NOT NULL: "sem e-mail" é o texto vazio
    expect(await erros(enviarPedidoPorEmail(T.ctx, semEmail.id, deps()))).toEqual({ geral: MSG_AUTORIZACAO.semEmail });
    const arquivado = await novoPaciente(app.db, T.ctx, { status: 'arquivado' });
    expect(await erros(enviarPedidoPorEmail(T.ctx, arquivado.id, deps()))).toEqual({ geral: MSG_FALHA.paciente_indisponivel });
    const bloqueado = await novoPaciente(app.db, T.ctx, { status: 'bloqueado' });
    await expect(enviarPedidoPorEmail(T.ctx, bloqueado.id, deps())).rejects.toBeInstanceOf(PacienteBloqueadoError);
  });
});

describe('US-108 — termo em papel (RNF-111 f)', () => {
  it('arquivo e linha na mesma transação: canal papel, em = início do dia informado, o arquivo do tipo novo; confirmação ao e-mail do paciente', async () => {
    const { T, p, deps, eventos } = await cenario();
    const hoje = hojeNoFuso('America/Sao_Paulo');
    const id = await registrarTermoEmPapel(T.ctx, p.id, { data: hoje, confirmacao: true, arquivo: PDF_MINIMO }, deps());
    const [e] = await eventos();
    expect(e).toMatchObject({ id, evento: 'autorizou', canal: 'papel', registradoPor: T.nutriId, ip: null, destino: 'teste', usos: ['leitura_laudos'] }); // F2
    expect(e.em.getTime()).toBe(inicioDoDia(hoje, 'America/Sao_Paulo').getTime());
    const [f] = await withTenant(T.ctx, (tx) => tx.select().from(storedFiles).where(eq(storedFiles.caminho, e.arquivoPath!)), app.db);
    expect(f).toMatchObject({ tipo: 'ia_autorizacao_termo', patientId: p.id });
    expect(await emailsNaFila('autorizacao_ia_confirmada', p.email!)).toHaveLength(1);
  });

  it('faltou arquivo, confirmação ou data válida (futura, antes da versão, inválida); arquivo fora do formato; nada gravado', async () => {
    const { T, p, deps, eventos } = await cenario();
    expect(await erros(registrarTermoEmPapel(T.ctx, p.id, { data: '2999-01-01', confirmacao: false, arquivo: null }, deps()))).toEqual({
      arquivo: MSG_AUTORIZACAO.faltouArquivo, confirmacao: MSG_AUTORIZACAO.faltouConfirmacao, data: MSG_AUTORIZACAO.dataInvalida,
    });
    for (const data of ['2999-01-01', '2026-10-08', '2026-02-30', 'ontem']) {
      expect((await erros(registrarTermoEmPapel(T.ctx, p.id, { data, confirmacao: true, arquivo: PDF_MINIMO }, deps())) as Record<string, string>).data, data).toBe(MSG_AUTORIZACAO.dataInvalida);
    }
    const hoje = hojeNoFuso('America/Sao_Paulo');
    expect(await erros(registrarTermoEmPapel(T.ctx, p.id, { data: hoje, confirmacao: true, arquivo: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') }, deps()))).toEqual({ arquivo: MSG_AUTORIZACAO.arquivoInvalido });
    expect(await erros(registrarTermoEmPapel(T.ctx, p.id, { data: hoje, confirmacao: true, arquivo: Buffer.alloc(20 * 1024 * 1024 + 1) }, deps()))).toEqual({ arquivo: MSG_AUTORIZACAO.arquivoInvalido });
    expect(await eventos()).toHaveLength(0);
  });

  it('a linha falha depois do arquivo → nem a linha nem o arquivo ficam (tudo ou nada); paciente bloqueado no meio → nada', async () => {
    const { T, p, deps, eventos } = await cenario();
    const hoje = hojeNoFuso('America/Sao_Paulo');
    const antes = arquivosEm(dataDir);
    await expect(registrarTermoEmPapel(T.ctx, p.id, { data: hoje, confirmacao: true, arquivo: PDF_MINIMO }, deps({ depoisDaLinha: async () => { throw new Error('falha simulada'); } }))).rejects.toThrow('falha simulada');
    expect(await eventos()).toHaveLength(0);
    expect(await withTenant(T.ctx, (tx) => tx.select().from(storedFiles).where(and(eq(storedFiles.patientId, p.id), eq(storedFiles.tipo, 'ia_autorizacao_termo'))), app.db)).toHaveLength(0);
    expect(arquivosEm(dataDir)).toBe(antes);
    const bloqueado = await novoPaciente(app.db, T.ctx, { status: 'bloqueado' });
    await expect(registrarTermoEmPapel(T.ctx, bloqueado.id, { data: hoje, confirmacao: true, arquivo: PDF_MINIMO }, deps())).rejects.toBeInstanceOf(PacienteBloqueadoError);
  });

  it('retirada no dia da assinatura ou depois (no app ou pela nutricionista) → recusa no campo da data, nada registrado (LGPD art. 8º, § 5º)', async () => {
    const hoje = hojeNoFuso('America/Sao_Paulo');
    const { T, p, P, deps, eventos } = await cenario();
    await autorizarNoApp(P, deps());
    expect(await retirarNoApp(P, deps())).toBe('retirada');
    const antes = arquivosEm(dataDir);
    expect(await erros(registrarTermoEmPapel(T.ctx, p.id, { data: hoje, confirmacao: true, arquivo: PDF_MINIMO }, deps()))).toEqual({ data: MSG_AUTORIZACAO.retiradaDepoisDaData });
    expect((await eventos()).map((e) => e.evento).sort()).toEqual(['autorizou', 'retirou']);
    expect(await withTenant(T.ctx, (tx) => tx.select().from(storedFiles).where(and(eq(storedFiles.patientId, p.id), eq(storedFiles.tipo, 'ia_autorizacao_termo'))), app.db)).toHaveLength(0);
    expect(arquivosEm(dataDir)).toBe(antes);
    expect(await withTenant(T.ctx, (tx) => autorizacaoDoPaciente(tx, p.id, 'teste'), app.db)).toMatchObject({ tipo: 'retirada' });

    const n = await cenario();
    await registrarTermoEmPapel(n.T.ctx, n.p.id, { data: hoje, confirmacao: true, arquivo: PDF_MINIMO }, n.deps());
    expect(await registrarRetiradaPelaNutri(n.T.ctx, n.p.id, { db: app.db })).toBe(true);
    expect(await erros(registrarTermoEmPapel(n.T.ctx, n.p.id, { data: hoje, confirmacao: true, arquivo: PDF_MINIMO }, n.deps()))).toEqual({ data: MSG_AUTORIZACAO.retiradaDepoisDaData });
    expect(await n.eventos()).toHaveLength(2);
  });

  it('armazenamento esgotado → o texto da US-108, nada registrado', async () => {
    const { T, p, deps, eventos } = await cenario();
    await app.db.update(tenants).set({ armazenamentoBytes: 5 * 1024 ** 3 }).where(eq(tenants.id, T.tenantId));
    expect(await erros(registrarTermoEmPapel(T.ctx, p.id, { data: hojeNoFuso('America/Sao_Paulo'), confirmacao: true, arquivo: PDF_MINIMO }, deps()))).toEqual({ geral: MSG_COTA_ESGOTADA });
    expect(await eventos()).toHaveLength(0);
  });

  it('"Ver termo assinado": o caminho com auditRead (entidade ia_autorizacao); de outro paciente → null, sem auditoria', async () => {
    const { T, p, deps } = await cenario();
    const id = await registrarTermoEmPapel(T.ctx, p.id, { data: hojeNoFuso('America/Sao_Paulo'), confirmacao: true, arquivo: PDF_MINIMO }, deps());
    const outro = await novoPaciente(app.db, T.ctx);
    expect(await caminhoDoTermo(T.ctx, outro.id, id, app.db)).toBeNull();
    expect(await caminhoDoTermo(T.ctx, p.id, id, app.db)).toMatch(new RegExp(`^${T.tenantId}/ia_autorizacao_termo/`));
    const lidas = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.entidade, 'ia_autorizacao'), eq(auditLog.acao, 'ler'))), app.db);
    expect(lidas).toEqual([expect.objectContaining({ entidadeId: id, patientId: p.id, actorUserId: T.nutriId })]);
  });
});

describe('US-105 — dados da seção "Uso de IA" e do bloco do app', () => {
  it('eventos do mais recente ao mais antigo, pedido aberto, alerta de e-mail trocado, código de referência', async () => {
    const { T, p, deps } = await cenario();
    await enviarPedidoPorEmail(T.ctx, p.id, deps());
    await autorizacaoNoBanco(app.db, T.tenantId, p.id, { emailHmac: 'hmac-de-outro-email' }); // autorizou pelo link de outro e-mail
    const painel = await painelDaAutorizacao(T.ctx, p, 'teste', { db: app.db });
    expect(painel.eventos.map((e) => e.evento)).toEqual(['autorizou', 'pedido_email']);
    expect(painel.situacao.tipo).toBe('vigente');
    expect(painel.pedidoAbertoAte).toBeInstanceOf(Date);
    expect(painel.alertaEmailTrocado).toBe(true);
    expect(painel.temRegistro).toBe(true);
    expect(painel.codigoDeReferencia).toMatch(/^.{4}-.{4}-.{4}$/);
  });

  it('secaoIaVisivel e blocoIaDoApp seguem a US-105 "Quando a seção aparece" e a US-106 "Consultório sem IA" (desvio 8)', async () => {
    expect(secaoIaVisivel('ausente', { iaLiberada: true, iaAditivoVersao: '0.2-provisorio' }, true)).toBe(false);
    expect(secaoIaVisivel('fake', { iaLiberada: false, iaAditivoVersao: null }, false)).toBe(false);
    expect(secaoIaVisivel('fake', { iaLiberada: false, iaAditivoVersao: null }, true)).toBe(true);
    expect(secaoIaVisivel('emergencia', { iaLiberada: false, iaAditivoVersao: '0.2-provisorio' }, false)).toBe(true);
    const { T, P } = await cenario();
    const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId));
    expect(await blocoIaDoApp(P, tenant, { ...IA_TESTE, modo: 'ausente' }, app.db)).toBeNull();
    expect(await blocoIaDoApp(P, tenant, IA_TESTE, app.db)).toEqual({ situacao: { tipo: 'nunca' }, podeDecidir: true });
    await app.db.update(tenants).set({ iaAtivadaEm: null }).where(eq(tenants.id, T.tenantId));
    const [semIa] = await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId));
    expect(await blocoIaDoApp(P, semIa, IA_TESTE, app.db)).toBeNull();
  });
});
