import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { pacienteComConta } from '../../../test/portal';
import { auditLog, examesCatalogo, type FaixaDoConsultorio } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { criarExame } from '@/modules/pacientes/exames';
import { abrirExame } from './detalhe';
import { salvarNota } from './interpretacao';

/**
 * Plano 22 (T5a, US-372, RN-379 a RN-382, EP-D11 a EP-D17, EP-D62): o detalhe do exame — classificação neutra, categoria
 * das faixas do consultório (calculada na leitura, com o catálogo atual), as faixas do REF, o modelo de nota e a nota em
 * vigor. Leitura pelos dois ids (M8): sem linha → `null` e nenhum `auditRead`.
 */
const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await app.pool.end();
});
const deps = { db: app.db };

const DEFICIENCIA: FaixaDoConsultorio = {
  sexo: null,
  idadeMin: 18,
  idadeMax: 120,
  aPartirDe: null,
  abaixoDe: 20,
  categoria: 'Deficiência',
  fonte: 'Diretriz X, 2024',
  atualizadaEm: '2026-01-10',
};

async function comCatalogo(T: TenantDeTeste, faixas: FaixaDoConsultorio[] = [DEFICIENCIA]) {
  const [c] = await withTenant(
    T.ctx,
    (tx) =>
      tx
        .insert(examesCatalogo)
        .values({
          tenantId: T.tenantId,
          nome: '25-OH vitamina D',
          unidade: 'ng/mL',
          sinonimos: ['25-hidroxivitamina D', 'Vitamina D'],
          faixas,
          modeloNotaAbaixo: 'Investigar exposição solar e ingestão.',
        })
        .returning({ id: examesCatalogo.id }),
    app.db,
  );
  return c.id;
}

async function cenario(unidade = 'ng/mL', extraPaciente: Parameters<typeof novoPaciente>[2] = {}) {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx, extraPaciente);
  const exameId = await criarExame(
    T.ctx,
    T.tenant,
    p.id,
    {
      titulo: 'Rotina',
      data: '2026-09-01',
      valores: [
        { nome: 'Vitamina D', valor: '15', unidade, referencia: '30 a 100', refMin: '30', refMax: '100' },
        { nome: 'Ferritina', valor: '80', unidade: 'ng/mL', referencia: '' },
      ],
      arquivo: null,
    },
    { db: app.db, now: new Date('2026-09-02T12:00:00Z') },
  );
  return { T, p, exameId };
}
const leituras = (T: TenantDeTeste, exameId: string) =>
  withTenant(
    T.ctx,
    (tx) => tx.select({ entidade: auditLog.entidade, actor: auditLog.actorUserId, patientId: auditLog.patientId }).from(auditLog).where(and(eq(auditLog.entidadeId, exameId), eq(auditLog.acao, 'ler'))),
    app.db,
  );

describe('abrirExame (T5a, EP-D62)', () => {
  it('devolve a neutra, a categoria do cenário "Vitamina D" (outro nome do catálogo), as faixas do REF e o modelo de nota; grava um ler/exames com o id', async () => {
    const { T, p, exameId } = await cenario();
    await comCatalogo(T);
    const e = (await abrirExame(T.ctx, p.id, exameId, deps))!;
    expect(e).toMatchObject({ id: exameId, titulo: 'Rotina', data: '2026-09-01', temLaudo: false, noAppEm: null, pacienteUsaApp: false, nota: null });
    expect(typeof e.updatedAt).toBe('string');
    const [vit, fer] = e.linhas;
    expect(vit).toMatchObject({
      nome: 'Vitamina D',
      valor: 15,
      neutra: 'abaixo',
      categoria: { nome: 'Deficiência', faixa: DEFICIENCIA },
      faixasDoConsultorio: [DEFICIENCIA],
      unidadeDoCatalogo: 'ng/mL',
      modeloNota: { abaixo: 'Investigar exposição solar e ingestão.', acima: null },
    });
    // sem faixa do laudo e sem casamento: nada a classificar, sem REF do consultório
    expect(fer).toMatchObject({ nome: 'Ferritina', neutra: null, categoria: null, faixasDoConsultorio: [], modeloNota: null });
    expect(await leituras(T, exameId)).toEqual([{ entidade: 'exames', actor: T.nutriId, patientId: p.id }]);
  });

  it('a mesma linha em nmol/L: sem categoria (unidade diferente), mas as faixas do catálogo que casou continuam no REF', async () => {
    const { T, p, exameId } = await cenario('nmol/L');
    await comCatalogo(T);
    const [vit] = (await abrirExame(T.ctx, p.id, exameId, deps))!.linhas;
    expect(vit).toMatchObject({ neutra: 'abaixo', categoria: null, faixasDoConsultorio: [DEFICIENCIA], unidadeDoCatalogo: 'ng/mL' });
  });

  it('exame de outro paciente na URL (ou id malformado) → null e nenhum ler', async () => {
    const { T, exameId } = await cenario();
    const outro = await novoPaciente(app.db, T.ctx);
    expect(await abrirExame(T.ctx, outro.id, exameId, deps)).toBeNull();
    expect(await abrirExame(T.ctx, outro.id, 'nao-uuid', deps)).toBeNull();
    expect(await abrirExame(T.ctx, 'nao-uuid', exameId, deps)).toBeNull();
    expect(await leituras(T, exameId)).toEqual([]);
    const doOutro = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.patientId, outro.id), eq(auditLog.acao, 'ler'))), app.db);
    expect(doOutro).toEqual([]);
  });

  it('mudar a faixa do consultório muda a categoria mostrada num exame antigo (com a data da faixa)', async () => {
    const { T, p, exameId } = await cenario();
    const id = await comCatalogo(T);
    expect((await abrirExame(T.ctx, p.id, exameId, deps))!.linhas[0].categoria?.nome).toBe('Deficiência');
    const nova: FaixaDoConsultorio = { ...DEFICIENCIA, abaixoDe: 30, categoria: 'Insuficiente', atualizadaEm: '2026-10-05' };
    await withTenant(T.ctx, (tx) => tx.update(examesCatalogo).set({ faixas: [nova] }).where(eq(examesCatalogo.id, id)), app.db);
    const [vit] = (await abrirExame(T.ctx, p.id, exameId, deps))!.linhas;
    expect(vit.categoria).toEqual({ nome: 'Insuficiente', faixa: nova });
    expect(vit.faixasDoConsultorio[0].atualizadaEm).toBe('2026-10-05');
  });

  it('paciente sem sexo nem nascimento (página pública) → só a neutra', async () => {
    const { T, p, exameId } = await cenario('ng/mL', { origem: 'agendamento_publico', sexo: null, dataNascimento: null });
    await comCatalogo(T);
    const [vit] = (await abrirExame(T.ctx, p.id, exameId, deps))!.linhas;
    expect(vit).toMatchObject({ neutra: 'abaixo', categoria: null, faixasDoConsultorio: [DEFICIENCIA] });
  });

  it('nome ambíguo (casa com dois exames do catálogo) → sem categoria, sem faixas e sem modelo', async () => {
    const { T, p, exameId } = await cenario();
    await comCatalogo(T);
    // o módulo recusaria o outro nome repetido; direto no banco, para provar que a leitura não escolhe um
    await withTenant(T.ctx, (tx) => tx.insert(examesCatalogo).values({ tenantId: T.tenantId, nome: 'Vitamina D total', unidade: 'ng/mL', sinonimos: ['Vitamina D'], faixas: [DEFICIENCIA] }), app.db);
    const [vit] = (await abrirExame(T.ctx, p.id, exameId, deps))!.linhas;
    expect(vit).toMatchObject({ neutra: 'abaixo', categoria: null, faixasDoConsultorio: [], modeloNota: null, unidadeDoCatalogo: null });
  });

  it('a nota em vigor é a de maior versão; "pacienteUsaApp" pelo user_id do paciente', async () => {
    const { T, p, exameId } = await cenario();
    await salvarNota(T.ctx, p.id, exameId, 'Primeira nota.', deps);
    await salvarNota(T.ctx, p.id, exameId, 'Segunda nota.', deps);
    const e = (await abrirExame(T.ctx, p.id, exameId, deps))!;
    expect(e.nota).toEqual({ versao: 2, texto: 'Segunda nota.' });
    expect(e.pacienteUsaApp).toBe(false);
    const { paciente: comApp } = await pacienteComConta(app.db, T);
    const outroExame = await criarExame(T.ctx, T.tenant, comApp.id, { titulo: 'R', data: '2026-09-01', valores: [], arquivo: null }, { db: app.db });
    expect((await abrirExame(T.ctx, comApp.id, outroExame, deps))!.pacienteUsaApp).toBe(true);
  });

  it('sessão de paciente → erro do assert de papel, antes da transação', async () => {
    const { T, p, exameId } = await cenario();
    await expect(abrirExame(ctxPaciente(T.tenantId, p.id), p.id, exameId, deps)).rejects.toThrow('exames: só a sessão nutri');
  });
});
