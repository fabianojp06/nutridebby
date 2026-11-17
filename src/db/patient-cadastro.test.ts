import { afterAll, describe, expect, inject, it } from 'vitest';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { makeDb } from '../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../test/pacientes';
import { auditLog, patientCadastro } from '@/db/schema';
import type { Tx } from '@/db/client';
import { withTenant, type TenantContext } from '@/db/tenant';
import { listAccessHistory, rotuloDaAcao } from '@/modules/plataforma/audit';

/**
 * Plano 18 (spec D1, §9.1): o cadastro complementar do paciente (`patient_cadastro`) — RLS de tenant e de paciente, a
 * política `patient_cadastro_paciente_com_conta` (o contexto de paciente sem login não lê nem a própria linha), auditoria
 * como `patients`, colunas fixas e DELETE só pelo worker com o titular anonimizado.
 */
const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

const codigo = (e: unknown) => ((e as { cause?: { code?: string } }).cause ?? (e as { code?: string })).code;
const falhaCom = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return codigo(e);
  }
  return 'sem erro';
};

/** Leitura de uma linha pela equipe. */
const lerUma = (ctx: TenantContext, id: string) => withTenant(ctx, (tx) => tx.select().from(patientCadastro).where(eq(patientCadastro.id, id)), app.db);

async function cenario() {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx);
  const worker: TenantContext = { tenantId: T.tenantId, role: 'worker' };
  const em = <R>(ctx: TenantContext, fn: (tx: Tx) => Promise<R>) => withTenant(ctx, fn, app.db);
  const exec = (ctx: TenantContext, q: SQL) => em(ctx, (tx) => tx.execute(q));
  const criar = (v: Partial<typeof patientCadastro.$inferInsert> = {}, ctx: TenantContext = T.ctx, patientId = p.id) =>
    em(ctx, (tx) => tx.insert(patientCadastro).values({ tenantId: T.tenantId, patientId, estadoCivil: 'casado', ...v }).returning()).then((r) => r[0]);
  const ler = (ctx: TenantContext) => em(ctx, (tx) => tx.select().from(patientCadastro));
  return { T, p, worker, em, exec, criar, ler };
}

describe('patient_cadastro: quem lê e quem grava (Plano 18, D1)', () => {
  it('público não lê nem grava', async () => {
    const { T, p, exec, criar, ler } = await cenario();
    await criar();
    const publico: TenantContext = { tenantId: T.tenantId, role: 'publico' };
    expect(await ler(publico)).toEqual([]);
    const q = await novoPaciente(app.db, T.ctx);
    expect(await falhaCom(criar({}, publico, q.id))).toBe('42501');
    expect((await exec(publico, sql`update patient_cadastro set observacao = 'x'`)).rowCount).toBe(0);
    expect((await exec(publico, sql`delete from patient_cadastro`)).rowCount).toBe(0);
    expect(await ler(T.ctx)).toEqual([expect.objectContaining({ patientId: p.id, observacao: null })]);
  });

  it('paciente com login lê só a própria linha e não grava', async () => {
    const { T, p, exec, criar, ler } = await cenario();
    const propria = await criar({ observacao: 'Prefere atendimento pela manhã' });
    const outro = await novoPaciente(app.db, T.ctx);
    await criar({ estadoCivil: 'solteiro' }, T.ctx, outro.id);
    const comoPaciente = ctxPaciente(T.tenantId, p.id);

    expect((await ler(comoPaciente)).map((c) => c.id)).toEqual([propria.id]);
    // INSERT recusado (paciente_sem_insert e a falta de PACIENTE_ESCREVE), inclusive da própria linha
    const semCadastro = await novoPaciente(app.db, T.ctx);
    expect(await falhaCom(criar({}, ctxPaciente(T.tenantId, semCadastro.id), semCadastro.id))).toBe('42501');
    // UPDATE e DELETE: paciente_sem_update/paciente_sem_delete escondem a linha — 0 linhas, sem erro
    expect((await exec(comoPaciente, sql`update patient_cadastro set observacao = 'Mudou'`)).rowCount).toBe(0);
    expect((await exec(comoPaciente, sql`delete from patient_cadastro`)).rowCount).toBe(0);
    const [depois] = await lerUma(T.ctx, propria.id);
    expect(depois).toMatchObject({ id: propria.id, observacao: 'Prefere atendimento pela manhã', estadoCivil: 'casado' });
  });

  // Review Focus 1: convite, links, webhook, contexto da IA Nutri e o "No app" recebem 0 linhas
  it('paciente semConta não lê nem a própria linha', async () => {
    const { T, p, exec, criar, ler } = await cenario();
    const propria = await criar({ cpf: '52998224725', nomeSocial: 'Joana Silva' });
    expect((await ler(ctxPaciente(T.tenantId, p.id))).map((c) => c.id)).toEqual([propria.id]);

    const semLogin: TenantContext = { tenantId: T.tenantId, role: 'paciente', patientId: p.id, semConta: true };
    expect(await ler(semLogin)).toEqual([]);
    expect((await exec(semLogin, sql`select count(*)::int as n from patient_cadastro`)).rows).toEqual([{ n: 0 }]);
    expect((await exec(semLogin, sql`update patient_cadastro set nome_social = 'Outra'`)).rowCount).toBe(0);
    const semCadastro = await novoPaciente(app.db, T.ctx);
    expect(await falhaCom(criar({}, { tenantId: T.tenantId, role: 'paciente', patientId: semCadastro.id, semConta: true }, semCadastro.id))).toBe('42501');
  });
});

describe('patient_cadastro: colunas fixas e apagar (gatilhos)', () => {
  it('colunas fixas', async () => {
    const { T, worker, exec, criar } = await cenario();
    const c = await criar();
    const outroDoTenant = await novoPaciente(app.db, T.ctx);
    const U = await novoTenant(app.db);
    expect(await falhaCom(exec(T.ctx, sql`update patient_cadastro set tenant_id = ${U.tenantId} where id = ${c.id}`))).toBe('42501');
    // para outro paciente do MESMO tenant a RLS da equipe deixaria passar: só o gatilho segura
    expect(await falhaCom(exec(T.ctx, sql`update patient_cadastro set patient_id = ${outroDoTenant.id} where id = ${c.id}`))).toBe('42501');
    expect(await falhaCom(exec(worker, sql`update patient_cadastro set patient_id = ${outroDoTenant.id} where id = ${c.id}`))).toBe('42501');
    expect(await falhaCom(exec(T.ctx, sql`update patient_cadastro set id = gen_random_uuid() where id = ${c.id}`))).toBe('42501');
    // o UPDATE sem mudança (o do teste de isolamento) passa, e mudar os campos do cadastro também
    expect((await exec(T.ctx, sql`update patient_cadastro set tenant_id = tenant_id, patient_id = patient_id, id = id where id = ${c.id}`)).rowCount).toBe(1);
    expect((await exec(T.ctx, sql`update patient_cadastro set ocupacao = 'Professora', updated_at = now() where id = ${c.id}`)).rowCount).toBe(1);
    const [depois] = await lerUma(T.ctx, c.id);
    expect(depois).toMatchObject({ id: c.id, tenantId: T.tenantId, patientId: c.patientId, ocupacao: 'Professora' });
  });

  it('apagar', async () => {
    const { T, p, worker, exec, criar } = await cenario();
    const c = await criar();
    const apagar = (ctx: TenantContext) => exec(ctx, sql`delete from patient_cadastro where id = ${c.id}`);
    const paciente = (set: SQL) => exec(worker, sql`update patients set ${set} where id = ${p.id}`);

    expect(await falhaCom(apagar(T.ctx))).toBe('42501');
    expect(await falhaCom(apagar(worker))).toBe('42501'); // titular ativo
    await paciente(sql`status = 'bloqueado', bloqueado_em = now()`);
    expect(await falhaCom(apagar(worker))).toBe('42501'); // bloqueado, ainda sem anonimizado_em
    expect(await falhaCom(apagar(T.ctx))).toBe('42501');
    await paciente(sql`anonimizado_em = now()`);
    expect(await falhaCom(apagar(T.ctx))).toBe('42501'); // a equipe nunca apaga
    expect((await apagar(worker)).rowCount).toBe(1);
    expect(await lerUma(T.ctx, c.id)).toEqual([]);
  });
});

describe('patient_cadastro: auditoria como o cadastro do paciente (regra 8)', () => {
  it('auditoria', async () => {
    const { T, p, em, exec, criar } = await cenario();
    const c = await criar({ cpf: '52998224725', observacao: 'Texto reservado da observação', cep: '13015904' });
    await exec(T.ctx, sql`update patient_cadastro set ocupacao = 'Engenheira', updated_at = now() where id = ${c.id}`);

    const linhas = await em(T.ctx, (tx) =>
      tx.select().from(auditLog).where(and(eq(auditLog.tenantId, T.tenantId), eq(auditLog.entidadeId, c.id))).orderBy(auditLog.criadoEm),
    );
    expect(linhas.map((l) => l.acao)).toEqual(['criar', 'alterar']);
    for (const l of linhas) expect(l).toMatchObject({ entidade: 'patients', entidadeId: c.id, patientId: p.id, actorUserId: T.nutriId, ip: T.ctx.ip });
    expect(c.id).not.toBe(p.id); // entidade_id é o id do cadastro, não o do titular
    const texto = JSON.stringify(linhas);
    for (const segredo of ['52998224725', 'Texto reservado', '13015904', 'Engenheira', 'casado']) expect(texto).not.toContain(segredo);

    // Histórico de acessos: preencher o cadastro complementar é "Alterou"; o "Criou" do paciente continua um só
    const h = await listAccessHistory(T.ctx, p.id, 1, app.db);
    const doCadastro = h.itens.filter((i) => i.entidade === 'patients');
    expect(doCadastro.filter((i) => i.entidadeId === c.id).map(rotuloDaAcao)).toEqual(['Alterou', 'Alterou']);
    expect(doCadastro.filter((i) => rotuloDaAcao(i) === 'Criou').map((i) => i.entidadeId)).toEqual([p.id]);
  });

  it('o "Excluiu" da anonimização (worker, sem ator) continua "Excluiu"', async () => {
    const { T, p, worker, exec, criar } = await cenario();
    const c = await criar();
    await exec(worker, sql`update patients set status = 'bloqueado', bloqueado_em = now(), anonimizado_em = now() where id = ${p.id}`);
    await exec(worker, sql`delete from patient_cadastro where id = ${c.id}`);
    const h = await listAccessHistory(T.ctx, p.id, 1, app.db);
    const excluiu = h.itens.filter((i) => i.entidadeId === c.id && i.acao === 'excluir');
    expect(excluiu.map((i) => [rotuloDaAcao(i), i.ator])).toEqual([['Excluiu', null]]);
  });
});

describe('patient_cadastro: CPF e CHECKs', () => {
  it('CPF único por consultório', async () => {
    const { T, p, criar } = await cenario();
    await criar({ cpf: '52998224725' });
    const outro = await novoPaciente(app.db, T.ctx);
    expect(await falhaCom(criar({ cpf: '52998224725' }, T.ctx, outro.id))).toBe('23505');
    // um cadastro por paciente
    expect(await falhaCom(criar({ cpf: null }, T.ctx, p.id))).toBe('23505');
    // outro consultório: passa
    const U = await novoTenant(app.db);
    const deU = await novoPaciente(app.db, U.ctx);
    await withTenant(U.ctx, (tx) => tx.insert(patientCadastro).values({ tenantId: U.tenantId, patientId: deU.id, cpf: '52998224725' }), app.db);
    // CPF nulo em vários: passa
    await criar({ cpf: null }, T.ctx, outro.id);
    const terceiro = await novoPaciente(app.db, T.ctx);
    await criar({ cpf: null }, T.ctx, terceiro.id);
  });

  it('CHECKs', async () => {
    const { T, exec, criar } = await cenario();
    const c = await criar();
    const set = (col: string, v: string | null) => exec(T.ctx, sql`update patient_cadastro set ${sql.identifier(col)} = ${v} where id = ${c.id}`);
    const x = (n: number) => 'x'.repeat(n);
    // tamanhos (char_length): [coluna, mínimo, máximo]
    const TAMANHOS: [string, number, number][] = [
      ['nome_social', 2, 120],
      ['ocupacao', 2, 80],
      ['nacionalidade', 2, 60],
      ['naturalidade', 2, 80],
      ['logradouro', 2, 120],
      ['numero', 1, 10],
      ['complemento', 1, 60],
      ['bairro', 2, 60],
      ['cidade', 2, 60],
      ['observacao', 1, 1000],
    ];
    for (const [col, min, max] of TAMANHOS) {
      if (min > 1) expect(await falhaCom(set(col, x(min - 1))), col).toBe('23514');
      expect(await falhaCom(set(col, '')), col).toBe('23514');
      expect(await falhaCom(set(col, x(max + 1))), col).toBe('23514');
      expect((await set(col, x(min))).rowCount, col).toBe(1);
      expect((await set(col, x(max))).rowCount, col).toBe(1);
      expect((await set(col, null)).rowCount, col).toBe(1);
    }
    // listas fechadas (US-260)
    const LISTAS: Record<string, string[]> = {
      identidade_genero: ['mulher', 'homem', 'nao_binario', 'outra', 'prefere_nao_informar'],
      estado_civil: ['solteiro', 'casado', 'uniao_estavel', 'separado', 'divorciado', 'viuvo'],
      escolaridade: [
        'sem_escolaridade',
        'fundamental_incompleto',
        'fundamental_completo',
        'medio_incompleto',
        'medio_completo',
        'superior_incompleto',
        'superior_completo',
        'pos_graduacao',
      ],
      uf: 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '),
    };
    for (const [col, valores] of Object.entries(LISTAS)) {
      for (const v of valores) expect((await set(col, v)).rowCount, `${col}=${v}`).toBe(1);
      for (const v of ['outro_valor', '', valores[0].toUpperCase() === valores[0] ? valores[0].toLowerCase() : valores[0].toUpperCase()])
        expect(await falhaCom(set(col, v)), `${col}=${v}`).toBe('23514');
      expect((await set(col, null)).rowCount, col).toBe(1);
    }
    expect(LISTAS.uf).toHaveLength(27);
    // formatos
    for (const v of ['5299822472', '529982247250', '529.982.247-25', '5299822472a']) expect(await falhaCom(set('cpf', v)), v).toBe('23514');
    expect((await set('cpf', '52998224725')).rowCount).toBe(1);
    for (const v of ['1133334444', '+0113333444', '+551', '+55 11 3333-4444', `+${'1'.repeat(16)}`]) expect(await falhaCom(set('telefone_fixo_e164', v)), v).toBe('23514');
    expect((await set('telefone_fixo_e164', '+551133334444')).rowCount).toBe(1);
    for (const v of ['1301590', '130159040', '13015-904']) expect(await falhaCom(set('cep', v)), v).toBe('23514');
    expect((await set('cep', '13015904')).rowCount).toBe(1);
  });
});
