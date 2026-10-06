/**
 * Plano 11 (A-D19, A-D20, D13 ★): aviso de IA ao paciente e aditivo de IA da nutricionista. Texto PROVISÓRIO até o
 * advogado (E-09), como DPA_VERSAO e TERMO_PACIENTE_VERSAO; o interruptor da admin (tenants.ia_liberada) impede o uso real
 * antes disso. Versão final: nova entrada em AVISOS_IA e as constantes *_MIN sobem (quem aceitou a provisória volta a
 * "não informado"/"aceite a versão atual").
 */
export const AVISO_IA_VERSAO = '0.1-provisorio';
export const AVISO_IA_VERSAO_MIN = '0.1-provisorio';
export const IA_ADITIVO_VERSAO = '0.1-provisorio';
export const IA_ADITIVO_VERSAO_MIN = '0.1-provisorio';
export const IA_ADITIVO_TERMO = `ia-aditivo-${IA_ADITIVO_VERSAO}`;

type Texto = { titulo: string; paragrafos: readonly string[] };

const AVISOS_IA: Record<string, Texto> = {
  '0.1-provisorio': {
    titulo: 'Aviso sobre o uso de inteligência artificial',
    paragrafos: [
      'Sua nutricionista pode usar uma ferramenta de inteligência artificial (IA) para ler os laudos de exames que você entrega e transcrever os valores para o seu prontuário. A IA só sugere: a nutricionista confere cada valor antes de salvar e continua responsável pelo seu atendimento.',
      'Para isso, o laudo inteiro é enviado à Anthropic, empresa que fornece a IA e processa os dados nos Estados Unidos, só para devolver a leitura: vão junto o seu nome, a sua data de nascimento e os demais dados impressos no laudo (o laudo não é anonimizado). Só os dados escondidos do arquivo, como autor e localização, são retirados antes do envio. O laudo não é usado para treinar a IA.',
      'A Anthropic não guarda o laudo depois da resposta, salvo quando a lei exigir ou quando os sistemas de segurança dela sinalizarem o conteúdo; nesse caso, pode guardá-lo por até 2 anos.',
      'A sugestão da IA fica guardada por até 7 dias, até a nutricionista salvar ou descartar. Os valores que ela salvar fazem parte do seu prontuário.',
      'Se você preferir não usar inteligência artificial com os seus dados, peça à sua nutricionista. A recusa não muda o seu atendimento: os valores continuam sendo lançados à mão.',
      'Versão provisória 0.1, em revisão jurídica.',
    ],
  },
};

export function avisoDaVersao(versao: string): Texto {
  return AVISOS_IA[versao] ?? AVISOS_IA[AVISO_IA_VERSAO];
}

export const IA_ADITIVO_TITULO = 'Aditivo de inteligência artificial';
export const IA_ADITIVO_PARAGRAFOS: readonly string[] = [
  'Este aditivo complementa o contrato de tratamento de dados (DPA) entre a nutricionista titular da conta (controladora) e a plataforma NutriDebby (operadora), para a leitura de laudos de exames com inteligência artificial.',
  'Suboperador: Anthropic (Claude), com processamento nos Estados Unidos. Finalidade: transcrever os valores do laudo enviado pela nutricionista, que confere cada valor antes de salvar. Nenhum dado é usado para treinar a IA. Com a retenção zero, o fornecedor não guarda o conteúdo depois da resposta, salvo exigência legal ou conteúdo sinalizado pelos sistemas de segurança dele (até 2 anos).',
  'Só o arquivo do laudo é enviado, sem metadados; os dados impressos nele (nome, data de nascimento, médico, laboratório) vão junto. A sugestão fica guardada por até 7 dias. O uso da IA tem um limite mensal de custo por consultório, definido pelo suporte.',
  'A controladora informa cada paciente sobre o uso de IA antes de usá-la com os dados dele (aviso de IA) e respeita o pedido de quem não quiser.',
  'A plataforma só libera o uso com dados reais depois da contratação de retenção zero com o fornecedor e da revisão jurídica deste texto.',
  'Versão provisória 0.1, em revisão jurídica. Quando a versão definitiva for publicada, um novo aceite será pedido.',
];

/** Compara só a parte numérica (`1.10` > `1.9`); qualquer coisa fora do formato não atende. */
export function versaoAtende(versao: string | null, minima: string): boolean {
  const num = (v: string) => (/^\d+(\.\d+)*/.exec(v)?.[0] ?? null)?.split('.').map(Number) ?? null;
  const a = versao ? num(versao) : null;
  const b = num(minima);
  if (!a || !b) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}
