import { and, eq, sql } from 'drizzle-orm';
import type { Db, Tx } from '@/db/client';
import { signedDocuments, type TenantRow } from '@/db/schema';
import type { TenantContext } from '@/db/tenant';
import type { TipoAssinatura, TipoDocumento } from './constantes';
import { entregarDocumento } from './entrega';
import { RecusaAssinaturaError, TransicaoInvalidaError } from './erros';
import type { CopiaProfissional } from './perfil-profissional';
import type { ConteudoDocumento } from './parecer';
import { mudarSituacao, registrarVerificacao } from './verificacao';

/**
 * D23 (Plano 10A): a parte da assinatura que a rota (envio) e o WORKER (digitalizada) compartilham. Este arquivo não
 * importa nada de sessão (o Better Auth, a confirmação do 2FA, o Next), nem pelos imports dos imports: o worker o importa
 * (guarda no teste, que procura os nomes desses módulos no fonte — por isso eles não aparecem nem neste comentário). Os tipos de acesso e
 * de dependências moram aqui para a digitalizada (T9) e o envio do PDF assinado (Plano 10B) usarem os mesmos.
 */
export type AcessoAssinatura = { ctx: TenantContext; tenant: TenantRow; user: { id: string; email: string; twoFactorEnabled: boolean | null } };
export type DepsAssinar = {
  headers: Headers; db?: Db; dataDir?: string; agora?: Date; appUrl?: string;
  confirmar2fa?: (e: { userId: string; codigo: unknown; headers: Headers }) => Promise<'ok' | 'invalido' | 'bloqueado'>;
  /** I3 do PR #19: devolve a marca anti-repetição quando a ação falha depois do 'ok' (padrão: liberarCodigo2fa). */
  liberar2fa?: (e: { userId: string; codigo: unknown }) => Promise<void>;
};
/**
 * `versao` amarra o registrar à versão do documento que foi LIDA (revisão do rascunho, Important): entre a leitura e o
 * registrar (2FA, disco, worker) a nutricionista pode, noutra aba, "Voltar a editar" e preparar de novo — o documento
 * volta a "aguardando_assinatura" com outro código e outro base, e um UPDATE só por status aceitaria o PDF antigo sobre o
 * conteúdo novo (quebra "PDF = prontuário", CS-141). A digitalizada amarra pelo código + "pendente" + as FOTOS lidas
 * (code review do PR #19: passada 1 h, um envio novo troca as fotos com o mesmo código, e o job das fotos antigas não
 * assina por cima dele); o envio do PDF assinado (Plano 10B) pelo código + SHA-256 do base conferido.
 */
export type VersaoLida = { codigo: string } & ({ baseSha256: string } | { digitalizacao: readonly string[] });
export type AssinaturaAceita = {
  documentoId: string; codigo: string; patientId: string; tenantId: string; caminho: string; sha256: string; tipo: TipoAssinatura;
  emissor: string | null; assinanteNome: string | null; userId: string; agora: Date; copia: CopiaProfissional; base: string | null;
  versao: VersaoLida;
  /** T10: o link do e-mail da entrega (portal ou link de uso único). A rota passa `getEnv().APP_URL`; o worker, o dele. */
  appUrl: string;
};

/** As fotos do envio que o worker leu, na mesma ordem (jsonb: igualdade exata do array). */
export const fotosLidas = (fotos: readonly string[]) => sql`${signedDocuments.digitalizacao} = ${JSON.stringify(fotos)}::jsonb`;

/**
 * Minor 9 da revisão de segurança: a habilitação em Fitoterapia é conferida ao salvar e ao preparar (T5) e de novo AO
 * ASSINAR — retirada entre o preparo e o envio, o fitoterápico formulado não é assinado. Quem chama passa o tenant lido
 * na sessão do envio (a digitalizada no envio das fotos; o 10B no envio do PDF assinado). Plano 13: só a receita tem
 * itens; o parecer (e o conteúdo '{}' de um anonimizado) passa direto.
 */
export function exigirHabilitacaoAtual(tenant: Pick<TenantRow, 'fitoterapiaRegistro'>, conteudo: ConteudoDocumento): void {
  if (conteudo.tipo !== 'receita') return;
  if (!tenant.fitoterapiaRegistro && conteudo.itens.some((i) => i.tipo === 'fitoterapico')) throw new RecusaAssinaturaError('sem_habilitacao', 'habilitacao_retirada');
}

/**
 * RN-140 (b): a ida a "assinado" e a verificação pública — na transação do arquivo (o `registrar` do salvarArquivo do PDF
 * final). Regra 9 (desvio registrado da RN-140 b): `base_pdf_path` e `digitalizacao` NÃO mudam aqui; quem chama, depois do
 * salvarArquivo, solta cada arquivo no seu apagarArquivo com `soltarArquivosDoPreparo(ctx, id, EMITIDOS)` (T9; o envio do
 * PDF assinado do Plano 10B faz o mesmo), e a varredura da T7 repete o que falhar. No fim, a entrega (T10).
 */
export async function registrarAssinatura(tx: Tx, a: AssinaturaAceita): Promise<void> {
  const daVersao = 'baseSha256' in a.versao
    ? eq(signedDocuments.basePdfSha256, a.versao.baseSha256)
    : and(eq(signedDocuments.digitalizacaoStatus, 'pendente'), fotosLidas(a.versao.digitalizacao));
  const r = await tx
    .update(signedDocuments)
    .set({
      status: 'assinado', pdfPath: a.caminho, pdfSha256: a.sha256, assinaturaTipo: a.tipo, assinaturaEmissor: a.emissor?.slice(0, 200) ?? null,
      assinanteNome: a.assinanteNome?.slice(0, 200) ?? null, assinadoEm: a.agora, assinadoPor: a.userId,
      digitalizacaoStatus: null, digitalizacaoEm: null, updatedAt: a.agora,
    })
    .where(and(eq(signedDocuments.id, a.documentoId), eq(signedDocuments.status, 'aguardando_assinatura'), eq(signedDocuments.codigo, a.versao.codigo), daVersao))
    .returning({ id: signedDocuments.id, tipo: signedDocuments.tipo, retificaId: signedDocuments.retificaId });
  if (!r.length) throw new TransicaoInvalidaError(); // outra versão no meio (ou já assinado): o salvarArquivo desfaz tudo
  await registrarVerificacao(tx, {
    codigo: a.codigo, tenantId: a.tenantId, documentoId: a.documentoId, tipo: r[0].tipo as TipoDocumento, assinadoEm: a.agora, emissorNome: a.copia.nomeCompleto,
    emissorCrn: a.copia.crn, assinanteNome: a.tipo === 'digitalizada' ? null : a.assinanteNome, assinaturaTipo: a.tipo, pdfSha256: a.sha256,
  });
  // RN-146 (Plano 13): a versão nova assinada substitui a original NA MESMA TRANSAÇÃO — só se ela ainda está "assinado"
  // (senão a assinatura inteira volta: o salvarArquivo desfaz tudo). O gatilho só deixa com esta já "assinado" (0105). A
  // original já está travada desde o antesDaReserva (travarDocumentoAntesDaCota: original → versão nova → tenant).
  // Q13-3 ★: o paciente recebe só o e-mail de documento novo da entrega abaixo, sem um "documento atualizado".
  // O `!s.length` é defesa em profundidade: pelos caminhos legais a original não sai de "assinado" com esta retificação em
  // andamento (o cancelamento recusa e só esta pode substituí-la — gatilhos da 0105), então não há teste que o alcance.
  if (r[0].retificaId) {
    const s = await tx
      .update(signedDocuments)
      .set({ status: 'substituido', substituidoEm: a.agora, updatedAt: a.agora })
      .where(and(eq(signedDocuments.id, r[0].retificaId), eq(signedDocuments.status, 'assinado')))
      .returning({ id: signedDocuments.id });
    if (!s.length) throw new TransicaoInvalidaError();
    await mudarSituacao(tx, r[0].retificaId, 'substituido', a.agora);
  }
  // RN-152/RN-153: a entrega na mesma transação; `entregue_em` só quando houve entrega de fato (Minor da revisão de
  // cobertura): arquivado → 'nenhuma' e a lista não mostra "Enviado em …" (só "Entregue pessoalmente", se marcado)
  const via = await entregarDocumento(tx, { tenantId: a.tenantId, patientId: a.patientId, documentoId: a.documentoId, agora: a.agora, appUrl: a.appUrl });
  if (via !== 'nenhuma') await tx.update(signedDocuments).set({ entregueEm: a.agora }).where(eq(signedDocuments.id, a.documentoId));
}
