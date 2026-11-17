import type { TenantRow } from '@/db/schema';
import { FRASE_DA_CATEGORIA_IA_NUTRI } from './campos-enviados';
import type { DestinoIA, UsoIA } from './constantes';
import { NOME_IA_NUTRI, RETENCAO_DIAS, RISCO_REVOGADO_MAX_DIAS } from './nutri-paciente/constantes';

/**
 * Plano 11 (A-D20) e Plano 14A (A-D23 a A-D25, RN-107, RN-109, §18.5): os textos legais da IA, na redação do parecer
 * JUR-2026-013 (itens 4.1 e 4.2), sem os trechos [14B]. **A-D27 (dono, 09/10/2026):** publicados como **1.0 sem a
 * validação do advogado da OAB** (risco assumido pelo dono; item no backlog), com a retenção de até 30 dias da Anthropic
 * direta. A 1.0 sobe a parte numérica: quem autorizou ou aceitou nas provisórias (0.1/0.2) autoriza e aceita de novo.
 * Qualquer mudança no que sai para a IA também sobe AUTORIZACAO_IA_VERSAO_MIN (RN-109) — inclusive os usos da 14B (F2).
 *
 * D21 (Plano 14B, sobre a A-D27): 1.1 — o aditivo e a autorização com os trechos [14B] do parecer. Versão final, sem
 * "provisorio", como a 1.0 publicada pelo dono sem o advogado; os trechos adaptados (desvio 10) estão na lista do P14A-16.
 *
 * D27 / DP-3 (Plano 15): o aditivo 1.2 traz a finalidade (e), a IA Nutri do paciente. Versão final, na linha da A-D27 (as
 * frases novas dos itens 2 a 9 vão ao P14A-16). D26: a IA Nutri depende só do consentimento próprio do paciente, nunca da
 * autorização dos usos (a) a (c) — os itens 3, 4, 5 e 8 dizem as duas bases separadas (revisão da T4). Só a IA Nutri exige a 1.2 (IA_NUTRI_ADITIVO_VERSAO_MIN); as
 * outras funções seguem com o mínimo 1.1 — quem aceitou a 1.1 não aceita de novo para laudos, resumo, rascunho e modelos.
 */
export const IA_ADITIVO_VERSAO = '1.2';
export const IA_ADITIVO_VERSAO_MIN = '1.1';
export const IA_NUTRI_ADITIVO_VERSAO_MIN = '1.2';
export const IA_ADITIVO_TERMO = `ia-aditivo-${IA_ADITIVO_VERSAO}`;
/** A data impressa no fim do aditivo 1.2. */
export const IA_ADITIVO_VERSAO_DATA = '2026-10-14';
/** F2 / RN-109 (Plano 14B): a versão nova lista os três usos; o mínimo sobe junto — a 1.0 (só leitura) não vale mais. */
export const AUTORIZACAO_IA_VERSAO = '1.1';
export const AUTORIZACAO_IA_VERSAO_MIN = '1.1';
/**
 * A data impressa em cada versão. US-108 "Data inválida": a da versão atual é também o piso da data do termo em papel. Um
 * termo impresso na 1.0 e assinado depois do deploy da 1.1 não passa pelo código de referência, que inclui a versão.
 */
export const DATA_DA_VERSAO: Record<string, string> = { '0.1-provisorio': '2026-10-09', '1.0': '2026-10-09', '1.1': '2026-10-09' };
export const AUTORIZACAO_IA_VERSAO_DATA = DATA_DA_VERSAO[AUTORIZACAO_IA_VERSAO];
/**
 * F2 (parecer JUR-2026-013, §18.5): a 0.1 e a 1.0 autorizavam só a leitura de laudos; a 1.1 (Plano 14B) traz o resumo do
 * histórico e o rascunho de plano, e por isso subiu o mínimo e pede autorização nova de todos (RN-109).
 */
export const AUTORIZACAO_IA_USOS: readonly UsoIA[] = ['leitura_laudos', 'resumo_historico', 'rascunho_plano'];
/** O que cada uso faz, como no texto 1.1 (e-mail de confirmação, telas). */
export const DESCRICAO_DO_USO: Record<UsoIA, string> = {
  leitura_laudos: 'ler os laudos dos seus exames e sugerir os valores para o seu prontuário',
  resumo_historico: 'resumir o seu histórico antes da consulta',
  rascunho_plano: 'montar um primeiro rascunho do seu plano alimentar, que a nutricionista revisa',
};

/**
 * RN-107 (revisão da T6, I1): a versão, os usos e o destino do texto que o paciente LEU. A tela que mostra o texto manda
 * isto de volta com o "Autorizo", e a gravação confere com os de agora: um deploy entre a leitura e o toque (troca de
 * IA_PROVEDOR, versão ou usos novos) não pode gravar um consentimento a um texto que o paciente não viu (prova só de
 * inclusão, art. 8º, § 2º; informação prévia do art. 33, VIII).
 */
export type TextoExibido = { versao: string; destino: DestinoIA; usos: readonly UsoIA[] };
export const textoExibido = (destino: DestinoIA): TextoExibido => ({ versao: AUTORIZACAO_IA_VERSAO, destino, usos: [...AUTORIZACAO_IA_USOS] });

/** O que veio do cliente (não confiável) é o texto de agora para `destino`? Os usos como conjunto, sem repetição. */
export function conferirTextoExibido(exibido: unknown, destino: DestinoIA): boolean {
  if (!exibido || typeof exibido !== 'object') return false;
  const e = exibido as Record<string, unknown>;
  if (e.versao !== AUTORIZACAO_IA_VERSAO || e.destino !== destino || !Array.isArray(e.usos)) return false;
  const usos = e.usos as unknown[];
  const atuais: readonly unknown[] = AUTORIZACAO_IA_USOS;
  return usos.length === atuais.length && new Set(usos).size === usos.length && usos.every((u) => atuais.includes(u));
}

/** Um trecho de parágrafo; `forte` = em destaque (art. 33, VIII: "em destaque"). O destaque é apresentação, não redação. */
export type Trecho = { texto: string; forte?: true };
export type Paragrafo = readonly Trecho[];
export type TextoLegal = { titulo: string; paragrafos: readonly Paragrafo[] };
export const textoCorrido = (p: Paragrafo): string => p.map((t) => t.texto).join('');
const n = (texto: string): Trecho => ({ texto });
const b = (texto: string): Trecho => ({ texto, forte: true });
const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Desvio 7: o texto cita a responsável; sem nome profissional, CRN ou e-mail de contato, não há como pedir. */
export type Responsavel = { consultorio: string; nutricionista: string; crn: string; contato: string };
export function responsavelDoTenant(t: Pick<TenantRow, 'nomeExibicao' | 'nomeProfissional' | 'crn' | 'contatoEmail'>): Responsavel | null {
  if (!t.nomeProfissional || !t.crn || !t.contatoEmail) return null;
  return { consultorio: t.nomeExibicao, nutricionista: t.nomeProfissional, crn: t.crn, contato: t.contatoEmail };
}

/** O trecho "{forma de retirar do canal}" (spec, tabela depois do texto; mantido pelo parecer): nem todo paciente tem app ou e-mail. */
export type CanalDoTexto = 'app' | 'link' | 'papel_com_email' | 'papel_sem_email';
const FORMA_DE_RETIRAR: Record<CanalDoTexto, string> = {
  app: 'no app (Eu › Privacidade), pelo link do e-mail de confirmação ou pedindo à sua nutricionista',
  link: 'pelo link "Retirar a autorização" do e-mail de confirmação, no app (Eu › Privacidade), se você usar o app, ou pedindo à sua nutricionista',
  papel_com_email: 'pelo link "Retirar a autorização" do e-mail de confirmação que você vai receber, no app (Eu › Privacidade), se você usar o app, ou pedindo à sua nutricionista',
  papel_sem_email: 'pedindo à sua nutricionista, pessoalmente ou pelo contato acima, ou no app (Eu › Privacidade), se você usar o app',
};
/**
 * RN-109: só a variante do provedor em uso. F1: no Bedrock, a autorização é exigência do consultório, não a base da
 * transferência (a base é a adequação, art. 33, I) — o texto nunca diz que a transferência "se baseia" nela. F6: o risco
 * de acesso por autoridade dos EUA. Adaptação (b) da §18.5: "Nos dois casos" vira "Os seus dados saem do Brasil." (só uma
 * variante aparece). O destino de teste nunca vai a produção (sandbox/fake recusados lá).
 */
const PARA_ONDE_VAI: Record<DestinoIA, Paragrafo> = {
  'anthropic-us': [
    b('Para onde vai.'),
    n(' Os dados são enviados à Anthropic, empresa dos Estados Unidos que fornece a IA (Claude), contratada pela plataforma NutriDebby. O processamento acontece '),
    b('nos Estados Unidos'),
    n(', um país que não tem decisão de adequação da Autoridade Nacional de Proteção de Dados (ANPD). Por isso, o envio só acontece com a sua autorização específica. Os seus dados '),
    b('saem do Brasil'),
    n('.'),
  ],
  'bedrock-eu': [
    b('Para onde vai.'),
    n(' Os dados são enviados à Amazon Web Services, que opera a IA Claude e é contratada pela plataforma NutriDebby. O processamento acontece '),
    b('em países da União Europeia'),
    n(', que a Autoridade Nacional de Proteção de Dados (ANPD) reconhece como de proteção adequada. A Amazon Web Services é uma empresa dos Estados Unidos. As leis de lá permitem, em certas situações, que autoridades americanas peçam dados a empresas americanas, mesmo fora dos Estados Unidos. Como os seus dados não ficam guardados depois da resposta, esse risco é pequeno. Mesmo com a proteção reconhecida pela ANPD, a sua nutricionista só usa a IA se você autorizar. Os seus dados '),
    b('saem do Brasil'),
    n('.'),
  ],
  teste: [b('Para onde vai.'), n(' Ambiente de teste: os dados não são enviados a nenhum fornecedor de IA.')],
};
const EXCECAO_DE_RETENCAO: Partial<Record<DestinoIA, string>> = {
  'anthropic-us': ' A exceção é quando a lei exigir ou quando os sistemas de segurança dele sinalizarem o conteúdo. Nesse caso, ele pode guardá-lo por até 2 anos.',
  'bedrock-eu': ' A exceção é quando os sistemas de segurança dele detectarem conteúdo ilegal em imagens. Nesse caso, ele pode guardá-lo e comunicá-lo às autoridades.',
};

type DadosDoTexto = Responsavel & { destino: DestinoIA; canal: CanalDoTexto; avisoPrivacidadeUrl?: string | null };

/** "Por quanto tempo", antes da exceção. Na 0.1 provisória, a promessa da retenção zero para os dois destinos. */
const RETENCAO_ZERO_NA_AUTORIZACAO = ' O fornecedor usa os dados só para devolver a resposta, não os usa para treinar a IA e não os guarda depois da resposta.';
/**
 * A-D27 (dono, 09/10/2026): na Anthropic direta, a retenção padrão aceita pelo dono — até 30 dias, só segurança e abuso,
 * sem treino (o texto não promete retenção zero, mesmo que a ZDR venha a ser concedida: fica o limite de cima). O Bedrock
 * na UE continua sem guardar (A-D4).
 */
const RETENCAO_NA_AUTORIZACAO_1_0: Record<DestinoIA, string> = {
  // revisão normativa: nada além do que o DPA da Anthropic garante (sem "só para devolver a resposta" nem "apenas para segurança")
  'anthropic-us': ' O fornecedor não usa os dados para treinar a IA. A Anthropic guarda os dados enviados por até 30 dias, para operar e proteger o serviço (por exemplo, segurança e prevenção de abuso), e depois os apaga.',
  'bedrock-eu': RETENCAO_ZERO_NA_AUTORIZACAO,
  teste: RETENCAO_ZERO_NA_AUTORIZACAO,
};
/** Revisão normativa da 1.0: o teto de 2 anos vale só para o conteúdo sinalizado; o que a lei exigir, pelo tempo da lei. */
const EXCECAO_DE_RETENCAO_1_0: Partial<Record<DestinoIA, string>> = {
  ...EXCECAO_DE_RETENCAO,
  'anthropic-us': ' Se os sistemas de segurança dele sinalizarem o conteúdo, ele pode guardá-lo por até 2 anos; se a lei exigir, pelo tempo que a lei exigir.',
};
/**
 * Transparência na 1.0 (decisão do controlador, a confirmar com o advogado — P14A-16): na Anthropic direta, os riscos da
 * guarda nos EUA, na forma do F6 da variante bedrock-eu, e a revisão humana do conteúdo sinalizado.
 */
const RISCOS_A_MAIS_1_0: Partial<Record<DestinoIA, string>> = {
  'anthropic-us': ' A Anthropic é uma empresa dos Estados Unidos e guarda os seus dados lá por até 30 dias. As leis de lá permitem, em certas situações, que autoridades americanas peçam acesso a esses dados. Se os sistemas de segurança do fornecedor sinalizarem o conteúdo, ele pode ser revisto por pessoas da equipe do fornecedor.',
};
/**
 * RN-171 / DP-2 / D37 (Plano 15, dono em 14/10/2026): o consentimento da IA Nutri é publicado como 1.0 FINAL, sem a
 * validação do advogado e do psicólogo, como a A-D27 fez com a autorização dos laudos (risco assumido pelo dono; o texto
 * está na lista do P14A-16). Nenhuma trava de produção depende dele. Frase mudada pelo advogado, pela psicóloga ou pela
 * troca do nome (D28) → versão nova aqui (ex.: '1.1') e o mínimo junto: o paciente lê e decide de novo (US-171).
 */
export const IA_NUTRI_TERMO_VERSAO = '1.0';
export const IA_NUTRI_TERMO_VERSAO_MIN = '1.0';
export const IA_NUTRI_TERMO_VERSAO_DATA = '2026-10-14';
/**
 * Como o TextoExibido da autorização (RN-107): a versão e o destino do consentimento que o paciente LEU voltam com o
 * "Ativar" e a gravação confere com os de agora (um deploy entre a leitura e o toque não grava aceite a texto não visto).
 */
export type TextoExibidoIaNutri = { versao: string; destino: DestinoIA };
export const textoExibidoIaNutri = (destino: DestinoIA): TextoExibidoIaNutri => ({ versao: IA_NUTRI_TERMO_VERSAO, destino });
/** O que veio do cliente (não confiável) é o consentimento de agora para `destino`? */
export function conferirTextoExibidoIaNutri(exibido: unknown, destino: DestinoIA): boolean {
  if (!exibido || typeof exibido !== 'object') return false;
  const e = exibido as Record<string, unknown>;
  return e.versao === IA_NUTRI_TERMO_VERSAO && e.destino === destino;
}

/**
 * LGPD art. 9º, § 1º (revisão do plano, 14/10/2026): o LIMITE DECLARADO de pseudonimizar.ts, na redação da autorização 1.1
 * (`oQueEEnviado`), dito ao paciente da IA Nutri e no item 5 do aditivo 1.2 — um texto só para cada público. Mudou a regra da
 * máscara → muda aqui e é versão nova do consentimento e do aditivo (RN-109). A redação final vai ao advogado (D11).
 */
export const LIMITE_DA_MASCARA_IA_NUTRI =
  'No que você escrever e nas orientações, o sistema retira o seu nome (completo, com o sobrenome ou só o primeiro nome), e-mail, telefone e CPF e os nomes da equipe e do consultório. Podem ir junto: o seu primeiro nome sozinho, quando tem menos de três letras ou também é uma palavra comum de alimentação (como Rosa ou Clara); outras partes do seu nome escritas sem o primeiro (como um segundo nome ou os sobrenomes); apelidos; e outros dados escritos ali, como o nome de outras pessoas, um endereço ou o número de outro documento.';
export const LIMITE_DA_MASCARA_ADITIVO_IA_NUTRI =
  'com os textos livres mascarados (nome, e-mail, telefone e CPF do paciente e os nomes da equipe e do consultório), com os limites descritos no texto do consentimento: o primeiro nome sozinho, quando tem menos de três letras ou também é palavra comum de alimentação, o segundo nome e os sobrenomes sem o primeiro nome, apelidos, endereços e outros documentos escritos no texto e dados de terceiros podem ir junto.';

/**
 * US-171: o texto do botão de aceite, citado no parágrafo da transferência do consentimento (art. 33, VIII). A tela (T7,
 * `MSG_IA_NUTRI.autorizo`) usa esta constante: o botão e a frase do texto não podem divergir.
 */
export const BOTAO_AUTORIZO_IA_NUTRI = `Autorizo o uso da ${NOME_IA_NUTRI}`;

/**
 * US-171 (spec v0.4): o texto inteiro, em destaque, na variante do destino em uso (as da 14A/A-D27: para onde vai,
 * retenção, exceção e riscos). D7 = (a), D10 = (a), D22 = (a): as frases condicionais da US-171 entram todas. DP-17: a
 * desativação também "pedindo à sua nutricionista". O "O que é enviado" é montado pelas frases de
 * FRASE_DA_CATEGORIA_IA_NUTRI (o contrato do que sai, campos-enviados.ts). Revisão da T4 (normas-cfn-lgpd): a guarda da
 * mensagem com sinal de risco vale também para o pedido de exclusão (item 6 do aditivo; apagarIaNutriDoTitular, T10;
 * art. 9º, II) e, nos destinos que saem do Brasil, o parágrafo final liga o toque no botão à transferência (art. 33, VIII).
 */
const CONSENTIMENTOS_IA_NUTRI: Record<string, (d: Responsavel & { destino: DestinoIA }) => TextoLegal> = {
  '1.0': (d) => ({
    titulo: `Antes de usar a ${NOME_IA_NUTRI}`,
    paragrafos: [
      [b(`A ${NOME_IA_NUTRI} é uma inteligência artificial, não é a sua nutricionista.`)],
      [n('Ela só responde dúvidas sobre o seu plano alimentar e as orientações que sua nutricionista publicou. Não faz diagnóstico, não muda o seu plano e não indica suplementos ou remédios.')],
      [n(`Quem é responsável pelos seus dados: ${d.nutricionista}, ${d.crn}, contato: ${d.contato}.`)],
      [b('O que é enviado: '), n(`${FRASE_DA_CATEGORIA_IA_NUTRI.plano}, ${FRASE_DA_CATEGORIA_IA_NUTRI.orientacoes} e ${FRASE_DA_CATEGORIA_IA_NUTRI.perguntas}.`)],
      [n(LIMITE_DA_MASCARA_IA_NUTRI)],
      [n('Não escreva dados de outras pessoas nem assuntos que não sejam sobre o seu plano.')],
      PARA_ONDE_VAI[d.destino],
      // a retenção do destino começa com espaço, como no "Por quanto tempo." da autorização
      [b('Por quanto tempo.'), n(`${RETENCAO_NA_AUTORIZACAO_1_0[d.destino]}${EXCECAO_DE_RETENCAO_1_0[d.destino] ?? ''}${RISCOS_A_MAIS_1_0[d.destino] ?? ''}`)],
      [n(`No NutriDebby, as conversas ficam guardadas por ${RETENCAO_DIAS} dias e depois são apagadas. Esse prazo é diferente da guarda pelo fornecedor, acima.`)],
      [n(`Sua nutricionista pode ler as suas conversas com a ${NOME_IA_NUTRI}.`)],
      [n(`Se você escrever algo que indique risco à sua saúde, a ${NOME_IA_NUTRI} mostra contatos de ajuda e avisa a sua nutricionista.`)],
      [b(`Em emergência, não use a ${NOME_IA_NUTRI}: ligue para o SAMU (192) ou o CVV (188).`)],
      [n(`Você pode desativar a ${NOME_IA_NUTRI} quando quiser em Eu › Privacidade ou pedindo à sua nutricionista; as conversas são apagadas na hora.`)],
      [n(`Se você desativar a ${NOME_IA_NUTRI} ou pedir a exclusão dos seus dados, uma mensagem com sinal de risco que sua nutricionista ainda não leu fica guardada até ela ler, por no máximo ${RISCO_REVOGADO_MAX_DIAS} dias.`)],
      [n('Recusar ou desativar não muda o seu atendimento nem a autorização de IA para os seus exames.')],
      // art. 33, VIII ("distinguindo claramente esta de outras finalidades"), no molde do último parágrafo da autorização
      // da 14A: o toque no botão é o consentimento para a transferência; no destino de teste nada sai do Brasil
      ...(d.destino === 'teste' ? [] : [[n(`Ao tocar em "${BOTAO_AUTORIZO_IA_NUTRI}", você autoriza o envio do seu plano, das orientações e das suas perguntas para fora do Brasil, ao destino acima, só para responder às suas dúvidas sobre o plano.`)]]),
      [n(`Versão 1.0, de ${dataBr(IA_NUTRI_TERMO_VERSAO_DATA)}.`)],
    ],
  }),
};
/** O consentimento da versão pedida, com o destino em uso; versão que não existe → null. */
export function textoDoConsentimentoIaNutri(versao: string, d: Responsavel & { destino: DestinoIA }): TextoLegal | null {
  return CONSENTIMENTOS_IA_NUTRI[versao]?.(d) ?? null;
}

/** "Para que serve" e "O que é enviado" da 0.1 e da 1.0 (só a leitura de laudos, F2). */
const PARA_QUE_SERVE_LEITURA = 'A IA ajuda a sua nutricionista a ler os laudos dos seus exames e sugerir os valores para o seu prontuário.';
const FECHO_PARA_QUE_SERVE_LEITURA = 'A IA não faz diagnóstico, não interpreta os seus exames, não receita e não fala com você.';
const LEITURA_ENVIA = 'Na leitura de laudos, vai o laudo inteiro, com o seu nome, a sua data de nascimento e tudo o que estiver impresso nele. Só são retirados os dados escondidos do arquivo, como autor e localização.';
/**
 * O que muda entre as versões: a retenção, a exceção, os riscos a mais e o rodapé (A-D27) e, desde a 1.1 (Plano 14B), os
 * dois parágrafos dos usos e o fecho do "Para que serve" (sem eles, os textos da 0.1 e da 1.0, que não mudam uma vírgula).
 */
type VarianteDoTexto = { retencao: string; excecao: string; riscos: string; rodape: string; paraQueServe?: string; fechoParaQueServe?: string; oQueEEnviado?: string };

/**
 * Parecer JUR-2026-013, item 4.1, com as adaptações da §18.5: na 0.1 e na 1.0, sem os trechos [14B] (F2), (a) "a: (1) ler…"
 * vira "a ler…" (sobrou um uso só); (b) "Os seus dados saem do Brasil.". Na 1.1, os trechos [14B] (desvio 10 do Plano 14B).
 */
function autorizacao(d: DadosDoTexto, v: VarianteDoTexto): TextoLegal {
  return {
    titulo: 'Autorização para uso de inteligência artificial',
    paragrafos: [
      [n(`${d.consultorio} pede a sua autorização para usar uma ferramenta de inteligência artificial (IA) com os seus dados de saúde. Esta autorização é só para isso, é separada do termo de uso do app e é pessoal: só você pode dar.`)],
      [
        b('Quem é responsável.'),
        n(` A responsável pelos seus dados é a sua nutricionista, ${d.nutricionista}, ${d.crn}, contato: ${d.contato}. A plataforma NutriDebby (WEB SMART SISTEMAS+13 LTDA, CNPJ 66.657.250/0001-07) trata os dados em nome dela e contrata o fornecedor da IA.`),
      ],
      [
        b('Para que serve.'),
        n(` ${v.paraQueServe ?? PARA_QUE_SERVE_LEITURA} A IA só sugere. A nutricionista confere tudo antes de usar e continua responsável pelo seu atendimento. ${v.fechoParaQueServe ?? FECHO_PARA_QUE_SERVE_LEITURA}`),
      ],
      [
        b('Benefícios e riscos.'),
        n(` O benefício é a nutricionista gastar menos tempo digitando e preparando, e ter mais tempo para você. Os riscos são dois: a IA pode errar, e por isso a nutricionista confere tudo; e os seus dados saem do Brasil, como explicado abaixo.${v.riscos}`),
      ],
      [
        b('O que é enviado.'),
        n(` ${v.oQueEEnviado ?? LEITURA_ENVIA} Nada além do que está descrito aqui é enviado. Se isso mudar, pediremos uma nova autorização.`),
      ],
      PARA_ONDE_VAI[d.destino],
      [
        b('Por quanto tempo.'),
        n(`${v.retencao}${v.excecao} A sugestão da IA fica guardada no NutriDebby por até 7 dias, até a nutricionista usar ou descartar. O que ela usar passa a fazer parte do seu prontuário. Cada envio fica registrado e aparece na cópia dos seus dados, que você pode pedir no app (Baixar meus dados) ou à sua nutricionista.`),
      ],
      [
        b('Você decide.'),
        n(' Autorizar é opcional. '),
        b('Se você não autorizar, ou se retirar a autorização depois, nada muda no seu atendimento:'),
        n(` a nutricionista faz essas tarefas sem a IA. Você pode retirar a autorização quando quiser, sem custo, ${FORMA_DE_RETIRAR[d.canal]}. A partir da retirada, nenhum dado seu é enviado à IA. O que já está no prontuário continua lá.`),
      ],
      [
        b('Seus direitos.'),
        n(` Você pode pedir à sua nutricionista acesso, correção, cópia e informações sobre o uso dos seus dados, e a eliminação do que não for obrigatório guardar (Lei nº 13.709/2018, art. 18). Se achar que os seus dados foram mal usados, pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD), em gov.br/anpd.${d.avisoPrivacidadeUrl ? ` Mais detalhes no aviso de privacidade: ${d.avisoPrivacidadeUrl}.` : ''}`),
      ],
      [
        b('Registro.'),
        n(' A sua autorização fica registrada com a data, a versão deste texto, o destino e o canal (app, link do e-mail ou termo assinado). No app e no link, também com o endereço IP e o navegador. No link, também com uma marca protegida do e-mail usado. Ela vale só para este consultório. Se o texto mudar, se surgir um uso novo, se mudar o que é enviado ou se o destino mudar, pediremos uma nova autorização.'),
      ],
      [n('Ao tocar em "Autorizo o envio para fora do Brasil" (ou ao assinar este termo, se recebê-lo impresso), você autoriza o envio dos seus dados para fora do Brasil, ao destino acima, só para as tarefas descritas.')],
      [n(v.rodape)],
    ],
  };
}

/**
 * As versões do texto. A 0.1 provisória e a 1.0 ficam para mostrar o que quem autorizou nelas leu (a 0.1 com a adaptação
 * (c) da §18.5; a 1.0, da A-D27, com o "Versão 1.0, de {data}" do parecer e a retenção do destino). A 1.1 (Plano 14B) traz
 * os três usos; o resto do texto é o da 1.0.
 */
const AUTORIZACOES_IA: Record<string, (d: DadosDoTexto) => TextoLegal> = {
  '0.1-provisorio': (d) =>
    autorizacao(d, { retencao: RETENCAO_ZERO_NA_AUTORIZACAO, excecao: EXCECAO_DE_RETENCAO[d.destino] ?? '', riscos: '', rodape: 'Versão provisória 0.1, de 09/10/2026, em revisão jurídica.' }),
  '1.0': (d) =>
    autorizacao(d, {
      retencao: RETENCAO_NA_AUTORIZACAO_1_0[d.destino],
      excecao: EXCECAO_DE_RETENCAO_1_0[d.destino] ?? '',
      riscos: RISCOS_A_MAIS_1_0[d.destino] ?? '',
      rodape: `Versão 1.0, de ${dataBr(DATA_DA_VERSAO['1.0'])}.`,
    }),
  // Plano 14B (F2): os trechos [14B] do parecer, item 4.1, com as adaptações do desvio 10 — P14A-16 (advogado da OAB)
  '1.1': (d) =>
    autorizacao(d, {
      // A-D27: a retenção, a exceção e os riscos do destino não mudam (anthropic-us: até 30 dias)
      retencao: RETENCAO_NA_AUTORIZACAO_1_0[d.destino],
      excecao: EXCECAO_DE_RETENCAO_1_0[d.destino] ?? '',
      riscos: RISCOS_A_MAIS_1_0[d.destino] ?? '',
      rodape: `Versão 1.1, de ${dataBr(DATA_DA_VERSAO['1.1'])}.`,
      // P14A-16: adaptação (a) do desvio 10 — os três usos numerados (texto do parecer)
      paraQueServe: `A IA ajuda a sua nutricionista a: (1) ${DESCRICAO_DO_USO.leitura_laudos}; (2) ${DESCRICAO_DO_USO.resumo_historico}; (3) montar um primeiro rascunho do seu plano alimentar, que ela revisa.`,
      // D27 do Plano 15: a IA Nutri do paciente virá depois — a frase vale "nestes usos", os da nutricionista
      fechoParaQueServe: 'A IA não faz diagnóstico, não interpreta os seus exames e não receita. Nestes usos, a IA não fala com você.',
      // P14A-16: adaptações (b) e (c) do desvio 10 — dizem exatamente o que o código manda (campos-enviados.ts) e o limite da máscara
      // (revisão da T6: as restrições do pedido do rascunho, §5.4, e o que a máscara deixa passar do próprio nome, RN-115 —
      // primeiro nome curto ou da lista PALAVRAS_COMUNS_ALIMENTACAO, qualquer outra parte do nome sem o primeiro — segundo nome
      // (Ana Beatriz → "Beatriz"), sobrenomes —, apelidos; art. 9º, § 1º)
      oQueEEnviado: `${LEITURA_ENVIA} No resumo e no rascunho, vão as informações do seu prontuário necessárias para a tarefa: a sua idade e o seu sexo, medidas e cálculos de gasto energético, exames, anamnese, orientações, plano, diário alimentar sem as fotos e as datas de cada registro; no rascunho, também as metas, as restrições e as preferências que a nutricionista informar; no resumo, se a nutricionista escolher, as anotações dela. O seu nome, e-mail, telefone, endereço e documentos do cadastro não vão. No lugar da data de nascimento, vai a sua idade. Nos textos escritos no prontuário e no pedido do rascunho, o sistema retira o seu nome (completo, com o sobrenome ou só o primeiro nome), e-mail, telefone e CPF. Podem ir junto: o seu primeiro nome sozinho, quando tem menos de três letras ou também é uma palavra comum de alimentação (como Rosa ou Clara); outras partes do seu nome escritas sem o primeiro nome (como um segundo nome ou os sobrenomes); apelidos; e outros dados escritos ali, como o nome de outras pessoas ou um endereço.`,
    }),
};

/** O texto da versão pedida, com o destino em uso e a forma de retirar do canal; versão que não existe → null. */
export function textoDaAutorizacao(versao: string, d: DadosDoTexto): TextoLegal | null {
  return AUTORIZACOES_IA[versao]?.(d) ?? null;
}

const FORNECEDOR: Record<DestinoIA, string> = {
  'anthropic-us': 'Anthropic (Claude), com processamento nos Estados Unidos',
  'bedrock-eu': 'Amazon Web Services (Claude), com processamento em Estados-membros da União Europeia',
  teste: 'provedor de teste, sem envio de dados a fornecedor',
};
/**
 * Revisão normativa: o DPA (cláusula 8, igual na 1.0 e na 1.1 do Plano 20) lista os suboperadores e remete o fornecedor
 * de IA a este aditivo — a cláusula 3 o inclui.
 */
const SUBOPERADORA: Record<DestinoIA, string> = {
  'anthropic-us': 'A Anthropic',
  'bedrock-eu': 'A Amazon Web Services',
  teste: 'O provedor de teste',
};
const MECANISMO: Record<DestinoIA, string> = {
  'anthropic-us': 'A transferência se apoia no consentimento específico e em destaque de cada paciente (LGPD, art. 33, VIII), registrado na plataforma.',
  'bedrock-eu': 'A transferência se apoia na decisão de adequação da União Europeia (Resolução CD/ANPD nº 32/2026; LGPD, art. 33, I). Além disso, a plataforma exige a autorização de cada paciente (na IA Nutri, o consentimento próprio dele).',
  teste: 'Ambiente de teste: nenhum dado de paciente sai para fornecedor.',
};
const SALVO: Record<DestinoIA, string> = {
  'anthropic-us': 'exigência legal ou conteúdo sinalizado pelos sistemas de segurança dele, que pode ser guardado por até 2 anos',
  'bedrock-eu': 'conteúdo ilegal em imagens detectado pelos sistemas de segurança dele',
  teste: 'nada (ambiente de teste)',
};

/**
 * A-D27: a cláusula 6 na Anthropic direta — a retenção de até 30 dias aceita pelo dono, sem prometer retenção zero.
 * No Bedrock (e no teste), a retenção zero da redação do parecer.
 */
function retencaoDoAditivo(destino: DestinoIA, operador: string): string {
  // Plano 15 (D8, D22, aditivo 1.2): a guarda das conversas da IA Nutri e da mensagem com sinal de risco de quem desativou
  const iaNutri = `Na IA Nutri, as conversas ficam guardadas na plataforma por ${RETENCAO_DIAS} dias; a mensagem com sinal de risco de quem desativou a IA Nutri ou pediu a exclusão fica até a CONTROLADORA abri-la, por no máximo ${RISCO_REVOGADO_MAX_DIAS} dias, e depois só um aviso sem o texto até o fim do prazo; na desativação, o registro sem conteúdo usado para os limites de perguntas fica até o fim do mês. `;
  if (destino === 'anthropic-us') {
    return `6. Retenção. O fornecedor não usa o conteúdo para treinar modelos. A Anthropic guarda o conteúdo enviado por até 30 dias, para operar e proteger o serviço (por exemplo, segurança e prevenção de abuso), e depois o apaga. Se os sistemas de segurança dela sinalizarem o conteúdo, ela pode guardá-lo por até 2 anos; se a lei exigir, pelo tempo que a lei exigir. A sugestão fica guardada na plataforma por até 7 dias, até ser salva ou descartada. ${iaNutri}O registro técnico do uso (data, situação e custo, sem conteúdo) é mantido.`;
  }
  return `6. Retenção. A plataforma só usa a IA com dados de paciente enquanto houver retenção zero com o fornecedor: ele não guarda o conteúdo depois da resposta, salvo ${SALVO[destino]}, e não o usa para treinar modelos.${operador} A sugestão fica guardada na plataforma por até 7 dias, até ser salva ou descartada. ${iaNutri}O registro técnico do uso (data, situação e custo, sem conteúdo) é mantido.`;
}

/**
 * US-101 (Plano 14A), A-D27 e Plano 14B (D21): o aditivo na redação do parecer JUR-2026-013, item 4.2, com os trechos
 * [14B] (finalidades (b)–(d), item 5 e o selo do item 10), com as variantes do destino (RN-109) e as adaptações da §18.5:
 * (d) a frase do "nenhum operador" e do registro de chamadas só na variante do Bedrock; na Anthropic direta, a retenção de
 * até 30 dias (cláusulas 6 e 8). Plano 15 (D27): a 1.2, com a finalidade (e) da IA Nutri nos itens 2 a 9 (D26: nos itens 3,
 * 4, 5 e 8, o consentimento da IA Nutri como base própria, independente da autorização — revisão da T4).
 * Sempre a versão atual (não há mapa por versão): quem aceitou uma versão abaixo do mínimo aceita de novo.
 */
export function aditivoIa(destino: DestinoIA): TextoLegal {
  const operador = destino === 'bedrock-eu' ? ' No Amazon Web Services, nenhum operador do serviço tem acesso ao conteúdo, e o registro de chamadas fica desligado na conta.' : '';
  return {
    titulo: 'Aditivo de inteligência artificial ao contrato de tratamento de dados',
    paragrafos: [
      '1. Partes e objeto. Este aditivo complementa o contrato de tratamento de dados (DPA) entre a nutricionista titular da conta (CONTROLADORA) e WEB SMART SISTEMAS+13 LTDA, CNPJ 66.657.250/0001-07 (OPERADORA), para o uso de inteligência artificial (IA) no consultório. Vale a partir do aceite e enquanto a IA estiver ativada.',
      // D27 (Plano 15): a finalidade (e) da IA Nutri; "Nos usos (a) a (d)" restringe a conferência prévia aos usos da
      // nutricionista; no uso (e) o paciente lê sem revisão prévia (modo (d) da D1) — revisão do plano, 14/10/2026 (art. 6º, VI)
      '2. Finalidades. Com dados de paciente: (a) ler o laudo de exame que a CONTROLADORA escolher e sugerir os valores para o prontuário; (b) resumir o histórico do paciente antes da consulta; (c) montar um rascunho de plano alimentar a partir das metas que a CONTROLADORA informar; (e) responder, no app do paciente, dúvidas sobre o plano alimentar publicado e as orientações que a CONTROLADORA publicou, só para o paciente que ela liberar e que consentir, mostrando trechos do plano e nunca texto escrito pela IA. Sem dados de paciente: (d) sugerir modelos de plano alimentar e de anamnese por área de atendimento. A IA não diagnostica, não interpreta exames e não prescreve. Nos usos (a) a (d), a IA não fala com o paciente, nada entra no prontuário nem chega ao paciente sem a conferência e a ação da CONTROLADORA, e ela avalia criticamente cada sugestão. No uso (e), o paciente lê, sem revisão prévia da CONTROLADORA, só trechos do plano e das orientações que ela publicou e textos fixos da plataforma; a CONTROLADORA decide quem é liberado e acompanha o uso como no item 7. Em todos os usos, ela responde pela conduta profissional, conforme o Código de Ética e de Conduta do Nutricionista.',
      `3. Fornecedor e país. O fornecedor em uso aparece no painel, no texto da autorização do paciente e no do consentimento da IA Nutri: ${FORNECEDOR[destino]}. ${SUBOPERADORA[destino]} atua como suboperadora da OPERADORA, além das listadas no DPA. A OPERADORA responde pelo fornecedor perante a CONTROLADORA, nos termos do DPA. A troca de fornecedor é avisada à CONTROLADORA com 15 dias de antecedência e torna necessária uma nova autorização de todos os pacientes e, na IA Nutri, um novo consentimento.`,
      `4. Transferência internacional. ${MECANISMO[destino]} Em qualquer caso, nenhum dado de paciente vai à IA sem a manifestação vigente dele, registrada na plataforma com a versão, o destino, a data e o canal: nos usos (a) a (c), a autorização, que registra também os usos; na IA Nutri, o consentimento próprio dele, independente da autorização.`,
      // P14A-16: adaptação (e) do desvio 10 — "documentos do cadastro", as restrições do rascunho e o limite da máscara, como no texto da autorização;
      // Plano 15 (art. 9º, § 1º): o que vai na conversa da IA Nutri, com o limite da máscara dito no consentimento
      `5. O que é enviado. Na leitura, só o arquivo do laudo, sem metadados. Os dados impressos nele vão junto. No resumo e no rascunho, os dados do prontuário necessários à tarefa e, no rascunho, as metas, as restrições e as preferências que a CONTROLADORA informar, como descritos no texto da autorização do paciente, sem nome, e-mail, telefone, endereço e documentos do cadastro do paciente, com a idade no lugar da data de nascimento e com os textos livres mascarados (nome, e-mail, telefone e CPF do paciente), com os limites descritos no texto da autorização: o primeiro nome sozinho, quando tem menos de três letras ou também é palavra comum de alimentação, o segundo nome e os sobrenomes sem o primeiro nome, apelidos e dados de terceiros podem ir junto. As anotações privadas da CONTROLADORA só vão quando ela marcar essa opção no pedido. Nos modelos, nenhum dado de paciente. Na IA Nutri, o plano publicado, as orientações dos últimos atendimentos e as perguntas do paciente, ${LIMITE_DA_MASCARA_ADITIVO_IA_NUTRI} A OPERADORA não envia nada além do que o texto da autorização ou, na IA Nutri, o do consentimento descreve. Qualquer mudança gera nova versão e nova autorização ou, na IA Nutri, novo consentimento.`,
      retencaoDoAditivo(destino, operador),
      // Revisão do plano (14/10/2026): os incisos (a) e (d) valem para os usos (a) a (d); os deveres da finalidade (e) (D6, D7,
      // D11, RN-185) ficam escritos, e o consentimento da IA Nutri é do próprio paciente, no app
      '7. Deveres da CONTROLADORA. Nos usos (a) a (d), antes de usar a IA com os dados de um paciente, a CONTROLADORA: (a) obtém a autorização dele pela plataforma: no app, pelo link enviado por e-mail ou pelo termo impresso, assinado e registrado com a foto ou o PDF de todas as páginas. Guarda o original em papel na pasta do paciente e entrega a ele uma via; (b) não pressiona nem condiciona o atendimento: recusar ou retirar não muda nada; (c) registra a retirada quando o paciente pedir; (d) confere cada sugestão antes de usá-la; (e) só usa a IA com pacientes adultos e com laudos do próprio paciente; (f) mantém o sigilo profissional. No uso (e), a CONTROLADORA: libera a IA Nutri paciente por paciente, avaliando se a ferramenta é adequada para ele, inclusive para quem está com o peso oculto no app; sabe que o consentimento é dado pelo próprio paciente, no app, e registra a desativação quando ele pedir; lê as dúvidas encaminhadas e as mensagens com sinal de risco e segue o protocolo de risco mostrado na fila; revisa todo mês uma amostra das conversas e as respostas marcadas como "Não ajudou"; e cumpre os deveres (b), (e) e (f). Vale a confidencialidade prevista nos contratos da OPERADORA com o fornecedor e neste aditivo.',
      `8. Bloqueios automáticos. A plataforma não envia à IA dados de paciente: nos usos (a) a (c), sem autorização vigente para aquele uso e destino; na IA Nutri, sem o consentimento próprio dele vigente para aquele destino (a autorização não é exigida), sem a liberação do paciente pela CONTROLADORA ou com a IA Nutri pausada pela OPERADORA; em qualquer uso, de paciente bloqueado, arquivado ou anonimizado, ${destino === 'anthropic-us' ? 'sem a retenção da cláusula 6 confirmada pela OPERADORA' : 'sem retenção zero confirmada'}, nem quando o limite mensal de custo do consultório foi atingido.`,
      '9. Registro e direitos do paciente. Cada pedido, cada envio de dados ao fornecedor e cada abertura da sugestão aparecem no histórico de acessos do paciente. O paciente que pedir os seus dados recebe as autorizações, a data de cada envio e o nome e o país do fornecedor. Na IA Nutri, a CONTROLADORA lê as conversas dos pacientes liberados e trata as dúvidas encaminhadas fora da plataforma ou na consulta.',
      '10. Selo e transparência. O plano alimentar criado a partir do rascunho da IA leva o selo "Elaborado com apoio de IA e revisado pela nutricionista". A CONTROLADORA observa as regras do CFN sobre informar o uso de ferramentas automatizadas.',
      '11. Desativação e limite. A CONTROLADORA pode desativar a IA a qualquer momento. A OPERADORA pode suspendê-la por motivo de segurança, mudança do fornecedor ou de norma, avisando a CONTROLADORA. O uso tem um limite mensal de custo por consultório, informado no painel.',
      `Versão 1.2, de ${dataBr(IA_ADITIVO_VERSAO_DATA)}.`,
    ].map((t) => [n(t)]),
  };
}

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
