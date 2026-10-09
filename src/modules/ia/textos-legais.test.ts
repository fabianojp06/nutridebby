import { describe, expect, it } from 'vitest';
import {
  aditivoIa, AUTORIZACAO_IA_USOS, AUTORIZACAO_IA_VERSAO, AUTORIZACAO_IA_VERSAO_MIN, IA_ADITIVO_TERMO,
  IA_ADITIVO_VERSAO, IA_ADITIVO_VERSAO_MIN, responsavelDoTenant, textoCorrido, textoDaAutorizacao, versaoAtende,
} from './textos-legais';

const RESP = { consultorio: 'Consultório Debby', nutricionista: 'Debora Silva', crn: 'CRN-3 12345', contato: 'contato@debby.test' };
const corrido = (d: Parameters<typeof textoDaAutorizacao>[1]) => textoDaAutorizacao(AUTORIZACAO_IA_VERSAO, d)!.paragrafos.map(textoCorrido);

describe('textos legais da IA (A-D19, A-D20; 1.0 publicada sem advogado pela A-D27)', () => {
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

  it('A-D27: as quatro versões são 1.0; quem aceitou ou autorizou nas provisórias (0.1 e 0.2) fica abaixo do mínimo e aceita de novo', () => {
    expect([AUTORIZACAO_IA_VERSAO, AUTORIZACAO_IA_VERSAO_MIN, IA_ADITIVO_VERSAO, IA_ADITIVO_VERSAO_MIN]).toEqual(['1.0', '1.0', '1.0', '1.0']);
    expect(IA_ADITIVO_TERMO).toBe('ia-aditivo-1.0');
    for (const antiga of ['0.1-provisorio', '0.2-provisorio']) {
      expect(versaoAtende(antiga, AUTORIZACAO_IA_VERSAO_MIN), antiga).toBe(false);
      expect(versaoAtende(antiga, IA_ADITIVO_VERSAO_MIN), antiga).toBe(false);
    }
  });
});

describe('Plano 14A e A-D27 — texto da autorização 1.0 (redação do parecer JUR-2026-013, item 4.1; spec §18.5)', () => {
  it('F2: a versão 1.0 lista só a leitura de laudos (os usos da 14B entram com a versão nova da 14B)', () => {
    expect(AUTORIZACAO_IA_USOS).toEqual(['leitura_laudos']);
    const texto = corrido({ ...RESP, destino: 'anthropic-us', canal: 'app' }).join(' ');
    for (const da14B of ['resumir o seu histórico', 'rascunho do seu plano', 'No resumo e no rascunho', 'três tarefas']) expect(texto, da14B).not.toContain(da14B);
  });

  it('anthropic-us, canal app: a redação do parecer, palavra por palavra (adaptações a e b da §18.5; retenção de 30 dias da A-D27)', () => {
    const t = textoDaAutorizacao(AUTORIZACAO_IA_VERSAO, { ...RESP, destino: 'anthropic-us', canal: 'app' })!;
    expect(t.titulo).toBe('Autorização para uso de inteligência artificial');
    expect(t.paragrafos.map(textoCorrido)).toEqual([
      'Consultório Debby pede a sua autorização para usar uma ferramenta de inteligência artificial (IA) com os seus dados de saúde. Esta autorização é só para isso, é separada do termo de uso do app e é pessoal: só você pode dar.',
      'Quem é responsável. A responsável pelos seus dados é a sua nutricionista, Debora Silva, CRN-3 12345, contato: contato@debby.test. A plataforma NutriDebby (WEB SMART SISTEMAS+13 LTDA, CNPJ 66.657.250/0001-07) trata os dados em nome dela e contrata o fornecedor da IA.',
      'Para que serve. A IA ajuda a sua nutricionista a ler os laudos dos seus exames e sugerir os valores para o seu prontuário. A IA só sugere. A nutricionista confere tudo antes de usar e continua responsável pelo seu atendimento. A IA não faz diagnóstico, não interpreta os seus exames, não receita e não fala com você.',
      'Benefícios e riscos. O benefício é a nutricionista gastar menos tempo digitando e preparando, e ter mais tempo para você. Os riscos são dois: a IA pode errar, e por isso a nutricionista confere tudo; e os seus dados saem do Brasil, como explicado abaixo.',
      'O que é enviado. Na leitura de laudos, vai o laudo inteiro, com o seu nome, a sua data de nascimento e tudo o que estiver impresso nele. Só são retirados os dados escondidos do arquivo, como autor e localização. Nada além do que está descrito aqui é enviado. Se isso mudar, pediremos uma nova autorização.',
      'Para onde vai. Os dados são enviados à Anthropic, empresa dos Estados Unidos que fornece a IA (Claude), contratada pela plataforma NutriDebby. O processamento acontece nos Estados Unidos, um país que não tem decisão de adequação da Autoridade Nacional de Proteção de Dados (ANPD). Por isso, o envio só acontece com a sua autorização específica. Os seus dados saem do Brasil.',
      'Por quanto tempo. O fornecedor usa os dados só para devolver a resposta e não os usa para treinar a IA. A Anthropic pode guardar os dados enviados por até 30 dias, apenas para segurança e prevenção de abuso, e depois os apaga. A exceção é quando a lei exigir ou quando os sistemas de segurança dele sinalizarem o conteúdo. Nesse caso, ele pode guardá-lo por até 2 anos. A sugestão da IA fica guardada no NutriDebby por até 7 dias, até a nutricionista usar ou descartar. O que ela usar passa a fazer parte do seu prontuário. Cada envio fica registrado e aparece na cópia dos seus dados, que você pode pedir no app (Baixar meus dados) ou à sua nutricionista.',
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
    expect(us).toContain('A Anthropic pode guardar os dados enviados por até 30 dias, apenas para segurança e prevenção de abuso, e depois os apaga.');
    expect(us).toContain('não os usa para treinar a IA');
    expect(us).not.toMatch(/não os guarda|não ficam guardados|retenção zero/);
    expect(eu).toContain('não os guarda depois da resposta');
    expect(eu).not.toContain('30 dias');
  });

  it('a versão provisória 0.1 continua legível (é o texto que quem autorizou nela leu), com a frase da versão provisória', () => {
    const t = textoDaAutorizacao('0.1-provisorio', { ...RESP, destino: 'anthropic-us', canal: 'app' })!.paragrafos.map(textoCorrido);
    expect(t.at(-1)).toBe('Versão provisória 0.1, de 09/10/2026, em revisão jurídica.');
    expect(t[6]).toContain('não os guarda depois da resposta');
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
    expect(eu.filter((p, i) => p !== us[i]).length).toBe(2);
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
    const t = textoDaAutorizacao(AUTORIZACAO_IA_VERSAO, { ...RESP, destino: 'anthropic-us', canal: 'app' })!;
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

describe('Plano 14A e A-D27 — aditivo 1.0 (redação do parecer JUR-2026-013, item 4.2; US-101, C1)', () => {
  it('a versão é 1.0 e quem aceitou a 0.1 ou a 0.2 provisórias fica desatualizado', () => {
    expect(IA_ADITIVO_VERSAO).toBe('1.0');
    expect(versaoAtende(IA_ADITIVO_VERSAO, IA_ADITIVO_VERSAO_MIN)).toBe(true);
    expect(versaoAtende('0.1-provisorio', IA_ADITIVO_VERSAO_MIN)).toBe(false);
    expect(versaoAtende('0.2-provisorio', IA_ADITIVO_VERSAO_MIN)).toBe(false);
    expect(IA_ADITIVO_TERMO).toBe('ia-aditivo-1.0');
  });

  it('fornecedor, mecanismo da transferência e retenção seguem o destino (F1: no Bedrock, a adequação; a autorização como exigência a mais); sem os usos da 14B (F2)', () => {
    const us = aditivoIa('anthropic-us');
    const eu = aditivoIa('bedrock-eu');
    expect(eu.titulo).toBe('Aditivo de inteligência artificial ao contrato de tratamento de dados');
    const pu = us.paragrafos.map(textoCorrido);
    const pe = eu.paragrafos.map(textoCorrido);
    expect(pe[2]).toBe('3. Fornecedor e país. O fornecedor em uso aparece no painel e no texto da autorização do paciente: Amazon Web Services (Claude), com processamento em Estados-membros da União Europeia. A OPERADORA responde pelo fornecedor perante a CONTROLADORA, nos termos do DPA. A troca de fornecedor segue a cláusula 7 do DPA, com aviso de 15 dias, e torna necessária uma nova autorização de todos os pacientes.');
    expect(pe[3]).toBe('4. Transferência internacional. A transferência se apoia na decisão de adequação da União Europeia (Resolução CD/ANPD nº 32/2026; LGPD, art. 33, I). Além disso, a plataforma exige a autorização de cada paciente. Em qualquer caso, nenhum dado de paciente vai à IA sem a autorização vigente dele, registrada com a versão, os usos, o destino, a data e o canal.');
    expect(pu[3]).toContain('A transferência se apoia no consentimento específico e em destaque de cada paciente (LGPD, art. 33, VIII), registrado na plataforma.');
    // A-D27: na Anthropic direta, a retenção de até 30 dias (nada de retenção zero); no Bedrock, a retenção zero
    expect(pu[5]).toBe('6. Retenção. O fornecedor não usa o conteúdo para treinar modelos. A Anthropic pode guardar o conteúdo enviado por até 30 dias, apenas para segurança e prevenção de abuso, e depois o apaga; o conteúdo sinalizado pelos sistemas de segurança dela, ou guardado por exigência legal, pode ficar até 2 anos. A sugestão fica guardada na plataforma por até 7 dias, até ser salva ou descartada. O registro técnico do uso (data, situação e custo, sem conteúdo) é mantido.');
    expect(pu.join(' ')).not.toContain('retenção zero');
    expect(pu[7]).toContain('sem a retenção da cláusula 6 confirmada pela OPERADORA');
    expect(pe[5]).toContain('enquanto houver retenção zero com o fornecedor');
    expect(pe[5]).toContain('conteúdo ilegal em imagens detectado pelos sistemas de segurança dele');
    expect(pe[7]).toContain('sem retenção zero confirmada');
    expect(pe[5]).toContain('nenhum operador do serviço tem acesso ao conteúdo');
    expect(pu[5]).not.toContain('Amazon Web Services');
    expect(pu[6]).toContain('Guarda o original em papel na pasta do paciente e entrega a ele uma via');
    expect(pu.join(' ')).not.toMatch(/resumir o histórico|rascunho de plano alimentar|Elaborado com apoio de IA/);
    expect(pu.at(-1)).toBe('Versão 1.0, de 09/10/2026.');
    expect(pe.at(-1)).toBe('Versão 1.0, de 09/10/2026.');
    expect(pu).toHaveLength(12);
  });
});
