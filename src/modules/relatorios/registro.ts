import type { Tx } from '@/db/client';
import { recordAudit } from '@/modules/plataforma/audit';
import type { Secao } from './constantes';
import type { Periodo } from './periodo';
import type { DadosDaSecao, RelRanking } from './tipos';

/**
 * RN-493 (RE-D4): o rastro do CSV e da impressão, gravado **na transação da leitura** (se algo falhar depois, o registro
 * some junto; regra 8). Agregado: uma linha `exportar` da entidade `relatorios`, sem paciente. Ranking (lista nominal): uma
 * linha por paciente da lista, que aparece no Histórico de acessos como "Exportou — Relatórios"; lista vazia, uma sem
 * paciente (o download fica registrado, como no CSV do Financeiro). `entidade_id` = '{secao}|{de}..{ate}|{local ou
 * todos}'. Nunca `ler`: a tela dos Relatórios não chama `auditRead`.
 */
export async function registrarExportacao(
  tx: Tx,
  o: { secao: Secao; periodo: Periodo; localId: string | null; pacientes?: string[] },
): Promise<void> {
  // erro de programação (quem chama decide pela seção): sem a lista o Ranking ficaria sem rastro por paciente
  if (o.secao === 'ranking' && o.pacientes === undefined) throw new RangeError('O Ranking registra a exportação por paciente.');
  if (o.secao !== 'ranking' && o.pacientes !== undefined) throw new RangeError('Só o Ranking registra a exportação por paciente.');
  const entidadeId = `${o.secao}|${o.periodo.de}..${o.periodo.ate}|${o.localId ?? 'todos'}`;
  const pacientes = [...new Set(o.pacientes ?? [])];
  await recordAudit(
    tx,
    pacientes.length
      ? pacientes.map((patientId) => ({ acao: 'exportar' as const, entidade: 'relatorios', entidadeId, patientId }))
      : { acao: 'exportar', entidade: 'relatorios', entidadeId, patientId: null },
  );
}

/**
 * RN-493 (RE-D4): o `naMesmaTransacao` das leituras (`deps` de cada `relatorio*`) para o CSV e a impressão — grava o
 * `exportar` na transação da leitura, com os dados que vão sair: no Ranking, um por paciente **da lista devolvida** (nunca
 * uma lista lida de novo, que poderia diferir). Se a gravação falhar, a leitura não sai.
 */
export function exportacaoNaLeitura<S extends Secao>(secao: S, periodo: Periodo, localId: string | null): (tx: Tx, dados: DadosDaSecao[S]) => Promise<void> {
  return (tx, dados) =>
    registrarExportacao(tx, {
      secao,
      periodo,
      localId,
      ...(secao === 'ranking' ? { pacientes: (dados as RelRanking).linhas.map((l) => l.patientId) } : {}),
    });
}
