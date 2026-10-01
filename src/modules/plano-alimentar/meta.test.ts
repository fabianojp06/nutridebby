import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { idTaco } from '@/modules/alimentos/taco';
import { entradaDoFormulario, registrarAntropometria } from '@/modules/pacientes/antropometria';
import { salvarCalculo } from '@/modules/pacientes/gasto-energetico';
import { carregarPlano } from './carregar';
import { MSG_PLANO } from './constantes';
import { PlanoError } from './erros';
import { contextoDoPaciente } from './meta';
import { criarRascunho, salvarRascunho } from './rascunho';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
const deps = { db: app.db, now: new Date('2026-10-01T15:00:00Z') };
const corpo = (energyCalcId: string | null, metaKcal: string) => ({
  revisao: 0, titulo: 'Plano', metaKcal, energyCalcId, mostrarCalorias: false, orientacoes: '',
  refeicoes: [{ id: randomUUID(), nome: 'Almoço', horario: '12:00', observacao: '', itens: [{ id: randomUUID(), foodId: idTaco(3), quantidadeG: '100', medida: null, substituiItemId: null }] }],
});

describe('meta do plano a partir do gasto energético (US-014 → US-022) e peso para g/kg (D15)', () => {
  it('contexto traz o peso da última antropometria e os cálculos salvos (kcal inteiros)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    expect(await contextoDoPaciente(T.ctx, p.id, T.tenant.fuso, app.db)).toEqual({ pesoKg: null, calculos: [] });
    await registrarAntropometria(T.ctx, T.tenant, p.id, entradaDoFormulario({ data: '2026-09-15', pesoKg: '60', alturaCm: '165', protocolo: 'nenhum' }), deps);
    const c = await salvarCalculo(T.ctx, T.tenant, p.id, { formula: 'mifflin', pesoKg: '60', alturaCm: '165', fator: '1,55' }, deps);
    expect(await contextoDoPaciente(T.ctx, p.id, T.tenant.fuso, app.db)).toEqual({ pesoKg: 60, calculos: [{ id: c.id, rotulo: 'Mifflin-St Jeor · 01/10/2026 · 2008 kcal', kcal: 2008 }] });
  });

  it('o rótulo do cálculo usa a data no fuso do tenant: 01h UTC de 02/10 ainda é 01/10 em São Paulo (RN-06)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const c = await salvarCalculo(T.ctx, T.tenant, p.id, { formula: 'mifflin', pesoKg: '60', alturaCm: '165', fator: '1,55' }, { db: app.db, now: new Date('2026-10-02T01:00:00Z') });
    const { calculos } = await contextoDoPaciente(T.ctx, p.id, 'America/Sao_Paulo', app.db);
    expect(calculos).toEqual([{ id: c.id, rotulo: 'Mifflin-St Jeor · 01/10/2026 · 2008 kcal', kcal: 2008 }]);
    expect((await contextoDoPaciente(T.ctx, p.id, 'UTC', app.db)).calculos[0].rotulo).toContain('02/10/2026'); // mesmo instante, outro fuso
  });

  it('"Usar como meta do plano" grava a meta e o cálculo de origem; cálculo de outro paciente é recusado', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const outro = await novoPaciente(app.db, T.ctx, { email: `outro-${randomUUID()}@exemplo.com` });
    const c = await salvarCalculo(T.ctx, T.tenant, p.id, { formula: 'mifflin', pesoKg: '60', alturaCm: '165', fator: '1,55' }, deps);
    const cOutro = await salvarCalculo(T.ctx, T.tenant, outro.id, { formula: 'mifflin', pesoKg: '60', alturaCm: '165', fator: '1,55' }, deps);
    const { id } = await criarRascunho(T.ctx, p.id, deps);
    await expect(salvarRascunho(T.ctx, id, corpo(cOutro.id, '2008'), deps)).rejects.toEqual(new PlanoError({ metaKcal: MSG_PLANO.calculo }));
    await salvarRascunho(T.ctx, id, corpo(c.id, '2008'), deps);
    expect(await carregarPlano(T.ctx, id, app.db)).toMatchObject({ metaKcal: 2008, energyCalcId: c.id });
  });
});
