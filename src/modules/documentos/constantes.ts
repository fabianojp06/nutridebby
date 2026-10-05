/**
 * Planos 10A e 10B — documentos assinados. SEM imports: componentes 'use client' leem daqui (como marca-constantes.ts).
 * No Plano 10A só existe a assinatura digitalizada (opção E); o Plano 10B amplia `TipoAssinatura` e `ROTULO_ASSINATURA`
 * com 'govbr' e 'icp' (e os CHECKs do banco, migration própria).
 */
export type TipoAssinatura = 'digitalizada';
/** Pontos PDF, origem no canto de baixo à esquerda (A4 = 595 × 842). */
export type AreaAssinatura = { x1: number; y1: number; x2: number; y2: number };

/**
 * D15 / RN-144 (6): o quadro "Assinatura digital", em branco, no rodapé de CADA página, à direita (208 × 70 pt), acima
 * da faixa do código e do QR. Nasce no 10A (o PDF preparado é o mesmo nos dois planos: um documento preparado antes do
 * 10B pode ser assinado com certificado depois dele); a conferência do 10B aceita o widget de área zero ou dentro dele.
 */
export const AREA_ASSINATURA: AreaAssinatura = { x1: 351, y1: 62, x2: 559, y2: 132 };
export const TOLERANCIA_AREA_PT = 2;

export const STATUS_DOCUMENTO = ['rascunho', 'preparando', 'aguardando_assinatura', 'assinado', 'substituido', 'cancelado'] as const;
export type StatusDocumento = (typeof STATUS_DOCUMENTO)[number];
/** RN-141: o que a sessão de paciente vê (paciente_so_emitidos, 0090). */
export const EMITIDOS: readonly StatusDocumento[] = ['assinado', 'substituido', 'cancelado'];
export const ROTULO_STATUS: Record<StatusDocumento, string> = {
  rascunho: 'Rascunho',
  preparando: 'Preparando o PDF',
  aguardando_assinatura: 'Aguardando assinatura',
  assinado: 'Assinado',
  substituido: 'Substituído',
  cancelado: 'Cancelado',
};
/** O Plano 10B acrescenta `govbr: 'gov.br'` e `icp: 'Certificado ICP-Brasil'`. */
export const ROTULO_ASSINATURA: Record<TipoAssinatura, string> = { digitalizada: 'Digitalizado' };
/** RN-157 / US-144 / US-147: a mesma linha no portal, na lista da nutricionista, na página do documento e na /v. */
export const linhaDaAssinatura = (t: TipoAssinatura): string => `Assinatura: ${ROTULO_ASSINATURA[t]}`;
export type SituacaoVerificacao = 'valido' | 'substituido' | 'cancelado' | 'eliminado';
export type EventoRecibo = 'aberto' | 'recebido';
export type ViaRecibo = 'portal' | 'link_email' | 'pessoalmente';
export const TIPO_DOCUMENTO_ROTULO = { receita: 'Receita' } as const;

/**
 * D5 da spec (RASCUNHO até a revisão da Debby e a consulta ao CRN-3, runbook passo 3). Minor 10 da revisão de normas:
 * o texto cita também os medicamentos isentos de prescrição à base de vitaminas, minerais, aminoácidos e/ou proteínas
 * (Res. CFN 656/2020, art. 1º, § 1º) — registrado na spec v0.3.1 como o texto proposto que vai à Debby e ao CRN-3.
 */
export const DECLARACAO_RECEITA =
  'Declaro que os itens são suplementos alimentares, medicamentos isentos de prescrição à base de vitaminas, minerais, aminoácidos e/ou proteínas, produtos vegetais classificáveis como alimento ou suplemento ou fitoterápicos isentos de prescrição médica, dentro da minha competência (Resoluções CFN nº 656/2020 e nº 680/2021), e que a receita não indica marca nem local de compra.';
export const MSG_DECLARACAO = 'Confirme a declaração para continuar.';

/**
 * RN-157: fotos da digitalizada acima disto são recusadas pelo cabeçalho, sem decodificar (como o diário e a capa): uma
 * "bomba de pixels" decodificada no worker derrubaria o processo e o pg-boss repetiria o job em laço.
 */
export const MAX_PIXELS_FOTO = 40_000_000;
/** D24: um envio digitalizado "recebendo"/"pendente" vale por 1 h; depois, a varredura o expira e outro envio pode começar. */
export const DIGITALIZACAO_MAX_MS = 3_600_000;
