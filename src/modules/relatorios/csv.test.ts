import { describe, expect, it } from 'vitest';
import { celulaTexto } from '@/modules/financeiro/csv';
import { linhasCsv, montarCsv, nomeDoArquivo } from './csv';
import type { Periodo } from './periodo';
import type { RelAgenda, RelFinanceiro, RelPacientes, RelPlanos, RelRanking } from './tipos';

const BOM = '﻿';
const pacientes: RelPacientes = {
  situacao: { ativos: 40, arquivados: 8, bloqueados: 2, total: 50 },
  sexo: [
    { rotulo: 'Feminino', n: 31 },
    { rotulo: 'Masculino', n: 9 },
    { rotulo: 'Não informado', n: 0 },
  ],
  fase: [
    { rotulo: 'Adultos (18 a 59 anos)', n: 33 },
    { rotulo: 'Pessoas idosas (60 anos ou mais)', n: 7 },
  ],
  faixas: [
    { rotulo: '18 a 29', n: 10 },
    { rotulo: '60 ou mais', n: 7 },
  ],
  novosPorMes: [
    { mes: '2026-01', n: 3 },
    { mes: '2026-02', n: 5 },
    { mes: '2026-03', n: 0 },
  ],
};

/** RN-494: ";", UTF-8 com BOM, CRLF, meses mm/aaaa, vírgula decimal sem "R$" e percentuais sem "%"; texto neutralizado. */
describe('montarCsv', () => {
  it('BOM no início, ";" entre as células e CRLF no fim de cada linha (nenhum \\n solto)', () => {
    const csv = montarCsv([['a', 'b'], ['c']]);
    expect(csv).toBe(`${BOM}a;b\r\nc\r\n`);
    expect(csv.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });
});

describe('linhasCsv', () => {
  it('Pacientes: situação, sexo e fase com percentual de uma casa e vírgula (sem "%"), novos por mês com o total', () => {
    expect(linhasCsv('pacientes', pacientes)).toEqual([
      ['Pacientes por situação', 'Pacientes'],
      ['Ativos', '40'],
      ['Inativos (arquivados)', '8'],
      ['Bloqueados por pedido de exclusão', '2'],
      ['Total', '50'],
      [],
      ['Pacientes ativos por sexo', 'Pacientes', 'Percentual'],
      ['Feminino', '31', '77,5'],
      ['Masculino', '9', '22,5'],
      ['Não informado', '0', '0,0'],
      [],
      ['Pacientes ativos por fase da vida', 'Pacientes', 'Percentual'],
      ['Adultos (18 a 59 anos)', '33', '82,5'],
      ['Pessoas idosas (60 anos ou mais)', '7', '17,5'],
      ['18 a 29', '10', '25,0'],
      ['60 ou mais', '7', '17,5'],
      [],
      ['Novos pacientes por mês'],
      ['Mês', 'Novos'],
      ['01/2026', '3'],
      ['02/2026', '5'],
      ['03/2026', '0'],
      ['Total', '8'],
    ]);
    expect(montarCsv(linhasCsv('pacientes', pacientes))).not.toContain('%');
  });

  it('Pacientes na recepção (sem a linha de bloqueados) e com zero ativos: sem a linha e percentual vazio', () => {
    const r = linhasCsv('pacientes', { ...pacientes, situacao: { ativos: 0, arquivados: 1, total: 1 }, sexo: [{ rotulo: 'Feminino', n: 0 }] });
    expect(r.map((l) => l[0])).not.toContain('Bloqueados por pedido de exclusão');
    expect(r).toContainEqual(['Feminino', '0', '']);
  });

  it('Agenda: as colunas da US-483 e a taxa sem "%" (vazia sem consulta iniciada); previsões só quando vêm', () => {
    const agenda: RelAgenda = {
      meses: [
        { mes: '2026-01', marcadas: 18, realizadas: 14, faltas: 2, iniciadas: 16, canceladasPaciente: 1, canceladasConsultorio: 1, marcadasPeloPaciente: 4, retornos: 9 },
        { mes: '2026-02', marcadas: 0, realizadas: 0, faltas: 0, iniciadas: 0, canceladasPaciente: 0, canceladasConsultorio: 0, marcadasPeloPaciente: 0, retornos: 0 },
      ],
    };
    expect(linhasCsv('agenda', agenda)).toEqual([
      ['Mês', 'Marcadas', 'Realizadas', 'Faltas', 'Taxa de faltas', 'Canceladas pelo paciente', 'Canceladas pelo consultório', 'Marcadas pelo paciente', 'Retornos'],
      ['01/2026', '18', '14', '2', '12,5', '1', '1', '4', '9'],
      ['02/2026', '0', '0', '0', '', '0', '0', '0', '0'],
    ]);
    const com23 = linhasCsv('agenda', { meses: [{ ...agenda.meses[0], retornosPrevistos: 5, previstosComConsulta: 3 }] });
    expect(com23[0].slice(-2)).toEqual(['Retornos previstos', 'Previstos com consulta marcada']);
    expect(com23[1].slice(-2)).toEqual(['5', '3']);
  });

  it('Atendimentos e Planos: uma linha por mês com as colunas da spec; o cartão de hoje no fim', () => {
    expect(
      linhasCsv('atendimentos', { meses: [{ mes: '2026-03', atendidos: 2, novos: 1, retorno: 1, consultasRealizadas: 1, atendimentosRegistrados: 2 }] }),
    ).toEqual([
      ['Mês', 'Pacientes atendidos', 'Pacientes novos (primeiro atendimento)', 'Pacientes em retorno', 'Consultas realizadas', 'Atendimentos registrados'],
      ['03/2026', '2', '1', '1', '1', '2'],
    ]);
    const planos: RelPlanos = { meses: [{ mes: '2026-03', publicacoes: 4, pacientes: 3 }], hoje: { comPlano: 12, ativos: 40 } };
    expect(linhasCsv('planos', planos)).toEqual([
      ['Mês', 'Publicações de plano', 'Pacientes com plano publicado no mês'],
      ['03/2026', '4', '3'],
      [],
      ['Pacientes ativos com plano publicado hoje: 12 de 40'],
    ]);
  });

  it('Financeiro: vírgula decimal sem "R$", "-" no resultado negativo (a planilha lê como número), total e categorias', () => {
    const fin: RelFinanceiro = {
      configurado: true,
      meses: [
        { mes: '2026-01', recebido: 125_050, pago: 180_000 },
        { mes: '2026-02', recebido: 50_000, pago: 0 },
      ],
      porCategoria: {
        entradas: [{ categoria: 'Consultas', valor: 175_050 }],
        saidas: [{ categoria: '=HYPERLINK("x")', valor: 180_000 }],
      },
    };
    expect(linhasCsv('financeiro', fin)).toEqual([
      ['Mês', 'Recebido', 'Pago', 'Resultado'],
      ['01/2026', '1250,50', '1800,00', '-549,50'],
      ['02/2026', '500,00', '0,00', '500,00'],
      ['Total', '1750,50', '1800,00', '-49,50'],
      [],
      ['Por categoria'],
      ['Categoria', 'Recebido'],
      ['Consultas', '1750,50'],
      [],
      ['Categoria', 'Pago'],
      [celulaTexto('=HYPERLINK("x")'), '1800,00'],
    ]);
    expect(montarCsv(linhasCsv('financeiro', fin))).not.toContain('R$');
  });

  it('Financeiro com local: "Pago" e "Resultado" vazios (saídas não têm local)', () => {
    const r = linhasCsv('financeiro', { configurado: true, meses: [{ mes: '2026-01', recebido: 10_000, pago: null }], porCategoria: { entradas: [], saidas: [] } });
    expect(r[1]).toEqual(['01/2026', '100,00', '', '']);
    expect(r[2]).toEqual(['Total', '100,00', '', '']);
  });

  it('Financeiro não configurado: só o aviso', () => {
    expect(linhasCsv('financeiro', { configurado: false })).toEqual([['O Financeiro ainda não foi configurado.']]);
  });

  it('Ranking: a coluna "Paciente (nome de registro)" com o nome civil (nunca o exibido), posição e valor', () => {
    const consultas: RelRanking = {
      por: 'consultas',
      linhas: [
        { patientId: 'p1', nomeExibido: 'Joana Silva', nomeRegistro: 'João Silva', valor: 12 },
        { patientId: 'p2', nomeExibido: 'Bia Lima', nomeRegistro: 'Bia Lima', valor: 7 },
      ],
    };
    const r = linhasCsv('ranking', consultas);
    expect(r).toEqual([
      ['Pacientes com mais consultas realizadas'],
      ['Posição', 'Paciente (nome de registro)', 'Consultas'],
      ['1', 'João Silva', '12'],
      ['2', 'Bia Lima', '7'],
    ]);
    expect(JSON.stringify(r)).not.toContain('Joana');
    const receita = linhasCsv('ranking', { por: 'receita', linhas: [{ patientId: 'p1', nomeExibido: 'A', nomeRegistro: 'Ana', valor: 125_000 }] });
    expect(receita).toEqual([['Pacientes com maior receita recebida'], ['Posição', 'Paciente (nome de registro)', 'Recebido'], ['1', 'Ana', '1250,00']]);
  });

  it('célula de texto que começa com =, +, -, @, tabulação ou CR ganha "\'" (a mesma função do Financeiro)', () => {
    for (const nome of ['=1+1', '+55', '-x', '@SUM(A1)', '\tTab', '\rCR']) {
      const [, , linha] = linhasCsv('ranking', { por: 'consultas', linhas: [{ patientId: 'p', nomeExibido: 'x', nomeRegistro: nome, valor: 1 }] });
      expect(linha[1]).toBe(celulaTexto(nome));
      expect(linha[1].replace(/^"/, '').startsWith("'")).toBe(true);
    }
    // ";" e aspas vão entre aspas, como no Financeiro
    const [, , linha] = linhasCsv('ranking', { por: 'consultas', linhas: [{ patientId: 'p', nomeExibido: 'x', nomeRegistro: 'Ana; "Bia"', valor: 1 }] });
    expect(linha[1]).toBe('"Ana; ""Bia"""');
  });
});

describe('nomeDoArquivo (RN-494)', () => {
  it('relatorio-{secao}-{de}-a-{ate}.csv; o Ranking leva o critério', () => {
    const p: Periodo = { de: '2026-01', ate: '2026-06', meses: [] };
    expect(nomeDoArquivo('agenda', p)).toBe('relatorio-agenda-2026-01-a-2026-06.csv');
    expect(nomeDoArquivo('pacientes', p)).toBe('relatorio-pacientes-2026-01-a-2026-06.csv');
    expect(nomeDoArquivo('ranking', p, 'consultas')).toBe('relatorio-ranking-consultas-2026-01-a-2026-06.csv');
    expect(nomeDoArquivo('ranking', p, 'receita')).toBe('relatorio-ranking-receita-2026-01-a-2026-06.csv');
  });
});
