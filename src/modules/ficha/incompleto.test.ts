import { afterAll, describe, expect, inject, it } from 'vitest';
import { count, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import * as schema from '@/db/schema';
import { auditLog, patientCadastro } from '@/db/schema';
import { TenantContextError, withTenant } from '@/db/tenant';
import { cadastroIncompleto, presencaDoCadastro, textoDoIncompleto, type PresencaDoCadastro } from './incompleto';

// Plano 18 (D17, RN-269): a nota "Cadastro incompleto" do cartão Resumo — lista fechada de campos, só a PRESENÇA de cada
// um (`campo is not null`), nunca o valor, e sem auditRead.
const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

const COMPLETO: PresencaDoCadastro = {
  dataNascimento: true, sexo: true, identidadeGenero: true, estadoCivil: true, nacionalidade: true, naturalidade: true,
  escolaridade: true, ocupacao: true, endereco: true, telefone: true,
};
const faltando = (...campos: (keyof PresencaDoCadastro)[]): PresencaDoCadastro => ({
  ...COMPLETO,
  ...Object.fromEntries(campos.map((c) => [c, false])),
});

const ENDERECO = { cep: '01310100', logradouro: 'Avenida Paulista', numero: '1000', bairro: 'Bela Vista', cidade: 'São Paulo', uf: 'SP' };
const RESTO = { identidadeGenero: 'mulher', estadoCivil: 'solteiro', escolaridade: 'superior_completo', ocupacao: 'Professora', nacionalidade: 'Brasileira', naturalidade: 'São Paulo/SP' };

async function cadastro(T: TenantDeTeste, patientId: string, valores: Partial<typeof patientCadastro.$inferInsert>) {
  await withTenant(T.ctx, (tx) => tx.insert(patientCadastro).values({ tenantId: T.tenantId, patientId, ...valores }), app.db);
}
const trilha = async (T: TenantDeTeste) => (await app.db.select({ n: count() }).from(auditLog).where(eq(auditLog.tenantId, T.tenantId)))[0].n;

describe('textoDoIncompleto (RN-269)', () => {
  it('completo: sem nota', () => {
    expect(textoDoIncompleto(COMPLETO)).toBeNull();
  });

  it('um item', () => {
    expect(textoDoIncompleto(faltando('telefone'))).toBe('Cadastro incompleto: faltam telefone.');
  });

  it('dois itens: separados por "e", em minúsculas, na ordem da lista', () => {
    expect(textoDoIncompleto(faltando('endereco', 'estadoCivil'))).toBe('Cadastro incompleto: faltam estado civil e endereço.');
  });

  it('três itens: vírgula e "e"', () => {
    expect(textoDoIncompleto(faltando('dataNascimento', 'identidadeGenero', 'ocupacao'))).toBe(
      'Cadastro incompleto: faltam data de nascimento, identidade de gênero e ocupação.',
    );
  });

  it('quatro ou mais: só a quantidade', () => {
    expect(textoDoIncompleto(faltando('sexo', 'nacionalidade', 'naturalidade', 'escolaridade'))).toBe('Cadastro incompleto: faltam 4 dados.');
    expect(textoDoIncompleto(faltando('identidadeGenero', 'estadoCivil', 'nacionalidade', 'naturalidade', 'escolaridade', 'ocupacao'))).toBe(
      'Cadastro incompleto: faltam 6 dados.',
    );
  });
});

describe('presencaDoCadastro (RN-269)', () => {
  it('paciente sem linha de cadastro: só nascimento, sexo e celular (de patients) contam', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx, { telefoneE164: '+5511999990000' });
    const presenca = await withTenant(T.ctx, (tx) => presencaDoCadastro(tx, p.id), app.db);
    expect(presenca).toEqual({ ...faltando('identidadeGenero', 'estadoCivil', 'nacionalidade', 'naturalidade', 'escolaridade', 'ocupacao', 'endereco') });
    expect(textoDoIncompleto(presenca)).toBe('Cadastro incompleto: faltam 7 dados.');
  });

  it('endereço sem complemento conta como presente; o telefone fixo basta sem celular', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx, { telefoneE164: null });
    await cadastro(T, p.id, { ...ENDERECO, ...RESTO, telefoneFixoE164: '+551133334444' });
    const presenca = await withTenant(T.ctx, (tx) => presencaDoCadastro(tx, p.id), app.db);
    expect(presenca).toEqual(COMPLETO);
    expect(textoDoIncompleto(presenca)).toBeNull();
  });

  it('o celular basta sem fixo; endereço sem a cidade conta como ausente', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx, { telefoneE164: '+5511999990000' });
    await cadastro(T, p.id, { ...ENDERECO, cidade: null, ...RESTO, estadoCivil: null });
    const presenca = await withTenant(T.ctx, (tx) => presencaDoCadastro(tx, p.id), app.db);
    expect(presenca).toEqual(faltando('estadoCivil', 'endereco'));
    expect(textoDoIncompleto(presenca)).toBe('Cadastro incompleto: faltam estado civil e endereço.');
  });

  it('sem telefone nenhum: falta "telefone"', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx, { telefoneE164: null });
    await cadastro(T, p.id, { ...ENDERECO, ...RESTO });
    expect(await withTenant(T.ctx, (tx) => presencaDoCadastro(tx, p.id), app.db)).toEqual(faltando('telefone'));
  });

  it('não grava "ler" e a consulta só seleciona expressões `is not null` (nenhum valor sai do banco)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx, { telefoneE164: '+5511999990000' });
    await cadastro(T, p.id, { ...ENDERECO, ...RESTO, cpf: '52998224725', nomeSocial: 'Joana Silva', observacao: 'Nota' });
    const antes = await trilha(T);
    const consultas: string[] = [];
    const db = drizzle({ client: app.pool, schema, logger: { logQuery: (q) => void consultas.push(q) } });
    await withTenant(T.ctx, (tx) => presencaDoCadastro(tx, p.id), db);
    expect(await trilha(T)).toBe(antes);
    const selects = consultas.filter((q) => /^select\b/i.test(q.trim()) && /"patient_cadastro"/.test(q));
    expect(selects).toHaveLength(1);
    const colunas = selects[0].slice(selects[0].search(/^select\b/i) + 'select'.length, selects[0].search(/\bfrom "patients"/));
    // tirando as expressões `"tabela"."coluna" is not null`, só sobram parênteses, `and`, `or` e vírgulas
    const resto = colunas.replace(/"[a-z_]+"\."[a-z_0-9]+" is not null/g, '').replace(/\b(and|or)\b/g, '').replace(/[\s(),]/g, '');
    expect(resto).toBe('');
    expect(colunas).not.toMatch(/"cpf"|"nome_social"|"observacao"|"complemento"/);
  });

  it('outro tenant: o cadastro de B não é lido pelo ctx de A (tudo ausente)', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const p = await novoPaciente(app.db, B.ctx, { telefoneE164: '+5511999990000' });
    await cadastro(B, p.id, { ...ENDERECO, ...RESTO });
    const presenca = await withTenant(A.ctx, (tx) => presencaDoCadastro(tx, p.id), app.db);
    expect(Object.values(presenca).every((v) => v === false)).toBe(true);
  });
});

describe('cadastroIncompleto (a nota do Início)', () => {
  it('devolve o texto da nota; nulo com o cadastro completo; sem trilha', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx, { telefoneE164: '+5511999990000' });
    const antes = await trilha(T);
    expect(await cadastroIncompleto(T.ctx, p.id, { db: app.db })).toBe('Cadastro incompleto: faltam 7 dados.');
    await cadastro(T, p.id, { ...ENDERECO, ...RESTO });
    expect(await cadastroIncompleto(T.ctx, p.id, { db: app.db })).toBeNull();
    expect(await trilha(T)).toBe(antes);
  });

  it('id malformado: nulo, sem consultar', async () => {
    const T = await novoTenant(app.db);
    expect(await cadastroIncompleto(T.ctx, 'nao-e-uuid', { db: app.db })).toBeNull();
  });

  it('só a sessão da nutricionista', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await expect(cadastroIncompleto(ctxPaciente(T.tenantId, p.id), p.id, { db: app.db })).rejects.toBeInstanceOf(TenantContextError);
  });
});
