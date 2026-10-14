import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { pacienteAutorizado, prontuarioCompleto } from '../../../test/ia';
import { novoTenant } from '../../../test/pacientes';
import { consultations, patients } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { hojeNoFuso, idadeEm } from '@/modules/pacientes/datas';
import { CATEGORIAS_POR_USO } from './campos-enviados';
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
/** O que NUNCA pode sair (§5.4, A-D8, A-D17): campos do cadastro, ids, data de nascimento, faixa de referência, títulos, comentário. */
const proibidos = (p: { id: string; nome: string; email: string; telefoneE164: string | null }) => [
  p.id,
  'Marcadora',
  'Silvestre',
  p.email,
  '999990000',
  '1980-05-17',
  'MARCADOR-REFERENCIA',
  'MARCADOR-TITULO-EXAME',
  'MARCADOR-COMENTARIO',
  'MARCADOR-TITULO-PLANO',
];

describe('F2 (parecer 3.2 (ii)) / D8: o que sai bate com o texto da autorização', () => {
  it('resumo: só as categorias do uso, nada proibido, nenhum id do banco; notas só com a caixa', async () => {
    const { p, w } = await cenario();
    const sem = await withTenant(w, (tx) => montarPedidoDoResumo(tx, p, { notasPrivadas: false, agora, fuso }), app.db);
    const com = await withTenant(w, (tx) => montarPedidoDoResumo(tx, p, { notasPrivadas: true, agora, fuso }), app.db);
    const ids = await withTenant(w, (tx) => tx.select({ id: consultations.id }).from(consultations).where(eq(consultations.patientId, p.id)), app.db);
    for (const pedido of [sem, com]) {
      for (const k of Object.keys(pedido.dados)) expect(CATEGORIAS_POR_USO.resumo_historico).toContain(k);
      const json = JSON.stringify(pedido.dados);
      for (const x of proibidos(p)) expect(json, x).not.toContain(x);
      for (const { id } of ids) expect(json).not.toContain(id);
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
    const sem = await withTenant(w, (tx) => montarPedidoDoRascunho(tx, p, v.metas, { agora, fuso }), app.db);
    expect(Object.keys(sem.dados).sort()).toEqual(['idade', 'metas', 'sexo']);
    for (const x of proibidos(p)) expect(JSON.stringify(sem.dados), x).not.toContain(x);
    const com = await withTenant(w, (tx) => montarPedidoDoRascunho(tx, p, { ...v.metas, considerarAnamnese: true }, { agora, fuso }), app.db);
    expect(Object.keys(com.dados).sort()).toEqual(['anamnese', 'idade', 'metas', 'sexo']);
    for (const k of Object.keys(com.dados)) expect(CATEGORIAS_POR_USO.rascunho_plano).toContain(k);
    for (const x of proibidos(p)) expect(JSON.stringify(com.dados), x).not.toContain(x);
    expect(JSON.stringify(com.dados)).toContain('[removido] não come carne.');
    expect(JSON.stringify(com.dados)).toContain('[removido] trabalha à noite.');
    expect(com.bytes).toBe(Buffer.byteLength(JSON.stringify(com.dados), 'utf8'));
  });
});
