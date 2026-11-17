import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, describe, expect, inject, it, vi } from 'vitest';
import { and, eq, getTableColumns, sql } from 'drizzle-orm';
import type { PoolClient } from 'pg';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import * as schema from '@/db/schema';
import { auditLog, patientCadastro, patients } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { logger } from '@/lib/logger';
import { filtrarBreadcrumb, filtrarEvento, type EventoSentry } from '@/lib/sentry-filtro';
import { PacienteBloqueadoError } from './base';
import {
  CAMPOS_DO_CADASTRO,
  cadastroDoPaciente,
  CpfRepetidoError,
  ESCOLARIDADES,
  ESTADOS_CIVIS,
  gravarCadastro,
  IDENTIDADES_DE_GENERO,
  MSG_CADASTRO,
  tamanhoDoTexto,
  UFS,
  validarCadastro,
  type CadastroComplementar,
} from './cadastro';
import { atualizarPaciente, buscarPaciente, criarPaciente, PacienteError } from './pacientes';

/**
 * Plano 18 (US-260, RN-260, RN-261, RN-262, D23, RNF-262): regras do cadastro complementar. O pool desta suíte anota o
 * SQLSTATE de todo erro que o banco devolve: a Review Focus 3 é que o CPF repetido e o valor fora das regras nunca
 * cheguem ao banco como 23505/23514 (o Postgres registraria o CPF ou a linha inteira no log do `nutri_db`).
 */
const app = makeDb(inject('appDatabaseUrl'));
const errosDoBanco: string[] = [];
app.pool.on('connect', (client: PoolClient) => {
  const original = client.query.bind(client) as (...a: unknown[]) => unknown;
  (client as unknown as { query: (...a: unknown[]) => unknown }).query = (...a: unknown[]) => {
    // forma com callback (o `pool.query` do pg chama assim): o erro passa pela callback, não pela promessa
    const cb = a.at(-1);
    if (typeof cb === 'function') {
      a[a.length - 1] = (e: { code?: string } | null, ...resto: unknown[]) => {
        if (e) errosDoBanco.push(e.code ?? '?');
        return (cb as (...x: unknown[]) => unknown)(e, ...resto);
      };
    }
    const r = original(...a);
    if (r && typeof (r as Promise<unknown>).then === 'function') {
      (r as Promise<unknown>).catch((e: { code?: string }) => void errosDoBanco.push(e?.code ?? '?'));
    }
    return r;
  };
});
const now = new Date('2026-11-17T15:00:00Z');
const deps = { db: app.db, now, appUrl: 'http://localhost:3104' };
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});

const s = () => randomUUID().slice(0, 8);
const CPF = '529.982.247-25';
const CPF_DIGITOS = '52998224725';
const ana = (extra: Record<string, unknown> = {}) => ({
  nome: 'Ana Souza',
  dataNascimento: '1991-03-10',
  sexo: 'F',
  email: `ana-${s()}@ex.com`,
  telefone: '(11) 91234-5678',
  whatsappAutorizado: false,
  ...extra,
});
/** O formulário manda todos os campos; vazio = '' (FormData). */
const formVazio = () => Object.fromEntries(CAMPOS_DO_CADASTRO.map((c) => [c, ''])) as Record<string, string>;
const erroDe = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof PacienteError) return e;
    throw e;
  }
  throw new Error('esperava PacienteError');
};
const cadastroDe = (T: TenantDeTeste, patientId: string) =>
  withTenant(T.ctx, (tx) => tx.select().from(patientCadastro).where(eq(patientCadastro.patientId, patientId)), app.db);
const novoComCpf = async (T: TenantDeTeste, extra: Partial<typeof patients.$inferInsert> = {}, cpf = CPF_DIGITOS) => {
  const p = await novoPaciente(app.db, T.ctx, extra);
  await withTenant(T.ctx, (tx) => tx.insert(patientCadastro).values({ tenantId: T.tenantId, patientId: p.id, cpf }), app.db);
  return p;
};
/** Espera até alguma conexão do banco estar parada esperando uma trava de linha/transação (a corrida montada à mão). */
async function esperarAlguemEsperandoTrava() {
  for (let i = 0; i < 100; i++) {
    const r = await app.pool.query(`select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database() and query like 'insert into "patient_cadastro"%'`);
    if (r.rows[0].n > 0) return;
    await new Promise((ok) => setTimeout(ok, 50));
  }
  throw new Error('ninguém esperou a trava');
}

describe('controles positivos dos espiões', () => {
  it('o espião de SQLSTATE anota um erro provocado de propósito (pela transação e pelo pool.query)', async () => {
    const T = await novoTenant(app.db);
    errosDoBanco.length = 0;
    await expect(withTenant(T.ctx, (tx) => tx.execute(sql`select 1/0`), app.db)).rejects.toThrow();
    await expect(app.pool.query(`select 'x'::int`)).rejects.toThrow();
    expect(errosDoBanco).toEqual(expect.arrayContaining(['22012', '22P02']));
    // e um 23514 de verdade, gravado por fora das regras (só para provar que o espião o veria)
    const p = await novoPaciente(app.db, T.ctx);
    errosDoBanco.length = 0;
    await expect(withTenant(T.ctx, (tx) => tx.insert(patientCadastro).values({ tenantId: T.tenantId, patientId: p.id, cep: '123' }), app.db)).rejects.toThrow();
    expect(errosDoBanco).toContain('23514');
    errosDoBanco.length = 0;
  });
});

describe('gravação na mesma transação (RN-260)', () => {
  it('cria com os campos novos na mesma transação (cenário da US-260)', async () => {
    const T = await novoTenant(app.db);
    const p = await criarPaciente(T.ctx, T.tenant, ana({ ...formVazio(), cpf: CPF, estadoCivil: 'casado', cep: '13015-904' }), deps);
    const [c] = await cadastroDe(T, p.id);
    expect(c).toMatchObject({ tenantId: T.tenantId, patientId: p.id, cpf: CPF_DIGITOS, estadoCivil: 'casado', cep: '13015904', nomeSocial: null, observacao: null });
    // mesma transação: o xmin das duas linhas é o mesmo
    const r = await withTenant(
      T.ctx,
      (tx) => tx.execute(sql`select p.xmin::text = c.xmin::text as mesma from patients p join patient_cadastro c on c.patient_id = p.id where p.id = ${p.id}`),
      app.db,
    );
    expect(r.rows).toEqual([{ mesma: true }]);
  });

  it('sem campo novo não cria linha (sem as chaves ou com todas vazias)', async () => {
    const T = await novoTenant(app.db);
    const p1 = await criarPaciente(T.ctx, T.tenant, ana(), deps);
    const p2 = await criarPaciente(T.ctx, T.tenant, ana({ ...formVazio(), observacao: '   ' }), deps);
    expect(await cadastroDe(T, p1.id)).toEqual([]);
    expect(await cadastroDe(T, p2.id)).toEqual([]);
  });

  it('e-mail repetido desfaz também o cadastro (uma transação só)', async () => {
    const T = await novoTenant(app.db);
    const email = `dup-${s()}@ex.com`;
    await criarPaciente(T.ctx, T.tenant, ana({ email }), deps);
    expect((await erroDe(criarPaciente(T.ctx, T.tenant, ana({ email, cpf: CPF }), deps))).erros).toEqual({ email: 'Paciente já cadastrado com este e-mail' });
    const r = await withTenant(T.ctx, (tx) => tx.select().from(patientCadastro).where(eq(patientCadastro.tenantId, T.tenantId)), app.db);
    expect(r).toEqual([]);
  });

  it('envio parcial: campo ausente mantém o gravado; só \'\' ou null explícito esvazia', async () => {
    const T = await novoTenant(app.db);
    const p = await criarPaciente(T.ctx, T.tenant, ana({ cpf: CPF, ocupacao: 'Professora', observacao: 'Prefere manhã', uf: 'SP' }), deps);
    const base = ana({ email: p.email });
    // só a ocupação: o resto continua
    await atualizarPaciente(T.ctx, T.tenant, p.id, { ...base, ocupacao: 'Engenheira' }, deps);
    expect((await cadastroDe(T, p.id))[0]).toMatchObject({ cpf: CPF_DIGITOS, ocupacao: 'Engenheira', observacao: 'Prefere manhã', uf: 'SP' });
    // '' esvazia só o campo enviado
    await atualizarPaciente(T.ctx, T.tenant, p.id, { ...base, observacao: '' }, deps);
    expect((await cadastroDe(T, p.id))[0]).toMatchObject({ cpf: CPF_DIGITOS, ocupacao: 'Engenheira', observacao: null, uf: 'SP' });
    // null explícito também
    await atualizarPaciente(T.ctx, T.tenant, p.id, { ...base, cpf: null }, deps);
    expect((await cadastroDe(T, p.id))[0]).toMatchObject({ cpf: null, ocupacao: 'Engenheira', uf: 'SP' });
    // gravarCadastro direto, com um campo só
    await withTenant(T.ctx, (tx) => gravarCadastro(tx, { tenantId: T.tenantId, patientId: p.id, valor: { nomeSocial: 'Joana Silva' }, now }), app.db);
    expect((await cadastroDe(T, p.id))[0]).toMatchObject({ nomeSocial: 'Joana Silva', ocupacao: 'Engenheira', uf: 'SP' });
    // undefined explícito numa chave conta como ausente
    await atualizarPaciente(T.ctx, T.tenant, p.id, { ...base, uf: undefined, ocupacao: '' }, deps);
    expect((await cadastroDe(T, p.id))[0]).toMatchObject({ nomeSocial: 'Joana Silva', ocupacao: null, uf: 'SP' });
    // paciente sem linha, envio parcial só com vazios: não nasce linha
    const q = await criarPaciente(T.ctx, T.tenant, ana(), deps);
    await atualizarPaciente(T.ctx, T.tenant, q.id, { ...ana({ email: q.email }), ocupacao: '', cpf: null }, deps);
    expect(await cadastroDe(T, q.id)).toEqual([]);
  });

  it('bloqueado não grava', async () => {
    const T = await novoTenant(app.db);
    const p = await novoComCpf(T, { status: 'bloqueado' });
    await expect(atualizarPaciente(T.ctx, T.tenant, p.id, ana({ ...formVazio(), email: p.email, ocupacao: 'Professora' }), deps)).rejects.toBeInstanceOf(
      PacienteBloqueadoError,
    );
    const [c] = await cadastroDe(T, p.id);
    expect(c).toMatchObject({ cpf: CPF_DIGITOS, ocupacao: null });
  });
});

describe('CPF (RN-261, D23 — Review Focus 3)', () => {
  it('CPF inválido: a mensagem da US-260, sem repetir os números', async () => {
    const T = await novoTenant(app.db);
    for (const cpf of ['111.111.111-11', '529.982.247-26', '529.982.247-2', 'abc']) {
      const e = await erroDe(criarPaciente(T.ctx, T.tenant, ana({ cpf }), deps));
      expect(e.erros).toEqual({ cpf: 'CPF inválido. Confira os números.' });
      const texto = `${JSON.stringify(e.erros)} ${e.message} ${JSON.stringify(e)}`;
      for (const pedaco of [cpf, cpf.replace(/\D/g, '')].filter(Boolean)) expect(texto).not.toContain(pedaco);
    }
    expect(MSG_CADASTRO.cpfInvalido).toBe('CPF inválido. Confira os números.');
  });

  it('CPF repetido não chega ao índice: CpfRepetidoError com o outro (sem ele, se bloqueado)', async () => {
    const T = await novoTenant(app.db);
    const ana1 = await novoComCpf(T);
    errosDoBanco.length = 0;
    const email = `ana2-${s()}@ex.com`;
    const e = await erroDe(criarPaciente(T.ctx, T.tenant, ana({ email, cpf: CPF }), deps));
    expect(e).toBeInstanceOf(CpfRepetidoError);
    expect(e.erros).toEqual({ cpf: 'Já existe um paciente com este CPF neste consultório.' });
    expect((e as CpfRepetidoError).outroId).toBe(ana1.id);
    // nada foi gravado: o paciente novo saiu junto
    expect(await withTenant(T.ctx, (tx) => tx.select().from(patients).where(eq(patients.email, email)), app.db)).toEqual([]);

    // na edição também; arquivado continua com o link
    const outra = await novoPaciente(app.db, T.ctx);
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'arquivado' }).where(eq(patients.id, ana1.id)), app.db);
    const e2 = await erroDe(atualizarPaciente(T.ctx, T.tenant, outra.id, ana({ email: outra.email, cpf: CPF }), deps));
    expect((e2 as CpfRepetidoError).outroId).toBe(ana1.id);
    // salvar de novo o próprio CPF não é repetição
    await expect(atualizarPaciente(T.ctx, T.tenant, ana1.id, ana({ email: ana1.email, cpf: CPF, ocupacao: 'Professora' }), deps)).resolves.toMatchObject({ id: ana1.id });

    // o outro bloqueado por pedido de exclusão: a mensagem, sem o link
    const U = await novoTenant(app.db);
    await novoComCpf(U, { status: 'bloqueado', bloqueadoEm: now });
    const e3 = await erroDe(criarPaciente(U.ctx, U.tenant, ana({ cpf: CPF }), deps));
    expect(e3).toBeInstanceOf(CpfRepetidoError);
    expect(e3.erros).toEqual({ cpf: MSG_CADASTRO.cpfRepetido });
    expect((e3 as CpfRepetidoError).outroId).toBeNull();

    // outro consultório com o mesmo CPF: passa
    const V = await novoTenant(app.db);
    await expect(criarPaciente(V.ctx, V.tenant, ana({ cpf: CPF }), deps)).resolves.toBeDefined();
    expect(errosDoBanco.filter((c) => c === '23505')).toEqual([]);
  });

  it('corrida: duas conexões gravando o mesmo CPF ao mesmo tempo — uma passa, a outra recebe CpfRepetidoError', async () => {
    for (let rodada = 0; rodada < 3; rodada++) {
      const T = await novoTenant(app.db);
      errosDoBanco.length = 0;
      const r = await Promise.allSettled([
        criarPaciente(T.ctx, T.tenant, ana({ cpf: CPF }), deps),
        criarPaciente(T.ctx, T.tenant, ana({ cpf: '52998224725' }), deps),
      ]);
      expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      const [falhou] = r.filter((x): x is PromiseRejectedResult => x.status === 'rejected');
      expect(falhou.reason).toBeInstanceOf(CpfRepetidoError);
      expect((falhou.reason as CpfRepetidoError).outroId).toBe((r.find((x) => x.status === 'fulfilled') as PromiseFulfilledResult<{ id: string }>).value.id);
      expect(errosDoBanco).toEqual([]); // a trava serializou: nenhum 23505
    }
  });

  it('23505 residual (CPF gravado por fora da trava, entre a checagem e o INSERT) vira CpfRepetidoError sem o outro', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const outro = await novoPaciente(app.db, T.ctx);
    let soltar!: () => void;
    const segura = new Promise<void>((ok) => (soltar = ok));
    let gravou!: () => void;
    const gravado = new Promise<void>((ok) => (gravou = ok));
    // outra transação grava o CPF sem a trava e só confirma depois: a pré-checagem não a vê, o INSERT espera o índice
    const porFora = withTenant(
      T.ctx,
      async (tx) => {
        await tx.insert(patientCadastro).values({ tenantId: T.tenantId, patientId: outro.id, cpf: CPF_DIGITOS });
        gravou();
        await segura;
      },
      app.db,
    );
    await gravado;
    const salvar = erroDe(atualizarPaciente(T.ctx, T.tenant, p.id, ana({ email: p.email, cpf: CPF }), deps));
    await esperarAlguemEsperandoTrava();
    soltar();
    await porFora;
    const e = await salvar;
    expect(e).toBeInstanceOf(CpfRepetidoError);
    expect(e.erros).toEqual({ cpf: MSG_CADASTRO.cpfRepetido });
    expect((e as CpfRepetidoError).outroId).toBeNull();
    expect(await cadastroDe(T, p.id)).toEqual([]);
  });
});

describe('regras dos CHECKs conferidas antes do banco (D23)', () => {
  const x = (n: number, c = 'x') => c.repeat(n);
  /** [campo, mínimo, máximo] — as faixas dos CHECKs de patient_cadastro. */
  const TAMANHOS: [keyof CadastroComplementar, number, number][] = [
    ['nomeSocial', 2, 120],
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

  it('fronteiras não violam CHECK: o maior e o menor aceitos gravam; um a mais/menos é recusado antes do banco', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    errosDoBanco.length = 0;
    const gravar = (input: Record<string, unknown>) => {
      const r = validarCadastro(input);
      if (!r.ok) throw new Error(`recusado: ${Object.keys(r.erros).join(',')}`);
      return withTenant(T.ctx, (tx) => gravarCadastro(tx, { tenantId: T.tenantId, patientId: p.id, valor: r.valor, now }), app.db);
    };
    const lido = async () => (await cadastroDe(T, p.id))[0];
    for (const [campo, min, max] of TAMANHOS) {
      // 'ç' e um emoji (dois code units em JS, um caractere no Postgres) nas pontas
      for (const v of [x(min), x(max), x(max, 'ç'), x(max, '😀'), `  ${x(max)}  `]) {
        await gravar({ [campo]: v });
        expect(await lido(), `${campo} ${v.length}`).toMatchObject({ [campo]: v.trim() });
      }
      const fora = [x(max + 1), x(max + 1, '😀'), ...(min > 1 ? [x(min - 1), ` ${x(min - 1)} `] : [])];
      for (const v of fora) {
        const r = validarCadastro({ [campo]: v });
        expect(r.ok, `${campo} ${v.length}`).toBe(false);
        if (!r.ok) expect(r.erros[campo]).toBe(campo === 'observacao' ? 'Use no máximo 1.000 caracteres' : `Use entre ${min} e ${max} caracteres`);
      }
      // vazio ou só espaços = nulo
      await gravar({ [campo]: '   ' });
      expect(await lido()).toMatchObject({ [campo]: null });
    }
    const LISTAS: [keyof CadastroComplementar, readonly { valor: string }[], string][] = [
      ['identidadeGenero', IDENTIDADES_DE_GENERO, 'Escolha uma opção da lista'],
      ['estadoCivil', ESTADOS_CIVIS, 'Escolha uma opção da lista'],
      ['escolaridade', ESCOLARIDADES, 'Escolha uma opção da lista'],
      ['uf', UFS, 'Selecione um estado da lista'],
    ];
    for (const [campo, lista, msg] of LISTAS) {
      for (const { valor } of lista) {
        await gravar({ [campo]: valor });
        expect(await lido()).toMatchObject({ [campo]: valor });
      }
      for (const v of ['outro_valor', lista[0].valor.toUpperCase() === lista[0].valor ? lista[0].valor.toLowerCase() : lista[0].valor.toUpperCase(), ` ${lista[0].valor}x`, 42]) {
        const r = validarCadastro({ [campo]: v });
        expect(r.ok ? null : r.erros[campo], `${campo}=${v}`).toBe(msg);
      }
    }
    expect(UFS).toHaveLength(27);
    // as listas da tela (cadastro-textos.ts, sem banco) são as do schema (os CHECKs), na mesma ordem
    expect(IDENTIDADES_DE_GENERO.map((o) => o.valor)).toEqual([...schema.IDENTIDADES_DE_GENERO]);
    expect(ESTADOS_CIVIS.map((o) => o.valor)).toEqual([...schema.ESTADOS_CIVIS]);
    expect(ESCOLARIDADES.map((o) => o.valor)).toEqual([...schema.ESCOLARIDADES]);
    expect(UFS.map((o) => o.valor)).toEqual([...schema.UFS]);
    // formatos
    for (const [entrada, gravado] of [
      ['13015-904', '13015904'],
      [' 13015904 ', '13015904'],
      // pontos e espaço, como o CPF (code review do PR 2)
      ['01.310-100', '01310100'],
      ['01310 100', '01310100'],
    ]) {
      await gravar({ cep: entrada });
      expect(await lido()).toMatchObject({ cep: gravado });
    }
    for (const v of ['1301590', '130159040', '13015-90a', '13.015/904']) expect(validarCadastro({ cep: v })).toEqual({ ok: false, erros: { cep: 'CEP inválido. Use os 8 números.' } });
    for (const [entrada, gravado] of [
      ['(11) 3123-4567', '+551131234567'],
      ['+44 20 7946 0958', '+442079460958'],
    ]) {
      await gravar({ telefoneFixo: entrada });
      expect(await lido()).toMatchObject({ telefoneFixoE164: gravado });
    }
    for (const v of ['123', '(11) 1123-4567', '+0 11 3123 4567']) expect(validarCadastro({ telefoneFixo: v })).toEqual({ ok: false, erros: { telefoneFixo: 'Telefone fixo inválido' } });
    // celular brasileiro (9 dígitos começando por 9, com ou sem +55) não é telefone fixo (code review do PR 2)
    for (const v of ['(11) 91234-5678', '+55 11 91234-5678', '5511912345678', '011912345678'])
      expect(validarCadastro({ telefoneFixo: v }), v).toEqual({ ok: false, erros: { telefoneFixo: 'Telefone fixo inválido' } });
    // o internacional segue só o E.164 (um número que começa com 9 em outro país passa)
    expect(validarCadastro({ telefoneFixo: '+351 912 345 678' })).toMatchObject({ ok: true, valor: { telefoneFixo: '+351912345678' } });
    await gravar({ cpf: ' 529.982.247-25 ' });
    expect(await lido()).toMatchObject({ cpf: CPF_DIGITOS });
    // texto que não é texto (formulário adulterado): recusado com a mensagem do campo
    expect(validarCadastro({ ocupacao: ['a', 'b'] })).toEqual({ ok: false, erros: { ocupacao: 'Use entre 2 e 80 caracteres' } });
    expect(validarCadastro({ cpf: 52998224725 })).toEqual({ ok: false, erros: { cpf: MSG_CADASTRO.cpfInvalido } });

    expect(errosDoBanco.filter((c) => c.startsWith('23'))).toEqual([]);
  });

  it('pelo criarPaciente: valor fora das regras volta como erro do campo e nada chega ao banco', async () => {
    const T = await novoTenant(app.db);
    errosDoBanco.length = 0;
    const e = await erroDe(
      criarPaciente(T.ctx, T.tenant, ana({ ...formVazio(), nome: 'A', nomeSocial: 'J', cep: '123', uf: 'XX', observacao: x(1001), numero: x(11) }), deps),
    );
    expect(e.erros).toEqual({
      nome: 'Informe o nome',
      nomeSocial: 'Use entre 2 e 120 caracteres',
      cep: 'CEP inválido. Use os 8 números.',
      uf: 'Selecione um estado da lista',
      observacao: 'Use no máximo 1.000 caracteres',
      numero: 'Use entre 1 e 10 caracteres',
    });
    expect(errosDoBanco).toEqual([]);
  });
});

describe('quebras de linha e revalidação na gravação', () => {
  it('\\r\\n vira \\n antes de validar e gravar: 1.000 caracteres com quebras passam, como conta a tela', async () => {
    const T = await novoTenant(app.db);
    // 1.000 caracteres com \n (como o navegador mostra no textarea); o FormData manda as quebras como \r\n
    const texto = `${Array.from({ length: 10 }, (_, i) => `${i}`.repeat(99)).join('\n')}b`;
    expect(Array.from(texto)).toHaveLength(1000);
    const enviado = texto.replace(/\n/g, '\r\n');
    expect(tamanhoDoTexto(enviado)).toBe(1000); // o contador da tela conta o mesmo que o servidor
    expect(MSG_CADASTRO.contadorObservacao(tamanhoDoTexto(enviado))).toBe('1.000 de 1.000 caracteres');
    expect(validarCadastro({ observacao: enviado })).toMatchObject({ ok: true, valor: { observacao: texto } });
    const p = await criarPaciente(T.ctx, T.tenant, ana({ observacao: enviado }), deps);
    expect((await cadastroDe(T, p.id))[0]).toMatchObject({ observacao: texto });
    const r = await withTenant(T.ctx, (tx) => tx.execute(sql`select char_length(observacao) as n from patient_cadastro where patient_id = ${p.id}`), app.db);
    expect(r.rows).toEqual([{ n: 1000 }]);
    // \r sozinho também vira \n; 1.001 com quebras continua recusado
    expect(validarCadastro({ observacao: 'a\rb' })).toMatchObject({ ok: true, valor: { observacao: 'a\nb' } });
    expect(validarCadastro({ observacao: `${enviado}c` })).toEqual({ ok: false, erros: { observacao: 'Use no máximo 1.000 caracteres' } });
    expect(tamanhoDoTexto(`${enviado}c`)).toBe(1001);
    // as pontas saem, como no servidor
    expect(tamanhoDoTexto('  \r\n ab \r\n')).toBe(2);
  });

  it('gravarCadastro revalida: valor fora das regras não chega ao CHECK (nenhum 23514) e volta como erro do campo', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    errosDoBanco.length = 0;
    const gravar = (valor: Record<string, unknown>) =>
      withTenant(T.ctx, (tx) => gravarCadastro(tx, { tenantId: T.tenantId, patientId: p.id, valor: valor as Partial<CadastroComplementar>, now }), app.db);
    for (const [valor, erros] of [
      [{ cep: '123' }, { cep: 'CEP inválido. Use os 8 números.' }],
      [{ observacao: 'x'.repeat(1001) }, { observacao: 'Use no máximo 1.000 caracteres' }],
      [{ uf: 'XX', nomeSocial: 'J' }, { uf: 'Selecione um estado da lista', nomeSocial: 'Use entre 2 e 120 caracteres' }],
      [{ cpf: '11111111111' }, { cpf: 'CPF inválido. Confira os números.' }],
      [{ telefoneFixo: '123' }, { telefoneFixo: 'Telefone fixo inválido' }],
    ] as const) {
      const e = await erroDe(gravar(valor));
      expect(e.erros).toEqual(erros);
    }
    expect(await cadastroDe(T, p.id)).toEqual([]);
    // o valor normalizado (o que validarCadastro devolve) passa de novo pela revalidação sem mudar
    await gravar({ cpf: CPF_DIGITOS, cep: '13015904', telefoneFixo: '+551131234567', uf: 'SP', observacao: 'a\nb' });
    expect((await cadastroDe(T, p.id))[0]).toMatchObject({ cpf: CPF_DIGITOS, cep: '13015904', telefoneFixoE164: '+551131234567', uf: 'SP', observacao: 'a\nb' });
    expect(errosDoBanco.filter((c) => c.startsWith('23'))).toEqual([]);
  });
});

describe('nada do cadastro em log nem no Sentry (RNF-262)', () => {
  it('log sem dado: "Salvar" com erro de CPF, CEP e observação de teste', async () => {
    const T = await novoTenant(app.db);
    await novoComCpf(T);
    const capturado: unknown[] = [];
    for (const nivel of ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const) {
      vi.spyOn(logger, nivel).mockImplementation(((...a: unknown[]) => void capturado.push(a)) as never);
    }
    for (const nivel of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, nivel).mockImplementation((...a: unknown[]) => void capturado.push(a));
    }
    // controle positivo: o espião pega o que passa pelo logger e pelo console
    logger.warn({ campo: 'controle' }, 'linha de controle do logger');
    console.error('linha de controle do console');
    expect(JSON.stringify(capturado)).toContain('linha de controle do logger');
    expect(JSON.stringify(capturado)).toContain('linha de controle do console');
    const segredos = [CPF, CPF_DIGITOS, '13015-904', '13015904', 'Observação reservada de teste', '111.111.111-11', '11111111111'];
    const erros: unknown[] = [];
    // CPF inválido + CEP + observação
    erros.push(await erroDe(criarPaciente(T.ctx, T.tenant, ana({ cpf: '111.111.111-11', cep: '13015-904', observacao: 'Observação reservada de teste' }), deps)));
    // CEP inválido junto
    erros.push(await erroDe(criarPaciente(T.ctx, T.tenant, ana({ cpf: '111.111.111-11', cep: '13015-904x', observacao: 'Observação reservada de teste' }), deps)));
    // CPF repetido com CEP e observação válidos
    erros.push(await erroDe(criarPaciente(T.ctx, T.tenant, ana({ cpf: CPF, cep: '13015-904', observacao: 'Observação reservada de teste' }), deps)));

    const texto = JSON.stringify(capturado) + erros.map((e) => `${String(e)} ${(e as Error).stack} ${JSON.stringify(e)}`).join(' ');
    for (const s of segredos) expect(texto).not.toContain(s);

    // o mesmo erro no Sentry: evento com a exceção, a requisição e um breadcrumb de entrada do formulário de cadastro
    for (const e of erros as Error[]) {
      const evento: EventoSentry = {
        message: `Falha ao salvar ${CPF}`,
        exception: { values: [{ type: e.name, value: `${e.message} ${CPF} 13015-904 Observação reservada de teste` }] },
        request: { method: 'POST', url: `http://localhost:3104/painel/pacientes/novo?cpf=${CPF_DIGITOS}&cep=13015904`, data: { cpf: CPF, cep: '13015-904', observacao: 'Observação reservada de teste' } },
        extra: { valores: { cpf: CPF, cep: '13015904', observacao: 'Observação reservada de teste' } },
        breadcrumbs: [
          { category: 'ui.input', message: `input[name="cpf"] ${CPF}`, data: { value: CPF } },
          { category: 'fetch', data: { method: 'POST', url: `http://localhost:3104/painel/pacientes/novo?cpf=${CPF_DIGITOS}&cep=13015904&obs=Observa%C3%A7%C3%A3o`, status_code: 200 } },
          { category: 'console', message: `cadastro ${CPF} 13015-904 Observação reservada de teste` },
        ],
        tags: { cpf: CPF_DIGITOS, rota: '/painel/pacientes/novo' },
        contexts: { formulario: { cpf: CPF } },
      };
      const saiu = JSON.stringify(filtrarEvento(evento)) + JSON.stringify(evento.breadcrumbs!.map(filtrarBreadcrumb));
      for (const s of [...segredos, 'Observa%C3%A7%C3%A3o']) expect(saiu).not.toContain(s);
    }
  });
});

describe('leituras (D20, RN-268 — Review Focus 4)', () => {
  it('cadastroDoPaciente devolve os valores e grava "ler" de patients; outro tenant ou sem linha → null', async () => {
    const T = await novoTenant(app.db);
    const p = await criarPaciente(
      T.ctx,
      T.tenant,
      ana({ cpf: CPF, nomeSocial: 'Joana Silva', telefoneFixo: '(11) 3123-4567', uf: 'SP', identidadeGenero: 'mulher', observacao: ' Prefere manhã ' }),
      deps,
    );
    const [linha] = await cadastroDe(T, p.id);
    const c = await cadastroDoPaciente(T.ctx, p.id, { db: app.db });
    expect(c).toEqual({
      cpf: CPF_DIGITOS,
      nomeSocial: 'Joana Silva',
      identidadeGenero: 'mulher',
      estadoCivil: null,
      escolaridade: null,
      ocupacao: null,
      nacionalidade: null,
      naturalidade: null,
      telefoneFixo: '+551131234567',
      cep: null,
      logradouro: null,
      numero: null,
      complemento: null,
      bairro: null,
      cidade: null,
      uf: 'SP',
      observacao: 'Prefere manhã',
    });
    const leituras = await withTenant(
      T.ctx,
      (tx) => tx.select().from(auditLog).where(and(eq(auditLog.tenantId, T.tenantId), eq(auditLog.acao, 'ler'), eq(auditLog.patientId, p.id))),
      app.db,
    );
    expect(leituras).toEqual([expect.objectContaining({ entidade: 'patients', entidadeId: linha.id, actorUserId: T.nutriId })]);

    const U = await novoTenant(app.db);
    expect(await cadastroDoPaciente(U.ctx, p.id, { db: app.db })).toBeNull();
    expect(await cadastroDoPaciente(T.ctx, 'nao-e-uuid', { db: app.db })).toBeNull();
    const semLinha = await novoPaciente(app.db, T.ctx);
    expect(await cadastroDoPaciente(T.ctx, semLinha.id, { db: app.db })).toBeNull();
  });

  it('buscarPaciente traz só nomeSocial do cadastro', async () => {
    const T = await novoTenant(app.db);
    const p = await criarPaciente(T.ctx, T.tenant, ana({ cpf: CPF, nomeSocial: 'Joana Silva', cep: '13015-904', observacao: 'Reservada' }), deps);
    const b = await buscarPaciente(T.ctx, p.id, app.db);
    expect(Object.keys(b!).sort()).toEqual([...Object.keys(getTableColumns(patients)), 'nomeSocial'].sort());
    expect(b).toMatchObject({ id: p.id, nome: 'Ana Souza', nomeSocial: 'Joana Silva' });
    const texto = JSON.stringify(b);
    for (const s of [CPF_DIGITOS, '13015904', 'Reservada']) expect(texto).not.toContain(s);
    // sem cadastro: nomeSocial nulo
    const q = await novoPaciente(app.db, T.ctx);
    expect(await buscarPaciente(T.ctx, q.id, app.db)).toMatchObject({ id: q.id, nomeSocial: null });
  });
});

it('agendamento público não cria cadastro (US-260): a página pública não escreve em patient_cadastro', () => {
  // o fluxo de ponta a ponta confere a ausência da linha em agendamento-publico.test.ts ("fluxo feliz")
  const fonte = readFileSync('src/modules/agenda/agendamento-publico.ts', 'utf8');
  expect(fonte).not.toMatch(/patientCadastro|patient_cadastro|gravarCadastro|\/cadastro'/);
});
