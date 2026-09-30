import { describe, expect, it } from 'vitest';
import { arredondar } from '@/lib/numero';
import {
  calcularGordura,
  compararTmb,
  densidadeJP,
  dobrasDoProtocolo,
  gastoTotal,
  imc,
  kcal,
  siri,
  tmb,
} from './formulas';

/** Apêndice A: "casos de teste unitário obrigatórios do cálculo (tolerância ±0,01)". */
const perto = (v: number, esperado: number) =>
  expect(Math.abs(v - esperado), `${v} ≠ ${esperado}`).toBeLessThanOrEqual(0.01);

describe('Apêndice A — casos obrigatórios', () => {
  it('IMC: 70 kg, 175 cm → 22,86', () => {
    perto(imc(70, 175), 22.86);
    expect(arredondar(imc(70, 175), 2)).toBe(22.86);
  });

  it('Harris-Benedict mulher 60 kg, 165 cm, 35 anos → 1370,47 pela fórmula da spec (exibido 1370; a spec escreve 1370,5/1371 — P-08)', () => {
    const v = tmb('harris_benedict', { sexo: 'F', pesoKg: 60, alturaCm: 165, idade: 35 });
    perto(v, 1370.47);
    expect(kcal(v)).toBe(1370);
    perto(tmb('harris_benedict', { sexo: 'M', pesoKg: 70, alturaCm: 175, idade: 30 }), 1701.85);
  });

  it('Mifflin-St Jeor: homem 70/175/30 → 1648,75; mulher 60/165/35 → 1295,25 (TMB 1295, GET × 1,55 = 2008)', () => {
    perto(tmb('mifflin', { sexo: 'M', pesoKg: 70, alturaCm: 175, idade: 30 }), 1648.75);
    const f = tmb('mifflin', { sexo: 'F', pesoKg: 60, alturaCm: 165, idade: 35 });
    perto(f, 1295.25);
    expect(kcal(f)).toBe(1295);
    // GET usa a TMB sem arredondar: 1295,25 × 1,55 = 2007,64 → 2008 (1295 × 1,55 daria 2007)
    expect(kcal(gastoTotal(f, 1.55))).toBe(2008);
  });

  it('meio exato vira para cima mesmo com erro de ponto flutuante (RN-14)', () => {
    // Mifflin homem 45 kg, 150 cm, 18 anos = 1302,5; × 1,40 = 1823,5 exato (JS: 1823,4999999999998)
    const t = tmb('mifflin', { sexo: 'M', pesoKg: 45, alturaCm: 150, idade: 18 });
    perto(t, 1302.5);
    expect(kcal(t)).toBe(1303);
    expect(gastoTotal(t, 1.4)).toBe(1823.5);
    expect(kcal(gastoTotal(t, 1.4))).toBe(1824);
    expect(kcal(gastoTotal(1075, 1.38))).toBe(1484); // JS: 1483,4999999999998
    expect(kcal(1823.4999999999998)).toBe(1824);
  });

  it('FAO/OMS: mulher 60 kg, 35 anos → 1351,0; faixas 18–29, 30–59 e 60+; não se aplica a menores (RN-17)', () => {
    perto(tmb('fao_oms', { sexo: 'F', pesoKg: 60, alturaCm: 165, idade: 35 }), 1351);
    perto(tmb('fao_oms', { sexo: 'F', pesoKg: 60, alturaCm: 165, idade: 29 }), 14.7 * 60 + 496);
    perto(tmb('fao_oms', { sexo: 'M', pesoKg: 70, alturaCm: 175, idade: 30 }), 11.6 * 70 + 879);
    perto(tmb('fao_oms', { sexo: 'M', pesoKg: 70, alturaCm: 175, idade: 60 }), 13.5 * 70 + 487);
    expect(() => tmb('fao_oms', { sexo: 'F', pesoKg: 60, alturaCm: 165, idade: 17 })).toThrow(
      RangeError,
    );
  });

  it('US-014 "Comparar fórmulas": Harris-Benedict 1370, Mifflin 1295, FAO/OMS 1351', () => {
    const r = compararTmb({ sexo: 'F', pesoKg: 60, alturaCm: 165, idade: 35 });
    expect({ hb: kcal(r.harris_benedict), mifflin: kcal(r.mifflin), fao: kcal(r.fao_oms) }).toEqual(
      { hb: 1370, mifflin: 1295, fao: 1351 },
    );
  });

  it('Jackson & Pollock 3 dobras + Siri: homem 30 anos, S = 50 → D 1,06432 e %G 15,08; mulher 35 anos, S = 60 → D 1,04333 e %G 24,44', () => {
    perto(densidadeJP('jp3', 'M', 50, 30), 1.06432);
    const m = calcularGordura('jp3', 'M', 30, { peitoral: 15, abdominal: 20, coxa: 15 });
    expect(m).toEqual({ ok: true, densidade: 1.06432, percGordura: 15.08 });
    const f = calcularGordura('jp3', 'F', 35, { triceps: 20, suprailiaca: 20, coxa: 20 });
    expect(f).toEqual({ ok: true, densidade: 1.04333, percGordura: 24.44 });
    // O %G sai da densidade sem arredondar: com 1,06432 arredondada daria 15,09
    perto(siri(1.064323), 15.08);
  });

  it('Jackson & Pollock 7 dobras (mesmas fórmulas da spec): homem 30, S = 100 → 14,63; mulher 35, S = 100 → 20,92', () => {
    const sete = (v: number) =>
      Object.fromEntries(
        dobrasDoProtocolo('jp7', 'M').map((d, i) => [
          d,
          i === 0 ? v - 6 * Math.floor(v / 7) : Math.floor(v / 7),
        ]),
      );
    expect(Object.values(sete(100)).reduce((a, b) => a + b, 0)).toBe(100);
    expect(calcularGordura('jp7', 'M', 30, sete(100))).toMatchObject({
      ok: true,
      percGordura: 14.63,
    });
    expect(calcularGordura('jp7', 'F', 35, sete(100))).toMatchObject({
      ok: true,
      percGordura: 20.92,
    });
  });

  it('dobras de cada protocolo e "Dobra faltando" (US-013)', () => {
    expect(dobrasDoProtocolo('jp3', 'M')).toEqual(['peitoral', 'abdominal', 'coxa']);
    expect(dobrasDoProtocolo('jp3', 'F')).toEqual(['triceps', 'suprailiaca', 'coxa']);
    expect(dobrasDoProtocolo('jp7', 'F')).toEqual([
      'peitoral',
      'axilar_media',
      'triceps',
      'subescapular',
      'abdominal',
      'suprailiaca',
      'coxa',
    ]);
    const semAxilar = {
      peitoral: 10,
      triceps: 10,
      subescapular: 10,
      abdominal: 10,
      suprailiaca: 10,
      coxa: 10,
    };
    expect(calcularGordura('jp7', 'F', 35, semAxilar)).toEqual({
      ok: false,
      faltando: ['axilar_media'],
    });
    expect(calcularGordura('jp3', 'M', 30, { peitoral: 15, abdominal: null, coxa: 15 })).toEqual({
      ok: false,
      faltando: ['abdominal'],
    });
  });
});

describe('endurecimento P03-06', () => {
  it('calcularGordura: dobra NaN, Infinity ou negativa conta como faltando', () => {
    for (const x of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(calcularGordura('jp3', 'M', 30, { peitoral: x, abdominal: 20, coxa: 15 }).ok).toBe(
        false,
      );
    }
  });
  it('tmb: idade não finita lança RangeError (não cai na faixa 60+ da FAO)', () => {
    for (const idade of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => tmb('fao_oms', { sexo: 'M', pesoKg: 70, alturaCm: 175, idade })).toThrow(
        RangeError,
      );
    }
  });
});
