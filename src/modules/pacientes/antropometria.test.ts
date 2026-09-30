import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { anthropometry, auditLog } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { AntropometriaError, entradaDoFormulario, excluirAntropometria, listarAntropometrias, MSG_ANTROPO, registrarAntropometria } from './antropometria';
import { calcularGordura, dobrasNormalizadas } from './formulas';
import { MSG_CADASTRO_INCOMPLETO, PacienteBloqueadoError, PacienteNaoEncontradoError } from './base';

const app = makeDb(inject('appDatabaseUrl'));
const now = new Date('2026-10-01T15:00:00Z');
const deps = { db: app.db, now };
afterAll(() => app.pool.end());

const entrada = (v: Record<string, string>) => entradaDoFormulario({ data: '2026-09-01', pesoKg: '70', alturaCm: '175', protocolo: 'nenhum', ...v });
const erros = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof AntropometriaError) return e.erros;
    throw e;
  }
  throw new Error('esperava AntropometriaError');
};

describe('registrarAntropometria (US-013)', () => {
  it('"IMC automático": 70 kg e 175 cm → 22,86 (coluna gerada no banco); circunferências com 1 casa; auditoria "criar"', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const r = await registrarAntropometria(T.ctx, T.tenant, p.id, entrada({ circ_cintura: '80,25', circ_quadril: '98' }), deps);
    expect(r.aviso).toBeNull();
    const [a] = await listarAntropometrias(T.ctx, p.id, app.db);
    expect(a).toMatchObject({ id: r.id, pesoKg: 70, alturaCm: 175, imc: 22.86, protocolo: 'nenhum', percGordura: null, circunferencias: { cintura: 80.3, quadril: 98 } });
    const log = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(eq(auditLog.entidadeId, r.id)), app.db);
    expect(log[0]).toMatchObject({ acao: 'criar', entidade: 'antropometria', patientId: p.id, actorUserId: T.nutriId });
  });

  it('JP 3 dobras: homem 30 anos (15, 20, 15) → D 1,06432 e %G 15,08; mulher 35 anos (20, 20, 20) → %G 24,44', async () => {
    const T = await novoTenant(app.db);
    const homem = await novoPaciente(app.db, T.ctx, { sexo: 'M', dataNascimento: '1996-01-15' }); // 30 anos em 01/09/2026
    const r = await registrarAntropometria(T.ctx, T.tenant, homem.id, entrada({ protocolo: 'jp3', dobra_peitoral: '15', dobra_abdominal: '20', dobra_coxa: '15' }), deps);
    const [a] = await listarAntropometrias(T.ctx, homem.id, app.db);
    expect(a).toMatchObject({ id: r.id, densidade: 1.06432, percGordura: 15.08, dobrasMm: { peitoral: 15, abdominal: 20, coxa: 15 } });
    const mulher = await novoPaciente(app.db, T.ctx); // F, 1991-03-10 → 35 anos em 01/09/2026
    await registrarAntropometria(T.ctx, T.tenant, mulher.id, entrada({ protocolo: 'jp3', dobra_triceps: '20', dobra_suprailiaca: '20', dobra_coxa: '20' }), deps);
    expect((await listarAntropometrias(T.ctx, mulher.id, app.db))[0].percGordura).toBe(24.44);
  });

  it('"Dobra faltando": JP 7 sem a axilar média salva o resto, sem %G, com o aviso da spec', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const seis = { dobra_peitoral: '10', dobra_triceps: '12', dobra_subescapular: '14', dobra_abdominal: '20', dobra_suprailiaca: '15', dobra_coxa: '18' };
    const r = await registrarAntropometria(T.ctx, T.tenant, p.id, entrada({ protocolo: 'jp7', ...seis, circ_braco: '30' }), deps);
    expect(r.aviso).toBe('Preencha as 7 dobras para calcular o % de gordura');
    const [a] = await listarAntropometrias(T.ctx, p.id, app.db);
    expect(a).toMatchObject({ protocolo: 'jp7', percGordura: null, densidade: null, circunferencias: { braco: 30 } });
    expect(Object.keys(a.dobrasMm)).toHaveLength(6);
  });

  it('"Valor fora da faixa" e números digitados do jeito brasileiro (Review Focus 2)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    for (const pesoKg of ['0', '500', '', '7O', '70,5 kg']) {
      expect(await erros(registrarAntropometria(T.ctx, T.tenant, p.id, entrada({ pesoKg }), deps)), pesoKg).toEqual({ pesoKg: 'Peso deve estar entre 1 e 400 kg' });
    }
    expect(await erros(registrarAntropometria(T.ctx, T.tenant, p.id, entrada({ alturaCm: '20', circ_coxa: '2', dobra_coxa: '150' }), deps))).toEqual({
      alturaCm: MSG_ANTROPO.altura,
      circ_coxa: MSG_ANTROPO.circunferencia,
      dobra_coxa: MSG_ANTROPO.dobra,
    });
    expect(await erros(registrarAntropometria(T.ctx, T.tenant, p.id, entrada({ data: '2026-10-02' }), deps))).toEqual({ data: MSG_ANTROPO.futuro });
    expect(await listarAntropometrias(T.ctx, p.id, app.db)).toEqual([]); // nada foi salvo
    await registrarAntropometria(T.ctx, T.tenant, p.id, entrada({ pesoKg: ' 70,5 ', alturaCm: '175.0' }), deps);
    expect((await listarAntropometrias(T.ctx, p.id, app.db))[0]).toMatchObject({ pesoKg: 70.5, alturaCm: 175 });
  });

  it('cadastro sem nascimento/sexo (agendamento público) salva as medidas e avisa para completar o cadastro', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx, { origem: 'agendamento_publico', dataNascimento: null, sexo: null });
    const r = await registrarAntropometria(T.ctx, T.tenant, p.id, entrada({ protocolo: 'jp3', dobra_triceps: '20', dobra_suprailiaca: '20', dobra_coxa: '20' }), deps);
    expect(r.aviso).toBe(MSG_CADASTRO_INCOMPLETO);
  });

  it('paciente de outro tenant: "não encontrado" no serviço e FK composta no banco (Review Focus 4); bloqueado é só leitura', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const deB = await novoPaciente(app.db, B.ctx);
    await expect(registrarAntropometria(A.ctx, A.tenant, deB.id, entrada({}), deps)).rejects.toBeInstanceOf(PacienteNaoEncontradoError);
    const direto = withTenant(A.ctx, (tx) => tx.execute(sql`insert into anthropometry (tenant_id, patient_id, data, peso_kg, altura_cm) values (${A.tenantId}, ${deB.id}, '2026-09-01', 70, 175)`), app.db);
    await expect(direto).rejects.toSatisfy((e: unknown) => ((e as { cause?: { code?: string } }).cause ?? (e as { code?: string })).code === '23503');
    const bloqueado = await novoPaciente(app.db, A.ctx, { status: 'bloqueado' });
    await expect(registrarAntropometria(A.ctx, A.tenant, bloqueado.id, entrada({}), deps)).rejects.toBeInstanceOf(PacienteBloqueadoError);
  });

  it('lista da mais recente para a mais antiga (auditada) e exclui só do próprio paciente', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const outro = await novoPaciente(app.db, T.ctx);
    const antiga = await registrarAntropometria(T.ctx, T.tenant, p.id, entrada({ data: '2026-06-01' }), deps);
    const nova = await registrarAntropometria(T.ctx, T.tenant, p.id, entrada({ data: '2026-09-01', pesoKg: '68' }), deps);
    expect((await listarAntropometrias(T.ctx, p.id, app.db)).map((a) => a.id)).toEqual([nova.id, antiga.id]);
    const leitura = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(eq(auditLog.acao, 'ler')), app.db);
    expect(leitura.some((l) => l.entidade === 'antropometria' && l.patientId === p.id)).toBe(true);
    expect(await excluirAntropometria(T.ctx, outro.id, antiga.id, app.db)).toBe(false);
    expect(await excluirAntropometria(T.ctx, p.id, antiga.id, app.db)).toBe(true);
    expect(await withTenant(T.ctx, (tx) => tx.select().from(anthropometry).where(eq(anthropometry.patientId, p.id)), app.db)).toHaveLength(1);
  });
});

describe('correções da rodada 1', () => {
  it('%G é calculado com as dobras arredondadas a 1 casa (o mesmo que a prévia) e difere do cálculo com o valor cru', async () => {
    const T = await novoTenant(app.db);
    const homem = await novoPaciente(app.db, T.ctx, { sexo: 'M', dataNascimento: '1996-01-15' });
    const cru = { peitoral: 15.25, abdominal: 20.25, coxa: 15.25 };
    const r = await registrarAntropometria(T.ctx, T.tenant, homem.id, entrada({ protocolo: 'jp3', dobra_peitoral: '15,25', dobra_abdominal: '20,25', dobra_coxa: '15,25' }), deps);
    const [a] = await listarAntropometrias(T.ctx, homem.id, app.db);
    const arred = calcularGordura('jp3', 'M', 30, dobrasNormalizadas(cru));
    const bruto = calcularGordura('jp3', 'M', 30, cru);
    if (!arred.ok || !bruto.ok) throw new Error('esperava ok');
    expect(arred.percGordura).not.toBe(bruto.percGordura);
    expect(a).toMatchObject({ id: r.id, percGordura: arred.percGordura, dobrasMm: { peitoral: 15.3, abdominal: 20.3, coxa: 15.3 } });
  });

  it('data da avaliação anterior ao nascimento: erro no campo data e nada salvo (T7-R1)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx, { sexo: 'M', dataNascimento: '1996-01-15' });
    expect(await erros(registrarAntropometria(T.ctx, T.tenant, p.id, entrada({ data: '1996-01-14' }), deps))).toEqual({ data: 'A data não pode ser anterior à data de nascimento' });
    expect(await listarAntropometrias(T.ctx, p.id, app.db)).toEqual([]);
    await registrarAntropometria(T.ctx, T.tenant, p.id, entrada({ data: '1996-01-15' }), deps); // no dia do nascimento vale
  });

  it('calcularGordura rejeita idade não finita', () => {
    for (const idade of [Number.NaN, Number.POSITIVE_INFINITY]) expect(() => calcularGordura('jp3', 'M', idade, {})).toThrow(RangeError);
  });

  it('dobrasNormalizadas: fora de 1–100 mm vira ausente', () => {
    expect(dobrasNormalizadas({ coxa: 0.9, triceps: 100.5, peitoral: 1, abdominal: Number.NaN })).toEqual({ peitoral: 1 });
  });
});
