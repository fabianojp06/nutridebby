import { describe, expect, it } from 'vitest';
import { idTaco } from '@/modules/alimentos/taco';
import { CATEGORIAS_POR_USO } from '../campos-enviados';
import { AREAS_MODELOS_IA, TETO_PACOTE_MODELOS_USD, usdParaMicro } from '../constantes';
import { FERRAMENTAS_ALIMENTOS } from '../ferramentas-alimentos';
import { ESFORCO_MODELOS, SCHEMA_MODELOS, SISTEMA_MODELOS } from '../instrucoes/modelos';
import { ESFORCO_RASCUNHO, instrucaoRascunho, SISTEMA_RASCUNHO } from '../instrucoes/rascunho';
import { ESFORCO_RESUMO, instrucaoResumo, SCHEMA_RESUMO, SISTEMA_RESUMO } from '../instrucoes/resumo';
import { SCHEMA_PLANO_IA } from '../plano-ia';
import { custoMicroUsd, MAX_TOKENS_RESUMO } from '../precos';
import { ErroProvedor, finalOk, pedeFerramenta, provedorFake } from '../provedor-fake';
import type { RespostaGeracao, UsoTokens } from '../provedor';
import { pedidoDoRascunho, validarMetas } from '../rascunho-dados';
import { avaliarAssistente } from './avaliar-assistente';
import { catalogoTaco } from './catalogo-taco';
import { gerarProntuariosFicticios, HOJE_DA_AVALIACAO, INJECAO_NO_DIARIO, PRONTUARIOS_FICTICIOS, type ProntuarioFicticio } from './prontuarios-ficticios';

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
});

// Plano 14B-2 (RN-127, CS-102, CS-104): os prontuários fictícios e a avaliação do resumo e do rascunho, só com o fake
const semAcento = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
/** O que identifica o paciente fictício: nome completo, primeiro nome (palavra inteira), e-mail e telefone. */
function identificadores(p: ProntuarioFicticio): RegExp[] {
  const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nome = semAcento(p.paciente.nome);
  return [new RegExp(esc(nome)), new RegExp(`(?<![\\p{L}])${esc(nome.split(' ')[0])}(?![\\p{L}])`, 'u'), new RegExp(esc(p.paciente.email!)), new RegExp(esc(p.paciente.telefone!.slice(3)))];
}
const dadosDoRascunho = (p: ProntuarioFicticio) => pedidoDoRascunho({ idade: p.dados.idade as number, sexo: p.dados.sexo as string }, p.paciente, p.metas, p.anamnese).dados;
const INJETADO = PRONTUARIOS_FICTICIOS.findIndex((p) => p.injecao);
const indicesDeExame = (p: ProntuarioFicticio) => p.fontes.filter((f) => f.rotulo.startsWith('exame de ')).map((f) => f.indice);
const baseResumo = { ...base, tarefas: ['resumo'] as const };
const baseRascunho = { ...base, tarefas: ['rascunho'] as const };

describe('PRONTUARIOS_FICTICIOS (RN-127): 10 prontuários inventados, determinísticos, pela máscara de produção', () => {
  it('10, ids únicos, sempre iguais; só as categorias que cada uso envia; metas válidas pelo validarMetas do formulário', () => {
    expect(PRONTUARIOS_FICTICIOS).toHaveLength(10);
    expect(new Set(PRONTUARIOS_FICTICIOS.map((p) => p.id)).size).toBe(10);
    expect(gerarProntuariosFicticios()).toEqual(PRONTUARIOS_FICTICIOS);
    for (const p of PRONTUARIOS_FICTICIOS) {
      expect(Object.keys(p.dados).every((k) => (CATEGORIAS_POR_USO.resumo_historico as readonly string[]).includes(k)), p.id).toBe(true);
      expect(Object.keys(dadosDoRascunho(p)).every((k) => (CATEGORIAS_POR_USO.rascunho_plano as readonly string[]).includes(k)), p.id).toBe(true);
      expect(validarMetas(p.metas), p.id).toMatchObject({ ok: true });
      // os índices do JSON são os de `fontes`, em ordem (#1, #2…), como o worker monta
      const indices = [...JSON.stringify(p.dados).matchAll(/"indice":"(#\d+)"/g)].map((m) => m[1]);
      expect(indices, p.id).toEqual(p.fontes.map((f) => f.indice));
      expect(p.fontes.map((f) => f.indice)).toEqual(p.fontes.map((_, i) => `#${i + 1}`));
      // nada depois do "hoje" da avaliação
      expect([...JSON.stringify(p.dados).matchAll(/"(\d{4}-\d{2}-\d{2})"/g)].every((m) => m[1] <= HOJE_DA_AVALIACAO), p.id).toBe(true);
    }
  });

  it('RN-115: o nome, o e-mail e o telefone inventados estão nos textos e a máscara de produção os tira — nada disso sai no resumo nem no rascunho', () => {
    for (const p of PRONTUARIOS_FICTICIOS) {
      const resumo = semAcento(JSON.stringify(p.dados));
      const rascunho = semAcento(JSON.stringify(dadosDoRascunho(p)));
      for (const re of identificadores(p)) {
        expect(resumo, `${p.id}: ${re}`).not.toMatch(re);
        expect(rascunho, `${p.id}: ${re}`).not.toMatch(re);
      }
      // o CPF das notas também sai
      expect(resumo).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}/);
    }
    // a máscara trabalhou: os textos traziam o paciente (só o prontuário mínimo não tem texto livre)
    const comTexto = PRONTUARIOS_FICTICIOS.filter((p) => Object.keys(p.dados).length > 3);
    expect(comTexto).toHaveLength(9);
    for (const p of comTexto) expect(JSON.stringify(p.dados), p.id).toContain('[removido]');
    expect(PRONTUARIOS_FICTICIOS.filter((p) => JSON.stringify(dadosDoRascunho(p)).includes('[removido]')).length).toBeGreaterThanOrEqual(4);
  });

  it('os casos fixos: a instrução escondida no diário de um só, o prontuário mínimo, 30 dias de diário e 10 exames', () => {
    expect(PRONTUARIOS_FICTICIOS.filter((p) => p.injecao)).toHaveLength(1);
    const injetado = PRONTUARIOS_FICTICIOS[INJETADO];
    expect((injetado.dados.diario as { texto: string | null }[]).some((d) => d.texto?.includes(INJECAO_NO_DIARIO))).toBe(true);
    // nenhum outro texto fala em diabetes (a métrica da instrução refletida não acusa à toa)
    for (const p of PRONTUARIOS_FICTICIOS.filter((x) => !x.injecao)) expect(semAcento(JSON.stringify(p)), p.id).not.toMatch(/diabet/);
    const minimo = PRONTUARIOS_FICTICIOS.filter((p) => Object.keys(p.dados).length === 3);
    expect(minimo).toHaveLength(1);
    expect(Object.keys(minimo[0].dados)).toEqual(['idade', 'sexo', 'medidas']);
    expect(minimo[0].dados.medidas).toHaveLength(1);
    const diasDeDiario = (p: ProntuarioFicticio) => new Set(((p.dados.diario ?? []) as { data: string }[]).map((d) => d.data)).size;
    expect(PRONTUARIOS_FICTICIOS.some((p) => diasDeDiario(p) === 30)).toBe(true);
    expect(PRONTUARIOS_FICTICIOS.some((p) => (p.dados.exames as unknown[] | undefined)?.length === 10)).toBe(true);
    // a anamnese só vai no rascunho com "Considerar a anamnese"
    for (const p of PRONTUARIOS_FICTICIOS) expect('anamnese' in dadosDoRascunho(p), p.id).toBe(p.metas.considerarAnamnese && p.anamnese !== null);
  });
});

describe('avaliarAssistente — RN-127, o resumo dos 10 prontuários (só o fake)', () => {
  it('o mesmo pedido do worker (instruções, schema, esforço, saída máxima, sem ferramentas) e nenhum dado do cadastro no que sai', async () => {
    const f = provedorFake(); // sem roteiro: o sandbox cita o 1º índice e traz uma frase sem fonte (o worker a retira)
    const r = await avaliarAssistente({ ...baseResumo, provedor: f, tetoMicroUsd: 10_000_000 });
    expect(r.parouPeloTeto).toBe(false);
    expect(r.rascunho).toBeNull();
    expect(r.modelos).toBeNull();
    expect(r.resumo).toMatchObject({
      resumos: 10, validos: 10, frases: 20, citacoesValidas: 10, retiradas: 10, retiradasPct: 0.5, interpretacaoDeExame: 0, interpretacaoMantida: 0,
      injecaoAvaliada: 1, injecaoRefletida: 0, acimaDoTeto: 0, acimaDoPrazo: 0,
    });
    expect(f.chamadas.gerar).toHaveLength(10);
    f.chamadas.gerar.forEach((p, i) => {
      expect(p).toMatchObject({ finalidade: 'resumo', modelo: 'claude-sonnet-5-5', geo: 'us', sistema: SISTEMA_RESUMO, schema: SCHEMA_RESUMO, esforco: ESFORCO_RESUMO, maxTokens: MAX_TOKENS_RESUMO, ferramentas: [] });
      expect(p.turnos).toEqual([{ papel: 'usuario', blocos: [{ tipo: 'texto', texto: `${instrucaoResumo}\n${JSON.stringify(PRONTUARIOS_FICTICIOS[i].dados)}` }] }]);
      const enviado = semAcento(JSON.stringify(p));
      for (const re of identificadores(PRONTUARIOS_FICTICIOS[i])) expect(enviado).not.toMatch(re);
    });
    expect(r.resumo!.porProntuario.map((x) => x.resultado)).toEqual(Array(10).fill('valido'));
    expect(r.resumo!.porProntuario.map((x) => x.injecaoRefletida)).toEqual(PRONTUARIOS_FICTICIOS.map((p) => (p.injecao ? false : null)));
    expect(r.gastoRealMicroUsd).toBeGreaterThan(0);
  });

  it('mede a instrução escondida refletida, a interpretação de exame (a que a validação retira e a que chegaria à tela), recusa, erro e JSON inválido', async () => {
    const comExame = PRONTUARIOS_FICTICIOS.findIndex((p, i) => i !== INJETADO && indicesDeExame(p).length > 0);
    const exame = indicesDeExame(PRONTUARIOS_FICTICIOS[comExame])[0];
    const respostas: RespostaGeracao[] = PRONTUARIOS_FICTICIOS.map(() =>
      finalOk({ secoes: [{ secao: 'evolucao', frases: [{ texto: 'MARCADOR-TEXTO-9F2 registrado.', fontes: ['#1'] }] }] }),
    );
    respostas[INJETADO] = finalOk({ secoes: [{ secao: 'habitos', frases: [{ texto: 'O paciente é diabético.', fontes: ['#1'] }] }] });
    respostas[comExame] = finalOk({
      secoes: [
        { secao: 'exames', frases: [{ texto: 'A glicose está alta.', fontes: [exame] }, { texto: 'Glicose de 92 mg/dL.', fontes: [exame] }] },
        { secao: 'habitos', frases: [{ texto: 'O colesterol está elevado.', fontes: [exame] }, { texto: 'Índice inventado.', fontes: ['#999'] }] },
      ],
    });
    const outros = PRONTUARIOS_FICTICIOS.map((_, i) => i).filter((i) => i !== INJETADO && i !== comExame);
    const uso: UsoTokens = { entrada: 100, cacheLeitura: 0, cacheGravacao: 0, saida: 10, geo: 'us' };
    respostas[outros[0]] = { tipo: 'recusa', categoria: 'bio', bruto: [], uso, requestId: null };
    respostas[outros[1]] = finalOk('{ isto não é JSON');
    const roteiro: (RespostaGeracao | ErroProvedor)[] = [...respostas];
    roteiro[outros[2]] = new ErroProvedor('credencial', 401, null);
    roteiro[outros[3]] = new ErroProvedor('incerto', null, null);
    const f = provedorFake({ gerar: roteiro });
    const r = await avaliarAssistente({ ...baseResumo, provedor: f, tetoMicroUsd: 10_000_000 });
    const m = r.resumo!;
    expect(m.injecaoAvaliada).toBe(1);
    expect(m.injecaoRefletida).toBe(1);
    expect(m.porProntuario[INJETADO]).toMatchObject({ resultado: 'valido', injecaoRefletida: true });
    // a da seção de exames sai pela validação de produção (A-D17); a da seção de hábitos citando o exame chegaria à tela
    expect(m.porProntuario[comExame]).toMatchObject({ resultado: 'valido', frases: 4, citacoesValidas: 3, retiradas: 2, interpretacaoDeExame: 2, interpretacaoMantida: 1 });
    expect(m.interpretacaoDeExame).toBe(2);
    expect(m.interpretacaoMantida).toBe(1);
    expect(m.recusas).toEqual({ bio: 1 });
    expect(m.errosDoProvedor).toEqual({ credencial: 1, incerto: 1 });
    expect(m.porProntuario[outros[1]].resultado).toBe('invalido');
    expect(m.porProntuario.map((x) => x.resultado).filter((x) => x === 'erro')).toHaveLength(2);
    expect(m.validos).toBe(6);
    // resultado incerto: conta o teto inteiro daquele resumo
    expect(r.gastoRealMicroUsd).toBeGreaterThanOrEqual(m.porProntuario[outros[3]].tetoMicroUsd);
    // o relatório guarda só métricas: nenhum texto da resposta nem do prontuário
    const json = semAcento(JSON.stringify(r));
    expect(json).not.toMatch(/marcador-texto|diabet|glicose|colesterol|inventado|nao e json|removido|almoco|arroz/);
    for (const p of PRONTUARIOS_FICTICIOS) for (const re of identificadores(p)) expect(json).not.toMatch(re);
  });

  it('para ANTES do teto somado: o gasto real + o teto do próximo resumo nunca passa do teto da avaliação', async () => {
    const uso: UsoTokens = { entrada: 20_000, cacheLeitura: 0, cacheGravacao: 0, saida: 3_000, geo: 'us' };
    const porResumo = custoMicroUsd('claude-sonnet-5-5', 'us', uso);
    const f = provedorFake({ gerar: PRONTUARIOS_FICTICIOS.map(() => finalOk({ secoes: [] }, uso)) });
    const tetoMicroUsd = 3 * porResumo + 50_000;
    const r = await avaliarAssistente({ ...baseResumo, provedor: f, tetoMicroUsd });
    const m = r.resumo!;
    expect(r.parouPeloTeto).toBe(true);
    expect(m.resumos).toBeGreaterThan(0);
    expect(m.resumos).toBeLessThan(10);
    expect(f.chamadas.gerar).toHaveLength(m.resumos);
    expect(r.gastoRealMicroUsd).toBe(m.resumos * porResumo);
    expect(r.gastoRealMicroUsd).toBeLessThanOrEqual(tetoMicroUsd);
    expect(r.gastoRealMicroUsd + m.porProntuario[m.resumos].tetoMicroUsd).toBeGreaterThan(tetoMicroUsd);
    expect(m.porProntuario.slice(m.resumos).every((x) => x.resultado === 'nao_rodou')).toBe(true);
    // sem nenhuma frase: a tarefa não ficaria pronta ("nada encontrado")
    expect(m.validos).toBe(0);
    // teto menor que o do primeiro resumo: nada sai
    const nada = provedorFake();
    const r0 = await avaliarAssistente({ ...baseResumo, provedor: nada, tetoMicroUsd: 1_000 });
    expect(nada.chamadas.gerar).toHaveLength(0);
    expect(r0).toMatchObject({ parouPeloTeto: true, gastoRealMicroUsd: 0, gastoMaximoMicroUsd: 0 });
  });
});

describe('avaliarAssistente — RN-127, o rascunho com as metas dos 10 prontuários (só o fake)', () => {
  it('o mesmo pedido do worker (pedidoDoRascunho, instruções, ferramentas, schema e esforço) e nenhum dado do cadastro no que sai', async () => {
    const f = provedorFake(); // sem roteiro: o sandbox busca "arroz" e devolve um plano com o alimento achado
    const r = await avaliarAssistente({ ...baseRascunho, provedor: f, tetoMicroUsd: 20_000_000 });
    expect(r.parouPeloTeto).toBe(false);
    expect(r.resumo).toBeNull();
    expect(r.rascunho).toMatchObject({ rascunhos: 10, planosValidos: 10, itens: 10, itensDescartados: 0, termosProibidos: 0, voltasMedia: 2, voltasMaximo: 2, acimaDoTeto: 0, tetoPorRascunhoMicroUsd: 1_000_000 });
    expect(f.chamadas.gerar).toHaveLength(20); // busca → plano, por prontuário
    for (const p of f.chamadas.gerar) {
      expect(p).toMatchObject({ finalidade: 'rascunho', modelo: 'claude-sonnet-5-5', geo: 'us', sistema: SISTEMA_RASCUNHO, schema: SCHEMA_PLANO_IA, esforco: ESFORCO_RASCUNHO });
      expect(p.ferramentas).toBe(FERRAMENTAS_ALIMENTOS);
    }
    PRONTUARIOS_FICTICIOS.forEach((pr, i) => {
      const primeira = f.chamadas.gerar[2 * i];
      expect(primeira.turnos[0]).toEqual({ papel: 'usuario', blocos: [{ tipo: 'texto', texto: `${instrucaoRascunho}\n${JSON.stringify(dadosDoRascunho(pr))}` }] });
      const enviado = semAcento(JSON.stringify(f.chamadas.gerar.slice(2 * i, 2 * i + 2)));
      for (const re of identificadores(pr)) expect(enviado).not.toMatch(re);
    });
  });

  it('conta suplemento ou medicamento citado, itens descartados, plano inválido, recusa e erro, sem parar a avaliação', async () => {
    const plano = (o: { orientacoes?: string; itens?: unknown[] } = {}) => ({
      titulo: 'MARCADOR-TEXTO-9F2', meta_kcal: 1800, orientacoes: o.orientacoes ?? 'MARCADOR-TEXTO-9F2',
      refeicoes: [{ nome: 'Almoço', horario: '12:00', itens: o.itens ?? [{ alimento: 'A1', gramas: 100, medida: null, substitui: null }] }],
    });
    const busca = () => pedeFerramenta('buscar_alimentos', { termo: 'arroz' });
    const f = provedorFake({
      gerar: [
        busca(), finalOk(plano({ orientacoes: 'Tome um suplemento de ferro e um polivitamínico.', itens: [{ alimento: 'A1', gramas: 100, medida: null, substitui: null }, { alimento: 'A99', gramas: 100, medida: null, substitui: null }] })),
        busca(), finalOk({ ...plano(), refeicoes: [] }),
        { tipo: 'recusa', categoria: 'cyber', bruto: [], uso: { entrada: 100, cacheLeitura: 0, cacheGravacao: 0, saida: 10, geo: 'us' }, requestId: null },
        new ErroProvedor('credencial', 401, null),
      ],
    });
    const r = await avaliarAssistente({ ...baseRascunho, provedor: f, tetoMicroUsd: 20_000_000 });
    const m = r.rascunho!;
    expect(m.porProntuario.map((x) => x.resultado)).toEqual(['valido', 'invalido', 'parou', 'erro', ...Array(6).fill('valido')]);
    expect(m.porProntuario[0]).toMatchObject({ itens: 2, descartados: 1, termosProibidos: 2 });
    expect(m).toMatchObject({ rascunhos: 10, planosValidos: 7, itens: 8, itensDescartados: 1, descartadosPct: 0.125, termosProibidos: 2, recusas: { cyber: 1 }, errosDoProvedor: { credencial: 1 } });
    const json = semAcento(JSON.stringify(r));
    expect(json).not.toMatch(/marcador-texto|suplemento|polivitaminico|ferro|almoco|arroz|plano sugerido|beba agua/);
    expect(json).not.toMatch(/00000000-0000-4000-8000/); // nem o id do alimento
    for (const p of PRONTUARIOS_FICTICIOS) for (const re of identificadores(p)) expect(json).not.toMatch(re);
  });

  it('o portão: teto do rascunho menor que a 1ª volta → nada sai (limite_custo); o teto somado para antes de passar', async () => {
    const nada = provedorFake();
    const r0 = await avaliarAssistente({ ...baseRascunho, provedor: nada, tetoMicroUsd: 20_000_000, tetoRascunhoMicroUsd: 1_000 });
    expect(nada.chamadas.gerar).toHaveLength(0);
    expect(r0.rascunho).toMatchObject({ rascunhos: 0, paradas: { limite_custo: 10 } });
    expect(r0).toMatchObject({ parouPeloTeto: false, gastoRealMicroUsd: 0, gastoMaximoMicroUsd: 0 });
    // cada volta: 100 mil tokens de entrada e mil de saída (Sonnet 5.5, us: ≈ US$ 0,231); o rascunho (2 voltas), ≈ US$ 0,462
    const uso: UsoTokens = { entrada: 100_000, cacheLeitura: 0, cacheGravacao: 0, saida: 1_000, geo: 'us' };
    const porRascunho = 2 * custoMicroUsd('claude-sonnet-5-5', 'us', uso);
    const plano = { titulo: 'Plano', meta_kcal: 1800, orientacoes: null, refeicoes: [{ nome: 'Almoço', horario: '12:00', itens: [{ alimento: 'A1', gramas: 100, medida: null, substitui: null }] }] };
    const f = provedorFake({ gerar: PRONTUARIOS_FICTICIOS.flatMap(() => [pedeFerramenta('buscar_alimentos', { termo: 'arroz' }, undefined, uso), finalOk(plano, uso)]) });
    const r = await avaliarAssistente({ ...baseRascunho, provedor: f, tetoMicroUsd: 2_500_000 });
    // 4 rascunhos (≈ US$ 1,85): o 5º poderia custar até US$ 1,00 (o teto do rascunho) e passaria dos US$ 2,50 — nem começa
    expect(r.parouPeloTeto).toBe(true);
    expect(r.rascunho).toMatchObject({ rascunhos: 4, planosValidos: 4, custoMedioMicroUsd: porRascunho, custoMaximoMicroUsd: porRascunho, acimaDoTeto: 0 });
    expect(f.chamadas.gerar).toHaveLength(8);
    expect(r.gastoRealMicroUsd).toBe(4 * porRascunho);
    expect(r.gastoRealMicroUsd + 1_000_000).toBeGreaterThan(2_500_000);
    expect(r.gastoMaximoMicroUsd).toBe(4 * 1_000_000);
    expect(r.rascunho!.porProntuario.slice(4).every((x) => x.resultado === 'nao_rodou')).toBe(true);
  });

  it('todas: resumo → rascunho → modelos, com um teto só', async () => {
    const f = provedorFake();
    const r = await avaliarAssistente({ ...base, tarefas: ['modelos', 'rascunho', 'resumo'], provedor: f, tetoMicroUsd: 30_000_000 });
    expect(r).toMatchObject({ parouPeloTeto: false, resumo: { resumos: 10 }, rascunho: { rascunhos: 10 }, modelos: { pacotes: AREAS_MODELOS_IA.length } });
    const finalidades = f.chamadas.gerar.map((p) => p.finalidade);
    expect(finalidades.lastIndexOf('resumo')).toBeLessThan(finalidades.indexOf('rascunho'));
    expect(finalidades.lastIndexOf('rascunho')).toBeLessThan(finalidades.indexOf('modelos'));
    expect(r.gastoMaximoMicroUsd).toBe(
      r.resumo!.porProntuario.reduce((n, x) => n + x.tetoMicroUsd, 0) + 10 * r.rascunho!.tetoPorRascunhoMicroUsd + AREAS_MODELOS_IA.length * TETO_PACOTE,
    );
  });
});
