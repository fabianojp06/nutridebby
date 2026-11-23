import type { ConteudoDocumento } from './parecer';

/**
 * Planos 10A e 10B — documentos assinados. SEM imports de valor (Plano 22: só o `import type` acima, apagado na
 * compilação): componentes 'use client' leem daqui (como marca-constantes.ts).
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
/**
 * Plano 13: o parecer nutricional (F3-05) ao lado da receita. "Receita" no banco e na tela (D16 do 10A). Plano 22 (RN-397,
 * EP-D1): a solicitação de exames laboratoriais. Quem decide pelo tipo usa `switch` + `assertNever`
 * (`tipos-de-documento.ts`), nunca "o que não é parecer é receita" (DEP-E7).
 */
export const TIPO_DOCUMENTO_ROTULO = { receita: 'Receita', parecer: 'Parecer nutricional', solicitacao_exames: 'Solicitação de exames laboratoriais' } as const;
export type TipoDocumento = keyof typeof TIPO_DOCUMENTO_ROTULO;
/** Leitor de tela no portal ("Abrir PDF da receita de …", "Abrir PDF do parecer nutricional de …"): o artigo muda com o tipo. */
export const TIPO_DOCUMENTO_COM_ARTIGO: Record<TipoDocumento, string> = {
  receita: 'da receita',
  parecer: 'do parecer nutricional',
  solicitacao_exames: 'da solicitação de exames laboratoriais',
};

/**
 * D5 da spec (RASCUNHO até a revisão da Debby e a consulta ao CRN-3, runbook passo 3). Minor 10 da revisão de normas:
 * o texto cita também os medicamentos isentos de prescrição à base de vitaminas, minerais, aminoácidos e/ou proteínas
 * (Res. CFN 656/2020, art. 1º, § 1º) — registrado na spec v0.3.1 como o texto proposto que vai à Debby e ao CRN-3.
 */
export const DECLARACAO_RECEITA =
  'Declaro que os itens são suplementos alimentares, medicamentos isentos de prescrição à base de vitaminas, minerais, aminoácidos e/ou proteínas, produtos vegetais classificáveis como alimento ou suplemento ou fitoterápicos isentos de prescrição médica, dentro da minha competência (Resoluções CFN nº 656/2020 e nº 680/2021), e que a receita não indica marca nem local de compra.';
/** D5 da spec (RASCUNHO até a revisão da Debby e a consulta ao CRN-3, P-B1): a declaração ao preparar o parecer (RN-148). */
export const DECLARACAO_PARECER = 'Declaro que este parecer não afirma diagnóstico de doença nem prescreve medicamento.';
/** D5 da spec (RASCUNHO, como a declaração): a ressalva fixa impressa no PDF do parecer (§3.1). */
export const RESSALVA_PARECER = 'Este parecer trata do estado nutricional e não constitui diagnóstico de doença nem substitui avaliação médica.';
/**
 * Plano 22 (RN-389, §6.2; RASCUNHO para a Debby e o CRN-3, §14.3): a declaração ao preparar a solicitação de exames.
 * Aqui, sem imports, para os componentes 'use client'; `solicitacao.ts` reexporta (R22-14). Em `DECLARACAO_POR_TIPO`
 * desde a T7, com o tipo `solicitacao_exames` (EP-D49).
 */
export const DECLARACAO_SOLICITACAO =
  'Declaro que os exames solicitados são laboratoriais e necessários à avaliação, à prescrição ou à evolução nutricional, dentro da minha competência (Lei nº 8.234/1991, art. 4º, VIII, e Resolução CFN nº 306/2003), e que este pedido não indica laboratório.';
export const DECLARACAO_POR_TIPO: Record<TipoDocumento, string> = {
  receita: DECLARACAO_RECEITA,
  parecer: DECLARACAO_PARECER,
  solicitacao_exames: DECLARACAO_SOLICITACAO,
};
export const MSG_DECLARACAO = 'Confirme a declaração para continuar.';

/**
 * Plano 22 (RN-392, EP-D56; RASCUNHO para a Debby e o CRN-3, como a declaração): a frase que a declaração da receita ganha,
 * antes do ponto final, quando a receita tem a fórmula magistral fitoterápica (Res. CFN 680/2021, art. 9º, II).
 */
export const FRASE_FORMULA_FITOTERAPICA =
  ', e que a fórmula magistral fitoterápica tem só derivados vegetais, sem vitaminas, minerais, aminoácidos ou substâncias isoladas (Resolução CFN nº 680/2021, art. 9º, II)';

/**
 * Plano 22 (EP-D56): a declaração gravada no preparo E mostrada na tela (o mesmo texto, do mesmo conteúdo). A declaração
 * continua por tipo de documento (`DECLARACAO_POR_TIPO`); só a da receita com `formula_fitoterapica` ganha a frase. Aqui
 * o `=== 'receita'` não decide o tipo por exclusão (DEP-E7): todo tipo cai em `DECLARACAO_POR_TIPO[c.tipo]`.
 */
export function declaracaoDoDocumento(c: ConteudoDocumento): string {
  if (c.tipo === 'receita' && c.itens.some((i) => i.tipo === 'formula_fitoterapica')) return `${DECLARACAO_RECEITA.replace(/\.$/, '')}${FRASE_FORMULA_FITOTERAPICA}.`;
  return DECLARACAO_POR_TIPO[c.tipo];
}

/** Q13-5 ★ (proposto na spec v0.5): a versão no portal e no link ("Versão 2") e no PDF e no painel (a linha abaixo do título). */
export const rotuloDaVersao = (versao: number): string => `Versão ${versao}`;
export const linhaDaVersao = (versao: number, codigoAnterior: string): string => `Versão ${versao} — substitui o documento ${codigoAnterior}`;
/** US-148 / Q13-1 ★ e US-149 (texto exato da spec v0.5). */
export const MSG_RETIFICACAO = {
  motivo: 'Escreva o motivo da retificação (até 500 caracteres).',
  emAndamento: (versao: number) => `Há uma retificação em andamento (versão ${versao}). Conclua ou apague a retificação antes de cancelar.`,
} as const;

/**
 * RN-157: fotos da digitalizada acima disto são recusadas pelo cabeçalho, sem decodificar (como o diário e a capa): uma
 * "bomba de pixels" decodificada no worker derrubaria o processo e o pg-boss repetiria o job em laço.
 */
export const MAX_PIXELS_FOTO = 40_000_000;
/** D24: um envio digitalizado "recebendo"/"pendente" vale por 1 h; depois, a varredura o expira e outro envio pode começar. */
export const DIGITALIZACAO_MAX_MS = 3_600_000;

/**
 * Um envio digitalizado em curso (recebendo ou pendente) que ainda não expirou: outro envio espera (D24) e "Voltar a
 * editar" também (code review do PR #19, item 9). A página do documento usa a mesma regra (Minor 7 da Etapa 3): passada
 * 1 h, mostra o formulário de novo sem esperar a varredura marcar "falhou". Aqui (sem imports) para o módulo de documentos,
 * a digitalizada e a página usarem a mesma.
 */
export const envioEmCurso = (d: { digitalizacaoStatus: string | null; digitalizacaoEm: Date | null }, agora: Date) =>
  (d.digitalizacaoStatus === 'recebendo' || d.digitalizacaoStatus === 'pendente') && !!d.digitalizacaoEm && agora.getTime() - d.digitalizacaoEm.getTime() < DIGITALIZACAO_MAX_MS;

/**
 * RN-141 (preparando/aguardando_assinatura → rascunho), na tela (code review do PR #19, item 9): em "Preparando o PDF"
 * só com o PDF falho ou sem cota (senão o documento ficaria preso; com o PDF a caminho, a tela só acompanha); em
 * "Aguardando assinatura", fora de um envio digitalizado em curso (o módulo também o recusa).
 */
export const podeVoltarAEditar = (
  d: { status: StatusDocumento; pdfStatus: string | null; digitalizacaoStatus: string | null; digitalizacaoEm: Date | null }, agora: Date,
): boolean =>
  d.status === 'preparando' ? d.pdfStatus === 'falhou' || d.pdfStatus === 'sem_cota' : d.status === 'aguardando_assinatura' && !envioEmCurso(d, agora);
