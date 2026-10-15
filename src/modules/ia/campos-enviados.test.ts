import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { pacienteAutorizado, prontuarioCompleto } from '../../../test/ia';
import { novoTenant } from '../../../test/pacientes';
import {
  anamneses,
  anthropometry,
  consultationNotes,
  consultations,
  diaryEntries,
  energyCalcs,
  exams,
  mealItems,
  mealPlans,
  meals,
  patients,
  storedFiles,
} from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { hojeNoFuso, idadeEm } from '@/modules/pacientes/datas';
import { CATEGORIAS, CATEGORIAS_DA_IA_NUTRI, CATEGORIAS_POR_USO, FRASE_DA_CATEGORIA, FRASE_DA_CATEGORIA_IA_NUTRI } from './campos-enviados';
import { montarPedidoDoRascunho, validarMetas } from './rascunho-dados';
import { montarPedidoDoResumo } from './resumo-dados';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
const agora = new Date();
const fuso = 'America/Sao_Paulo';

async function cenario() {
  const T = await novoTenant(app.db);
  const p = await pacienteAutorizado(app.db, T.ctx, { nome: 'Marcadora Silvestre', email: 'marcadora@teste.dev', telefoneE164: '+5511999990000', dataNascimento: '1980-05-17', sexo: 'F' });
  await prontuarioCompleto(app.db, T.ctx, p.id);
  const w = { tenantId: T.tenantId, role: 'worker' as const };
  const [pp] = await withTenant(w, (tx) => tx.select().from(patients).where(eq(patients.id, p.id)), app.db);
  return { T, p: pp, w };
}
/**
 * O que NUNCA pode sair (§5.4, A-D8, A-D17, D8 (c)): campos do cadastro, ids, data de nascimento, faixa de referência,
 * títulos, comentário, caminhos de arquivo (laudo, foto e original do diário: levam o tenant e um uuid) e a cópia da
 * refeição do plano no diário.
 */
const proibidos = (p: { id: string; tenantId: string; nome: string; email: string; telefoneE164: string | null }) => [
  p.id,
  p.tenantId,
  'Marcadora',
  'Silvestre',
  p.email,
  '999990000',
  '1980-05-17',
  'MARCADOR-REFERENCIA',
  'MARCADOR-TITULO-EXAME',
  'MARCADOR-COMENTARIO',
  'MARCADOR-TITULO-PLANO',
  'MARCADOR-LAUDO',
  'MARCADOR-FOTO',
  'MARCADOR-REFEICAO-PLANO',
  '/exame/',
  '/diario_foto',
];

/**
 * D8 (c): todo id do banco do prontuário do paciente — de cada tabela que a montagem lê (atendimentos, notas, medidas,
 * cálculos, exames, anamnese, diário, plano, refeições e itens), os alimentos do catálogo (`food_id`), as perguntas da
 * anamnese (chaves das respostas) e as linhas e os caminhos de `stored_files`. Nenhum pode aparecer no JSON.
 */
async function idsDoProntuario(w: TenantContext, patientId: string): Promise<string[]> {
  return withTenant(
    w,
    async (tx) => {
      const ids = (rs: { id: string }[]) => rs.map((r) => r.id);
      const ana = await tx.select().from(anamneses).where(eq(anamneses.patientId, patientId));
      const its = await tx.select().from(mealItems).where(eq(mealItems.patientId, patientId));
      const arqs = await tx.select().from(storedFiles).where(eq(storedFiles.patientId, patientId));
      const todos = [
        ...ids(await tx.select({ id: consultations.id }).from(consultations).where(eq(consultations.patientId, patientId))),
        ...ids(await tx.select({ id: consultationNotes.id }).from(consultationNotes).where(eq(consultationNotes.patientId, patientId))),
        ...ids(await tx.select({ id: anthropometry.id }).from(anthropometry).where(eq(anthropometry.patientId, patientId))),
        ...ids(await tx.select({ id: energyCalcs.id }).from(energyCalcs).where(eq(energyCalcs.patientId, patientId))),
        ...ids(await tx.select({ id: exams.id }).from(exams).where(eq(exams.patientId, patientId))),
        ...ids(await tx.select({ id: diaryEntries.id }).from(diaryEntries).where(eq(diaryEntries.patientId, patientId))),
        ...ids(await tx.select({ id: mealPlans.id }).from(mealPlans).where(eq(mealPlans.patientId, patientId))),
        ...ids(await tx.select({ id: meals.id }).from(meals).where(eq(meals.patientId, patientId))),
        ...ids(ana),
        ...ana.flatMap((a) => [...a.templateSnapshot.perguntas.map((q) => q.id), ...Object.keys(a.respostas)]),
        ...ids(its),
        ...its.map((i) => i.foodId),
        ...ids(arqs),
        ...arqs.map((a) => a.caminho),
      ];
      const unicos = [...new Set(todos)];
      // o cenário tem de ter cada fonte (senão a guarda passaria em vazio): 4 atendimentos, 4 notas, 6 medidas, 3 cálculos,
      // 2 exames, 3 registros do diário, 1 plano, 1 refeição, 1 anamnese, 2 perguntas, 1 item, 1 alimento, 3 arquivos e 3 caminhos
      expect(unicos).toHaveLength(35);
      return unicos;
    },
    app.db,
  );
}

describe('F2 (parecer 3.2 (ii)) / D8: o que sai bate com o texto da autorização', () => {
  it('resumo: só as categorias do uso, nada proibido, nenhum id do banco; notas só com a caixa', async () => {
    const { p, w } = await cenario();
    const sem = await withTenant(w, (tx) => montarPedidoDoResumo(tx, p, { notasPrivadas: false, agora, fuso }), app.db);
    const com = await withTenant(w, (tx) => montarPedidoDoResumo(tx, p, { notasPrivadas: true, agora, fuso }), app.db);
    const ids = await idsDoProntuario(w, p.id);
    for (const pedido of [sem, com]) {
      for (const k of Object.keys(pedido.dados)) expect(CATEGORIAS_POR_USO.resumo_historico).toContain(k);
      const json = JSON.stringify(pedido.dados);
      for (const x of proibidos(p)) expect(json, x).not.toContain(x);
      for (const id of ids) expect(json, id).not.toContain(id);
      // o registro do diário com foto e a resposta ao plano está no pedido (sem a foto nem a refeição copiada), e o exame com laudo também
      expect((pedido.dados.diario as { resposta: string | null }[]).map((d) => d.resposta)).toContain('outra_coisa');
      expect(pedido.dados.exames).toHaveLength(2);
      expect(json).toContain('[removido]');
      expect(pedido.bytes).toBe(Buffer.byteLength(json, 'utf8'));
    }
    expect(sem.dados).not.toHaveProperty('notas');
    expect(JSON.stringify(sem.dados)).not.toContain('MARCADOR-NOTA');
    expect(com.dados.notas).toHaveLength(4);
    expect(JSON.stringify(com.dados.notas)).toContain('MARCADOR-NOTA 0: [removido] comenta ansiedade.');
    expect(sem.dados.idade).toBe(idadeEm('1980-05-17', hojeNoFuso(fuso, agora)));
    expect(sem.dados.sexo).toBe('F');
    expect(sem.carimbo).toMatch(/^[0-9a-f]{64}$/);
    expect(sem.carimbo).not.toBe(com.carimbo); // a escolha das notas entra no carimbo (D11)
    // o mesmo prontuário, montado de novo, dá o mesmo carimbo (RN-120 "Reaproveitar")
    const de_novo = await withTenant(w, (tx) => montarPedidoDoResumo(tx, p, { notasPrivadas: false, agora, fuso }), app.db);
    expect(de_novo.carimbo).toBe(sem.carimbo);
  });

  it('resumo: quantidades da RN-120 / D10 (10 medidas, 3 cálculos, 10 exames, 1 anamnese, 10 atendimentos, diário de 30 dias)', async () => {
    const { p, w } = await cenario();
    const r = await withTenant(w, (tx) => montarPedidoDoResumo(tx, p, { notasPrivadas: false, agora, fuso }), app.db);
    const d = r.dados as Record<string, unknown[]>;
    expect(d.medidas).toHaveLength(6);
    expect(d.gasto).toHaveLength(3);
    expect(d.exames).toHaveLength(2);
    expect(d.orientacoes).toHaveLength(4);
    expect(d.diario).toHaveLength(2); // o de 40 dias fica fora
    expect(r.fontes.map((f) => f.indice)).toEqual(r.fontes.map((_, i) => `#${i + 1}`));
    expect(r.fontes.find((f) => f.rotulo === 'antropometria de 01/04/2026')).toBeTruthy();
    expect(r.tabela.find((l) => l.rotulo === 'Peso')?.texto).toMatch(/^82,4 kg em 01\/04\/2026 → 78,9 kg em 01\/09\/2026 \(−3,5 kg\)$/);
    expect(r.tabela.find((l) => l.rotulo === 'Glicose')?.texto).toBe('110 mg/dL em 01/06/2026 → 98 mg/dL em 01/09/2026 (−12 mg/dL)');
    expect(r.vazio).toBe(false);
  });

  it('resumo: mudar um registro usado muda o carimbo; lançar o mesmo prontuário em outro paciente não mexe no deste (D11)', async () => {
    const { T, p, w } = await cenario();
    const antes = await withTenant(w, (tx) => montarPedidoDoResumo(tx, p, { notasPrivadas: false, agora, fuso }), app.db);
    const outro = await pacienteAutorizado(app.db, T.ctx);
    await prontuarioCompleto(app.db, T.ctx, outro.id);
    const igual = await withTenant(w, (tx) => montarPedidoDoResumo(tx, p, { notasPrivadas: false, agora, fuso }), app.db);
    expect(igual.carimbo).toBe(antes.carimbo);
    await withTenant(w, (tx) => tx.update(consultations).set({ orientacoesPaciente: 'Beber água.', updatedAt: new Date() }).where(eq(consultations.patientId, p.id)), app.db);
    const depois = await withTenant(w, (tx) => montarPedidoDoResumo(tx, p, { notasPrivadas: false, agora, fuso }), app.db);
    expect(depois.carimbo).not.toBe(antes.carimbo);
  });

  it('prontuário vazio → vazio (US-120 "Prontuário vazio")', async () => {
    const T = await novoTenant(app.db);
    const p = await pacienteAutorizado(app.db, T.ctx);
    const r = await withTenant({ tenantId: T.tenantId, role: 'worker' }, (tx) => montarPedidoDoResumo(tx, p, { notasPrivadas: true, agora, fuso }), app.db);
    expect(r.vazio).toBe(true);
    expect(r.fontes).toEqual([]);
    expect(r.tabela).toEqual([]);
  });

  it('rascunho: só idade, sexo, metas e — com a caixa — a anamnese; restrições mascaradas', async () => {
    const { p, w } = await cenario();
    const v = validarMetas({ metaKcal: '1800', proteinaPct: '20', carboidratoPct: '50', lipidioPct: '30', refeicoes: [{ nome: 'Almoço', horario: '12:00' }], restricoes: 'Marcadora não come carne.', considerarAnamnese: false });
    if (!v.ok) throw new Error('metas');
    const ids = await idsDoProntuario(w, p.id);
    const sem = await withTenant(w, (tx) => montarPedidoDoRascunho(tx, p, v.metas, { agora, fuso }), app.db);
    expect(Object.keys(sem.dados).sort()).toEqual(['idade', 'metas', 'sexo']);
    for (const x of proibidos(p)) expect(JSON.stringify(sem.dados), x).not.toContain(x);
    for (const id of ids) expect(JSON.stringify(sem.dados), id).not.toContain(id);
    const com = await withTenant(w, (tx) => montarPedidoDoRascunho(tx, p, { ...v.metas, considerarAnamnese: true }, { agora, fuso }), app.db);
    expect(Object.keys(com.dados).sort()).toEqual(['anamnese', 'idade', 'metas', 'sexo']);
    for (const k of Object.keys(com.dados)) expect(CATEGORIAS_POR_USO.rascunho_plano).toContain(k);
    for (const x of proibidos(p)) expect(JSON.stringify(com.dados), x).not.toContain(x);
    for (const id of ids) expect(JSON.stringify(com.dados), id).not.toContain(id);
    expect(JSON.stringify(com.dados)).toContain('[removido] não come carne.');
    expect(JSON.stringify(com.dados)).toContain('[removido] trabalha à noite.');
    expect(com.bytes).toBe(Buffer.byteLength(JSON.stringify(com.dados), 'utf8'));
  });
});

describe('Plano 15 (§7.3): o contrato do que sai na conversa da IA Nutri', () => {
  it('CATEGORIAS_DA_IA_NUTRI é exatamente plano, orientações e perguntas, todas em CATEGORIAS', () => {
    expect(CATEGORIAS_DA_IA_NUTRI).toEqual(['plano', 'orientacoes', 'perguntas']);
    for (const c of CATEGORIAS_DA_IA_NUTRI) expect(CATEGORIAS).toContain(c);
    expect(Object.keys(FRASE_DA_CATEGORIA_IA_NUTRI).sort()).toEqual([...CATEGORIAS_DA_IA_NUTRI].sort());
  });
  it('CATEGORIAS_POR_USO da 14B não muda: "perguntas" não está em nenhum uso da nutricionista (a autorização 1.1 não muda)', () => {
    expect(CATEGORIAS_POR_USO).toEqual({
      resumo_historico: ['idade', 'sexo', 'medidas', 'gasto', 'exames', 'anamnese', 'orientacoes', 'plano', 'diario', 'notas'],
      rascunho_plano: ['idade', 'sexo', 'anamnese', 'metas'],
    });
    expect(Object.values(CATEGORIAS_POR_USO).flat()).not.toContain('perguntas');
    expect(FRASE_DA_CATEGORIA.perguntas).toBe(FRASE_DA_CATEGORIA_IA_NUTRI.perguntas);
  });
});
