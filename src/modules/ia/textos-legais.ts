import type { TenantRow } from '@/db/schema';
import type { DestinoIA, UsoIA } from './constantes';

/**
 * Plano 11 (A-D20) e Plano 14A (A-D23 a A-D25, RN-107, RN-109, §18.5): os textos legais da IA, na redação do parecer
 * JUR-2026-013 (itens 4.1 e 4.2), PROVISÓRIOS até o advogado da OAB (B3). O interruptor da admin (tenants.ia_liberada,
 * D22) impede o uso real antes da versão final, que será a **1.0** (a parte numérica sobe: força nova autorização e novo
 * aceite de todos). Qualquer mudança no que sai para a IA também sobe AUTORIZACAO_IA_VERSAO_MIN (RN-109) — inclusive os
 * usos da 14B (F2).
 */
/** C1 / US-101: 0.2 — a 0.1-provisorio não serviria (versaoAtende só olha a parte numérica). A definitiva será a 1.0. */
export const IA_ADITIVO_VERSAO = '0.2-provisorio';
export const IA_ADITIVO_VERSAO_MIN = '0.2-provisorio';
export const IA_ADITIVO_TERMO = `ia-aditivo-${IA_ADITIVO_VERSAO}`;
export const AUTORIZACAO_IA_VERSAO = '0.1-provisorio';
export const AUTORIZACAO_IA_VERSAO_MIN = '0.1-provisorio';
/** US-108 "Data inválida": o termo em papel não pode ser de antes do início desta versão (é também a data impressa no texto). */
export const AUTORIZACAO_IA_VERSAO_DATA = '2026-10-09';
/**
 * F2 (parecer JUR-2026-013, §18.5): a versão 0.1 autoriza só a leitura de laudos. O resumo e o rascunho (14B) entram
 * numa versão nova do texto, que sobe o mínimo e pede autorização nova de todos (RN-109).
 */
export const AUTORIZACAO_IA_USOS: readonly UsoIA[] = ['leitura_laudos'];

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
/**
 * Parecer JUR-2026-013, item 4.1, sem os trechos [14B] (F2), com as adaptações da §18.5: (a) "a: (1) ler…" vira "a ler…"
 * (sobrou um uso só); (b) "Os seus dados saem do Brasil."; (c) "Versão 1.0, de {data}" vira "Versão provisória 0.1, de
 * {data}, em revisão jurídica." até o advogado da OAB.
 */
const AUTORIZACOES_IA: Record<string, (d: DadosDoTexto) => TextoLegal> = {
  '0.1-provisorio': (d) => ({
    titulo: 'Autorização para uso de inteligência artificial',
    paragrafos: [
      [n(`${d.consultorio} pede a sua autorização para usar uma ferramenta de inteligência artificial (IA) com os seus dados de saúde. Esta autorização é só para isso, é separada do termo de uso do app e é pessoal: só você pode dar.`)],
      [
        b('Quem é responsável.'),
        n(` A responsável pelos seus dados é a sua nutricionista, ${d.nutricionista}, ${d.crn}, contato: ${d.contato}. A plataforma NutriDebby (WEB SMART SISTEMAS+13 LTDA, CNPJ 66.657.250/0001-07) trata os dados em nome dela e contrata o fornecedor da IA.`),
      ],
      [
        b('Para que serve.'),
        n(' A IA ajuda a sua nutricionista a ler os laudos dos seus exames e sugerir os valores para o seu prontuário. A IA só sugere. A nutricionista confere tudo antes de usar e continua responsável pelo seu atendimento. A IA não faz diagnóstico, não interpreta os seus exames, não receita e não fala com você.'),
      ],
      [
        b('Benefícios e riscos.'),
        n(' O benefício é a nutricionista gastar menos tempo digitando e preparando, e ter mais tempo para você. Os riscos são dois: a IA pode errar, e por isso a nutricionista confere tudo; e os seus dados saem do Brasil, como explicado abaixo.'),
      ],
      [
        b('O que é enviado.'),
        n(' Na leitura de laudos, vai o laudo inteiro, com o seu nome, a sua data de nascimento e tudo o que estiver impresso nele. Só são retirados os dados escondidos do arquivo, como autor e localização. Nada além do que está descrito aqui é enviado. Se isso mudar, pediremos uma nova autorização.'),
      ],
      PARA_ONDE_VAI[d.destino],
      [
        b('Por quanto tempo.'),
        n(` O fornecedor usa os dados só para devolver a resposta, não os usa para treinar a IA e não os guarda depois da resposta.${EXCECAO_DE_RETENCAO[d.destino] ?? ''} A sugestão da IA fica guardada no NutriDebby por até 7 dias, até a nutricionista usar ou descartar. O que ela usar passa a fazer parte do seu prontuário. Cada envio fica registrado e aparece na cópia dos seus dados, que você pode pedir no app (Baixar meus dados) ou à sua nutricionista.`),
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
      [n(`Versão provisória 0.1, de ${dataBr(AUTORIZACAO_IA_VERSAO_DATA)}, em revisão jurídica.`)],
    ],
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
const MECANISMO: Record<DestinoIA, string> = {
  'anthropic-us': 'A transferência se apoia no consentimento específico e em destaque de cada paciente (LGPD, art. 33, VIII), registrado na plataforma.',
  'bedrock-eu': 'A transferência se apoia na decisão de adequação da União Europeia (Resolução CD/ANPD nº 32/2026; LGPD, art. 33, I). Além disso, a plataforma exige a autorização de cada paciente.',
  teste: 'Ambiente de teste: nenhum dado de paciente sai para fornecedor.',
};
const SALVO: Record<DestinoIA, string> = {
  'anthropic-us': 'exigência legal ou conteúdo sinalizado pelos sistemas de segurança dele, que pode ser guardado por até 2 anos',
  'bedrock-eu': 'conteúdo ilegal em imagens detectado pelos sistemas de segurança dele',
  teste: 'nada (ambiente de teste)',
};

/**
 * US-101 (Plano 14A): o aditivo 0.2-provisorio na redação do parecer JUR-2026-013, item 4.2, sem os trechos [14B] (F2),
 * com as variantes do destino (RN-109) e as adaptações da §18.5: (d) a frase do "nenhum operador" e do registro de chamadas
 * só na variante do Bedrock; (e) "Versão 1.0" vira a frase da versão provisória.
 */
export function aditivoIa(destino: DestinoIA): TextoLegal {
  const operador = destino === 'bedrock-eu' ? ' No Amazon Web Services, nenhum operador do serviço tem acesso ao conteúdo, e o registro de chamadas fica desligado na conta.' : '';
  return {
    titulo: 'Aditivo de inteligência artificial ao contrato de tratamento de dados',
    paragrafos: [
      '1. Partes e objeto. Este aditivo complementa o contrato de tratamento de dados (DPA) entre a nutricionista titular da conta (CONTROLADORA) e WEB SMART SISTEMAS+13 LTDA, CNPJ 66.657.250/0001-07 (OPERADORA), para o uso de inteligência artificial (IA) no consultório. Vale a partir do aceite e enquanto a IA estiver ativada.',
      '2. Finalidades. Com dados de paciente: (a) ler o laudo de exame que a CONTROLADORA escolher e sugerir os valores para o prontuário. Sem dados de paciente: sugerir modelos de plano alimentar e de anamnese por área de atendimento. A IA não diagnostica, não interpreta exames, não prescreve e não fala com o paciente. Nada entra no prontuário nem chega ao paciente sem a conferência e a ação da CONTROLADORA. Ela avalia criticamente cada sugestão e responde pela conduta profissional, conforme o Código de Ética e de Conduta do Nutricionista.',
      `3. Fornecedor e país. O fornecedor em uso aparece no painel e no texto da autorização do paciente: ${FORNECEDOR[destino]}. A OPERADORA responde pelo fornecedor perante a CONTROLADORA, nos termos do DPA. A troca de fornecedor segue a cláusula 7 do DPA, com aviso de 15 dias, e torna necessária uma nova autorização de todos os pacientes.`,
      `4. Transferência internacional. ${MECANISMO[destino]} Em qualquer caso, nenhum dado de paciente vai à IA sem a autorização vigente dele, registrada com a versão, os usos, o destino, a data e o canal.`,
      '5. O que é enviado. Na leitura, só o arquivo do laudo, sem metadados. Os dados impressos nele vão junto. Nos modelos, nenhum dado de paciente. A OPERADORA não envia nada além do que o texto da autorização descreve. Qualquer mudança gera nova versão e nova autorização.',
      `6. Retenção. A plataforma só usa a IA com dados de paciente enquanto houver retenção zero com o fornecedor: ele não guarda o conteúdo depois da resposta, salvo ${SALVO[destino]}, e não o usa para treinar modelos.${operador} A sugestão fica guardada na plataforma por até 7 dias, até ser salva ou descartada. O registro técnico do uso (data, situação e custo, sem conteúdo) é mantido.`,
      '7. Deveres da CONTROLADORA. Antes de usar a IA com os dados de um paciente, a CONTROLADORA: (a) obtém a autorização dele pela plataforma: no app, pelo link enviado por e-mail ou pelo termo impresso, assinado e registrado com a foto ou o PDF de todas as páginas. Guarda o original em papel na pasta do paciente e entrega a ele uma via; (b) não pressiona nem condiciona o atendimento: recusar ou retirar não muda nada; (c) registra a retirada quando o paciente pedir; (d) confere cada sugestão antes de usá-la; (e) só usa a IA com pacientes adultos e com laudos do próprio paciente; (f) mantém o sigilo profissional. A confidencialidade do fornecedor está garantida pelo contrato dele com a OPERADORA e por este aditivo.',
      '8. Bloqueios automáticos. A plataforma não envia à IA dados de paciente sem autorização vigente para aquele uso e destino, de paciente bloqueado, arquivado ou anonimizado, sem retenção zero confirmada, nem quando o limite mensal de custo do consultório foi atingido.',
      '9. Registro e direitos do paciente. Cada pedido, cada envio de dados ao fornecedor e cada abertura da sugestão aparecem no histórico de acessos do paciente. O paciente que pedir os seus dados recebe as autorizações, a data de cada envio e o nome e o país do fornecedor.',
      '10. Selo e transparência. A CONTROLADORA observa as regras do CFN sobre informar o uso de ferramentas automatizadas.',
      '11. Desativação e limite. A CONTROLADORA pode desativar a IA a qualquer momento. A OPERADORA pode suspendê-la por motivo de segurança, mudança do fornecedor ou de norma, avisando a CONTROLADORA. O uso tem um limite mensal de custo por consultório, informado no painel.',
      'Versão provisória 0.2, em revisão jurídica. Quando a versão definitiva for publicada, um novo aceite será pedido.',
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
