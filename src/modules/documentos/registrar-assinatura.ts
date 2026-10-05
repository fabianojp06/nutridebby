import { and, eq } from 'drizzle-orm';
import type { Db, Tx } from '@/db/client';
import { signedDocuments, type TenantRow } from '@/db/schema';
import type { TenantContext } from '@/db/tenant';
import type { TipoAssinatura } from './constantes';
import { RecusaAssinaturaError, TransicaoInvalidaError } from './erros';
import type { CopiaProfissional } from './perfil-profissional';
import type { ConteudoReceita } from './prescricao';
import { registrarVerificacao } from './verificacao';

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
};
/**
 * `versao` amarra o registrar à versão do documento que foi LIDA (revisão do rascunho, Important): entre a leitura e o
 * registrar (2FA, disco, worker) a nutricionista pode, noutra aba, "Voltar a editar" e preparar de novo — o documento
 * volta a "aguardando_assinatura" com outro código e outro base, e um UPDATE só por status aceitaria o PDF antigo sobre o
 * conteúdo novo (quebra "PDF = prontuário", CS-141). A digitalizada amarra pelo código + "pendente"; o envio do PDF
 * assinado (Plano 10B) pelo código + SHA-256 do base conferido.
 */
export type VersaoLida = { codigo: string } & ({ baseSha256: string } | { digitalizacaoPendente: true });
export type AssinaturaAceita = {
  documentoId: string; codigo: string; patientId: string; tenantId: string; caminho: string; sha256: string; tipo: TipoAssinatura;
  emissor: string | null; assinanteNome: string | null; userId: string; agora: Date; copia: CopiaProfissional; base: string | null;
  versao: VersaoLida;
};

/**
 * Minor 9 da revisão de segurança: a habilitação em Fitoterapia é conferida ao salvar e ao preparar (T5) e de novo AO
 * ASSINAR — retirada entre o preparo e o envio, o fitoterápico formulado não é assinado. Quem chama passa o tenant lido
 * na sessão do envio (a digitalizada no envio das fotos; o 10B no envio do PDF assinado).
 */
export function exigirHabilitacaoAtual(tenant: Pick<TenantRow, 'fitoterapiaRegistro'>, conteudo: ConteudoReceita): void {
  if (!tenant.fitoterapiaRegistro && conteudo.itens.some((i) => i.tipo === 'fitoterapico')) throw new RecusaAssinaturaError('sem_habilitacao', 'habilitacao_retirada');
}

/**
 * RN-140 (b): a ida a "assinado" e a verificação pública — na transação do arquivo (o `registrar` do salvarArquivo do PDF
 * final). Regra 9 (desvio registrado da RN-140 b): `base_pdf_path` e `digitalizacao` NÃO mudam aqui; quem chama, depois do
 * salvarArquivo, solta cada arquivo no seu apagarArquivo com `soltarArquivosDoPreparo(ctx, id, EMITIDOS)` (T9; o envio do
 * PDF assinado do Plano 10B faz o mesmo), e a varredura da T7 repete o que falhar. A T10 acrescenta a entrega.
 */
export async function registrarAssinatura(tx: Tx, a: AssinaturaAceita): Promise<void> {
  const daVersao = 'baseSha256' in a.versao
    ? eq(signedDocuments.basePdfSha256, a.versao.baseSha256)
    : eq(signedDocuments.digitalizacaoStatus, 'pendente');
  const r = await tx
    .update(signedDocuments)
    .set({
      status: 'assinado', pdfPath: a.caminho, pdfSha256: a.sha256, assinaturaTipo: a.tipo, assinaturaEmissor: a.emissor?.slice(0, 200) ?? null,
      assinanteNome: a.assinanteNome?.slice(0, 200) ?? null, assinadoEm: a.agora, assinadoPor: a.userId,
      digitalizacaoStatus: null, digitalizacaoEm: null, updatedAt: a.agora,
    })
    .where(and(eq(signedDocuments.id, a.documentoId), eq(signedDocuments.status, 'aguardando_assinatura'), eq(signedDocuments.codigo, a.versao.codigo), daVersao))
    .returning({ id: signedDocuments.id });
  if (!r.length) throw new TransicaoInvalidaError(); // outra versão no meio (ou já assinado): o salvarArquivo desfaz tudo
  await registrarVerificacao(tx, {
    codigo: a.codigo, tenantId: a.tenantId, documentoId: a.documentoId, tipo: 'receita', assinadoEm: a.agora, emissorNome: a.copia.nomeCompleto,
    emissorCrn: a.copia.crn, assinanteNome: a.tipo === 'digitalizada' ? null : a.assinanteNome, assinaturaTipo: a.tipo, pdfSha256: a.sha256,
  });
}
