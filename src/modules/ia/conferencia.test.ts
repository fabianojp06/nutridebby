import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { novoTenant } from '../../../test/pacientes';
import { exameComLaudo, pacienteInformado, tarefaNoBanco } from '../../../test/ia';
import { auditLog, exams, iaTarefas, patients } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { PacienteBloqueadoError } from '@/modules/pacientes/base';
import { abrirSugestao, aplicarSugestao, ConferenciaError, descartarSugestao } from './conferencia';
import { MSG_IA } from './constantes';
import type { ResultadoLeitura } from './tipos';

const app = makeDb(inject('appDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-ia-conf-'));
afterAll(async () => {
  await app.pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});
const agora = new Date('2026-10-06T15:00:00Z');
const fuso = { fuso: 'America/Sao_Paulo' };
const RESULTADO: ResultadoLeitura = {
  versao: 1,
  dataColeta: '2026-08-28',
  descartadas: 1,
  linhas: [
    { nome: 'Glicose de jejum', valorTexto: '92', unidade: 'mg/dL', referencia: '70 a 99', pagina: 1 },
    { nome: 'Plaquetas', valorTexto: '250.000', unidade: '/mm³', referencia: null, pagina: 1 },
    { nome: 'HBsAg', valorTexto: 'Não reagente', unidade: null, referencia: null, pagina: 2 },
    { nome: 'Colesterol total', valorTexto: '190', unidade: 'mg/dL', referencia: null, pagina: 1 },
    { nome: 'Ferritina', valorTexto: '1.234,5', unidade: 'ng/mL', referencia: null, pagina: 1 },
  ],
};

async function pronta(o: { valores?: unknown[]; outrosExames?: unknown[][] } = {}) {
  const T = await novoTenant(app.db);
  const p = await pacienteInformado(app.db, T.ctx);
  for (const v of o.outrosExames ?? []) await exameComLaudo(app.db, T.ctx, T.tenant, p.id, { dataDir, valores: v, data: '2026-06-01' });
  const examId = await exameComLaudo(app.db, T.ctx, T.tenant, p.id, { dataDir, valores: o.valores ?? [] });
  const tarefaId = await tarefaNoBanco(app.db, T.ctx, p.id, examId, { status: 'pronta', resultado: RESULTADO, expiraEm: new Date(agora.getTime() + 86_400_000) });
  return { T, p, examId, tarefaId };
}
const exame = async (P: Awaited<ReturnType<typeof pronta>>) => (await withTenant(P.T.ctx, (tx) => tx.select().from(exams).where(eq(exams.id, P.examId)), app.db))[0];
const tarefa = async (P: Awaited<ReturnType<typeof pronta>>) => (await withTenant(P.T.ctx, (tx) => tx.select().from(iaTarefas).where(eq(iaTarefas.id, P.tarefaId)), app.db))[0];
const erros = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof ConferenciaError) return e.erros;
    throw e;
  }
  return null;
};
const linha = (indice: number, valor: string, extra: Record<string, unknown> = {}) => ({ indice, nome: RESULTADO.linhas[indice].nome, valor, unidade: RESULTADO.linhas[indice].unidade, referencia: RESULTADO.linhas[indice].referencia, ...extra });

describe('US-111 — abrir a sugestão', () => {
  it('linhas com o valor lido pelo sistema, ajuste de nome pela série, "já lançado", data da coleta; abrir é leitura auditada', async () => {
    const P = await pronta({ valores: [{ nome: 'Colesterol total', valor: '190', unidade: 'mg/dL', referencia: '' }], outrosExames: [[{ nome: 'Glicemia de jejum', valor: '88', unidade: 'mg/dL', referencia: '' }]] });
    const s = await abrirSugestao(P.T.ctx, P.p.id, P.tarefaId, { db: app.db, agora });
    expect(s).toMatchObject({ dataColeta: '2026-08-28', descartadas: 1, exame: { id: P.examId, quantidadeDeValores: 1, mime: 'application/pdf' } });
    const porNome = Object.fromEntries(s!.linhas.map((l) => [l.nomeLido, l]));
    expect(porNome['Glicose de jejum']).toMatchObject({ nomeSugerido: 'Glicemia de jejum', nomeAjustado: true, valor: { tipo: 'numero', valor: 92 } });
    expect(porNome['Plaquetas'].valor).toEqual({ tipo: 'ambiguo' });
    expect(porNome['HBsAg'].valor).toEqual({ tipo: 'nao_numerico' });
    expect(porNome['Colesterol total'].jaLancado).toBe(true);
    expect(porNome['Ferritina'].valor).toEqual({ tipo: 'numero', valor: 1234.5 });
    const [a] = await withTenant(P.T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.entidade, 'ia'), eq(auditLog.acao, 'ler'), eq(auditLog.entidadeId, P.tarefaId))), app.db);
    expect(a).toMatchObject({ patientId: P.p.id, actorUserId: P.T.nutriId });
  });

  it('vencida, de outro paciente ou já aplicada → null', async () => {
    const P = await pronta();
    expect(await abrirSugestao(P.T.ctx, P.p.id, P.tarefaId, { db: app.db, agora: new Date(agora.getTime() + 2 * 86_400_000) })).toBeNull();
    const outro = await pacienteInformado(app.db, P.T.ctx);
    expect(await abrirSugestao(P.T.ctx, outro.id, P.tarefaId, { db: app.db, agora })).toBeNull();
    await aplicarSugestao(P.T.ctx, fuso, P.p.id, P.tarefaId, { linhas: [linha(0, '92')], usarData: false }, { db: app.db, agora });
    expect(await abrirSugestao(P.T.ctx, P.p.id, P.tarefaId, { db: app.db, agora })).toBeNull();
  });
});

describe('US-111 / RN-114 — salvar os valores selecionados', () => {
  it('acrescenta DEPOIS dos existentes, com iaTarefaId; a tarefa fica "aplicada" com quem, quando e quantas linhas; a sugestão é esvaziada', async () => {
    const P = await pronta({ valores: [{ nome: 'Colesterol total', valor: '190', unidade: 'mg/dL', referencia: '' }] });
    const r = await aplicarSugestao(P.T.ctx, fuso, P.p.id, P.tarefaId, { linhas: [linha(0, '92', { nome: 'Glicemia de jejum' }), linha(4, '1234,5', { unidade: 'ng/mL' })], usarData: false }, { db: app.db, agora });
    expect(r).toEqual({ linhas: 2 });
    const e = await exame(P);
    expect(e.valores).toEqual([
      { nome: 'Colesterol total', valor: 190, unidade: 'mg/dL', referencia: null },
      { nome: 'Glicemia de jejum', valor: 92, unidade: 'mg/dL', referencia: '70 a 99', iaTarefaId: P.tarefaId },
      { nome: 'Ferritina', valor: 1234.5, unidade: 'ng/mL', referencia: null, iaTarefaId: P.tarefaId },
    ]);
    expect(e.data).toBe('2026-09-01');
    expect(await tarefa(P)).toMatchObject({ status: 'aplicada', resultado: null, encerradoPor: P.T.nutriId, encerradoEm: agora, linhasAplicadas: 2, exameDataAnterior: null });
    // a mesma sugestão de novo (outra aba): indisponível, nada muda
    expect(await erros(aplicarSugestao(P.T.ctx, fuso, P.p.id, P.tarefaId, { linhas: [linha(0, '92')], usarData: false }, { db: app.db, agora }))).toEqual({ geral: MSG_IA.indisponivelSugestao });
    expect((await exame(P)).valores).toHaveLength(3);
  });

  it('D10: ambíguo sem editar, editado para outro ambíguo ou não numérico → recusa por linha; nada é gravado', async () => {
    const P = await pronta();
    expect(await erros(aplicarSugestao(P.T.ctx, fuso, P.p.id, P.tarefaId, { linhas: [linha(1, '250.000'), linha(0, '92')], usarData: false }, { db: app.db, agora }))).toEqual({ 'valor-1': MSG_IA.ambiguo });
    expect(await erros(aplicarSugestao(P.T.ctx, fuso, P.p.id, P.tarefaId, { linhas: [linha(1, '7.500')], usarData: false }, { db: app.db, agora }))).toEqual({ 'valor-1': MSG_IA.ambiguo });
    expect(await erros(aplicarSugestao(P.T.ctx, fuso, P.p.id, P.tarefaId, { linhas: [linha(2, 'Não reagente')], usarData: false }, { db: app.db, agora }))).toEqual({ 'valor-2': MSG_IA.naoNumerico });
    expect((await exame(P)).valores).toEqual([]);
    await aplicarSugestao(P.T.ctx, fuso, P.p.id, P.tarefaId, { linhas: [linha(1, '250000'), linha(3, '0,0000001')], usarData: false }, { db: app.db, agora });
    expect((await exame(P)).valores).toMatchObject([{ nome: 'Plaquetas', valor: 250000 }, { nome: 'Colesterol total', valor: 1e-7 }]);
  });

  it('índice inexistente ou repetido → indisponível; nenhuma linha → "Marque ao menos uma linha"; nome vazio → erro da linha', async () => {
    const P = await pronta();
    expect(await erros(aplicarSugestao(P.T.ctx, fuso, P.p.id, P.tarefaId, { linhas: [linha(0, '92'), { ...linha(0, '92') }], usarData: false }, { db: app.db, agora }))).toEqual({ geral: MSG_IA.indisponivelSugestao });
    expect(await erros(aplicarSugestao(P.T.ctx, fuso, P.p.id, P.tarefaId, { linhas: [{ indice: 99, nome: 'X', valor: '1', unidade: null, referencia: null }], usarData: false }, { db: app.db, agora }))).toEqual({ geral: MSG_IA.indisponivelSugestao });
    expect(await erros(aplicarSugestao(P.T.ctx, fuso, P.p.id, P.tarefaId, { linhas: [], usarData: false }, { db: app.db, agora }))).toEqual({ geral: MSG_IA.nadaMarcado });
    expect(await erros(aplicarSugestao(P.T.ctx, fuso, P.p.id, P.tarefaId, { linhas: Array.from({ length: 151 }, () => linha(0, '92')), usarData: false }, { db: app.db, agora }))).toEqual({ geral: MSG_IA.indisponivelSugestao });
    expect(await erros(aplicarSugestao(P.T.ctx, fuso, P.p.id, P.tarefaId, { linhas: [linha(0, '92', { nome: '' })], usarData: false }, { db: app.db, agora }))).toMatchObject({ 'linha-0': expect.any(String) });
  });

  it('limite de 50 valores: "Desmarque {n} linhas."', async () => {
    const P = await pronta({ valores: Array.from({ length: 49 }, (_, i) => ({ nome: `M${i}`, valor: '1', unidade: '', referencia: '' })) });
    expect(await erros(aplicarSugestao(P.T.ctx, fuso, P.p.id, P.tarefaId, { linhas: [linha(0, '92'), linha(3, '190')], usarData: false }, { db: app.db, agora }))).toEqual({ geral: MSG_IA.limiteLinhas(1) });
  });

  it('"Usar esta data ao salvar": troca a data na mesma gravação e guarda a anterior na tarefa; data futura → recusa', async () => {
    const P = await pronta();
    await aplicarSugestao(P.T.ctx, fuso, P.p.id, P.tarefaId, { linhas: [linha(0, '92')], usarData: true }, { db: app.db, agora });
    expect((await exame(P)).data).toBe('2026-08-28');
    expect((await tarefa(P)).exameDataAnterior).toBe('2026-09-01');
    const F = await pronta();
    await withTenant(F.T.ctx, (tx) => tx.update(iaTarefas).set({ resultado: { ...RESULTADO, dataColeta: '2026-12-01' } }).where(eq(iaTarefas.id, F.tarefaId)), app.db);
    expect(await erros(aplicarSugestao(F.T.ctx, fuso, F.p.id, F.tarefaId, { linhas: [linha(0, '92')], usarData: true }, { db: app.db, agora }))).toEqual({ data: MSG_IA.dataInvalida });
  });

  it('paciente bloqueado entre abrir e salvar → PacienteBloqueadoError; vencida → indisponível', async () => {
    const P = await pronta();
    await withTenant(P.T.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado', bloqueadoEm: agora }).where(eq(patients.id, P.p.id)), app.db);
    await expect(aplicarSugestao(P.T.ctx, fuso, P.p.id, P.tarefaId, { linhas: [linha(0, '92')], usarData: false }, { db: app.db, agora })).rejects.toBeInstanceOf(PacienteBloqueadoError);
    const V = await pronta();
    expect(await erros(aplicarSugestao(V.T.ctx, fuso, V.p.id, V.tarefaId, { linhas: [linha(0, '92')], usarData: false }, { db: app.db, agora: new Date(agora.getTime() + 2 * 86_400_000) }))).toEqual({ geral: MSG_IA.indisponivelSugestao });
  });
});

describe('US-111 — descartar', () => {
  it('esvazia a sugestão, registra quem e quando; o exame não muda; a linha fica', async () => {
    const P = await pronta();
    expect(await descartarSugestao(P.T.ctx, P.p.id, P.tarefaId, { db: app.db, agora })).toBe(true);
    expect(await tarefa(P)).toMatchObject({ status: 'descartada', resultado: null, encerradoPor: P.T.nutriId, encerradoEm: agora });
    expect((await exame(P)).valores).toEqual([]);
    expect(await descartarSugestao(P.T.ctx, P.p.id, P.tarefaId, { db: app.db, agora })).toBe(false);
  });
});
