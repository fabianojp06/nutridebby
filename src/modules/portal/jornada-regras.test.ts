import { describe, expect, it } from 'vitest';
import { medidasDaAvaliacao, miniJornada, montarJornada, MSG_JORNADA, type AvaliacaoDaJornada } from './jornada-regras';

const SP = 'America/Sao_Paulo';
const AGORA = new Date('2026-10-08T14:05:00Z');
const AMANHA_14H = new Date('2026-10-09T17:00:00Z');
const av = (id: string, data: string, consultationId: string | null, pesoKg: number | null, cintura: number, imc: number | null = null): AvaliacaoDaJornada => ({
  id,
  data,
  consultationId,
  pesoKg,
  imc,
  percGordura: 25.5,
  circunferencias: { cintura },
});
const ATENDIMENTOS = [
  { id: 'c3', data: '2026-09-22', orientacao: 'Manter as frutas no lanche.' },
  { id: 'c2', data: '2026-07-15', orientacao: null },
  { id: 'c1', data: '2026-03-18', orientacao: 'Beber 2 litros de água.' },
];
const AVALIACOES = [av('a3', '2026-09-22', 'c3', 78.6, 86, 27.2), av('a4', '2026-05-27', null, 80.9, 90), av('a2', '2026-07-15', 'c2', 79.7, 88), av('a1', '2026-03-18', 'c1', 82.8, 92)];

describe('Jornada (US-194, RN-202, RN-203, RN-206)', () => {
  it('título desde o mês da primeira consulta; marcos da próxima consulta para a primeira, com as medidas e a orientação dela', () => {
    const j = montarJornada({ atendimentos: ATENDIMENTOS, avaliacoes: AVALIACOES, proxima: { id: 'ap1', inicio: AMANHA_14H, modalidade: 'online' }, podeAgendar: true, percGordura: false, pesoOculto: false }, AGORA, SP);
    expect(j.titulo).toBe('Sua jornada desde março');
    expect(j.marcos.map((m) => (m.tipo === 'proxima' ? `próxima ${m.quando.semFuso}` : m.titulo))).toEqual([
      'próxima amanhã, 14:00',
      '22 de setembro',
      '15 de julho',
      'Medidas de 27 de maio',
      '18 de março',
    ]);
    expect(j.marcos[1]).toMatchObject({ tipo: 'atendimento', primeira: false, orientacao: 'Manter as frutas no lanche.', medidas: [{ id: 'peso', texto: '78,6 kg' }, { id: 'imc', texto: 'IMC 27,2' }, { id: 'circ_cintura', texto: 'cintura 86 cm' }] });
    expect(j.marcos[4]).toMatchObject({ tipo: 'atendimento', primeira: true });
    expect(j.marcos[0]).toMatchObject({ tipo: 'proxima', modalidade: 'Online.', quando: { comFuso: 'amanhã, 14:00 (horário de Brasília)' } });
    expect(j.grafico).toMatchObject({ id: 'peso', rotulo: 'Peso nas consultas', unidade: 'kg' });
    expect(j.grafico?.pontos.map((p) => p.valor)).toEqual([82.8, 80.9, 79.7, 78.6]);
    expect(j.vazia).toBe(false);
  });

  it('peso oculto (avaliações sem peso nem IMC, como o banco devolve): nenhum gráfico de medida corporal em destaque (G-D16 a); nenhuma medida em kg', () => {
    const semPeso = AVALIACOES.map((a) => ({ ...a, pesoKg: null, imc: null }));
    const j = montarJornada({ atendimentos: ATENDIMENTOS, avaliacoes: semPeso, proxima: null, podeAgendar: true, percGordura: false, pesoOculto: true }, AGORA, SP);
    expect(j.grafico).toBeNull();
    expect(JSON.stringify(j)).not.toMatch(/kg|IMC/);
  });

  it('duas avaliações no mesmo atendimento: o atendimento mostra a mais recente e a outra vira "Medidas de …"; nenhuma some (§4.5)', () => {
    // como o banco devolve: data desc, created_at desc (a refeita, 78,6 kg, vem antes da gravada por engano, 87,6 kg)
    const avaliacoes = [av('a3b', '2026-09-22', 'c3', 78.6, 86), av('a3a', '2026-09-22', 'c3', 87.6, 86), av('a2', '2026-07-15', 'c2', 79.7, 88), av('a1', '2026-03-18', 'c1', 82.8, 92)];
    const j = montarJornada({ atendimentos: ATENDIMENTOS, avaliacoes, proxima: null, podeAgendar: true, percGordura: false, pesoOculto: false }, AGORA, SP);
    expect(j.marcos.map((m) => (m.tipo === 'proxima' ? 'próxima' : m.titulo))).toEqual(['22 de setembro', 'Medidas de 22 de setembro', '15 de julho', '18 de março']);
    expect(j.marcos[0]).toMatchObject({ tipo: 'atendimento', medidas: [{ id: 'peso', texto: '78,6 kg' }, { id: 'circ_cintura', texto: 'cintura 86 cm' }] });
    expect(j.marcos[1]).toMatchObject({ tipo: 'medidas', medidas: [{ id: 'peso', texto: '87,6 kg' }, { id: 'circ_cintura', texto: 'cintura 86 cm' }] });
    // toda avaliação está em um marco, e só em um: os pesos dos marcos são os do gráfico
    const pesosDosMarcos = j.marcos.flatMap((m) => (m.tipo === 'proxima' ? [] : m.medidas.filter((x) => x.id === 'peso').map((x) => x.texto)));
    expect(pesosDosMarcos).toHaveLength(avaliacoes.length);
    expect([...pesosDosMarcos].sort()).toEqual(j.grafico!.pontos.map((p) => `${String(p.valor).replace('.', ',')} kg`).sort());
    // a avaliação de data maior vence mesmo fora da ordem da entrada
    const foraDeOrdem = [av('x1', '2026-09-20', 'c3', 80, 86), av('x2', '2026-09-22', 'c3', 79, 86)];
    const k = montarJornada({ atendimentos: ATENDIMENTOS, avaliacoes: foraDeOrdem, proxima: null, podeAgendar: true, percGordura: false, pesoOculto: false }, AGORA, SP);
    expect(k.marcos.find((m) => m.tipo === 'atendimento' && m.titulo === '22 de setembro')).toMatchObject({ medidas: [{ id: 'peso', texto: '79 kg' }, { id: 'circ_cintura', texto: 'cintura 86 cm' }] });
    expect(k.marcos.filter((m) => m.tipo === 'medidas').map((m) => m.titulo)).toEqual(['Medidas de 20 de setembro']);
  });

  it('peso visível com 1 peso e 2 cinturas: o gráfico vira "Cintura nas consultas" (§4.5)', () => {
    const avaliacoes = [av('a1', '2026-03-18', 'c1', 82.8, 92), av('a2', '2026-07-15', 'c2', null, 88)];
    const j = montarJornada({ atendimentos: ATENDIMENTOS, avaliacoes, proxima: null, podeAgendar: true, percGordura: false, pesoOculto: false }, AGORA, SP);
    expect(j.grafico).toMatchObject({ id: 'circ_cintura', rotulo: 'Cintura nas consultas', unidade: 'cm' });
    expect(j.grafico?.pontos.map((p) => p.valor)).toEqual([92, 88]);
  });

  it('% de gordura só com a opção do consultório; menos de 2 pesos e de 2 cinturas: sem gráfico e sem mensagem sobre o peso', () => {
    expect(medidasDaAvaliacao(AVALIACOES[0], { percGordura: true }).map((m) => m.texto)).toContain('% de gordura 25,5');
    expect(medidasDaAvaliacao(AVALIACOES[0], { percGordura: false }).map((m) => m.id)).not.toContain('perc_gordura');
    const j = montarJornada({ atendimentos: [], avaliacoes: [AVALIACOES[0]], proxima: null, podeAgendar: true, percGordura: false, pesoOculto: false }, AGORA, SP);
    expect(j.grafico).toBeNull();
  });

  it('peso oculto e avaliações só de peso e altura pela aba Antropometria (sem atendimento, sem circunferência): nenhum marco "Medidas de …" vazio (RN-214, §4.5)', () => {
    // como o banco devolve com o peso oculto: pesoKg e imc nulos, nenhuma circunferência
    const soPeso = (id: string, data: string, consultationId: string | null): AvaliacaoDaJornada => ({ id, data, consultationId, pesoKg: null, imc: null, percGordura: null, circunferencias: {} });
    const avaliacoes = [soPeso('a3', '2026-09-22', null), soPeso('a2', '2026-07-15', 'c2'), soPeso('a1', '2026-05-27', null)];
    const j = montarJornada({ atendimentos: ATENDIMENTOS, avaliacoes, proxima: null, podeAgendar: true, percGordura: false, pesoOculto: true }, AGORA, SP);
    expect(j.marcos.filter((m) => m.tipo === 'medidas')).toEqual([]);
    expect(JSON.stringify(j)).not.toContain('Medidas de');
    // os atendimentos ficam (data e orientação próprias), mesmo sem medida para mostrar
    expect(j.marcos.map((m) => (m.tipo === 'proxima' ? 'próxima' : m.titulo))).toEqual(['22 de setembro', '15 de julho', '18 de março']);
    expect(j.marcos[1]).toMatchObject({ tipo: 'atendimento', medidas: [] });
    // só com avaliações assim e sem atendimento: a Jornada fica vazia, como antes da primeira consulta
    expect(montarJornada({ atendimentos: [], avaliacoes, proxima: null, podeAgendar: true, percGordura: false, pesoOculto: true }, AGORA, SP).vazia).toBe(true);
  });

  it('ainda sem consulta: "Sua jornada", vazia', () => {
    expect(montarJornada({ atendimentos: [], avaliacoes: [], proxima: null, podeAgendar: true, percGordura: false, pesoOculto: false }, AGORA, SP)).toEqual({ titulo: 'Sua jornada', grafico: null, marcos: [], vazia: true, podeAgendar: true });
  });

  it('mini-jornada: variação com sinal e sem julgamento; o complemento só para leitor de tela (o nome acessível contém o texto visível, WCAG 2.5.3); com e sem a sigla do fuso', () => {
    const m = miniJornada({ pesos: [{ data: '2026-03-18', valor: 82.8 }, { data: '2026-09-22', valor: 78.6 }], atendimentos: 3, primeiroAtendimento: '2026-03-18', proxima: { inicio: AMANHA_14H }, podeAgendar: true }, AGORA, SP);
    expect(m.linha1).toBe('−4,2 kg desde março');
    expect(m.linha2).toEqual({ semFuso: 'Próximo marco: consulta amanhã, 14:00', comFuso: 'Próximo marco: consulta amanhã, 14:00 (horário de Brasília)' });
    expect(m.complemento).toBe('78,6 kg na última consulta');
    expect(m.pontos).toEqual([82.8, 78.6]);
    expect(miniJornada({ pesos: [{ data: '2026-03-18', valor: 80 }, { data: '2026-09-22', valor: 81.5 }], atendimentos: 2, primeiroAtendimento: '2026-03-18', proxima: null, podeAgendar: true }, AGORA, SP).complemento).toBe('81,5 kg na última consulta');
    expect(miniJornada({ pesos: [{ data: '2026-03-18', valor: 80 }, { data: '2026-09-22', valor: 80 }], atendimentos: 2, primeiroAtendimento: '2026-03-18', proxima: null, podeAgendar: true }, AGORA, SP).linha1).toBe('Sem mudança de peso desde março');
  });

  it('mini-jornada com o peso oculto (pesos vazios): número de consultas, nenhum valor; sem consulta: a jornada começa na primeira', () => {
    const oculto = miniJornada({ pesos: [], atendimentos: 3, primeiroAtendimento: '2026-03-18', proxima: { inicio: AMANHA_14H }, podeAgendar: true }, AGORA, SP);
    expect(oculto.linha1).toBe('3 consultas desde março');
    expect(oculto.complemento).toBeNull(); // nenhum peso, nem só para o leitor de tela
    expect(oculto.pontos).toEqual([]);
    const nova = miniJornada({ pesos: [], atendimentos: 0, primeiroAtendimento: null, proxima: null, podeAgendar: true }, AGORA, SP);
    expect(nova.linha1).toBe(MSG_JORNADA.comeca);
    expect(nova.complemento).toBeNull();
  });
});
