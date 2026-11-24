import { describe, expect, it } from 'vitest';
import { MSG_ANAMNESE, respostaParaCampo, respostasDoFormulario, validarModelo, validarRespostas, type Pergunta } from './anamnese-tipos';

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const P: Pergunta[] = [
  { id: id(1), tipo: 'texto_curto', rotulo: 'Alergias', obrigatoria: true },
  { id: id(2), tipo: 'numero', rotulo: 'Consumo de água', obrigatoria: false, unidade: 'litros por dia' },
  { id: id(3), tipo: 'sim_nao', rotulo: 'Fuma?', obrigatoria: false },
  { id: id(4), tipo: 'escolha_unica', rotulo: 'Intestino', obrigatoria: false, opcoes: ['Regular', 'Constipação'] },
  { id: id(5), tipo: 'multipla_escolha', rotulo: 'Refeições', obrigatoria: false, opcoes: ['Café', 'Almoço', 'Jantar'] },
  { id: id(6), tipo: 'data', rotulo: 'Último exame', obrigatoria: false },
  { id: id(7), tipo: 'texto_longo', rotulo: 'Histórico', obrigatoria: false },
];

describe('validarModelo (US-012)', () => {
  it('aceita os 7 tipos; tira espaços, opções vazias/repetidas e unidade de quem não é número', () => {
    const r = validarModelo({
      nome: '  Retorno ',
      perguntas: [
        ...P.map((p) => ({ ...p, rotulo: ` ${p.rotulo} ` })),
        { id: 'lixo', tipo: 'texto_curto', rotulo: 'Sem id válido', obrigatoria: false, unidade: 'kg' },
        { id: id(4), tipo: 'escolha_unica', rotulo: 'Id repetido', obrigatoria: false, opcoes: [' A ', 'A', '', 'B'] },
      ],
    });
    if (!r.ok) throw new Error(JSON.stringify(r.erros));
    expect(r.nome).toBe('Retorno');
    expect(r.perguntas).toHaveLength(9);
    expect(r.perguntas[0].rotulo).toBe('Alergias');
    expect(r.perguntas[7]).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), tipo: 'texto_curto', rotulo: 'Sem id válido', obrigatoria: false });
    expect(r.perguntas[8].opcoes).toEqual(['A', 'B']);
    expect(new Set(r.perguntas.map((p) => p.id)).size).toBe(9);
  });
  it('erros por campo: nome, texto da pergunta, menos de 2 opções, nenhuma pergunta, tipo inválido', () => {
    expect(validarModelo({ nome: '', perguntas: [] })).toEqual({ ok: false, erros: { nome: MSG_ANAMNESE.nomeModelo, perguntas: MSG_ANAMNESE.semPerguntas } });
    const r = validarModelo({
      nome: 'X',
      perguntas: [
        { tipo: 'texto_curto', rotulo: '  ', obrigatoria: false },
        { tipo: 'escolha_unica', rotulo: 'Uma só', obrigatoria: false, opcoes: ['A'] },
        { tipo: 'desenho', rotulo: 'Tipo errado', obrigatoria: false },
      ],
    });
    expect(r).toEqual({ ok: false, erros: { pergunta_0: MSG_ANAMNESE.rotulo, pergunta_1: MSG_ANAMNESE.opcoes, pergunta_2: MSG_ANAMNESE.tipo } });
  });
  it('acima dos limites dá erro, nunca corta em silêncio: 101 perguntas, 31 opções, opção com 101 caracteres', () => {
    const q = (i: number) => ({ tipo: 'texto_curto', rotulo: `P${i}`, obrigatoria: false });
    expect(validarModelo({ nome: 'X', perguntas: Array.from({ length: 101 }, (_, i) => q(i)) })).toEqual({ ok: false, erros: { perguntas: MSG_ANAMNESE.muitasPerguntas } });
    const opcoes = (o: string[]) => validarModelo({ nome: 'X', perguntas: [{ tipo: 'multipla_escolha', rotulo: 'M', obrigatoria: false, opcoes: o }] });
    expect(opcoes(Array.from({ length: 31 }, (_, i) => `op${i}`))).toEqual({ ok: false, erros: { pergunta_0: MSG_ANAMNESE.muitasOpcoes } });
    expect(opcoes(['A', 'x'.repeat(101)])).toEqual({ ok: false, erros: { pergunta_0: MSG_ANAMNESE.muitasOpcoes } });
    expect(opcoes(Array.from({ length: 30 }, (_, i) => `op${i}`)).ok).toBe(true);
  });
  it('SUS-114: a opção conta caracteres (code points): 100 emojis passam, 101 não', () => {
    const opcoes = (o: string[]) => validarModelo({ nome: 'X', perguntas: [{ tipo: 'escolha_unica', rotulo: 'M', obrigatoria: false, opcoes: o }] });
    expect(opcoes(['A', '🙂'.repeat(100)])).toMatchObject({ ok: true, perguntas: [{ opcoes: ['A', '🙂'.repeat(100)] }] });
    expect(opcoes(['A', '🙂'.repeat(101)])).toEqual({ ok: false, erros: { pergunta_0: MSG_ANAMNESE.muitasOpcoes } });
  });
});

describe('validarRespostas', () => {
  it('"Obrigatória não preenchida": "Responda: Alergias" (e nada mais é aceito)', () => {
    expect(validarRespostas(P, {})).toEqual({ ok: false, erros: { [id(1)]: 'Responda: Alergias' } });
    expect(validarRespostas(P, { [id(1)]: '   ' })).toEqual({ ok: false, erros: { [id(1)]: 'Responda: Alergias' } });
  });
  it('converte cada tipo; vazio some; valor fora das opções, número ou data inválidos → "Resposta inválida: <pergunta>"', () => {
    const ok = validarRespostas(P, {
      [id(1)]: ' Lactose ',
      [id(2)]: '1,5',
      [id(3)]: 'nao',
      [id(4)]: 'Regular',
      [id(5)]: ['Café', 'Jantar'],
      [id(6)]: '2026-08-10',
      [id(7)]: '',
    });
    expect(ok).toEqual({ ok: true, respostas: { [id(1)]: 'Lactose', [id(2)]: 1.5, [id(3)]: false, [id(4)]: 'Regular', [id(5)]: ['Café', 'Jantar'], [id(6)]: '2026-08-10' } });
    const ruim = validarRespostas(P, { [id(1)]: 'x', [id(2)]: '1,5 L', [id(4)]: 'Outra', [id(5)]: ['Ceia'], [id(6)]: '2026-02-30', [id(3)]: 'talvez' });
    expect(ruim).toEqual({
      ok: false,
      erros: {
        [id(2)]: 'Resposta inválida: Consumo de água',
        [id(3)]: 'Resposta inválida: Fuma?',
        [id(4)]: 'Resposta inválida: Intestino',
        [id(5)]: 'Resposta inválida: Refeições',
        [id(6)]: 'Resposta inválida: Último exame',
      },
    });
  });
  it('lê o FormData (r_<id>, múltipla escolha com getAll) e volta a resposta para o campo', () => {
    const f = new FormData();
    f.set(`r_${id(1)}`, 'Lactose');
    f.append(`r_${id(5)}`, 'Café');
    f.append(`r_${id(5)}`, 'Jantar');
    expect(respostasDoFormulario(P, f)).toMatchObject({ [id(1)]: 'Lactose', [id(5)]: ['Café', 'Jantar'], [id(2)]: '' });
    expect(respostaParaCampo(1.5)).toBe('1,5');
    expect(respostaParaCampo(true)).toBe('sim');
    expect(respostaParaCampo(['A'])).toEqual(['A']);
    expect(respostaParaCampo(undefined)).toBe('');
  });
});

describe('validarRespostas: quebras de linha (PF3)', () => {
  it('texto longo com CRLF conta 1 por quebra e é gravado com \\n', () => {
    const p: Pergunta[] = [{ id: id(1), tipo: 'texto_longo', rotulo: 'Histórico', obrigatoria: false }];
    const linhas = Array.from({ length: 2500 }, () => 'a').join('\r\n'); // 4999 caracteres com \n, 7499 com \r\n
    expect(validarRespostas(p, { [id(1)]: linhas })).toEqual({ ok: true, respostas: { [id(1)]: linhas.replace(/\r\n/g, '\n') } });
    expect(validarRespostas(p, { [id(1)]: `${linhas}\r\nb` }).ok).toBe(false); // 5001 caracteres
  });
});

describe('validarRespostas: tamanho por caractere (SUS-114)', () => {
  it('texto curto (200) e longo (5000) contam code points, como o banco: emojis no limite passam, um a mais não', () => {
    const p: Pergunta[] = [
      { id: id(1), tipo: 'texto_curto', rotulo: 'Apelido', obrigatoria: false },
      { id: id(2), tipo: 'texto_longo', rotulo: 'Histórico', obrigatoria: false },
    ];
    const curto = '🙂'.repeat(200);
    const longo = '🥗'.repeat(5000);
    expect(validarRespostas(p, { [id(1)]: curto, [id(2)]: longo })).toEqual({ ok: true, respostas: { [id(1)]: curto, [id(2)]: longo } });
    expect(validarRespostas(p, { [id(1)]: `${curto}🙂`, [id(2)]: `${longo}🥗` })).toEqual({
      ok: false,
      erros: { [id(1)]: MSG_ANAMNESE.invalida('Apelido'), [id(2)]: MSG_ANAMNESE.invalida('Histórico') },
    });
  });
});
