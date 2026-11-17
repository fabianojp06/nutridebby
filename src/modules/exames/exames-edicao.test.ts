import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { exameComLaudo, pacienteAutorizado, tarefaNoBanco } from '../../../test/ia';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import type { Tx } from '@/db/client';
import { auditLog, examesCatalogo, examVersoes, exams, patients, user } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { numeroParaCampo } from '@/lib/numero';
import { aplicarSugestao } from '@/modules/ia/conferencia';
import type { ResultadoLeitura } from '@/modules/ia/tipos';
import { PacienteBloqueadoError } from '@/modules/pacientes/base';
import { criarExame, ExameError } from '@/modules/pacientes/exames';
import { MSG_EXAMES } from './constantes';
import { editarExame, exameParaEditar, versoesDoExame, type LinhaEditada } from './edicao';

/**
 * Plano 22 (T4, US-371, RN-378, EP-D21, EP-D41, EP-D62; Review Focus 3): ler para editar, editar com versão e "Versões
 * anteriores". Leituras pelos dois ids (M8), `updated_at` × `lidoEm` em TypeScript (M3), a origem da IA só do servidor.
 */
const app = makeDb(inject('appDatabaseUrl'));
const dono = makeDb(inject('ownerDatabaseUrl')); // só lê pg_stat_activity (quem está preso em qual trava)
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-exames-edicao-'));
afterAll(async () => {
  await app.pool.end();
  await dono.pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});

const E = MSG_EXAMES.lancamentoErros;
const fuso = { fuso: 'America/Sao_Paulo' };
const deps = { db: app.db };

const erros = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof ExameError) return e.erros;
    throw e;
  }
  throw new Error('esperava ExameError');
};

/** As linhas do formulário de edição a partir do que está gravado (cada uma com a origem). */
const doGravado = (valores: { nome: string; valor: number; unidade: string | null; referencia: string | null; refMin?: number; refMax?: number }[]): LinhaEditada[] =>
  valores.map((v, i) => ({
    origem: i,
    nome: v.nome,
    // o mesmo texto que o formulário mostra (linhaDoGravado): sem notação exponencial
    valor: numeroParaCampo(v.valor),
    unidade: v.unidade ?? '',
    referencia: v.referencia ?? '',
    refMin: numeroParaCampo(v.refMin),
    refMax: numeroParaCampo(v.refMax),
  }));
const nova = (o: Partial<LinhaEditada> = {}): LinhaEditada => ({ origem: null, nome: 'Ferritina', valor: '80', unidade: 'ng/mL', referencia: '', refMin: '', refMax: '', ...o });

async function cenario() {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx);
  const exameId = await criarExame(
    T.ctx,
    T.tenant,
    p.id,
    { titulo: 'Rotina', data: '2026-09-01', valores: [{ nome: 'Glicemia de jejum', valor: '95', unidade: 'mg/dL', referencia: '70 a 99' }], arquivo: null },
    { db: app.db, now: new Date('2026-09-02T12:00:00Z') },
  );
  const aberto = (await exameParaEditar(T.ctx, p.id, exameId, deps))!;
  return { T, p, exameId, aberto };
}
const exame = (T: TenantDeTeste, id: string) => withTenant(T.ctx, async (tx) => (await tx.select().from(exams).where(eq(exams.id, id)))[0], app.db);
const versoes = (T: TenantDeTeste, id: string) => withTenant(T.ctx, (tx) => tx.select().from(examVersoes).where(eq(examVersoes.examId, id)).orderBy(examVersoes.versao), app.db);
const logDo = (T: TenantDeTeste, id: string) =>
  withTenant(T.ctx, (tx) => tx.select({ acao: auditLog.acao, entidade: auditLog.entidade, actor: auditLog.actorUserId, patientId: auditLog.patientId }).from(auditLog).where(eq(auditLog.entidadeId, id)).orderBy(auditLog.criadoEm), app.db);

describe('exameParaEditar (T4, M8)', () => {
  it('devolve título, data, linhas, updatedAt (ISO) e o catálogo, e grava um ler/exames com o id do exame', async () => {
    const { T, p, exameId } = await cenario();
    await withTenant(T.ctx, (tx) => tx.insert(examesCatalogo).values({ tenantId: T.tenantId, nome: 'Glicemia de jejum', unidade: 'mg/dL' }), app.db);
    const antes = (await logDo(T, exameId)).length;
    const e = (await exameParaEditar(T.ctx, p.id, exameId, deps))!;
    expect(e).toMatchObject({ id: exameId, titulo: 'Rotina', data: '2026-09-01', valores: [{ nome: 'Glicemia de jejum', valor: 95 }], noAppEm: null });
    expect(e.updatedAt).toBe((await exame(T, exameId)).updatedAt.toISOString());
    expect(e.catalogo.map((c) => c.nome)).toEqual(['Glicemia de jejum']);
    const log = await logDo(T, exameId);
    expect(log.slice(antes)).toEqual([{ acao: 'ler', entidade: 'exames', actor: T.nutriId, patientId: p.id }]);
  });

  it('exame de outro paciente na URL (ou id malformado) → null e nenhum ler', async () => {
    const { T, exameId } = await cenario();
    const outro = await novoPaciente(app.db, T.ctx);
    const antes = (await logDo(T, exameId)).length;
    expect(await exameParaEditar(T.ctx, outro.id, exameId, deps)).toBeNull();
    expect(await exameParaEditar(T.ctx, 'nao-uuid', exameId, deps)).toBeNull();
    expect(await exameParaEditar(T.ctx, outro.id, 'nao-uuid', deps)).toBeNull();
    expect(await logDo(T, exameId)).toHaveLength(antes);
    const leiturasDoOutro = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.patientId, outro.id), eq(auditLog.acao, 'ler'))), app.db);
    expect(leiturasDoOutro).toEqual([]);
  });

  it('sessão de paciente → erro do assert de papel, antes da transação', async () => {
    const { T, p, exameId } = await cenario();
    const P = ctxPaciente(T.tenantId, p.id);
    await expect(exameParaEditar(P, p.id, exameId, deps)).rejects.toThrow('exames: só a sessão nutri');
    await expect(editarExame(P, fuso, p.id, exameId, { titulo: 'X', data: '2026-09-01', linhas: [], justificativa: '', lidoEm: '' }, deps)).rejects.toThrow('exames: só a sessão nutri');
    await expect(versoesDoExame(P, p.id, exameId, deps)).rejects.toThrow('exames: só a sessão nutri');
  });
});

describe('editarExame (US-371 "Editar exame", RN-378)', () => {
  it('título, data e valor mudados com justificativa → versão 1 com o estado de antes, justificativa e alterado_por da sessão; audit_log alterar/exames e criar/exames_versoes', async () => {
    const { T, p, exameId, aberto } = await cenario();
    const linhas = doGravado(aberto.valores);
    linhas[0].valor = '105';
    await editarExame(T.ctx, fuso, p.id, exameId, { titulo: 'Rotina anual', data: '2026-08-30', linhas, justificativa: 'Valor digitado errado', lidoEm: aberto.updatedAt }, deps);
    const e = await exame(T, exameId);
    expect(e).toMatchObject({ titulo: 'Rotina anual', data: '2026-08-30', valores: [{ nome: 'Glicemia de jejum', valor: 105, unidade: 'mg/dL', referencia: '70 a 99' }] });
    expect(e.updatedAt.toISOString()).not.toBe(aberto.updatedAt);
    const [v, ...resto] = await versoes(T, exameId);
    expect(resto).toEqual([]);
    expect(v).toMatchObject({ versao: 1, titulo: 'Rotina', data: '2026-09-01', valores: aberto.valores, justificativa: 'Valor digitado errado', alteradoPor: T.nutriId, patientId: p.id });
    const log = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.patientId, p.id), sql`${auditLog.acao} in ('alterar', 'criar')`)).orderBy(auditLog.criadoEm), app.db);
    expect(log.slice(-2).map((l) => [l.acao, l.entidade, l.actorUserId])).toEqual(
      expect.arrayContaining([
        ['alterar', 'exames', T.nutriId],
        ['criar', 'exames_versoes', T.nutriId],
      ]),
    );
    // a segunda edição grava a versão 2, com o estado da primeira
    const de2 = (await exameParaEditar(T.ctx, p.id, exameId, deps))!;
    await editarExame(T.ctx, fuso, p.id, exameId, { titulo: 'Rotina 2026', data: de2.data, linhas: doGravado(de2.valores), justificativa: 'Título padronizado', lidoEm: de2.updatedAt }, deps);
    expect((await versoes(T, exameId)).map((x) => [x.versao, x.titulo])).toEqual([[1, 'Rotina'], [2, 'Rotina anual']]);
  });

  it('sem justificativa (ou com menos de 5 caracteres, ou com NUL) → a mensagem e nada é gravado', async () => {
    const { T, p, exameId, aberto } = await cenario();
    const linhas = doGravado(aberto.valores);
    linhas[0].valor = '105';
    for (const justificativa of ['', '   ', 'abc', '🙂🙂🙂', '🙂🙂🙂🙂', `Valor\u0000errado`, 'x'.repeat(501), null]) {
      expect(await erros(editarExame(T.ctx, fuso, p.id, exameId, { titulo: 'Rotina', data: '2026-09-01', linhas, justificativa, lidoEm: aberto.updatedAt }, deps)), String(justificativa)).toEqual({
        justificativa: E.justificativa,
      });
    }
    // remover uma linha também pede justificativa
    expect(await erros(editarExame(T.ctx, fuso, p.id, exameId, { titulo: 'Rotina', data: '2026-09-01', linhas: [], justificativa: '', lidoEm: aberto.updatedAt }, deps))).toEqual({ justificativa: E.justificativa });
    expect(await versoes(T, exameId)).toEqual([]);
    expect((await exame(T, exameId)).valores[0].valor).toBe(95);
    // o tamanho é por code point, como o CHECK char_length: 5 emojis (10 unidades UTF-16) bastam
    await editarExame(T.ctx, fuso, p.id, exameId, { titulo: 'Rotina', data: '2026-09-01', linhas, justificativa: '🙂'.repeat(5), lidoEm: aberto.updatedAt }, deps);
    expect((await versoes(T, exameId)).map((v) => v.justificativa)).toEqual(['🙂'.repeat(5)]);
  });

  it('valor e faixa abaixo de 1e-6 (gravados como 1e-7): a linha intocada volta sem notação exponencial e a edição do título salva', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const exameId = await criarExame(
      T.ctx,
      T.tenant,
      p.id,
      { titulo: 'Traço', data: '2026-09-01', valores: [{ nome: 'Traço', valor: '0,0000001', unidade: 'mg/L', referencia: null, refMin: '0,0000001', refMax: '0,0000005' }], arquivo: null },
      { db: app.db, now: new Date('2026-09-02T12:00:00Z') },
    );
    const aberto = (await exameParaEditar(T.ctx, p.id, exameId, deps))!;
    expect(aberto.valores[0]).toMatchObject({ valor: 1e-7, refMin: 1e-7, refMax: 5e-7 });
    await editarExame(T.ctx, fuso, p.id, exameId, { titulo: 'Traço anual', data: '2026-09-01', linhas: doGravado(aberto.valores), justificativa: 'Título padronizado', lidoEm: aberto.updatedAt }, deps);
    const depois = await exame(T, exameId);
    expect(depois.titulo).toBe('Traço anual');
    expect(depois.valores).toEqual(aberto.valores);
  });

  it('só acréscimo (título, data e linhas existentes iguais, na mesma ordem) → passa sem justificativa e grava a versão de antes', async () => {
    const { T, p, exameId, aberto } = await cenario();
    await editarExame(T.ctx, fuso, p.id, exameId, { titulo: 'Rotina', data: '2026-09-01', linhas: [...doGravado(aberto.valores), nova({ refMin: '15', refMax: '150' })], justificativa: '', lidoEm: aberto.updatedAt }, deps);
    expect((await exame(T, exameId)).valores).toEqual([
      { nome: 'Glicemia de jejum', valor: 95, unidade: 'mg/dL', referencia: '70 a 99' },
      { nome: 'Ferritina', valor: 80, unidade: 'ng/mL', referencia: '15 a 150', refMin: 15, refMax: 150 },
    ]);
    const [v] = await versoes(T, exameId);
    expect(v).toMatchObject({ versao: 1, justificativa: null, valores: aberto.valores });
  });

  it('o exame aceito do app sem valores ganha linhas sem justificativa', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const exameId = await criarExame(T.ctx, T.tenant, p.id, { titulo: 'Enviado pelo paciente', data: '2026-09-01', valores: [], arquivo: null }, { db: app.db });
    const aberto = (await exameParaEditar(T.ctx, p.id, exameId, deps))!;
    await editarExame(T.ctx, fuso, p.id, exameId, { titulo: aberto.titulo, data: aberto.data, linhas: [nova(), nova({ nome: 'Vitamina D', valor: '32', unidade: 'ng/mL' })], justificativa: '', lidoEm: aberto.updatedAt }, deps);
    expect((await exame(T, exameId)).valores.map((v) => v.nome)).toEqual(['Ferritina', 'Vitamina D']);
    expect(await versoes(T, exameId)).toEqual([expect.objectContaining({ versao: 1, valores: [], justificativa: null })]);
  });

  it('nada mudou → "Nada foi alterado." e nenhuma versão', async () => {
    const { T, p, exameId, aberto } = await cenario();
    expect(await erros(editarExame(T.ctx, fuso, p.id, exameId, { titulo: ' Rotina ', data: '2026-09-01', linhas: doGravado(aberto.valores), justificativa: 'Sem motivo nenhum', lidoEm: aberto.updatedAt }, deps))).toEqual({
      geral: E.nadaAlterado,
    });
    expect(await versoes(T, exameId)).toEqual([]);
  });

  it('erros das linhas, título e data (as mensagens de hoje) e a faixa invertida; nada é gravado', async () => {
    const { T, p, exameId, aberto } = await cenario();
    const linhas = [...doGravado(aberto.valores), nova({ refMin: '120', refMax: '99' })];
    expect(await erros(editarExame(T.ctx, fuso, p.id, exameId, { titulo: '', data: '2999-01-01', linhas, justificativa: 'Correção do laudo', lidoEm: aberto.updatedAt }, deps))).toEqual({
      titulo: 'Informe o título do exame',
      data: 'A data não pode ser no futuro',
      'valores.1.refMin': E.faixaInvertida,
    });
    expect(await versoes(T, exameId)).toEqual([]);
  });

  it('o lidoEm de um exame com updated_at em microssegundos (relógio do banco) passa na edição (M3: comparação em TypeScript)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const [e] = await withTenant(
      T.ctx,
      (tx) =>
        tx
          .insert(exams)
          .values({ tenantId: T.tenantId, patientId: p.id, data: '2026-09-01', titulo: 'Rotina', valores: [], updatedAt: sql`clock_timestamp()`, createdAt: sql`clock_timestamp()` })
          .returning({ id: exams.id }),
      app.db,
    );
    const { rows } = await dono.pool.query<{ us: number }>('select (extract(microseconds from updated_at)::bigint % 1000)::int as us from exams where id = $1', [e.id]);
    expect(rows).toHaveLength(1); // o banco guarda os microssegundos; o Date do JS, não
    const aberto = (await exameParaEditar(T.ctx, p.id, e.id, deps))!;
    await editarExame(T.ctx, fuso, p.id, e.id, { titulo: 'Rotina', data: '2026-09-01', linhas: [nova()], justificativa: '', lidoEm: aberto.updatedAt }, deps);
    expect((await exame(T, e.id)).valores).toHaveLength(1);
  });

  it('lidoEm antigo (o exame mudou depois de aberto) → "O exame mudou desde que você abriu. Recarregue a página."', async () => {
    const { T, p, exameId, aberto } = await cenario();
    await editarExame(T.ctx, fuso, p.id, exameId, { titulo: 'Rotina', data: '2026-09-01', linhas: [...doGravado(aberto.valores), nova()], justificativa: '', lidoEm: aberto.updatedAt }, deps);
    expect(await erros(editarExame(T.ctx, fuso, p.id, exameId, { titulo: 'Rotina', data: '2026-09-01', linhas: [...doGravado(aberto.valores), nova({ nome: 'Ferro' })], justificativa: '', lidoEm: aberto.updatedAt }, deps))).toEqual({
      geral: E.mudou,
    });
    expect((await exame(T, exameId)).valores.map((v) => v.nome)).toEqual(['Glicemia de jejum', 'Ferritina']);
  });

  it('exame de outro paciente, de outro consultório ou excluído → "Exame não encontrado."; paciente bloqueado ou anonimizado → a recusa de hoje', async () => {
    const { T, p, exameId, aberto } = await cenario();
    const outro = await novoPaciente(app.db, T.ctx);
    const entrada = { titulo: 'Rotina', data: '2026-09-01', linhas: [...doGravado(aberto.valores), nova()], justificativa: '', lidoEm: aberto.updatedAt };
    expect(await erros(editarExame(T.ctx, fuso, outro.id, exameId, entrada, deps))).toEqual({ geral: MSG_EXAMES.erros.naoEncontrado });
    expect(await erros(editarExame(T.ctx, fuso, p.id, randomUUID(), entrada, deps))).toEqual({ geral: MSG_EXAMES.erros.naoEncontrado });
    const B = await novoTenant(app.db);
    await expect(editarExame(B.ctx, fuso, p.id, exameId, entrada, deps)).rejects.toThrow(); // PacienteNaoEncontradoError (RLS)
    await withTenant({ tenantId: T.tenantId, role: 'worker' }, (tx) => tx.update(patients).set({ status: 'bloqueado', bloqueadoEm: new Date(), anonimizarApos: '2046-01-01' }).where(eq(patients.id, p.id)), app.db);
    await expect(editarExame(T.ctx, fuso, p.id, exameId, entrada, deps)).rejects.toBeInstanceOf(PacienteBloqueadoError);
    const anon = await novoPaciente(app.db, T.ctx);
    const idAnon = await criarExame(T.ctx, T.tenant, anon.id, { titulo: 'R', data: '2026-09-01', valores: [], arquivo: null }, { db: app.db });
    const abertoAnon = (await exameParaEditar(T.ctx, anon.id, idAnon, deps))!;
    await withTenant({ tenantId: T.tenantId, role: 'worker' }, (tx) => tx.update(patients).set({ anonimizadoEm: new Date() }).where(eq(patients.id, anon.id)), app.db);
    await expect(editarExame(T.ctx, fuso, anon.id, idAnon, { ...entrada, titulo: 'R', lidoEm: abertoAnon.updatedAt }, deps)).rejects.toBeInstanceOf(PacienteBloqueadoError);
    expect(await versoes(T, exameId)).toEqual([]);
  });
});

describe('editarExame — a origem da IA só do servidor (RN-378)', () => {
  async function comLinhaDaIa() {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const quando = new Date('2026-09-02T12:00:00Z');
    const tarefa = await tarefaNoBanco(app.db, T.ctx, p.id, null, { status: 'aplicada', linhasAplicadas: 1, encerradoEm: quando, criadoEm: quando, saiuEm: quando });
    const [e] = await withTenant(
      T.ctx,
      (tx) =>
        tx
          .insert(exams)
          .values({ tenantId: T.tenantId, patientId: p.id, data: '2026-09-01', titulo: 'Laudo', valores: [{ nome: 'Glicose de jejum', valor: 92, unidade: 'mg/dL', referencia: '70 a 99', iaTarefaId: tarefa }] })
          .returning({ id: exams.id }),
      app.db,
    );
    return { T, p, tarefa, exameId: e.id, aberto: (await exameParaEditar(T.ctx, p.id, e.id, deps))! };
  }

  it('iaTarefaId forjado numa linha nova → ignorado (a linha nova nasce sem origem)', async () => {
    const { T, p, tarefa, exameId, aberto } = await comLinhaDaIa();
    const forjada = { ...nova(), iaTarefaId: tarefa } as LinhaEditada;
    await editarExame(T.ctx, fuso, p.id, exameId, { titulo: 'Laudo', data: '2026-09-01', linhas: [...doGravado(aberto.valores), forjada], justificativa: '', lidoEm: aberto.updatedAt }, deps);
    const [, nova1] = (await exame(T, exameId)).valores;
    expect(nova1).toEqual({ nome: 'Ferritina', valor: 80, unidade: 'ng/mL', referencia: null });
  });

  it('a linha da IA com nome e valor mudados no formulário é gravada com os originais (só faixa e referência mudam); a origem vem pelo índice', async () => {
    const { T, p, tarefa, exameId, aberto } = await comLinhaDaIa();
    const [l] = doGravado(aberto.valores);
    const mexida: LinhaEditada = { ...l, nome: 'Outro nome', valor: '999', unidade: 'mmol/L', referencia: '', refMin: '70', refMax: '110' };
    await editarExame(T.ctx, fuso, p.id, exameId, { titulo: 'Laudo', data: '2026-09-01', linhas: [mexida], justificativa: 'Faixa do laudo copiada', lidoEm: aberto.updatedAt }, deps);
    expect((await exame(T, exameId)).valores).toEqual([{ nome: 'Glicose de jejum', valor: 92, unidade: 'mg/dL', referencia: '70 a 110', iaTarefaId: tarefa, refMin: 70, refMax: 110 }]);
    expect((await versoes(T, exameId))[0].valores).toEqual(aberto.valores); // a versão guarda a linha inteira, com a origem
  });

  it('origem repetida, fora da lista ou forjada (texto, negativo) não copia a origem para outra linha', async () => {
    const { T, p, exameId, aberto } = await comLinhaDaIa();
    const [l] = doGravado(aberto.valores);
    const linhas: LinhaEditada[] = [l, { ...l, nome: 'Cópia', valor: '1' }, nova({ origem: 7 }), nova({ origem: -1, nome: 'Ferro' }), nova({ origem: '0' as unknown as number, nome: 'Zinco' })];
    await editarExame(T.ctx, fuso, p.id, exameId, { titulo: 'Laudo', data: '2026-09-01', linhas, justificativa: '', lidoEm: aberto.updatedAt }, deps);
    const valores = (await exame(T, exameId)).valores;
    expect(valores.filter((v) => v.iaTarefaId)).toHaveLength(1);
    expect(valores.map((v) => v.nome)).toEqual(['Glicose de jejum', 'Cópia', 'Ferritina', 'Ferro', 'Zinco']);
  });
});

describe('Review Focus 3 — editar × conferência da IA (concorrência)', () => {
  /** Espera alguma sessão ficar bloqueada pela sessão `pid` (até 10 s). */
  async function esperarBloqueadoPor(pid: number): Promise<void> {
    for (let i = 0; i < 200; i++) {
      const r = await dono.pool.query<{ n: number }>('select count(*)::int as n from pg_stat_activity where $1::int = any(pg_blocking_pids(pid))', [pid]);
      if (r.rows[0].n > 0) return;
      await new Promise((ok) => setTimeout(ok, 50));
    }
    throw new Error('a outra transação não chegou a esperar');
  }
  /** Abre uma transação, roda `antes` (as travas), avisa o pid e espera `soltar` para rodar `depois` (a escrita). */
  async function parada(ctx: TenantContext, antes: (tx: Tx) => Promise<unknown>, depois: (tx: Tx) => Promise<unknown>) {
    let soltar!: () => void;
    const solto = new Promise<void>((r) => (soltar = r));
    let avisar!: (pid: number) => void;
    const pid = new Promise<number>((r) => (avisar = r));
    const fim = withTenant(
      ctx,
      async (tx) => {
        await antes(tx);
        const r = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
        avisar(r.rows[0].pid);
        await solto;
        await depois(tx);
      },
      app.db,
    );
    return { pid: await pid, soltar, fim };
  }

  it('A abre a conferência (paciente e exame FOR UPDATE), B edita com o lidoEm antigo e espera; A confirma → B recebe "mudou" e nada grava', async () => {
    const { T, p, exameId, aberto } = await cenario();
    const A = await parada(
      T.ctx,
      async (tx) => {
        await tx.select().from(patients).where(eq(patients.id, p.id)).for('update');
        await tx.select().from(exams).where(eq(exams.id, exameId)).for('update');
      },
      (tx) =>
        tx
          .update(exams)
          .set({ valores: [...aberto.valores, { nome: 'Ferritina', valor: 80, unidade: 'ng/mL', referencia: null, iaTarefaId: randomUUID() }], updatedAt: new Date() })
          .where(eq(exams.id, exameId)),
    );
    const B = editarExame(T.ctx, fuso, p.id, exameId, { titulo: 'Rotina', data: '2026-09-01', linhas: [...doGravado(aberto.valores), nova({ nome: 'Vitamina D' })], justificativa: '', lidoEm: aberto.updatedAt }, deps).then(
      () => null,
      (e: unknown) => e,
    );
    await esperarBloqueadoPor(A.pid);
    A.soltar();
    await A.fim;
    const r = await B;
    expect(r).toBeInstanceOf(ExameError);
    expect((r as ExameError).erros).toEqual({ geral: E.mudou });
    expect((await exame(T, exameId)).valores.map((v) => v.nome)).toEqual(['Glicemia de jejum', 'Ferritina']);
    expect(await versoes(T, exameId)).toEqual([]);
  });

  it('com a conferência de verdade (aplicarSugestao) entre a abertura e o salvar → "mudou"', async () => {
    const T = await novoTenant(app.db);
    const p = await pacienteAutorizado(app.db, T.ctx);
    const exameId = await exameComLaudo(app.db, T.ctx, T.tenant, p.id, { dataDir, valores: [] });
    const resultado: ResultadoLeitura = { versao: 1, dataColeta: null, descartadas: 0, linhas: [{ nome: 'Glicose de jejum', valorTexto: '92', unidade: 'mg/dL', referencia: '70 a 99', pagina: 1 }] };
    const agora = new Date();
    const tarefa = await tarefaNoBanco(app.db, T.ctx, p.id, exameId, { status: 'pronta', resultado, expiraEm: new Date(agora.getTime() + 86_400_000) });
    const aberto = (await exameParaEditar(T.ctx, p.id, exameId, deps))!;
    await aplicarSugestao(T.ctx, fuso, p.id, tarefa, { linhas: [{ indice: 0, nome: 'Glicose de jejum', valor: '92', unidade: 'mg/dL', referencia: '70 a 99' }], usarData: false }, { db: app.db, agora, destino: 'teste' });
    expect(await erros(editarExame(T.ctx, fuso, p.id, exameId, { titulo: aberto.titulo, data: aberto.data, linhas: [nova()], justificativa: '', lidoEm: aberto.updatedAt }, deps))).toEqual({ geral: E.mudou });
  });
});

describe('versoesDoExame ("Versões anteriores", M8)', () => {
  it('grava um ler/exames_versoes e devolve o nome do autor ("Usuário removido" sem a conta), da mais nova para a mais antiga', async () => {
    const { T, p, exameId, aberto } = await cenario();
    await editarExame(T.ctx, fuso, p.id, exameId, { titulo: 'Rotina anual', data: '2026-09-01', linhas: doGravado(aberto.valores), justificativa: 'Título do laudo', lidoEm: aberto.updatedAt }, deps);
    const v = (await versoesDoExame(T.ctx, p.id, exameId, deps))!;
    expect(v.exame).toEqual({ titulo: 'Rotina anual', data: '2026-09-01' });
    expect(v.versoes).toEqual([
      { versao: 1, titulo: 'Rotina', data: '2026-09-01', valores: aberto.valores, justificativa: 'Título do laudo', por: 'Debby Silva', em: expect.any(Date) },
    ]);
    const log = await logDo(T, exameId);
    expect(log.filter((l) => l.acao === 'ler' && l.entidade === 'exames_versoes')).toEqual([{ acao: 'ler', entidade: 'exames_versoes', actor: T.nutriId, patientId: p.id }]);

    // a conta de quem alterou foi apagada: "Usuário removido"
    const outra = randomUUID();
    await app.db.insert(user).values({ id: outra, name: 'Assistente', email: `a-${outra.slice(0, 8)}@teste.dev`, appRole: 'nutri', tenantId: T.tenantId });
    const ctxOutra: TenantContext = { ...T.ctx, actorUserId: outra };
    const de2 = (await exameParaEditar(ctxOutra, p.id, exameId, deps))!;
    await editarExame(ctxOutra, fuso, p.id, exameId, { titulo: 'Rotina 2026', data: de2.data, linhas: doGravado(de2.valores), justificativa: 'Padronizar o título', lidoEm: de2.updatedAt }, deps);
    await app.db.delete(user).where(eq(user.id, outra));
    expect((await versoesDoExame(T.ctx, p.id, exameId, deps))!.versoes.map((x) => [x.versao, x.por])).toEqual([[2, 'Usuário removido'], [1, 'Debby Silva']]);
  });

  it('exame sem versão → lista vazia e nenhum ler/exames_versoes', async () => {
    const { T, p, exameId } = await cenario();
    expect(await versoesDoExame(T.ctx, p.id, exameId, deps)).toEqual({ exame: { titulo: 'Rotina', data: '2026-09-01' }, versoes: [] });
    expect((await logDo(T, exameId)).filter((l) => l.entidade === 'exames_versoes')).toEqual([]);
  });

  it('exame de outro paciente na URL → null e nenhum ler', async () => {
    const { T, p, exameId, aberto } = await cenario();
    await editarExame(T.ctx, fuso, p.id, exameId, { titulo: 'Outro título', data: '2026-09-01', linhas: doGravado(aberto.valores), justificativa: 'Título do laudo', lidoEm: aberto.updatedAt }, deps);
    const outro = await novoPaciente(app.db, T.ctx);
    const antes = (await logDo(T, exameId)).length;
    expect(await versoesDoExame(T.ctx, outro.id, exameId, deps)).toBeNull();
    expect(await versoesDoExame(T.ctx, p.id, 'nao-uuid', deps)).toBeNull();
    expect(await logDo(T, exameId)).toHaveLength(antes);
  });
});
