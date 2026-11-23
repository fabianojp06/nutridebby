import { formatarDecimal } from '@/lib/numero';
import { celulaTexto } from '@/modules/financeiro/csv';
import { MSG_RELATORIOS, type RankingPor, type Secao } from './constantes';
import { mesNumerico, type Periodo } from './periodo';
import type { DadosDaSecao, LinhaContagem, RelAgenda, RelAtendimentos, RelFinanceiro, RelPacientes, RelPlanos, RelRanking } from './tipos';

/**
 * RN-494: o CSV dos Relatórios — separador ";", UTF-8 com BOM, CRLF, meses mm/aaaa, valores com vírgula decimal e sem
 * "R$", percentuais com vírgula e sem "%". Texto (rótulo, categoria, nome) passa pelo escape de célula do Financeiro
 * (`celulaTexto`, RN-321: fórmula neutralizada com `'`, aspas quando precisa); número gerado pelo sistema não passa (o "-"
 * do resultado negativo é o que a planilha lê como número, como no CSV do Financeiro). Uma tabela por bloco, com uma linha
 * vazia entre os blocos. Puro: quem chama lê o banco e grava o `exportar` (`registro.ts`).
 */
const BOM = '﻿';
const FIM = '\r\n';
const SEP = ';';
const M = MSG_RELATORIOS;
const t = celulaTexto;

/** O arquivo: BOM + cada linha com ";" e CRLF. */
export function montarCsv(linhas: string[][]): string {
  return BOM + linhas.map((l) => l.join(SEP) + FIM).join('');
}

const n = (v: number) => String(v);
/** "1250,50", "-549,50" (centavos → reais, sem milhar). */
function reais(centavos: number): string {
  const abs = Math.abs(centavos);
  return `${centavos < 0 ? '-' : ''}${Math.trunc(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}
/** "77,5" (uma casa, RN-486); sem base, vazio (a tela mostra "—"). */
const percentual = (v: number, base: number) => (base > 0 ? formatarDecimal((v / base) * 100, 1) : '');
const mes = (m: string) => mesNumerico(m);
const soma = (v: number[]) => v.reduce((a, b) => a + b, 0);

function pacientes(d: RelPacientes): string[][] {
  const L = M.pacientes.linhas;
  const T = M.pacientes.titulos;
  const comPercentual = (titulo: string, linhas: LinhaContagem[]) => [
    [t(titulo), t(M.csv.pacientes), t(M.csv.percentual)],
    ...linhas.map((l) => [t(l.rotulo), n(l.n), percentual(l.n, d.situacao.ativos)]),
  ];
  return [
    [t(T.situacao), t(M.csv.pacientes)],
    [t(L.ativos), n(d.situacao.ativos)],
    [t(L.arquivados), n(d.situacao.arquivados)],
    // RE-D39: na sessão da recepção a linha não existe
    ...(d.situacao.bloqueados === undefined ? [] : [[t(L.bloqueados), n(d.situacao.bloqueados)]]),
    [t(L.total), n(d.situacao.total)],
    [],
    ...comPercentual(T.sexo, d.sexo),
    [],
    ...comPercentual(T.fase, [...d.fase, ...d.faixas]),
    [],
    [t(T.novos)],
    [t(M.atendimentos.colunas.mes), t(M.csv.novos)],
    ...d.novosPorMes.map((l) => [mes(l.mes), n(l.n)]),
    [t(L.total), n(soma(d.novosPorMes.map((l) => l.n)))],
  ];
}

function atendimentos(d: RelAtendimentos): string[][] {
  const C = M.atendimentos.colunas;
  return [
    [C.mes, C.atendidos, C.novos, C.retorno, C.consultasRealizadas, C.atendimentosRegistrados].map(t),
    ...d.meses.map((l) => [mes(l.mes), n(l.atendidos), n(l.novos), n(l.retorno), n(l.consultasRealizadas), n(l.atendimentosRegistrados)]),
  ];
}

function planos(d: RelPlanos): string[][] {
  const C = M.planos.colunas;
  return [
    [C.mes, C.publicacoes, C.pacientes].map(t),
    ...d.meses.map((l) => [mes(l.mes), n(l.publicacoes), n(l.pacientes)]),
    [],
    [t(M.planos.cartaoHoje(d.hoje.comPlano, d.hoje.ativos))],
  ];
}

function agenda(d: RelAgenda): string[][] {
  const C = M.agenda.colunas;
  // Plano 23 (T11a): as colunas das previsões só quando a leitura as traz
  const comPrevisoes = d.meses.some((l) => l.retornosPrevistos !== undefined);
  return [
    [
      C.mes, C.marcadas, C.realizadas, C.faltas, C.taxa, C.canceladasPaciente, C.canceladasConsultorio, C.marcadasPeloPaciente, C.retornos,
      ...(comPrevisoes ? [C.retornosPrevistos, C.previstosComConsulta] : []),
    ].map(t),
    ...d.meses.map((l) => [
      mes(l.mes),
      n(l.marcadas),
      n(l.realizadas),
      n(l.faltas),
      percentual(l.faltas, l.iniciadas),
      n(l.canceladasPaciente),
      n(l.canceladasConsultorio),
      n(l.marcadasPeloPaciente),
      n(l.retornos),
      ...(comPrevisoes ? [n(l.retornosPrevistos ?? 0), n(l.previstosComConsulta ?? 0)] : []),
    ]),
  ];
}

function financeiro(d: RelFinanceiro): string[][] {
  if (!d.configurado) return [[t(M.financeiro.naoConfigurado)]];
  const C = M.financeiro.colunas;
  const semLocal = d.meses.some((l) => l.pago === null);
  const linha = (rotulo: string, recebido: number, pago: number | null) => [rotulo, reais(recebido), pago === null ? '' : reais(pago), pago === null ? '' : reais(recebido - pago)];
  const recebido = soma(d.meses.map((l) => l.recebido));
  const pago = semLocal ? null : soma(d.meses.map((l) => l.pago ?? 0));
  const categorias = (coluna: string, linhas: { categoria: string; valor: number }[]) => [
    [t(M.csv.categoria), t(coluna)],
    ...linhas.map((l) => [t(l.categoria), reais(l.valor)]),
  ];
  return [
    [C.mes, C.recebido, C.pago, C.resultado].map(t),
    ...d.meses.map((l) => linha(mes(l.mes), l.recebido, l.pago)),
    linha(t(M.pacientes.linhas.total), recebido, pago),
    [],
    [t(M.financeiro.porCategoria)],
    ...categorias(C.recebido, d.porCategoria.entradas),
    [],
    ...categorias(C.pago, d.porCategoria.saidas),
  ];
}

/** RN-492: no arquivo, o nome de registro (nunca o exibido), com a coluna "Paciente (nome de registro)". */
function ranking(d: RelRanking): string[][] {
  const C = M.ranking.colunas;
  return [
    [t(M.ranking.titulos[d.por])],
    [t(C.posicao), t(C.pacienteRegistro), t(d.por === 'consultas' ? C.consultas : C.receita)],
    ...d.linhas.map((l, i) => [n(i + 1), t(l.nomeRegistro), d.por === 'consultas' ? n(l.valor) : reais(l.valor)]),
  ];
}

const POR_SECAO: { [S in Secao]: (d: DadosDaSecao[S]) => string[][] } = { pacientes, atendimentos, planos, agenda, financeiro, ranking };

/** As linhas (células já escapadas) do CSV de uma seção; `montarCsv` faz o arquivo. */
export function linhasCsv<S extends Secao>(secao: S, dados: DadosDaSecao[S]): string[][] {
  return (POR_SECAO[secao] as (d: DadosDaSecao[S]) => string[][])(dados);
}

/** "relatorio-agenda-2026-01-a-2026-06.csv"; no Ranking, "relatorio-ranking-consultas-…" ou "relatorio-ranking-receita-…". */
export function nomeDoArquivo(secao: Secao, p: Periodo, por?: RankingPor): string {
  const nome = secao === 'ranking' ? `ranking-${por ?? 'consultas'}` : secao;
  return `relatorio-${nome}-${p.de}-a-${p.ate}.csv`;
}
