import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { and, count, eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { pacienteComConta } from '../../../test/portal';
import { auditLog } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { mostrarNoApp } from '@/modules/exames/edicao';
import { criarExame } from '@/modules/pacientes/exames';
import { examesLiberadosDoPaciente, temExameLiberado, temExameLiberadoNaTransacao } from './exames-liberados';

/**
 * Plano 22 (T6, US-375, RN-385, RN-386, CS-373; Review Focus 1 e 5): a RLS decide **quais exames** a sessão do paciente lê
 * (política `paciente_exame_liberado`); a projeção fechada decide **quais campos** (só id, data, título e, por linha, nome,
 * valor, unidade, referência e "fora"). Abrir com itens grava um `auditRead` (entidade `exames`); as perguntas de
 * existência não gravam nada.
 */
const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

const deps = { db: app.db, now: new Date('2026-09-02T12:00:00Z') };
type Linha = { nome: string; valor: string; unidade: string; referencia: string; refMin?: string; refMax?: string };
const lancar = (T: TenantDeTeste, patientId: string, titulo: string, data: string, valores: Linha[]) => criarExame(T.ctx, T.tenant, patientId, { titulo, data, valores, arquivo: null }, deps);
const leituras = (T: TenantDeTeste, patientId: string) =>
  withTenant(
    T.ctx,
    async (tx) => (await tx.select({ n: count() }).from(auditLog).where(and(eq(auditLog.patientId, patientId), eq(auditLog.acao, 'ler'), eq(auditLog.entidade, 'exames'))))[0].n,
    app.db,
  );

async function cenario() {
  const T = await novoTenant(app.db);
  const ana = await pacienteComConta(app.db, T);
  const bia = await pacienteComConta(app.db, T);
  return { T, ana: ana.paciente, ctxAna: ctxPaciente(T.tenantId, ana.paciente.id, ana.userId), bia: bia.paciente, ctxBia: ctxPaciente(T.tenantId, bia.paciente.id, bia.userId) };
}

describe('examesLiberadosDoPaciente (Plano 22, T6)', () => {
  it('a paciente com login vê só o exame liberado dela (nem o não liberado, nem o liberado de outra paciente)', async () => {
    const { T, ana, ctxAna, bia } = await cenario();
    const liberado = await lancar(T, ana.id, 'Rotina', '2026-09-01', [{ nome: 'Glicemia de jejum', valor: '95', unidade: 'mg/dL', referencia: '70 a 99' }]);
    await lancar(T, ana.id, 'Não liberado', '2026-08-01', [{ nome: 'Ferritina', valor: '20', unidade: 'ng/mL', referencia: '' }]);
    const daBia = await lancar(T, bia.id, 'Da Bia', '2026-09-01', [{ nome: 'TSH', valor: '2', unidade: 'mUI/L', referencia: '' }]);
    expect(await examesLiberadosDoPaciente(ctxAna, app.db)).toEqual([]);
    await mostrarNoApp(T.ctx, ana.id, liberado, { db: app.db });
    await mostrarNoApp(T.ctx, bia.id, daBia, { db: app.db });
    const r = await examesLiberadosDoPaciente(ctxAna, app.db);
    expect(r.map((e) => e.id)).toEqual([liberado]);
    expect(r[0]).toEqual({ id: liberado, data: '2026-09-01', titulo: 'Rotina', linhas: [{ nome: 'Glicemia de jejum', valor: 95, unidade: 'mg/dL', referencia: '70 a 99', fora: null }] }); // sem faixa numérica: sem "fora"
  });

  it('projeção fechada: as chaves exatas do exame e da linha — nunca iaTarefaId, laudo, nota, categoria nem as faixas', async () => {
    const { T, ana, ctxAna } = await cenario();
    const id = await lancar(T, ana.id, 'Rotina', '2026-09-01', [{ nome: 'Glicemia de jejum', valor: '95', unidade: 'mg/dL', referencia: '', refMin: '70', refMax: '99' }]);
    await mostrarNoApp(T.ctx, ana.id, id, { db: app.db });
    const [e] = await examesLiberadosDoPaciente(ctxAna, app.db);
    expect(Object.keys(e).sort()).toEqual(['data', 'id', 'linhas', 'titulo']);
    expect(Object.keys(e.linhas[0]).sort()).toEqual(['fora', 'nome', 'referencia', 'unidade', 'valor']);
  });

  it('"fora": true abaixo ou acima da faixa, false dentro; null sem faixa e quando a faixa e o texto da referência divergem (RN-385)', async () => {
    const { T, ana, ctxAna } = await cenario();
    const id = await lancar(T, ana.id, 'Painel', '2026-09-01', [
      { nome: 'Acima', valor: '120', unidade: 'mg/dL', referencia: '', refMin: '70', refMax: '99' },
      { nome: 'Abaixo', valor: '60', unidade: 'mg/dL', referencia: '', refMin: '70', refMax: '99' },
      { nome: 'Dentro', valor: '80', unidade: 'mg/dL', referencia: '', refMin: '70', refMax: '99' },
      { nome: 'Sem faixa', valor: '80', unidade: 'mg/dL', referencia: 'ver laudo' },
      // a faixa digitada (70–99) contradiz o texto do laudo (80 a 120): o app não diz "Fora da referência"
      { nome: 'Divergente', valor: '75', unidade: 'mg/dL', referencia: '80 a 120', refMin: '70', refMax: '99' },
    ]);
    await mostrarNoApp(T.ctx, ana.id, id, { db: app.db });
    const [e] = await examesLiberadosDoPaciente(ctxAna, app.db);
    expect(Object.fromEntries(e.linhas.map((l) => [l.nome, l.fora]))).toEqual({ Acima: true, Abaixo: true, Dentro: false, 'Sem faixa': null, Divergente: null });
  });

  it('auditRead (entidade `exames`, sem entidade_id) uma vez por abertura com itens; nenhuma sem itens', async () => {
    const { T, ana, ctxAna } = await cenario();
    const id = await lancar(T, ana.id, 'Rotina', '2026-09-01', [{ nome: 'Glicemia', valor: '95', unidade: 'mg/dL', referencia: '' }]);
    const antes = await leituras(T, ana.id);
    await examesLiberadosDoPaciente(ctxAna, app.db); // nada liberado: sem trilha
    expect(await leituras(T, ana.id)).toBe(antes);
    await mostrarNoApp(T.ctx, ana.id, id, { db: app.db });
    await examesLiberadosDoPaciente(ctxAna, app.db); // controle positivo: com item, uma linha
    expect(await leituras(T, ana.id)).toBe(antes + 1);
    const [linha] = await withTenant(
      T.ctx,
      (tx) => tx.select().from(auditLog).where(and(eq(auditLog.patientId, ana.id), eq(auditLog.acao, 'ler'), eq(auditLog.entidade, 'exames'))).orderBy(auditLog.criadoEm),
      app.db,
    );
    expect(linha).toMatchObject({ entidadeId: null, actorUserId: ctxAna.actorUserId });
  });

  it('temExameLiberado e temExameLiberadoNaTransacao: só existe/não existe, sem trilha (controle positivo pela abertura)', async () => {
    const { T, ana, ctxAna, bia } = await cenario();
    const id = await lancar(T, ana.id, 'Rotina', '2026-09-01', [{ nome: 'Glicemia', valor: '95', unidade: 'mg/dL', referencia: '' }]);
    const daBia = await lancar(T, bia.id, 'Da Bia', '2026-09-01', [{ nome: 'TSH', valor: '2', unidade: 'mUI/L', referencia: '' }]);
    await mostrarNoApp(T.ctx, bia.id, daBia, { db: app.db });
    expect(await temExameLiberado(ctxAna, app.db)).toBe(false); // o não liberado dela e o liberado da Bia não contam
    await mostrarNoApp(T.ctx, ana.id, id, { db: app.db });
    const antes = await leituras(T, ana.id);
    expect(await temExameLiberado(ctxAna, app.db)).toBe(true);
    expect(await withTenant(ctxAna, (tx) => temExameLiberadoNaTransacao(tx, ana.id), app.db)).toBe(true);
    expect(await leituras(T, ana.id)).toBe(antes);
    await examesLiberadosDoPaciente(ctxAna, app.db);
    expect(await leituras(T, ana.id)).toBe(antes + 1);
  });

  it('só em sessão de paciente: a sessão nutri recebe o erro de pacienteDaSessao', async () => {
    const T = await novoTenant(app.db);
    await expect(examesLiberadosDoPaciente(T.ctx, app.db)).rejects.toThrow(/sessão de paciente/);
    await expect(temExameLiberado(T.ctx, app.db)).rejects.toThrow(/sessão de paciente/);
  });

  it('o laudo fica fora do portal (EP-D22, DEP-E3): nenhuma fonte do portal lê o caminho do laudo de `exams` nem procura `stored_files` tipo `exame`', () => {
    // a política paciente_arquivos ainda deixa a sessão do paciente ler a linha de stored_files do laudo (só metadados);
    // a garantia é que nada do portal a lista nem assina a URL dela (decisão da T6, manual técnico cap. 05)
    const fontes = ['src/modules/portal', 'src/app/p', 'src/app/api/p']
      .flatMap((d) => readdirSync(path.resolve(d), { recursive: true, withFileTypes: true }).filter((f) => f.isFile() && /\.tsx?$/.test(f.name) && !/\.test\.tsx?$/.test(f.name)).map((f) => path.join(f.parentPath, f.name)));
    expect(fontes.length).toBeGreaterThan(20);
    const achados = fontes.filter((f) => /\bexams\.arquivoPath\b|storedFiles\.tipo,\s*'exame'|tipo\s*=\s*'exame'/.test(readFileSync(f, 'utf8')));
    expect(achados).toEqual([]);
    const codigo = readFileSync(path.resolve('src/modules/portal/exames-liberados.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(codigo).not.toMatch(/arquivoPath|arquivo_path|storedFiles|signFileUrl/);
  });
});
