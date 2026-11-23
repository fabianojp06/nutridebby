import { formatarData } from '@/modules/pacientes/datas';
import { MSG_FINANCEIRO, ROTULO_FORMA } from './constantes';
import { nomeDoMes } from './meses';
import { ROTULO_SITUACAO } from './situacao';
import type { FluxoDoAno, LinhaCsv } from './tipos';

/**
 * RN-321 (F-D27): CSV para o contador — UTF-8 com BOM, separador ";", fim de linha CRLF, datas dd/mm/aaaa e valores
 * com vírgula decimal, sem "R$" e sem separador de milhar (a planilha lê como número). Puro: quem chama lê o banco e
 * grava o `exportar`.
 */
const BOM = '﻿';
const FIM = '\r\n';
const SEP = ';';
const C = MSG_FINANCEIRO.csv.colunas;
const L = MSG_FINANCEIRO.relatorios.linhas;

/**
 * Começo que uma planilha lê como fórmula (OWASP "CSV injection"), também depois de espaços na frente — a planilha os
 * ignora (TRI-17-20 #107). `\s` do JS já cobre os espaços Unicode e o BOM; os de largura zero (U+200B–U+200D, U+2060)
 * vão à parte. O `\t`/`\r` sozinhos no início continuam neutralizados (o `*` volta atrás para casá-los).
 */
const FORMULA = /^[\s\u200B-\u200D\u2060]*[=+\-@\t\r]/;
/** O que obriga a célula a ir entre aspas. */
const ESPECIAL = /[;"\r\n]/;

/** Célula de texto livre (descrição, categoria, paciente): neutraliza fórmula com `'` antes do texto original (espaços inclusive) e põe entre aspas se precisar. */
export function celulaTexto(v: string | null): string {
  if (v === null) return '';
  const t = FORMULA.test(v) ? `'${v}` : v;
  return ESPECIAL.test(t) ? `"${t.replaceAll('"', '""')}"` : t;
}

/** "1250,50", "-750,00": número gerado pelo sistema, sem `'` (o "-" do resultado negativo é o que a planilha entende). */
function valor(centavos: number): string {
  const abs = Math.abs(centavos);
  return `${centavos < 0 ? '-' : ''}${Math.trunc(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

const arquivo = (linhas: string[][]) => BOM + linhas.map((l) => l.join(SEP) + FIM).join('');

export function csvLancamentos(linhas: LinhaCsv[], o: { comPacientes: boolean }): string {
  const cabecalho = [C.vencimento, C.pagamento, C.tipo, C.categoria, C.descricao, ...(o.comPacientes ? [C.paciente] : []), C.forma, C.valor, C.situacao];
  return arquivo([
    cabecalho,
    ...linhas.map((l) => [
      formatarData(l.vencimento),
      l.pagoEm ? formatarData(l.pagoEm) : '',
      MSG_FINANCEIRO.csv.tipos[l.tipo],
      celulaTexto(l.categoria),
      // a descrição livre pode identificar o paciente ("Ana — retorno"): sem a opção, sai vazia nas linhas com paciente
      o.comPacientes || l.paciente === null ? celulaTexto(l.descricao) : '',
      ...(o.comPacientes ? [celulaTexto(l.paciente)] : []),
      l.forma ? ROTULO_FORMA[l.forma] : '',
      valor(l.valorCentavos),
      ROTULO_SITUACAO[l.situacao],
    ]),
  ]);
}

/** Fluxo de caixa do ano (US-306): as linhas da tabela × jan a dez + "Total". Saldo sem valor (antes do saldo do caixa) sai vazio. */
export function csvFluxo(f: FluxoDoAno): string {
  const soma = (v: number[]) => v.reduce((a, b) => a + b, 0);
  const movimento = (rotulo: string, v: number[]) => [rotulo, ...v.map(valor), valor(soma(v))];
  // o saldo não se soma no ano: a coluna "Total" fica vazia
  const saldo = (rotulo: string, v: (number | null)[]) => [rotulo, ...v.map((x) => (x === null ? '' : valor(x))), ''];
  return arquivo([
    [MSG_FINANCEIRO.relatorios.fluxo(f.ano), ...f.meses.map((m) => nomeDoMes(m).slice(0, 3)), MSG_FINANCEIRO.relatorios.total],
    saldo(L.saldoInicio, f.saldoInicio),
    ...f.categoriasEntrada.map((c) => movimento(celulaTexto(c.categoria), c.valores)),
    movimento(L.totalEntradas, f.totalEntradas),
    ...f.categoriasSaida.map((c) => movimento(celulaTexto(c.categoria), c.valores)),
    movimento(L.totalSaidas, f.totalSaidas),
    movimento(L.resultado, f.resultado),
    saldo(L.saldoFim, f.saldoFim),
  ]);
}
