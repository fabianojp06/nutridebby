import { describe, expect, it } from 'vitest';
import { idTaco } from '@/modules/alimentos/taco';
import { AREAS_MODELOS_IA, TETO_PACOTE_MODELOS_USD, usdParaMicro } from '../constantes';
import { FERRAMENTAS_ALIMENTOS } from '../ferramentas-alimentos';
import { ESFORCO_MODELOS, SCHEMA_MODELOS, SISTEMA_MODELOS } from '../instrucoes/modelos';
import { custoMicroUsd } from '../precos';
import { ErroProvedor, finalOk, pedeFerramenta, provedorFake } from '../provedor-fake';
import type { RespostaGeracao, UsoTokens } from '../provedor';
import { avaliarAssistente } from './avaliar-assistente';
import { catalogoTaco } from './catalogo-taco';

// RN-127 (Plano 14B-1): só o provedor falso (o sandbox por trás dele) — nenhuma chamada à API real no CI.
const TETO_PACOTE = usdParaMicro(TETO_PACOTE_MODELOS_USD);
const base = { tarefas: ['modelos'] as const, modelo: 'claude-sonnet-5-5' as const, geo: 'us' as const, tetoRascunhoMicroUsd: 1_000_000 };

/** Um pacote "perfeito" com textos-marcador (o relatório não pode levar nenhum deles): busca → resposta final. */
function pacote(o: { orientacoes?: string; marcador?: string; uso?: UsoTokens } = {}): RespostaGeracao[] {
  const m = o.marcador ?? 'MARCADOR-TEXTO-9F2';
  const plano = (n: number) => ({
    titulo: `${m} plano ${n}`,
    meta_kcal: 1800,
    orientacoes: o.orientacoes ?? `${m} orientação`,
    refeicoes: [{ nome: `${m} café`, horario: '07:00', itens: [{ alimento: 'A1', gramas: 100, medida: null, substitui: null }] }],
  });
  return [
    pedeFerramenta('buscar_alimentos', { termo: 'arroz' }, undefined, o.uso),
    finalOk({
      planos: [plano(1), plano(2)],
      anamnese: { nome: `${m} anamnese`, perguntas: [{ tipo: 'texto_curto', rotulo: `${m} pergunta`, obrigatoria: false }] },
    }, o.uso),
  ];
}

describe('catalogoTaco (busca em memória da avaliação, D7)', () => {
  it('cada palavra no nome, sem acento e sem maiúsculas; até 20, do nome mais curto; ids da TACO; menos de 2 letras → nada', async () => {
    const buscar = catalogoTaco();
    const arroz = await buscar('ARROZ');
    expect(arroz.length).toBeGreaterThan(1);
    expect(arroz.length).toBeLessThanOrEqual(20);
    expect(arroz.every((a) => /arroz/i.test(a.nome) && a.origem === 'TACO' && /^00000000-0000-4000-8000-\d{12}$/.test(a.id))).toBe(true);
    for (let i = 1; i < arroz.length; i++) expect(arroz[i].nome.length).toBeGreaterThanOrEqual(arroz[i - 1].nome.length);
    // sem acento: "feijao" acha "Feijão"; todas as palavras precisam estar no nome
    const feijao = await buscar('feijao cozido');
    expect(feijao.length).toBeGreaterThan(0);
    expect(feijao.every((a) => /feij[ãa]o/i.test(a.nome) && /cozid/i.test(a.nome))).toBe(true);
    expect(await buscar('a')).toEqual([]);
    expect((await buscar('arroz'))[0].id).toBe(arroz[0].id);
    expect(arroz.map((a) => a.id)).toContain(idTaco(1)); // "Arroz, integral, cozido" é o 1º item da planilha
  });
});

describe('avaliarAssistente — RN-127, os 7 pacotes de área (só o fake)', () => {
  it('roda as 7 áreas com o mesmo pedido do worker (instruções, ferramentas, schema e esforço de produção)', async () => {
    const f = provedorFake(); // sem roteiro: o sandbox busca "arroz" e devolve o pacote com o alimento achado
    const r = await avaliarAssistente({ ...base, provedor: f, tetoMicroUsd: 10_000_000 });
    expect(r.parouPeloTeto).toBe(false);
    expect(r.modelos?.pacotes).toBe(AREAS_MODELOS_IA.length);
    expect(r.modelos).toMatchObject({ pacotesValidos: 7, planosValidos: 14, anamnesesValidas: 7, itensDescartados: 0, termosProibidos: 0, tetoPorPacoteMicroUsd: TETO_PACOTE });
    expect(r.modelos!.porArea.map((a) => a.area)).toEqual([...AREAS_MODELOS_IA]);
    expect(f.chamadas.gerar).toHaveLength(14); // 2 voltas por pacote
    for (const p of f.chamadas.gerar) {
      expect(p).toMatchObject({ finalidade: 'modelos', modelo: 'claude-sonnet-5-5', geo: 'us', sistema: SISTEMA_MODELOS, schema: SCHEMA_MODELOS, esforco: ESFORCO_MODELOS });
      expect(p.ferramentas).toBe(FERRAMENTAS_ALIMENTOS);
    }
    expect(r.gastoRealMicroUsd).toBeGreaterThan(0);
    expect(r.modelos!.custoMaximoMicroUsd).toBeLessThanOrEqual(TETO_PACOTE);
  });

  it('para ANTES do teto somado: o gasto real + o teto do próximo pacote nunca passa do teto da avaliação', async () => {
    // cada volta: 100 mil tokens de entrada e mil de saída (Sonnet 5.5, us: ≈ US$ 0,231); o pacote (2 voltas), ≈ US$ 0,462
    const uso: UsoTokens = { entrada: 100_000, cacheLeitura: 0, cacheGravacao: 0, saida: 1_000, geo: 'us' };
    const porPacote = 2 * custoMicroUsd('claude-sonnet-5-5', 'us', uso);
    const f = provedorFake({ gerar: AREAS_MODELOS_IA.flatMap(() => pacote({ uso })) });
    const tetoMicroUsd = Math.round(TETO_PACOTE * 2.5);
    const r = await avaliarAssistente({ ...base, provedor: f, tetoMicroUsd });
    // 4 pacotes (≈ US$ 1,85): o 5º poderia custar até US$ 1,00 e passaria dos US$ 2,50 — nem começa
    expect(r.parouPeloTeto).toBe(true);
    expect(r.modelos?.pacotes).toBe(4);
    expect(f.chamadas.gerar).toHaveLength(8);
    expect(r.gastoRealMicroUsd).toBe(4 * porPacote);
    expect(r.gastoRealMicroUsd + TETO_PACOTE).toBeGreaterThan(tetoMicroUsd);
    expect(r.gastoMaximoMicroUsd).toBe(4 * TETO_PACOTE);
    expect(r.modelos).toMatchObject({ custoMedioMicroUsd: porPacote, custoMaximoMicroUsd: porPacote, acimaDoTeto: 0, voltasMedia: 2, voltasMaximo: 2 });
    expect(r.modelos!.porArea.filter((a) => a.resultado === 'nao_rodou').map((a) => a.area)).toEqual(AREAS_MODELOS_IA.slice(4));
    // teto menor que um pacote: nada sai
    const nada = provedorFake();
    const r0 = await avaliarAssistente({ ...base, provedor: nada, tetoMicroUsd: TETO_PACOTE - 1 });
    expect(nada.chamadas.gerar).toHaveLength(0);
    expect(r0).toMatchObject({ parouPeloTeto: true, gastoRealMicroUsd: 0, gastoMaximoMicroUsd: 0 });
  });

  it('o relatório guarda só métricas: nenhum texto da resposta, nome de alimento ou termo buscado', async () => {
    const f = provedorFake({ gerar: AREAS_MODELOS_IA.flatMap(() => pacote()) });
    const r = await avaliarAssistente({ ...base, provedor: f, tetoMicroUsd: 10_000_000 });
    expect(r.modelos?.pacotesValidos).toBe(7);
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/MARCADOR-TEXTO-9F2|caf[ée]|orienta[çc][ãa]o|pergunta|arroz|integral|cozido/i);
    expect(json).not.toMatch(/00000000-0000-4000-8000/); // nem o id do alimento
  });

  it('RN-123: a contagem de termos proibidos acusa uma orientação com "suplemento de ferro"', async () => {
    const f = provedorFake({
      gerar: [...pacote({ orientacoes: 'Tome um suplemento de ferro todo dia.' }), ...AREAS_MODELOS_IA.slice(1).flatMap(() => pacote())],
    });
    const r = await avaliarAssistente({ ...base, provedor: f, tetoMicroUsd: 10_000_000 });
    // os 2 planos do 1º pacote têm a orientação: 2 ocorrências, só na 1ª área
    expect(r.modelos?.termosProibidos).toBe(2);
    expect(r.modelos!.porArea[0]).toMatchObject({ area: AREAS_MODELOS_IA[0], termosProibidos: 2 });
    expect(r.modelos!.porArea.slice(1).every((a) => a.termosProibidos === 0)).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/suplemento|ferro/i);
  });

  it('item inválido descartado e contado; pacote fora do formato, recusa e erro do provedor viram métricas, sem parar a avaliação', async () => {
    const comItemRuim = pacote();
    const final = JSON.parse((comItemRuim[1] as Extract<RespostaGeracao, { tipo: 'final' }>).texto);
    final.planos[0].refeicoes[0].itens.push({ alimento: 'A99', gramas: 100, medida: null, substitui: null }, { alimento: 'A1', gramas: 6000, medida: null, substitui: null });
    const f = provedorFake({
      gerar: [
        comItemRuim[0], finalOk(final),
        pedeFerramenta('buscar_alimentos', { termo: 'arroz' }), finalOk({ planos: [], anamnese: { nome: 'x', perguntas: [] } }),
        { tipo: 'recusa', categoria: 'cyber', bruto: [], uso: { entrada: 100, cacheLeitura: 0, cacheGravacao: 0, saida: 10, geo: 'us' }, requestId: null },
        new ErroProvedor('credencial', 401, null),
        new ErroProvedor('incerto', null, null),
      ],
    });
    const r = await avaliarAssistente({ ...base, provedor: f, tetoMicroUsd: 10_000_000 });
    const m = r.modelos!;
    expect(m.porArea.map((a) => a.resultado)).toEqual(['valido', 'invalido', 'parou', 'erro', 'erro', 'valido', 'valido']);
    expect(m.porArea[0]).toMatchObject({ itens: 4, descartados: 2 });
    expect(m.itensDescartados).toBe(2);
    expect(m.itens).toBe(8); // 4 da 1ª área (3 + 1) e 2 de cada uma das duas últimas
    expect(m.descartadosPct).toBe(0.25);
    expect(m.pacotesValidos).toBe(3);
    expect(m.recusas).toEqual({ cyber: 1 });
    expect(m.errosDoProvedor).toEqual({ credencial: 1, incerto: 1 });
    // resultado incerto: conta o teto do pacote inteiro (o provedor pode ter cobrado), para o total seguir abaixo do teto
    expect(r.gastoRealMicroUsd).toBeGreaterThanOrEqual(TETO_PACOTE);
  });

  it('resumo e rascunho ainda não estão disponíveis na 14B-1 (a T12 os acrescenta)', async () => {
    await expect(avaliarAssistente({ ...base, tarefas: ['resumo'], provedor: provedorFake(), tetoMicroUsd: 10_000_000 })).rejects.toThrow(/ainda não disponível/);
    await expect(avaliarAssistente({ ...base, tarefas: ['modelos', 'rascunho'], provedor: provedorFake(), tetoMicroUsd: 10_000_000 })).rejects.toThrow(/ainda não disponível/);
  });
});
