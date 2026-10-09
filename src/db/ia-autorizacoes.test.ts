import { randomUUID } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../test/db';
import { autorizacaoNoBanco, tarefaNoBanco, termoNoDisco } from '../../test/ia';
import { ctxPaciente, novoPaciente, novoTenant } from '../../test/pacientes';
import { withTenant, type TenantContext } from './tenant';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
const causa = (e: unknown) => ((e as { cause?: unknown }).cause ?? e) as { code?: string; message?: string; constraint?: string };
const negadoPor = (trecho: string) => (e: unknown) => causa(e).code === '42501' && String(causa(e).message).includes(trecho);
const violaRls = (e: unknown) => causa(e).code === '42501' && /row-level security/.test(String(causa(e).message));
const semPermissao = (e: unknown) => causa(e).code === '42501' && /permission denied/.test(String(causa(e).message));
const violaCheck = (nome?: string) => (e: unknown) => causa(e).code === '23514' && (!nome || causa(e).constraint === nome);
const worker = (tenantId: string): TenantContext => ({ tenantId, role: 'worker' });
const semConta = (tenantId: string, patientId: string): TenantContext => ({ tenantId, role: 'paciente', patientId, semConta: true });

async function cenario(o: { bloqueado?: boolean } = {}) {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx, o.bloqueado ? { status: 'bloqueado' } : {});
  const q = (s: SQL, ctx: TenantContext = T.ctx) => withTenant(ctx, (tx) => tx.execute(s), app.db);
  return { T, p, q };
}
const USOS = sql`array['leitura_laudos']::text[]`; // os usos da versão 0.1 (F2); o CHECK já aceita os da 14B

describe('0107/0108: ia_autorizacoes — o gatilho ia_autorizacoes_regras (RN-107)', () => {
  it('registrado_em é do gatilho; fora do papel, em = registrado_em (o em mandado no INSERT é trocado)', async () => {
    const { T, p, q } = await cenario();
    const [r] = (await q(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, canal, registrado_por, em, registrado_em)
      values (${T.tenantId}, ${p.id}, 'retirou', 'nutricionista', ${T.nutriId}, '2020-01-01', '2020-01-01') returning em, registrado_em`)).rows as { em: string; registrado_em: string }[];
    expect(new Date(r.em).getTime()).toBe(new Date(r.registrado_em).getTime());
    expect(new Date(r.registrado_em).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('papel: exige o arquivo; o em é a data informada (até o registro)', async () => {
    const { T, p, q } = await cenario();
    const papel = (arquivo: string | null, em: string) =>
      q(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, versao, usos, destino, canal, registrado_por, arquivo_path, em)
        values (${T.tenantId}, ${p.id}, 'autorizou', '0.1-provisorio', ${USOS}, 'teste', 'papel', ${T.nutriId}, ${arquivo}, ${em}) returning em`);
    await expect(papel(null, '2026-10-01')).rejects.toSatisfy(negadoPor('termo em papel sem o arquivo'));
    const arq = await termoNoDisco(app.db, T.ctx, p.id);
    await expect(papel(arq, '2999-01-01')).rejects.toSatisfy(violaCheck('ia_autorizacoes_em'));
    const [r] = (await papel(arq, '2026-10-01T03:00:00Z')).rows as { em: string }[];
    expect(new Date(r.em).toISOString()).toBe('2026-10-01T03:00:00.000Z');
  });

  it('coerência canal × papel da sessão: a equipe não grava app/link nem em nome de outra pessoa; o worker não grava', async () => {
    const { T, p, q } = await cenario();
    await expect(q(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, versao, usos, destino, canal, registrado_por)
      values (${T.tenantId}, ${p.id}, 'autorizou', '0.1-provisorio', ${USOS}, 'teste', 'app', ${T.nutriId})`)).rejects.toSatisfy(negadoPor('a equipe não registra autorização pelo app nem pelo link'));
    await expect(q(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, canal, registrado_por)
      values (${T.tenantId}, ${p.id}, 'retirou', 'nutricionista', ${randomUUID()})`)).rejects.toSatisfy(negadoPor('quem registrou é a usuária da sessão'));
    await expect(q(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, canal, registrado_por)
      values (${T.tenantId}, ${p.id}, 'retirou', 'nutricionista', ${T.nutriId})`, worker(T.tenantId))).rejects.toSatisfy(negadoPor('o worker não registra autorização de IA'));
    await expect(q(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, versao, canal, registrado_por)
      values (${T.tenantId}, ${p.id}, 'pedido_email', '0.1-provisorio', 'link', ${T.nutriId})`)).rejects.toSatisfy(negadoPor('evento pelo link sem o e-mail'));
    await q(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, versao, canal, registrado_por, email_hmac)
      values (${T.tenantId}, ${p.id}, 'pedido_email', '0.1-provisorio', 'link', ${T.nutriId}, 'h')`);
  });

  it('CHECKs de coerência: usos, destino, versão, canal do evento, IP só no digital, HMAC só no link, arquivo só no papel', async () => {
    const { T, p, q } = await cenario();
    const retirada = (extra: SQL) => q(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, canal, registrado_por, versao, ip) values (${T.tenantId}, ${p.id}, 'retirou', 'nutricionista', ${T.nutriId}, ${extra})`);
    await expect(retirada(sql`'0.1-provisorio', null`)).rejects.toSatisfy(violaCheck('ia_autorizacoes_versao'));
    await expect(retirada(sql`null, '203.0.113.9'`)).rejects.toSatisfy(violaCheck('ia_autorizacoes_ip_so_digital'));
    const arq = await termoNoDisco(app.db, T.ctx, p.id);
    const papel = (usos: SQL, destino: string, arquivo = arq) =>
      q(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, versao, usos, destino, canal, registrado_por, arquivo_path, em)
        values (${T.tenantId}, ${p.id}, 'autorizou', '0.1-provisorio', ${usos}, ${destino}, 'papel', ${T.nutriId}, ${arquivo}, now())`);
    await expect(papel(sql`array['diagnostico']::text[]`, 'teste')).rejects.toSatisfy(violaCheck('ia_autorizacoes_usos'));
    await expect(papel(sql`array[]::text[]`, 'teste')).rejects.toSatisfy(violaCheck('ia_autorizacoes_usos'));
    await expect(papel(USOS, 'gcp-eu')).rejects.toSatisfy(violaCheck('ia_autorizacoes_destino'));
    const exame = `${T.tenantId}/exame/${randomUUID()}.pdf`;
    await q(sql`insert into stored_files (tenant_id, tipo, caminho, bytes, mime, patient_id) values (${T.tenantId}, 'exame', ${exame}, 10, 'application/pdf', ${p.id})`);
    await expect(papel(USOS, 'teste', exame)).rejects.toSatisfy(violaCheck('ia_autorizacoes_arquivo_so_papel'));
    // autorizou pelo canal da retirada da nutricionista; retirou em papel; pedido fora do link
    await expect(q(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, versao, usos, destino, canal, registrado_por)
      values (${T.tenantId}, ${p.id}, 'autorizou', '0.1-provisorio', ${USOS}, 'teste', 'nutricionista', ${T.nutriId})`)).rejects.toSatisfy(violaCheck());
    await expect(q(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, versao, canal, registrado_por, email_hmac)
      values (${T.tenantId}, ${p.id}, 'pedido_email', '0.1-provisorio', 'nutricionista', ${T.nutriId}, 'h')`)).rejects.toSatisfy(violaCheck());
    await papel(USOS, 'teste');
  });
});

describe('0108: a sessão de paciente (RNF-111 d, j)', () => {
  it('sem conta (link): autoriza e retira a própria; nunca pedido_email, nunca para outro paciente', async () => {
    const { T, p } = await cenario();
    await autorizacaoNoBanco(app.db, T.tenantId, p.id);
    await autorizacaoNoBanco(app.db, T.tenantId, p.id, { evento: 'retirou' });
    const outro = await novoPaciente(app.db, T.ctx);
    const comoP = (s: SQL) => withTenant(semConta(T.tenantId, p.id), (tx) => tx.execute(s), app.db);
    // com registrado_por preenchido o gatilho deixa passar: quem recusa é a política (evento fora de autorizou/retirou)
    await expect(comoP(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, versao, canal, email_hmac, registrado_por) values (${T.tenantId}, ${p.id}, 'pedido_email', '0.1-provisorio', 'link', 'h', ${randomUUID()})`)).rejects.toSatisfy(violaRls);
    await expect(comoP(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, canal, email_hmac) values (${T.tenantId}, ${outro.id}, 'retirou', 'link', 'h')`)).rejects.toSatisfy(violaRls);
    // sem conta, o canal app não fecha (registrado_por ≠ app_current_user(), que é nulo)
    await expect(comoP(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, canal, registrado_por) values (${T.tenantId}, ${p.id}, 'retirou', 'app', ${randomUUID()})`)).rejects.toSatisfy(violaRls);
  });

  it('com conta (app): só com a própria conta em registrado_por; o canal link logado e os canais da equipe são recusados', async () => {
    const { T, p } = await cenario();
    const conta = randomUUID();
    const comoP = (s: SQL) => withTenant(ctxPaciente(T.tenantId, p.id, conta), (tx) => tx.execute(s), app.db);
    await comoP(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, versao, usos, destino, canal, registrado_por, ip)
      values (${T.tenantId}, ${p.id}, 'autorizou', '0.1-provisorio', ${USOS}, 'teste', 'app', ${conta}, '203.0.113.7')`);
    await expect(comoP(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, canal, registrado_por) values (${T.tenantId}, ${p.id}, 'retirou', 'app', ${randomUUID()})`)).rejects.toSatisfy(violaRls);
    await expect(comoP(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, canal, email_hmac) values (${T.tenantId}, ${p.id}, 'retirou', 'link', 'h')`)).rejects.toSatisfy(violaRls);
    await expect(comoP(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, canal, registrado_por) values (${T.tenantId}, ${p.id}, 'retirou', 'nutricionista', ${conta})`)).rejects.toSatisfy(violaRls);
    const arq = await termoNoDisco(app.db, T.ctx, p.id);
    await expect(comoP(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, versao, usos, destino, canal, registrado_por, arquivo_path, em)
      values (${T.tenantId}, ${p.id}, 'autorizou', '0.1-provisorio', ${USOS}, 'teste', 'papel', ${conta}, ${arq}, now())`)).rejects.toSatisfy(violaRls);
    // o paciente lê as próprias linhas (não é staff_only)
    expect((await comoP(sql`select evento from ia_autorizacoes`)).rows).toEqual([{ evento: 'autorizou' }]);
  });

  it('o paciente não grava o termo (stored_files ia_autorizacao_termo continua fora da política da 0102)', async () => {
    const { T, p } = await cenario();
    await expect(
      withTenant(ctxPaciente(T.tenantId, p.id), (tx) => tx.execute(sql`insert into stored_files (tenant_id, tipo, caminho, bytes, mime, patient_id)
        values (${T.tenantId}, 'ia_autorizacao_termo', ${`${T.tenantId}/ia_autorizacao_termo/${randomUUID()}.pdf`}, 10, 'application/pdf', ${p.id})`), app.db),
    ).rejects.toSatisfy(violaRls);
  });
});

describe('0108: só inclusão (RNF-110) e as duas funções SECURITY DEFINER', () => {
  it('UPDATE, DELETE e TRUNCATE recusados por permissão, para a equipe e para o paciente', async () => {
    const { T, p, q } = await cenario();
    await autorizacaoNoBanco(app.db, T.tenantId, p.id);
    await expect(q(sql`update ia_autorizacoes set versao = '9.9' where patient_id = ${p.id}`)).rejects.toSatisfy(semPermissao);
    await expect(q(sql`delete from ia_autorizacoes where patient_id = ${p.id}`)).rejects.toSatisfy(semPermissao);
    await expect(q(sql`truncate ia_autorizacoes`)).rejects.toSatisfy(semPermissao);
    await expect(q(sql`delete from ia_autorizacoes`, worker(T.tenantId))).rejects.toSatisfy(semPermissao);
    await expect(withTenant(semConta(T.tenantId, p.id), (tx) => tx.execute(sql`delete from ia_autorizacoes`), app.db)).rejects.toSatisfy(semPermissao);
  });

  it('app_ia_autorizacao_soltar_termo: só no worker e com o titular bloqueado ou anonimizado', async () => {
    const { T, p, q } = await cenario();
    const b = await novoPaciente(app.db, T.ctx, { status: 'bloqueado' });
    const termoDe = async (patientId: string) => {
      const arq = await termoNoDisco(app.db, T.ctx, patientId);
      const [{ id }] = (await q(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, versao, usos, destino, canal, registrado_por, arquivo_path, em)
        values (${T.tenantId}, ${patientId}, 'autorizou', '0.1-provisorio', ${USOS}, 'teste', 'papel', ${T.nutriId}, ${arq}, now()) returning id`)).rows as { id: string }[];
      return id;
    };
    const doAtivo = await termoDe(p.id);
    const doBloqueado = await termoDe(b.id);
    const soltar = (id: string, ctx: TenantContext) => q(sql`select app_ia_autorizacao_soltar_termo(${id}) as ok`, ctx);
    await expect(soltar(doBloqueado, T.ctx)).rejects.toSatisfy(negadoPor('só roda no contexto worker'));
    expect((await soltar(doAtivo, worker(T.tenantId))).rows).toEqual([{ ok: false }]); // paciente ativo: nada muda (o pedido de exclusão é que bloqueia)
    expect((await soltar(doBloqueado, worker(T.tenantId))).rows).toEqual([{ ok: true }]);
    expect((await q(sql`select id, arquivo_path is null as solto from ia_autorizacoes where id in (${doAtivo}, ${doBloqueado}) order by solto`)).rows).toEqual([
      { id: doAtivo, solto: false },
      { id: doBloqueado, solto: true },
    ]);
  });

  it('app_anonimizar_autorizacoes_ia: só no worker, paciente bloqueado à espera; tira IP, user-agent, HMAC e a conta só do canal app', async () => {
    const { T, p, q } = await cenario();
    const b = await novoPaciente(app.db, T.ctx, { status: 'bloqueado' });
    const conta = randomUUID();
    await withTenant(ctxPaciente(T.tenantId, b.id, conta), (tx) => tx.execute(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, versao, usos, destino, canal, registrado_por, ip, user_agent)
      values (${T.tenantId}, ${b.id}, 'autorizou', '0.1-provisorio', ${USOS}, 'teste', 'app', ${conta}, '203.0.113.7', 'Mozilla/5.0')`), app.db);
    await autorizacaoNoBanco(app.db, T.tenantId, b.id, { evento: 'retirou', emailHmac: 'h-link' });
    await q(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, canal, registrado_por) values (${T.tenantId}, ${b.id}, 'retirou', 'nutricionista', ${T.nutriId})`);
    const anonimizar = (patientId: string, ctx: TenantContext) => q(sql`select app_anonimizar_autorizacoes_ia(${patientId})`, ctx);
    await expect(anonimizar(b.id, T.ctx)).rejects.toSatisfy(negadoPor('só roda no contexto worker'));
    await expect(anonimizar(p.id, worker(T.tenantId))).rejects.toSatisfy(negadoPor('não está bloqueado'));
    await anonimizar(b.id, worker(T.tenantId));
    const linhas = (await q(sql`select canal, registrado_por, ip, user_agent, email_hmac from ia_autorizacoes where patient_id = ${b.id} order by canal`)).rows;
    expect(linhas).toEqual([
      { canal: 'app', registrado_por: null, ip: null, user_agent: null, email_hmac: null },
      { canal: 'link', registrado_por: null, ip: null, user_agent: null, email_hmac: null },
      { canal: 'nutricionista', registrado_por: T.nutriId, ip: null, user_agent: null, email_hmac: null },
    ]);
  });
});

describe('0107/0108: ia_tarefas.destino (RN-109)', () => {
  it('só com saiu_em, só da lista; depois de gravado, não muda', async () => {
    const { T, p, q } = await cenario();
    await expect(tarefaNoBanco(app.db, T.ctx, p.id, null, { status: 'falhou', erro: 'interrompida', destino: 'teste' })).rejects.toSatisfy(violaCheck('ia_tarefas_destino_valido'));
    await expect(tarefaNoBanco(app.db, T.ctx, p.id, null, { status: 'falhou', erro: 'interrompida', saiuEm: new Date(), destino: 'gcp-eu' })).rejects.toSatisfy(violaCheck('ia_tarefas_destino_valido'));
    const id = await tarefaNoBanco(app.db, T.ctx, p.id, null, { status: 'falhou', erro: 'interrompida', saiuEm: new Date(), destino: 'teste' });
    await expect(q(sql`update ia_tarefas set destino = 'bedrock-eu' where id = ${id}`)).rejects.toSatisfy(negadoPor('o destino da saída ao provedor não muda'));
    await expect(q(sql`update ia_tarefas set destino = null where id = ${id}`)).rejects.toSatisfy(negadoPor('o destino da saída ao provedor não muda'));
  });
});
