import { desc, eq } from 'drizzle-orm';
import { signedDocuments } from '@/db/schema';
import { ROTULO_STATUS, TIPO_DOCUMENTO_ROTULO, type StatusDocumento, type TipoDocumento } from '@/modules/documentos/constantes';
import { MSG_FICHA } from '../textos';
import type { SecaoDaFicha } from '../tipos';
import { diaNoFuso, LIMITE_DA_SECAO, resumoDasLinhas, totalJunto } from './comum';

/** Documentos assinados (Planos 10A e 13): "Receita"/"Parecer nutricional", o dia e a situação — como a lista da aba (10A D17). */
export const secaoDocumentos: SecaoDaFicha = {
  id: 'documentos',
  titulo: MSG_FICHA.titulos.documentos,
  aba: 'documentos',
  // D20 do Plano 10A: só com os documentos liberados pelo admin
  disponivel: (t) => t.documentosLiberados,
  async resumo(tx, patientId, fuso) {
    const linhas = await tx
      .select({ id: signedDocuments.id, tipo: signedDocuments.tipo, status: signedDocuments.status, criadoEm: signedDocuments.createdAt, total: totalJunto() })
      .from(signedDocuments)
      .where(eq(signedDocuments.patientId, patientId))
      .orderBy(desc(signedDocuments.createdAt))
      .limit(LIMITE_DA_SECAO);
    return resumoDasLinhas(linhas, (d) => ({
      id: d.id,
      rotulo: TIPO_DOCUMENTO_ROTULO[d.tipo as TipoDocumento],
      data: diaNoFuso(d.criadoEm, fuso),
      situacao: ROTULO_STATUS[d.status as StatusDocumento],
      href: `documentos/${d.id}`,
    }));
  },
  adicionar: [
    { grupo: 'prescricoes', rotulo: MSG_FICHA.itens.receita, destino: { acao: 'criar-receita' } },
    { grupo: 'prescricoes', rotulo: MSG_FICHA.itens.parecer, destino: { acao: 'criar-parecer' } },
  ],
};
