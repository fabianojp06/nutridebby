import { describe, expect, it } from 'vitest';
import { celulaTexto, csvFluxo, csvLancamentos } from './csv';
import type { FluxoDoAno, LinhaCsv } from './tipos';
import { mesesDoAno } from './meses';

const BOM = '﻿';
const linhas = (csv: string) => csv.slice(BOM.length).split('\r\n');

const entradaComPaciente: LinhaCsv = {
  vencimento: '2026-11-10',
  pagoEm: '2026-11-16',
  tipo: 'entrada',
  categoria: 'Consultas',
  descricao: 'Ana — retorno',
  paciente: 'Ana Souza',
  forma: 'pix',
  valorCentavos: 125_050,
  situacao: 'recebido',
};
const entradaSemPaciente: LinhaCsv = { ...entradaComPaciente, paciente: null, descricao: 'Palestra', pagoEm: null, forma: null, valorCentavos: 30_000, situacao: 'previsto' };
const saida: LinhaCsv = {
  vencimento: '2026-11-05',
  pagoEm: '2026-11-05',
  tipo: 'saida',
  categoria: 'Aluguel e condomínio',
  descricao: 'Aluguel de novembro',
  paciente: null,
  forma: 'transferencia',
  valorCentavos: 180_000,
  situacao: 'pago',
};

/** RN-321: ';', UTF-8 com BOM, CRLF, datas dd/mm/aaaa, vírgula decimal sem "R$", célula de texto neutralizada. */
describe('csvLancamentos', () => {
  it('BOM no início, CRLF, ";" e o cabeçalho da spec — sem a coluna Paciente quando não pedida', () => {
    const csv = csvLancamentos([saida], { comPacientes: false });
    expect(csv.startsWith(BOM)).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(linhas(csv)).toEqual([
      'Vencimento;Pagamento;Tipo;Categoria;Descrição;Forma de pagamento;Valor;Situação',
      '05/11/2026;05/11/2026;Saída;Aluguel e condomínio;Aluguel de novembro;Transferência bancária;1800,00;Pago',
      '',
    ]);
  });

  it('sem a opção: a descrição sai vazia na linha com paciente; nas outras, sai', () => {
    const [cab, comPac, semPac, sai] = linhas(csvLancamentos([entradaComPaciente, entradaSemPaciente, saida], { comPacientes: false }));
    expect(cab).not.toContain('Paciente');
    expect(comPac).toBe('10/11/2026;16/11/2026;Entrada;Consultas;;Pix;1250,50;Recebido');
    expect(comPac).not.toContain('Ana');
    expect(semPac).toBe('10/11/2026;;Entrada;Consultas;Palestra;;300,00;Previsto');
    expect(sai).toContain(';Aluguel de novembro;');
  });

  it('com a opção: coluna Paciente e a descrição em todas as linhas', () => {
    const [cab, comPac, semPac] = linhas(csvLancamentos([entradaComPaciente, entradaSemPaciente], { comPacientes: true }));
    expect(cab).toBe('Vencimento;Pagamento;Tipo;Categoria;Descrição;Paciente;Forma de pagamento;Valor;Situação');
    expect(comPac).toBe('10/11/2026;16/11/2026;Entrada;Consultas;Ana — retorno;Ana Souza;Pix;1250,50;Recebido');
    expect(semPac).toBe('10/11/2026;;Entrada;Consultas;Palestra;;;300,00;Previsto');
  });

  it('injeção de fórmula na descrição, na categoria e no paciente; números do sistema sem apóstrofo', () => {
    const l: LinhaCsv = { ...entradaComPaciente, descricao: '=HIPERLINK("http://x";"y")', categoria: '+Cat', paciente: '@Ana', situacao: 'cancelado' };
    const [, linha] = linhas(csvLancamentos([l], { comPacientes: true }));
    expect(linha).toBe(`10/11/2026;16/11/2026;Entrada;'+Cat;"'=HIPERLINK(""http://x"";""y"")";'@Ana;Pix;1250,50;Cancelado`);
  });

  it('lista vazia: só o cabeçalho', () => {
    expect(csvLancamentos([], { comPacientes: false })).toBe(`${BOM}Vencimento;Pagamento;Tipo;Categoria;Descrição;Forma de pagamento;Valor;Situação\r\n`);
  });
});

describe('celulaTexto', () => {
  it('"=HIPERLINK(…)" → "\'=HIPERLINK(…)"', () => {
    expect(celulaTexto('=HIPERLINK(…)')).toBe("'=HIPERLINK(…)");
  });
  it.each([
    ['+1', "'+1"],
    ['-1', "'-1"],
    ['@SOMA(A1)', "'@SOMA(A1)"],
  ])('%j → %j', (v, esperado) => {
    expect(celulaTexto(v)).toBe(esperado);
  });
  it('tabulação e CR no início neutralizados (e o CR põe a célula entre aspas)', () => {
    expect(celulaTexto('\t=1')).toBe("'\t=1");
    expect(celulaTexto('\r=1')).toBe(`"'\r=1"`);
  });
  // TRI-17-20 #107 (P20-18 RM-1): a planilha ignora o espaço da frente e lê a fórmula; o `'` vai antes do texto original
  it.each([
    [' =1+1', "' =1+1"],
    [' @SOMA(A1)', "' @SOMA(A1)"],
    ['\t-2', "'\t-2"],
    [' +1', "' +1"],
    ['​=1', "'​=1"],
    ['﻿=1', "'﻿=1"],
    [' 　-1', "' 　-1"],
    ['  \t @x', "'  \t @x"],
  ])('espaço na frente da fórmula: %j → %j', (v, esperado) => {
    expect(celulaTexto(v)).toBe(esperado);
  });
  it('espaço na frente com aspas: o `\'` entra antes do espaço e a célula vai entre aspas', () => {
    expect(celulaTexto(' =HIPERLINK("x")')).toBe(`"' =HIPERLINK(""x"")"`);
  });
  it('texto comum com espaço ou sinal no meio não ganha `\'`', () => {
    expect(celulaTexto('Consulta - retorno')).toBe('Consulta - retorno');
    expect(celulaTexto('Retorno 15/11')).toBe('Retorno 15/11');
    expect(celulaTexto(' Consulta')).toBe(' Consulta');
    expect(celulaTexto('   ')).toBe('   ');
  });
  it('texto comum passa igual; nulo vira vazio; ";", aspas e quebras de linha vão entre aspas', () => {
    expect(celulaTexto('Material e insumos')).toBe('Material e insumos');
    expect(celulaTexto('a = b')).toBe('a = b');
    expect(celulaTexto(null)).toBe('');
    expect(celulaTexto('a;b')).toBe('"a;b"');
    expect(celulaTexto('diz "oi"')).toBe('"diz ""oi"""');
    expect(celulaTexto('linha 1\nlinha 2')).toBe('"linha 1\nlinha 2"');
  });
});

describe('csvFluxo', () => {
  const zeros = () => Array<number>(12).fill(0);
  const comEm = (i: number, v: number) => zeros().map((x, j) => (j === i ? v : x));
  const f: FluxoDoAno = {
    ano: 2026,
    meses: mesesDoAno(2026),
    categoriasEntrada: [{ categoria: 'Consultas', valores: comEm(10, 125_000) }],
    categoriasSaida: [{ categoria: '=Aluguel', valores: comEm(10, 200_000) }],
    totalEntradas: comEm(10, 125_000),
    totalSaidas: comEm(10, 200_000),
    resultado: comEm(10, -75_000),
    saldoInicio: [...Array(11).fill(null), 75_000],
    saldoFim: [...Array(10).fill(null), 75_000, 75_000],
    saldoDesde: '2026-11-01',
  };

  it('BOM, CRLF, colunas jan a dez e Total; as linhas da US-306 na ordem; saldo vazio antes do saldo do caixa', () => {
    const csv = csvFluxo(f);
    expect(csv.startsWith(BOM)).toBe(true);
    const z = (n: number) => Array(n).fill('0,00').join(';');
    const v = (n: number) => Array(n).fill('').join(';');
    expect(linhas(csv)).toEqual([
      'Fluxo de caixa de 2026;jan;fev;mar;abr;mai;jun;jul;ago;set;out;nov;dez;Total',
      `Saldo no início do mês;${v(11)};750,00;`,
      `Consultas;${z(10)};1250,00;0,00;1250,00`,
      `Total de entradas;${z(10)};1250,00;0,00;1250,00`,
      `'=Aluguel;${z(10)};2000,00;0,00;2000,00`,
      `Total de saídas;${z(10)};2000,00;0,00;2000,00`,
      `Resultado do mês;${z(10)};-750,00;0,00;-750,00`,
      `Saldo no fim do mês;${v(10)};750,00;750,00;`,
      '',
    ]);
  });
});
