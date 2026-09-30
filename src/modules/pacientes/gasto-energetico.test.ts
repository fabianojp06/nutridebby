import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { auditLog } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { registrarAntropometria, entradaDoFormulario } from './antropometria';
import { MSG_CADASTRO_INCOMPLETO, PacienteNaoEncontradoError } from './base';
import { kcal } from './formulas';
import { GastoError, listarCalculos, medidasRecentes, MSG_GASTO, salvarCalculo } from './gasto-energetico';

const app = makeDb(inject('appDatabaseUrl'));
const now = new Date('2026-10-01T15:00:00Z');
const deps = { db: app.db, now };
afterAll(() => app.pool.end());

const erros = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof GastoError) return e.erros;
    throw e;
  }
  throw new Error('esperava GastoError');
};

describe('gasto energético (US-014, RN-14)', () => {
  it('"Mifflin-St Jeor": paciente F, 35 anos, última antropometria 60 kg / 165 cm, fator 1,55 → TMB 1295, GET 2008', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx); // F, 1991-03-10 → 35 anos em 01/10/2026
    await registrarAntropometria(T.ctx, T.tenant, p.id, entradaDoFormulario({ data: '2026-09-15', pesoKg: '60', alturaCm: '165', protocolo: 'nenhum' }), deps);
    expect(await medidasRecentes(T.ctx, p.id, app.db)).toEqual({ pesoKg: 60, alturaCm: 165 });
    const r = await salvarCalculo(T.ctx, T.tenant, p.id, { formula: 'mifflin', pesoKg: '60', alturaCm: '165', fator: '1,55' }, deps);
    expect(r).toMatchObject({ tmb: 1295, get: 2008 });
    const [c] = await listarCalculos(T.ctx, p.id, app.db);
    expect(c).toMatchObject({ id: r.id, formula: 'mifflin', idade: 35, sexo: 'F', fatorAtividade: 1.55, tmb: 1295.25, get: 2007.6375 }); // sem arredondar (6 casas)
    const log = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(eq(auditLog.entidadeId, r.id)), app.db);
    expect(log[0]).toMatchObject({ acao: 'criar', entidade: 'gasto_energetico', actorUserId: T.nutriId });
  });

  it('"Fator inválido": 3,0 → "Fator de atividade deve estar entre 1,00 e 2,50"; peso e fórmula também são conferidos', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    expect(await erros(salvarCalculo(T.ctx, T.tenant, p.id, { formula: 'mifflin', pesoKg: '60', alturaCm: '165', fator: '3,0' }, deps))).toEqual({
      fator: 'Fator de atividade deve estar entre 1,00 e 2,50',
    });
    // Review Focus 2 também no fator: lixo digitado vira a mensagem do campo, nunca NaN gravado
    for (const fator of ['1,5O', '', 'abc', '1,55 x']) {
      expect(await erros(salvarCalculo(T.ctx, T.tenant, p.id, { formula: 'mifflin', pesoKg: '60', alturaCm: '165', fator }, deps)), fator).toEqual({
        fator: 'Fator de atividade deve estar entre 1,00 e 2,50',
      });
    }
    expect(await erros(salvarCalculo(T.ctx, T.tenant, p.id, { formula: 'x', pesoKg: '0', alturaCm: '165', fator: '1,2' }, deps))).toEqual({
      formula: MSG_GASTO.formula,
      pesoKg: 'Peso deve estar entre 1 e 400 kg',
    });
    expect(await listarCalculos(T.ctx, p.id, app.db)).toEqual([]);
  });

  it('idade = anos completos na data do cálculo, no fuso do tenant', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx, { dataNascimento: '1991-10-02' }); // faz 35 em 02/10/2026
    await salvarCalculo(T.ctx, T.tenant, p.id, { formula: 'fao_oms', pesoKg: '60', alturaCm: '165', fator: '1' }, { db: app.db, now: new Date('2026-10-02T02:00:00Z') }); // 01/10 23h em SP
    await salvarCalculo(T.ctx, T.tenant, p.id, { formula: 'fao_oms', pesoKg: '60', alturaCm: '165', fator: '1' }, { db: app.db, now: new Date('2026-10-02T12:00:00Z') });
    expect((await listarCalculos(T.ctx, p.id, app.db)).map((c) => c.idade).sort()).toEqual([34, 35]);
  });

  it('cadastro incompleto não calcula; paciente de outro tenant = não encontrado', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const semCadastro = await novoPaciente(app.db, A.ctx, { origem: 'agendamento_publico', dataNascimento: null, sexo: null });
    expect(await erros(salvarCalculo(A.ctx, A.tenant, semCadastro.id, { formula: 'mifflin', pesoKg: '60', alturaCm: '165', fator: '1,2' }, deps))).toEqual({
      geral: MSG_CADASTRO_INCOMPLETO,
    });
    const deB = await novoPaciente(app.db, B.ctx);
    await expect(salvarCalculo(A.ctx, A.tenant, deB.id, { formula: 'mifflin', pesoKg: '60', alturaCm: '165', fator: '1,2' }, deps)).rejects.toBeInstanceOf(
      PacienteNaoEncontradoError,
    );
    expect(await medidasRecentes(A.ctx, deB.id, app.db)).toEqual({ pesoKg: null, alturaCm: null });
  });

  it('menor de 18 anos (ou nascimento no futuro) não calcula, sem erro de banco', async () => {
    const T = await novoTenant(app.db);
    const novo = await novoPaciente(app.db, T.ctx, { dataNascimento: '2010-01-01' });
    expect(await erros(salvarCalculo(T.ctx, T.tenant, novo.id, { formula: 'harris_benedict', pesoKg: '60', alturaCm: '165', fator: '1,2' }, deps))).toEqual({
      geral: MSG_GASTO.menor,
    });
    expect(await listarCalculos(T.ctx, novo.id, app.db)).toEqual([]);
  });

  it('kcal da resposta = kcal da lista para o mesmo cálculo (sem arredondamento duplo)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const r = await salvarCalculo(T.ctx, T.tenant, p.id, { formula: 'harris_benedict', pesoKg: '60,25', alturaCm: '165,5', fator: '1,4' }, deps);
    const [c] = await listarCalculos(T.ctx, p.id, app.db);
    expect(kcal(c.tmb)).toBe(r.tmb);
    expect(kcal(c.get)).toBe(r.get);
  });
});
