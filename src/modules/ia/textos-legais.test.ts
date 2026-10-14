import { describe, expect, it } from 'vitest';
import { CATEGORIAS, CATEGORIAS_POR_USO, FRASE_DA_CATEGORIA } from './campos-enviados';
import {
  aditivoIa, AUTORIZACAO_IA_USOS, AUTORIZACAO_IA_VERSAO, AUTORIZACAO_IA_VERSAO_DATA, AUTORIZACAO_IA_VERSAO_MIN, DATA_DA_VERSAO, DESCRICAO_DO_USO,
  IA_ADITIVO_TERMO, IA_ADITIVO_VERSAO, IA_ADITIVO_VERSAO_DATA, IA_ADITIVO_VERSAO_MIN, responsavelDoTenant, textoCorrido, textoDaAutorizacao, versaoAtende,
} from './textos-legais';

const RESP = { consultorio: 'Consultório Debby', nutricionista: 'Debora Silva', crn: 'CRN-3 12345', contato: 'contato@debby.test' };
/** O texto 1.0 (A-D27): fica no mapa como registro do que quem autorizou nela leu; a versão atual é a 1.1 (Plano 14B). */
const corrido = (d: Parameters<typeof textoDaAutorizacao>[1]) => textoDaAutorizacao('1.0', d)!.paragrafos.map(textoCorrido);

describe('textos legais da IA (A-D19, A-D20; 1.0 publicada sem advogado pela A-D27; 1.1 com os usos da 14B)', () => {
  it('versaoAtende compara a parte numérica; nulo nunca atende', () => {
    expect(versaoAtende('0.1-provisorio', '0.1-provisorio')).toBe(true);
    expect(versaoAtende('1.0', '0.1-provisorio')).toBe(true);
    expect(versaoAtende('0.1-provisorio', '1.0')).toBe(false);
    expect(versaoAtende('1.10', '1.9')).toBe(true);
    expect(versaoAtende(null, '0.1')).toBe(false);
    expect(versaoAtende('lixo', '0.1')).toBe(false);
  });

  it('a versão atual atende à mínima; o termo do aditivo tem o prefixo ia-aditivo-', () => {
    expect(versaoAtende(IA_ADITIVO_VERSAO, IA_ADITIVO_VERSAO_MIN)).toBe(true);
    expect(IA_ADITIVO_TERMO).toBe(`ia-aditivo-${IA_ADITIVO_VERSAO}`);
  });

  it('Plano 14B (D21): as quatro versões são 1.1; quem aceitou ou autorizou na 1.0 ou nas provisórias (0.1 e 0.2) fica abaixo do mínimo e aceita de novo', () => {
    expect([AUTORIZACAO_IA_VERSAO, AUTORIZACAO_IA_VERSAO_MIN, IA_ADITIVO_VERSAO, IA_ADITIVO_VERSAO_MIN]).toEqual(['1.1', '1.1', '1.1', '1.1']);
    expect(IA_ADITIVO_TERMO).toBe('ia-aditivo-1.1');
    for (const antiga of ['1.0', '0.1-provisorio', '0.2-provisorio']) {
      expect(versaoAtende(antiga, AUTORIZACAO_IA_VERSAO_MIN), antiga).toBe(false);
      expect(versaoAtende(antiga, IA_ADITIVO_VERSAO_MIN), antiga).toBe(false);
    }
  });
});

describe('Plano 14A e A-D27 — texto da autorização 1.0 (redação do parecer JUR-2026-013, item 4.1; spec §18.5)', () => {
  it('F2: a versão 1.0 lista só a leitura de laudos (os usos da 14B entram com a versão 1.1)', () => {
    const texto = corrido({ ...RESP, destino: 'anthropic-us', canal: 'app' }).join(' ');
    for (const da14B of ['resumir o seu histórico', 'rascunho do seu plano', 'No resumo e no rascunho', 'três tarefas']) expect(texto, da14B).not.toContain(da14B);
  });

  it('anthropic-us, canal app: a redação do parecer, palavra por palavra (adaptações a e b da §18.5; retenção de 30 dias da A-D27)', () => {
    const t = textoDaAutorizacao('1.0', { ...RESP, destino: 'anthropic-us', canal: 'app' })!;
    expect(t.titulo).toBe('Autorização para uso de inteligência artificial');
    expect(t.paragrafos.map(textoCorrido)).toEqual([
      'Consultório Debby pede a sua autorização para usar uma ferramenta de inteligência artificial (IA) com os seus dados de saúde. Esta autorização é só para isso, é separada do termo de uso do app e é pessoal: só você pode dar.',
      'Quem é responsável. A responsável pelos seus dados é a sua nutricionista, Debora Silva, CRN-3 12345, contato: contato@debby.test. A plataforma NutriDebby (WEB SMART SISTEMAS+13 LTDA, CNPJ 66.657.250/0001-07) trata os dados em nome dela e contrata o fornecedor da IA.',
      'Para que serve. A IA ajuda a sua nutricionista a ler os laudos dos seus exames e sugerir os valores para o seu prontuário. A IA só sugere. A nutricionista confere tudo antes de usar e continua responsável pelo seu atendimento. A IA não faz diagnóstico, não interpreta os seus exames, não receita e não fala com você.',
      'Benefícios e riscos. O benefício é a nutricionista gastar menos tempo digitando e preparando, e ter mais tempo para você. Os riscos são dois: a IA pode errar, e por isso a nutricionista confere tudo; e os seus dados saem do Brasil, como explicado abaixo. A Anthropic é uma empresa dos Estados Unidos e guarda os seus dados lá por até 30 dias. As leis de lá permitem, em certas situações, que autoridades americanas peçam acesso a esses dados. Se os sistemas de segurança do fornecedor sinalizarem o conteúdo, ele pode ser revisto por pessoas da equipe do fornecedor.',
      'O que é enviado. Na leitura de laudos, vai o laudo inteiro, com o seu nome, a sua data de nascimento e tudo o que estiver impresso nele. Só são retirados os dados escondidos do arquivo, como autor e localização. Nada além do que está descrito aqui é enviado. Se isso mudar, pediremos uma nova autorização.',
      'Para onde vai. Os dados são enviados à Anthropic, empresa dos Estados Unidos que fornece a IA (Claude), contratada pela plataforma NutriDebby. O processamento acontece nos Estados Unidos, um país que não tem decisão de adequação da Autoridade Nacional de Proteção de Dados (ANPD). Por isso, o envio só acontece com a sua autorização específica. Os seus dados saem do Brasil.',
      'Por quanto tempo. O fornecedor não usa os dados para treinar a IA. A Anthropic guarda os dados enviados por até 30 dias, para operar e proteger o serviço (por exemplo, segurança e prevenção de abuso), e depois os apaga. Se os sistemas de segurança dele sinalizarem o conteúdo, ele pode guardá-lo por até 2 anos; se a lei exigir, pelo tempo que a lei exigir. A sugestão da IA fica guardada no NutriDebby por até 7 dias, até a nutricionista usar ou descartar. O que ela usar passa a fazer parte do seu prontuário. Cada envio fica registrado e aparece na cópia dos seus dados, que você pode pedir no app (Baixar meus dados) ou à sua nutricionista.',
      'Você decide. Autorizar é opcional. Se você não autorizar, ou se retirar a autorização depois, nada muda no seu atendimento: a nutricionista faz essas tarefas sem a IA. Você pode retirar a autorização quando quiser, sem custo, no app (Eu › Privacidade), pelo link do e-mail de confirmação ou pedindo à sua nutricionista. A partir da retirada, nenhum dado seu é enviado à IA. O que já está no prontuário continua lá.',
      'Seus direitos. Você pode pedir à sua nutricionista acesso, correção, cópia e informações sobre o uso dos seus dados, e a eliminação do que não for obrigatório guardar (Lei nº 13.709/2018, art. 18). Se achar que os seus dados foram mal usados, pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD), em gov.br/anpd.',
      'Registro. A sua autorização fica registrada com a data, a versão deste texto, o destino e o canal (app, link do e-mail ou termo assinado). No app e no link, também com o endereço IP e o navegador. No link, também com uma marca protegida do e-mail usado. Ela vale só para este consultório. Se o texto mudar, se surgir um uso novo, se mudar o que é enviado ou se o destino mudar, pediremos uma nova autorização.',
      'Ao tocar em "Autorizo o envio para fora do Brasil" (ou ao assinar este termo, se recebê-lo impresso), você autoriza o envio dos seus dados para fora do Brasil, ao destino acima, só para as tarefas descritas.',
      'Versão 1.0, de 09/10/2026.',
    ]);
  });

  it('A-D27: na anthropic-us o texto não promete retenção zero; no bedrock-eu continua dizendo que não guarda', () => {
    const us = corrido({ ...RESP, destino: 'anthropic-us', canal: 'app' }).join(' ');
    const eu = corrido({ ...RESP, destino: 'bedrock-eu', canal: 'app' }).join(' ');
    expect(us).toContain('A Anthropic guarda os dados enviados por até 30 dias, para operar e proteger o serviço (por exemplo, segurança e prevenção de abuso), e depois os apaga.');
    // revisão normativa: nada além do DPA da Anthropic (sem "só para devolver a resposta", sem "apenas para segurança"); o teto de 2 anos só para o sinalizado
    expect(us).not.toMatch(/só para devolver a resposta|apenas para segurança|exceção é quando a lei exigir/);
    expect(us).toContain('se a lei exigir, pelo tempo que a lei exigir');
    // transparência (decisão do controlador): guardados nos EUA por até 30 dias, autoridades de lá, revisão humana do sinalizado
    expect(us).toContain('A Anthropic é uma empresa dos Estados Unidos e guarda os seus dados lá por até 30 dias. As leis de lá permitem, em certas situações, que autoridades americanas peçam acesso a esses dados.');
    expect(us).toContain('pode ser revisto por pessoas da equipe do fornecedor');
    expect(eu).not.toContain('revisto por pessoas');
    expect(us).toContain('não usa os dados para treinar a IA');
    expect(us).not.toMatch(/não os guarda|não ficam guardados|retenção zero/);
    expect(eu).toContain('não os guarda depois da resposta');
    expect(eu).not.toContain('30 dias');
  });

  it('a versão provisória 0.1 continua legível (é o texto que quem autorizou nela leu), com a frase da versão provisória', () => {
    const t = textoDaAutorizacao('0.1-provisorio', { ...RESP, destino: 'anthropic-us', canal: 'app' })!.paragrafos.map(textoCorrido);
    expect(t.at(-1)).toBe('Versão provisória 0.1, de 09/10/2026, em revisão jurídica.');
    expect(t[6]).toBe('Por quanto tempo. O fornecedor usa os dados só para devolver a resposta, não os usa para treinar a IA e não os guarda depois da resposta. A exceção é quando a lei exigir ou quando os sistemas de segurança dele sinalizarem o conteúdo. Nesse caso, ele pode guardá-lo por até 2 anos. A sugestão da IA fica guardada no NutriDebby por até 7 dias, até a nutricionista usar ou descartar. O que ela usar passa a fazer parte do seu prontuário. Cada envio fica registrado e aparece na cópia dos seus dados, que você pode pedir no app (Baixar meus dados) ou à sua nutricionista.');
    expect(t[3]).not.toContain('30 dias');
  });

  it('bedrock-eu (F1, F6): a UE com a adequação, o risco das autoridades dos EUA, a autorização como exigência do consultório (nunca "se baseia"); a exceção de retenção do Bedrock', () => {
    const eu = corrido({ ...RESP, destino: 'bedrock-eu', canal: 'app' });
    const us = corrido({ ...RESP, destino: 'anthropic-us', canal: 'app' });
    expect(eu[5]).toBe(
      'Para onde vai. Os dados são enviados à Amazon Web Services, que opera a IA Claude e é contratada pela plataforma NutriDebby. O processamento acontece em países da União Europeia, que a Autoridade Nacional de Proteção de Dados (ANPD) reconhece como de proteção adequada. A Amazon Web Services é uma empresa dos Estados Unidos. As leis de lá permitem, em certas situações, que autoridades americanas peçam dados a empresas americanas, mesmo fora dos Estados Unidos. Como os seus dados não ficam guardados depois da resposta, esse risco é pequeno. Mesmo com a proteção reconhecida pela ANPD, a sua nutricionista só usa a IA se você autorizar. Os seus dados saem do Brasil.',
    );
    expect(eu[6]).toContain('A exceção é quando os sistemas de segurança dele detectarem conteúdo ilegal em imagens. Nesse caso, ele pode guardá-lo e comunicá-lo às autoridades.');
    expect(eu[6]).not.toContain('2 anos');
    expect(eu.join(' ')).not.toMatch(/se baseia|baseia-se|com base na sua autorização/);
    expect(eu.filter((p, i) => p !== us[i]).length).toBe(3); // benefícios e riscos (A-D27: o acréscimo só na anthropic-us), para onde vai e por quanto tempo
  });

  it('a forma de retirar muda só no trecho do canal (as quatro variantes da spec)', () => {
    const voceDecide = (canal: 'app' | 'link' | 'papel_com_email' | 'papel_sem_email') => corrido({ ...RESP, destino: 'anthropic-us', canal })[7];
    expect(voceDecide('link')).toContain('sem custo, pelo link "Retirar a autorização" do e-mail de confirmação, no app (Eu › Privacidade), se você usar o app, ou pedindo à sua nutricionista.');
    expect(voceDecide('papel_com_email')).toContain('sem custo, pelo link "Retirar a autorização" do e-mail de confirmação que você vai receber, no app (Eu › Privacidade), se você usar o app, ou pedindo à sua nutricionista.');
    expect(voceDecide('papel_sem_email')).toContain('sem custo, pedindo à sua nutricionista, pessoalmente ou pelo contato acima, ou no app (Eu › Privacidade), se você usar o app.');
  });

  it('com o endereço do aviso de privacidade, "Seus direitos" termina com ele; sem, a frase não aparece', () => {
    expect(corrido({ ...RESP, destino: 'anthropic-us', canal: 'app', avisoPrivacidadeUrl: 'https://x.dev/privacidade' })[8]).toMatch(/Mais detalhes no aviso de privacidade: https:\/\/x\.dev\/privacidade\.$/);
    expect(corrido({ ...RESP, destino: 'anthropic-us', canal: 'app' })[8]).not.toContain('Mais detalhes');
  });

  it('F3 (os oito requisitos do parecer, item 3.3): usos com o que vai, destino/país/retenção, nada pré-marcado, recusa sem prejuízo, retirada, versão e data, art. 18 e ANPD', () => {
    const texto = corrido({ ...RESP, destino: 'bedrock-eu', canal: 'link' }).join(' ');
    for (const requisito of [
      'ler os laudos dos seus exames', 'vai o laudo inteiro', 'países da União Europeia', 'não os guarda depois da resposta', 'Autorizar é opcional',
      'nada muda no seu atendimento', 'Você pode retirar a autorização quando quiser', 'Versão 1.0, de 09/10/2026', 'art. 18', 'gov.br/anpd',
    ]) expect(texto, requisito).toContain(requisito);
  });

  it('em destaque (art. 33, VIII): o país, o "saem do Brasil" e o "nada muda" vão em negrito', () => {
    const t = textoDaAutorizacao('1.0', { ...RESP, destino: 'anthropic-us', canal: 'app' })!;
    const fortes = t.paragrafos.flatMap((p) => p.filter((x) => x.forte).map((x) => x.texto));
    for (const f of ['nos Estados Unidos', 'saem do Brasil', 'Se você não autorizar, ou se retirar a autorização depois, nada muda no seu atendimento:', 'Para onde vai.', 'Benefícios e riscos.']) expect(fortes).toContain(f);
  });

  it('destino de teste (dev/CI/E2E) e versão desconhecida', () => {
    expect(corrido({ ...RESP, destino: 'teste', canal: 'app' })[5]).toBe('Para onde vai. Ambiente de teste: os dados não são enviados a nenhum fornecedor de IA.');
    expect(textoDaAutorizacao('9.9', { ...RESP, destino: 'teste', canal: 'app' })).toBeNull();
    expect(versaoAtende(AUTORIZACAO_IA_VERSAO, AUTORIZACAO_IA_VERSAO_MIN)).toBe(true);
  });

  it('responsavelDoTenant: sem nome profissional, CRN ou e-mail de contato → null (desvio 7)', () => {
    const t = { nomeExibicao: 'Consultório Debby', nomeProfissional: 'Debora Silva', crn: 'CRN-3 12345', contatoEmail: 'contato@debby.test' };
    expect(responsavelDoTenant(t)).toEqual(RESP);
    for (const falta of ['nomeProfissional', 'crn', 'contatoEmail'] as const) expect(responsavelDoTenant({ ...t, [falta]: null }), falta).toBeNull();
  });
});

describe('Plano 14A, A-D27 e Plano 14B — aditivo 1.1 (redação do parecer JUR-2026-013, item 4.2, com os trechos [14B]; US-101, C1)', () => {
  it('a versão é 1.1 e quem aceitou a 1.0 ou as provisórias 0.1 e 0.2 fica desatualizado', () => {
    expect(IA_ADITIVO_VERSAO).toBe('1.1');
    expect(versaoAtende(IA_ADITIVO_VERSAO, IA_ADITIVO_VERSAO_MIN)).toBe(true);
    expect(versaoAtende('1.0', IA_ADITIVO_VERSAO_MIN)).toBe(false);
    expect(versaoAtende('0.1-provisorio', IA_ADITIVO_VERSAO_MIN)).toBe(false);
    expect(versaoAtende('0.2-provisorio', IA_ADITIVO_VERSAO_MIN)).toBe(false);
    expect(IA_ADITIVO_TERMO).toBe('ia-aditivo-1.1');
  });

  it('fornecedor, mecanismo da transferência e retenção seguem o destino (F1: no Bedrock, a adequação; a autorização como exigência a mais)', () => {
    const us = aditivoIa('anthropic-us');
    const eu = aditivoIa('bedrock-eu');
    expect(eu.titulo).toBe('Aditivo de inteligência artificial ao contrato de tratamento de dados');
    const pu = us.paragrafos.map(textoCorrido);
    const pe = eu.paragrafos.map(textoCorrido);
    expect(pe[2]).toBe('3. Fornecedor e país. O fornecedor em uso aparece no painel e no texto da autorização do paciente: Amazon Web Services (Claude), com processamento em Estados-membros da União Europeia. A Amazon Web Services atua como suboperadora da OPERADORA, além das listadas no DPA. A OPERADORA responde pelo fornecedor perante a CONTROLADORA, nos termos do DPA. A troca de fornecedor é avisada à CONTROLADORA com 15 dias de antecedência e torna necessária uma nova autorização de todos os pacientes.');
    // revisão normativa: o DPA 0.1 não tem cláusulas numeradas nem cita o fornecedor de IA
    expect(pu[2]).toBe('3. Fornecedor e país. O fornecedor em uso aparece no painel e no texto da autorização do paciente: Anthropic (Claude), com processamento nos Estados Unidos. A Anthropic atua como suboperadora da OPERADORA, além das listadas no DPA. A OPERADORA responde pelo fornecedor perante a CONTROLADORA, nos termos do DPA. A troca de fornecedor é avisada à CONTROLADORA com 15 dias de antecedência e torna necessária uma nova autorização de todos os pacientes.');
    expect([...pu, ...pe].join(' ')).not.toContain('cláusula 7 do DPA');
    expect(pe[3]).toBe('4. Transferência internacional. A transferência se apoia na decisão de adequação da União Europeia (Resolução CD/ANPD nº 32/2026; LGPD, art. 33, I). Além disso, a plataforma exige a autorização de cada paciente. Em qualquer caso, nenhum dado de paciente vai à IA sem a autorização vigente dele, registrada com a versão, os usos, o destino, a data e o canal.');
    expect(pu[3]).toContain('A transferência se apoia no consentimento específico e em destaque de cada paciente (LGPD, art. 33, VIII), registrado na plataforma.');
    // A-D27: na Anthropic direta, a retenção de até 30 dias (nada de retenção zero); no Bedrock, a retenção zero
    expect(pu[5]).toBe('6. Retenção. O fornecedor não usa o conteúdo para treinar modelos. A Anthropic guarda o conteúdo enviado por até 30 dias, para operar e proteger o serviço (por exemplo, segurança e prevenção de abuso), e depois o apaga. Se os sistemas de segurança dela sinalizarem o conteúdo, ela pode guardá-lo por até 2 anos; se a lei exigir, pelo tempo que a lei exigir. A sugestão fica guardada na plataforma por até 7 dias, até ser salva ou descartada. O registro técnico do uso (data, situação e custo, sem conteúdo) é mantido.');
    expect(pu.join(' ')).not.toContain('retenção zero');
    expect(pu[7]).toContain('sem a retenção da cláusula 6 confirmada pela OPERADORA');
    expect(pe[5]).toContain('enquanto houver retenção zero com o fornecedor');
    expect(pe[5]).toContain('conteúdo ilegal em imagens detectado pelos sistemas de segurança dele');
    expect(pe[7]).toContain('sem retenção zero confirmada');
    expect(pe[5]).toContain('nenhum operador do serviço tem acesso ao conteúdo');
    expect(pu[5]).not.toContain('Amazon Web Services');
    expect(pu[6]).toContain('Guarda o original em papel na pasta do paciente e entrega a ele uma via');
    // Minor (c): sem garantir além do contrato
    expect(pu[6]).toMatch(/\(f\) mantém o sigilo profissional\. Vale a confidencialidade prevista nos contratos da OPERADORA com o fornecedor e neste aditivo\.$/);
    expect(pu[6]).not.toContain('garantida');
    // D27 do Plano 15: a IA Nutri do paciente vem depois — "Nestes usos" restringe a frase aos usos da nutricionista
    expect(pu[1]).toContain('A IA não diagnostica, não interpreta exames e não prescreve. Nestes usos, a IA não fala com o paciente.');
    expect(pu.at(-1)).toBe('Versão 1.1, de 09/10/2026.');
    expect(pe.at(-1)).toBe('Versão 1.1, de 09/10/2026.');
    expect(pu).toHaveLength(12);
  });
});

/**
 * D8 (revisão da T6): as frases das categorias valem só na LISTA do "O que é enviado" — entre "No resumo e no rascunho" e
 * "O seu nome, e-mail" —, no trecho comum aos dois usos ou no do próprio uso ("no rascunho, também …", "no resumo, se a
 * nutricionista escolher, …"). Palavras como "exames" e "plano" aparecem também no "Para que serve" e não contam.
 */
function faltandoNaLista(p4: string) {
  const ini = p4.indexOf('No resumo e no rascunho');
  const fim = p4.indexOf('O seu nome, e-mail');
  if (ini < 0 || fim <= ini) throw new Error('lista do "O que é enviado" não encontrada');
  const lista = p4.slice(ini, fim);
  const SO_RASCUNHO = '; no rascunho, também ';
  const SO_RESUMO = '; no resumo, se a nutricionista escolher, ';
  const corte = (marca: string) => (lista.includes(marca) ? lista.indexOf(marca) : lista.length);
  const comum = lista.slice(0, Math.min(corte(SO_RASCUNHO), corte(SO_RESUMO)));
  const trecho = (marca: string) => {
    if (!lista.includes(marca)) return '';
    const resto = lista.slice(lista.indexOf(marca) + marca.length);
    return resto.split(/; no (?:rascunho|resumo)/)[0];
  };
  const doUso = { resumo_historico: `${comum} ${trecho(SO_RESUMO)}`, rascunho_plano: `${comum} ${trecho(SO_RASCUNHO)}` };
  const faltando = (uso: keyof typeof CATEGORIAS_POR_USO) => CATEGORIAS_POR_USO[uso].filter((c) => !doUso[uso].includes(FRASE_DA_CATEGORIA[c]));
  return { resumo_historico: faltando('resumo_historico'), rascunho_plano: faltando('rascunho_plano'), datas: !comum.includes('as datas de cada registro') };
}

describe('Plano 14B — autorização 1.1 com os usos da 14B (F2; parecer JUR-2026-013, item 4.1, trechos [14B]; desvio 10; A-D27)', () => {
  const t02 = (d: Parameters<typeof textoDaAutorizacao>[1]) => textoDaAutorizacao('1.1', d)!.paragrafos.map(textoCorrido);

  it('versão e mínimo sobem juntos, sem "provisorio"; os três usos; a 1.0 deixa de valer (RN-109)', () => {
    expect(AUTORIZACAO_IA_VERSAO).toBe('1.1');
    expect(AUTORIZACAO_IA_VERSAO_MIN).toBe('1.1');
    expect(AUTORIZACAO_IA_USOS).toEqual(['leitura_laudos', 'resumo_historico', 'rascunho_plano']);
    expect(versaoAtende('1.0', AUTORIZACAO_IA_VERSAO_MIN)).toBe(false);
    expect(textoDaAutorizacao('1.1', { ...RESP, destino: 'anthropic-us', canal: 'app' })!.paragrafos.map(textoCorrido).join(' ')).not.toMatch(/provis[oó]ri/);
    // a data impressa em cada versão; a da atual é o piso do termo em papel (US-108)
    expect(DATA_DA_VERSAO).toEqual({ '0.1-provisorio': '2026-10-09', '1.0': '2026-10-09', '1.1': '2026-10-09' });
    expect(AUTORIZACAO_IA_VERSAO_DATA).toBe(DATA_DA_VERSAO[AUTORIZACAO_IA_VERSAO]);
    expect(Object.keys(DESCRICAO_DO_USO).sort()).toEqual([...AUTORIZACAO_IA_USOS].sort());
  });

  it('"Para que serve" e "O que é enviado": a redação [14B] do parecer com as adaptações (b)–(c) do desvio 10, palavra por palavra', () => {
    const p = t02({ ...RESP, destino: 'bedrock-eu', canal: 'app' });
    expect(p[2]).toBe('Para que serve. A IA ajuda a sua nutricionista a: (1) ler os laudos dos seus exames e sugerir os valores para o seu prontuário; (2) resumir o seu histórico antes da consulta; (3) montar um primeiro rascunho do seu plano alimentar, que ela revisa. A IA só sugere. A nutricionista confere tudo antes de usar e continua responsável pelo seu atendimento. A IA não faz diagnóstico, não interpreta os seus exames e não receita. Nestes usos, a IA não fala com você.');
    expect(p[4]).toBe(
      'O que é enviado. Na leitura de laudos, vai o laudo inteiro, com o seu nome, a sua data de nascimento e tudo o que estiver impresso nele. Só são retirados os dados escondidos do arquivo, como autor e localização. ' +
      'No resumo e no rascunho, vão as informações do seu prontuário necessárias para a tarefa: a sua idade e o seu sexo, medidas e cálculos de gasto energético, exames, anamnese, orientações, plano, diário alimentar sem as fotos e as datas de cada registro; no rascunho, também as metas, as restrições e as preferências que a nutricionista informar; no resumo, se a nutricionista escolher, as anotações dela. ' +
      'O seu nome, e-mail, telefone, endereço e documentos do cadastro não vão. No lugar da data de nascimento, vai a sua idade. ' +
      // revisão da T6: o limite da máscara (RN-115) sobre o próprio nome e as restrições do pedido do rascunho (§5.4), art. 9º, § 1º
      'Nos textos escritos no prontuário e no pedido do rascunho, o sistema retira o seu nome (completo, com o sobrenome ou só o primeiro nome), e-mail, telefone e CPF. ' +
      'Podem ir junto: o seu primeiro nome sozinho, quando tem menos de três letras ou também é uma palavra comum de alimentação (como Rosa ou Clara); outras partes do seu nome escritas sem o primeiro nome (como um segundo nome ou os sobrenomes); apelidos; e outros dados escritos ali, como o nome de outras pessoas ou um endereço. ' +
      'Nada além do que está descrito aqui é enviado. Se isso mudar, pediremos uma nova autorização.',
    );
    expect(p.at(-1)).toBe(`Versão 1.1, de ${AUTORIZACAO_IA_VERSAO_DATA.split('-').reverse().join('/')}.`);
  });

  it('R1 (pre-flight): fora dos dois parágrafos da 14B e do rodapé, a 1.1 é a 1.0 palavra por palavra — mesma retenção, exceção revista e riscos da guarda nos EUA', () => {
    for (const destino of ['anthropic-us', 'bedrock-eu', 'teste'] as const) {
      const v11 = t02({ ...RESP, destino, canal: 'link' });
      const v10 = corrido({ ...RESP, destino, canal: 'link' });
      expect(v11).toHaveLength(v10.length);
      expect(v11.flatMap((p, i) => (p === v10[i] ? [] : [i])), destino).toEqual([2, 4, v10.length - 1]);
    }
    // o "Nestes usos" é só da 1.1: a 0.1 e a 1.0 continuam com o que quem autorizou nelas leu
    for (const versao of ['0.1-provisorio', '1.0']) {
      expect(textoDaAutorizacao(versao, { ...RESP, destino: 'teste', canal: 'app' })!.paragrafos.map(textoCorrido)[2], versao).toMatch(/não receita e não fala com você\.$/);
    }
  });

  it('A-D27: na anthropic-us, "Por quanto tempo" continua com a retenção de até 30 dias da 1.0', () => {
    const p = t02({ ...RESP, destino: 'anthropic-us', canal: 'app' }).join(' ');
    expect(p).toContain('A Anthropic guarda os dados enviados por até 30 dias, para operar e proteger o serviço (por exemplo, segurança e prevenção de abuso), e depois os apaga.');
  });

  it('F3: os oito requisitos continuam no texto novo, nos dois destinos e nos quatro canais', () => {
    for (const destino of ['anthropic-us', 'bedrock-eu'] as const) {
      for (const canal of ['app', 'link', 'papel_com_email', 'papel_sem_email'] as const) {
        const texto = t02({ ...RESP, destino, canal }).join(' ');
        for (const r of ['Para que serve.', 'O que é enviado.', 'Para onde vai.', 'saem do Brasil', 'Por quanto tempo.', 'é separada do termo de uso do app', 'nada muda no seu atendimento', 'Você pode retirar a autorização quando quiser', 'Versão 1.1', 'art. 18', 'gov.br/anpd']) {
          expect(texto, `${destino}/${canal}: ${r}`).toContain(r);
        }
      }
    }
  });

  it('o contrato do que sai (D8): cada categoria de cada uso tem a frase na lista do "O que é enviado" da 1.1 (só ali)', () => {
    const p4 = t02({ ...RESP, destino: 'anthropic-us', canal: 'app' })[4];
    expect(faltandoNaLista(p4)).toEqual({ resumo_historico: [], rascunho_plano: [], datas: false });
    // a guarda percebe a saída de uma categoria da lista, mesmo com a palavra em outro parágrafo ou em outro trecho
    expect(faltandoNaLista(p4.replace(' exames,', '')).resumo_historico).toEqual(['exames']);
    expect(faltandoNaLista(p4.replace(' plano,', '')).resumo_historico).toEqual(['plano']);
    expect(faltandoNaLista(p4.replace('a sua idade e ', '')).rascunho_plano).toEqual(['idade']); // "vai a sua idade" fica de fora da lista
    expect(faltandoNaLista(p4.replace('as metas, as restrições e as preferências', 'as metas e as preferências')).rascunho_plano).toEqual(['metas']);
    expect(faltandoNaLista(p4.replace('; no resumo, se a nutricionista escolher, as anotações dela', '')).resumo_historico).toEqual(['notas']);
    expect(faltandoNaLista(p4.replace(' e as datas de cada registro', '')).datas).toBe(true);
    // toda categoria do contrato é usada por algum uso (nada declarado à toa)
    expect(new Set(Object.values(CATEGORIAS_POR_USO).flat())).toEqual(new Set(CATEGORIAS));
  });

  it('aditivo 1.1: finalidades (b)–(d), item 5 com a máscara, selo no item 10, retenção de até 30 dias na anthropic-us', () => {
    expect(IA_ADITIVO_VERSAO).toBe('1.1');
    expect(IA_ADITIVO_VERSAO_MIN).toBe('1.1');
    const a = aditivoIa('anthropic-us').paragrafos.map(textoCorrido);
    expect(a[5]).toContain('A Anthropic guarda o conteúdo enviado por até 30 dias');
    expect(a[1]).toContain('(b) resumir o histórico do paciente antes da consulta; (c) montar um rascunho de plano alimentar a partir das metas que a CONTROLADORA informar. Sem dados de paciente: (d) sugerir modelos');
    expect(a[4]).toContain('com os textos livres mascarados (nome, e-mail, telefone e CPF do paciente), com os limites descritos no texto da autorização: o primeiro nome sozinho, quando tem menos de três letras ou também é palavra comum de alimentação, o segundo nome e os sobrenomes sem o primeiro nome, apelidos e dados de terceiros podem ir junto. As anotações privadas da CONTROLADORA só vão quando ela marcar essa opção no pedido.');
    expect(a[4]).toContain('e, no rascunho, as metas, as restrições e as preferências que a CONTROLADORA informar, como descritos no texto da autorização do paciente');
    expect(a[9]).toBe('10. Selo e transparência. O plano alimentar criado a partir do rascunho da IA leva o selo "Elaborado com apoio de IA e revisado pela nutricionista". A CONTROLADORA observa as regras do CFN sobre informar o uso de ferramentas automatizadas.');
    expect(a.at(-1)).toBe(`Versão 1.1, de ${IA_ADITIVO_VERSAO_DATA.split('-').reverse().join('/')}.`);
    expect(a.join(' ')).not.toMatch(/provis[oó]ri/);
  });

  it('aditivo 1.1, itens 2 e 5 inteiros (parecer 4.2 com os trechos [14B]; D27 do Plano 15; adaptação (e) do desvio 10)', () => {
    for (const destino of ['anthropic-us', 'bedrock-eu'] as const) {
      const a = aditivoIa(destino).paragrafos.map(textoCorrido);
      expect(a[1]).toBe('2. Finalidades. Com dados de paciente: (a) ler o laudo de exame que a CONTROLADORA escolher e sugerir os valores para o prontuário; (b) resumir o histórico do paciente antes da consulta; (c) montar um rascunho de plano alimentar a partir das metas que a CONTROLADORA informar. Sem dados de paciente: (d) sugerir modelos de plano alimentar e de anamnese por área de atendimento. A IA não diagnostica, não interpreta exames e não prescreve. Nestes usos, a IA não fala com o paciente. Nada entra no prontuário nem chega ao paciente sem a conferência e a ação da CONTROLADORA. Ela avalia criticamente cada sugestão e responde pela conduta profissional, conforme o Código de Ética e de Conduta do Nutricionista.');
      expect(a[4]).toBe('5. O que é enviado. Na leitura, só o arquivo do laudo, sem metadados. Os dados impressos nele vão junto. No resumo e no rascunho, os dados do prontuário necessários à tarefa e, no rascunho, as metas, as restrições e as preferências que a CONTROLADORA informar, como descritos no texto da autorização do paciente, sem nome, e-mail, telefone, endereço e documentos do cadastro do paciente, com a idade no lugar da data de nascimento e com os textos livres mascarados (nome, e-mail, telefone e CPF do paciente), com os limites descritos no texto da autorização: o primeiro nome sozinho, quando tem menos de três letras ou também é palavra comum de alimentação, o segundo nome e os sobrenomes sem o primeiro nome, apelidos e dados de terceiros podem ir junto. As anotações privadas da CONTROLADORA só vão quando ela marcar essa opção no pedido. Nos modelos, nenhum dado de paciente. A OPERADORA não envia nada além do que o texto da autorização descreve. Qualquer mudança gera nova versão e nova autorização.');
    }
  });
});
