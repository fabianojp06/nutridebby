import { eq } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { documentVerifications } from '@/db/schema';
import { chaveDoLimite, consumirLimite } from '@/modules/agenda/limite-ip';
import { normalizarCodigo } from './codigo';
import { ROTULO_ASSINATURA, TIPO_DOCUMENTO_ROTULO, type SituacaoVerificacao, type TipoAssinatura, type TipoDocumento } from './constantes';

/**
 * RN-156: ÚNICO arquivo que toca `document_verifications` (fora da RLS; guarda em verificacao.test.ts). Sem dado do
 * paciente nem de saúde. A linha nasce na assinatura e só a situação muda depois (privilégio por coluna, 0090).
 */
export type NovaVerificacao = {
  codigo: string; tenantId: string; documentoId: string; tipo: TipoDocumento; assinadoEm: Date; emissorNome: string; emissorCrn: string;
  assinanteNome: string | null; assinaturaTipo: TipoAssinatura; pdfSha256: string;
};

export async function registrarVerificacao(tx: Tx, v: NovaVerificacao): Promise<void> {
  await tx.insert(documentVerifications).values({ ...v, situacao: 'valido', situacaoEm: v.assinadoEm });
}

export async function mudarSituacao(tx: Tx, documentoId: string, situacao: SituacaoVerificacao, em: Date): Promise<void> {
  await tx.update(documentVerifications).set({ situacao, situacaoEm: em }).where(eq(documentVerifications.documentoId, documentoId));
}

/** US-147: textos exatos da spec. As datas chegam já formatadas (dd/mm/aaaa, horário de Brasília). */
export const MSG_VERIFICACAO = {
  valido: 'Documento válido',
  cancelado: (data: string) => `Documento cancelado — Este documento foi cancelado por quem o emitiu em ${data} e não deve ser usado.`,
  substituido: (data: string) => `Documento substituído — Este documento foi substituído por uma versão retificada em ${data}. Peça a versão atual a quem o emitiu.`,
  eliminado: (data: string) => `Documento emitido em ${data} — o prazo de guarda terminou e o conteúdo foi eliminado.`,
  naoEncontrado: 'Código não encontrado. Confira os 12 caracteres.',
  limite: 'Muitas tentativas. Tente de novo em alguns minutos.',
} as const;
export const LIMITE_VERIFICACAO_HORA = 30;

/** D8: o que a página pública mostra — nada do paciente nem do conteúdo (Plano 13: do parecer, só o tipo). */
export type VerificacaoPublica = {
  codigo: string; tipo: (typeof TIPO_DOCUMENTO_ROTULO)[TipoDocumento]; situacao: SituacaoVerificacao; situacaoEm: Date; assinadoEm: Date; emissorNome: string; emissorCrn: string;
  assinanteNome: string | null; assinatura: string; sha256: string;
};
export type ResultadoVerificacao = { tipo: 'limite' } | { tipo: 'nao_encontrado' } | { tipo: 'ok'; v: VerificacaoPublica };

/** SHA-256 em grupos de 4 caracteres, para conferir a olho. */
export const textoSha256 = (sha: string): string => (sha.match(/.{1,4}/g) ?? []).join(' ');

/**
 * RN-156: só desta tabela, sem contexto de tenant (tenant suspenso continua respondendo); 30/h por IP (balde /64 no
 * IPv6, `clientIpDoLimite`); a mesma resposta para código inexistente e malformado.
 */
export async function consultarVerificacao(codigoBruto: unknown, deps: { db?: Db; ipDoLimite: string | null; agora?: Date }): Promise<ResultadoVerificacao> {
  const db = deps.db ?? getDb();
  const permitido = await consumirLimite(db, chaveDoLimite('verificacao-ip', deps.ipDoLimite ?? 'sem-ip'), LIMITE_VERIFICACAO_HORA, 3600, deps.agora ?? new Date());
  if (!permitido) return { tipo: 'limite' };
  const codigo = normalizarCodigo(codigoBruto);
  if (!codigo) return { tipo: 'nao_encontrado' };
  const d = documentVerifications;
  const [v] = await db
    .select({
      tipo: d.tipo, situacao: d.situacao, situacaoEm: d.situacaoEm, assinadoEm: d.assinadoEm, emissorNome: d.emissorNome, emissorCrn: d.emissorCrn,
      assinanteNome: d.assinanteNome, assinaturaTipo: d.assinaturaTipo, pdfSha256: d.pdfSha256,
    })
    .from(d)
    .where(eq(d.codigo, codigo));
  if (!v) return { tipo: 'nao_encontrado' };
  return {
    tipo: 'ok',
    v: {
      codigo, tipo: TIPO_DOCUMENTO_ROTULO[v.tipo as TipoDocumento], situacao: v.situacao as SituacaoVerificacao, situacaoEm: v.situacaoEm, assinadoEm: v.assinadoEm, emissorNome: v.emissorNome,
      emissorCrn: v.emissorCrn, assinanteNome: v.assinanteNome, assinatura: ROTULO_ASSINATURA[v.assinaturaTipo as TipoAssinatura], sha256: v.pdfSha256,
    },
  };
}
