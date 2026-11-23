import { and, eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { signedDocuments, tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { catalogoParaLancamentoNaTransacao, exigirNutri } from '@/modules/exames/catalogo';
import { expandirParaAnalise } from '@/modules/exames/catalogo-regras';
import { indiceDoCatalogo } from '@/modules/exames/classificacao';
import { idValido } from '@/modules/pacientes/base';
import { formatarData, hojeNoFuso } from '@/modules/pacientes/datas';
import { lerDocumentoNaTransacao } from './documentos';
import { MSG_SOLICITACAO } from './solicitacao';

/** O que o "Novo exame" recebe (`InicialDoExame` do `ExameForm`): o título e uma linha por exame, sem valor. */
export type ExamesParaLancar = { titulo: string; linhas: { nome: string; unidade: string | null }[] };

/**
 * Plano 22 (US-377 "Lançar resultados", RN-390, EP-D47, EP-D50): o que a página de exames põe no "Novo exame" a partir
 * de uma solicitação — o título "Exames solicitados em {data do preparo}" (no fuso do consultório) e uma linha por exame
 * pedido, com os painéis expandidos pelo catálogo **atual** (RN-373; a unidade do exame do catálogo que casar). Só a
 * solicitação `assinado` (a versão em vigor; `substituido`, cancelada, rascunho e preparo ficam de fora) do paciente da
 * rota, não anonimizada; senão `null`, e **nenhum** `auditRead` (a leitura só é gravada quando o conteúdo é devolvido).
 * A leitura do conteúdo é a de `lerDocumento` (`auditRead` da entidade `documentos`, na mesma transação). O exame que a
 * nutricionista salvar depois é cópia: não aponta para a solicitação (sem FK). Só a sessão `nutri` (o catálogo é
 * staff_only; conferido antes da transação). Depende de `documentos_liberados` — quem decide é a página (`linhasParaLancar`).
 */
export async function examesParaLancar(ctx: TenantContext, patientId: string, docId: string, deps: { db?: Db } = {}): Promise<ExamesParaLancar | null> {
  exigirNutri(ctx);
  if (!idValido(patientId) || !idValido(docId)) return null;
  return withTenant(
    ctx,
    async (tx) => {
      // a situação primeiro, sem o conteúdo: só a solicitação assinada do paciente segue para a leitura auditada
      const [d] = await tx
        .select({ tipo: signedDocuments.tipo, status: signedDocuments.status, declaracaoEm: signedDocuments.declaracaoEm, anonimizadoEm: signedDocuments.anonimizadoEm })
        .from(signedDocuments)
        .where(and(eq(signedDocuments.id, docId), eq(signedDocuments.patientId, patientId)));
      if (!d || d.tipo !== 'solicitacao_exames' || d.status !== 'assinado' || d.anonimizadoEm) return null;
      const lido = await lerDocumentoNaTransacao(tx, docId, { auditar: true, patientId });
      if (!lido || lido.conteudo.tipo !== 'solicitacao_exames') return null;
      const [t] = await tx.select({ fuso: tenants.fuso }).from(tenants).where(eq(tenants.id, ctx.tenantId));
      const indice = indiceDoCatalogo(await catalogoParaLancamentoNaTransacao(tx));
      return {
        titulo: MSG_SOLICITACAO.examesSolicitadosEm(formatarData(hojeNoFuso(t.fuso, d.declaracaoEm ?? lido.createdAt))),
        linhas: expandirParaAnalise(lido.conteudo.exames, indice),
      };
    },
    deps.db ?? getDb(),
  );
}
