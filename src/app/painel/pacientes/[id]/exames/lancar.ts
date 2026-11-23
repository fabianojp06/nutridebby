import type { TenantRow } from '@/db/schema';

/**
 * Plano 22 (US-377 "Lançar resultados", RN-398, EP-D50): a decisão da página de exames sobre o `?solicitacao=<docId>` —
 * função pura (sem banco), testada sem DOM em `src/modules/documentos/lancar-resultados.test.ts`. Devolve o id da
 * solicitação cujos exames vão para o "Novo exame" (lidos por `examesParaLancar`, que confere o resto e grava o
 * `auditRead`), ou `null`: com `documentos_liberados` desligado o parâmetro é ignorado — nenhuma linha pré-preenchida e
 * nenhuma leitura. Parâmetro ausente, vazio ou repetido também dá `null`.
 */
export function linhasParaLancar(tenant: Pick<TenantRow, 'documentosLiberados'>, busca: { solicitacao?: string | string[] }): string | null {
  if (!tenant.documentosLiberados) return null;
  const s = busca.solicitacao;
  return typeof s === 'string' && s.length > 0 ? s : null;
}
