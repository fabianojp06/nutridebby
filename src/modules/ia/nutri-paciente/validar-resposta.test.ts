import { describe, expect, it } from 'vitest';
import { validarSaida } from './validar-resposta';

const enviados = new Set(['#R1', '#I1', '#I2', '#S1', '#O1', '#A1']);
const saida = (o: object) => JSON.stringify({ categoria: 'plano', tipo_resposta: 'substituicao', fontes: ['#S1'], ...o });

describe('validarSaida (RN-175, D21 = a): o JSON fixo, sem texto livre', () => {
  it('plano + tipo + fontes enviadas e coerentes → ok', () =>
    expect(validarSaida(saida({}), { enviados, pergunta: 'o que posso comer no lugar da banana?' })).toEqual({ ok: true, tipo: 'substituicao', fontes: ['#S1'] }));

  it.each([
    ['campo fora do schema', saida({ resposta: 'pode comer' }), 'invalida_formato'],
    ['JSON quebrado', '{"categoria":', 'invalida_formato'],
    ['JSON que não é objeto', '["plano"]', 'invalida_formato'],
    ['fonte não enviada', saida({ fontes: ['#S9'] }), 'invalida_fonte'],
    ['mais de 4 fontes', saida({ tipo_resposta: 'quantidade', fontes: ['#I1', '#I2', '#S1', '#I1', '#I2'] }), 'invalida_fonte'],
    ['sem fonte', saida({ fontes: [] }), 'invalida_fonte'],
    ['fonte que não é texto', saida({ fontes: [1] }), 'invalida_fonte'],
    ['fonte que não combina com o tipo', saida({ fontes: ['#R1'] }), 'invalida_tipo'],
    ['tipo fora da lista', saida({ tipo_resposta: 'conselho' }), 'invalida_tipo'],
    ['"nenhum" em plano', saida({ tipo_resposta: 'nenhum' }), 'invalida_tipo'],
    ['categoria fora da lista', saida({ categoria: 'dieta' }), 'invalida_formato'],
  ])('%s → nao_encontrei (%s)', (_n, texto, motivo) =>
    expect(validarSaida(texto, { enviados, pergunta: 'o que posso comer no lugar da banana?' })).toEqual({ ok: false, categoria: null, textoFixo: 'nao_encontrei', motivo, risco: false }));

  it.each([
    ['fora_do_escopo', 'fora_do_escopo', false],
    ['mudanca_plano', 'mudanca_plano', false],
    ['sintoma_ou_exame', 'sintoma_ou_exame', false],
    ['suplemento_ou_remedio', 'suplemento_ou_remedio', false],
    ['peso_ou_dieta_restritiva', 'peso_ou_dieta_restritiva', false],
    ['risco', 'risco_transtorno', true],
  ])('categoria %s → texto fixo %s', (categoria, textoFixo, risco) =>
    expect(validarSaida(JSON.stringify({ categoria, tipo_resposta: 'nenhum', fontes: [] }), { enviados, pergunta: 'x' })).toEqual({ ok: false, categoria, textoFixo, motivo: null, risco }));

  it('"posso X se tenho Y" com o modelo dizendo plano → sintoma_ou_exame (condicao), nenhum trecho', () => {
    const esperado = { ok: false, categoria: 'sintoma_ou_exame', textoFixo: 'sintoma_ou_exame', motivo: 'condicao', risco: false };
    expect(validarSaida(saida({ tipo_resposta: 'quantidade', fontes: ['#I1'] }), { enviados, pergunta: 'posso comer o lanche da tarde mesmo com diarreia?' })).toEqual(esperado);
    expect(validarSaida(saida({ tipo_resposta: 'quantidade', fontes: ['#I1'] }), { enviados, pergunta: 'posso comer o almoço mesmo com dores no estômago?' })).toEqual(esperado);
    expect(validarSaida(saida({ tipo_resposta: 'quantidade', fontes: ['#I1'] }), { enviados, pergunta: 'faz mal comer banana com gastrite?' })).toEqual(esperado);
  });

  it('fontes repetidas saem uma vez, na ordem', () =>
    expect(validarSaida(saida({ tipo_resposta: 'quantidade', fontes: ['#I2', '#I1', '#I2'] }), { enviados, pergunta: 'quanto de arroz?' })).toEqual({ ok: true, tipo: 'quantidade', fontes: ['#I2', '#I1'] }));

  it('orientação aceita #O e #A; horário só #R', () => {
    expect(validarSaida(saida({ tipo_resposta: 'orientacao', fontes: ['#O1', '#A1'] }), { enviados, pergunta: 'o que ela disse sobre água?' })).toMatchObject({ ok: true });
    expect(validarSaida(saida({ tipo_resposta: 'horario', fontes: ['#I1'] }), { enviados, pergunta: 'que horas é o jantar?' })).toMatchObject({ ok: false, motivo: 'invalida_tipo' });
  });
});
