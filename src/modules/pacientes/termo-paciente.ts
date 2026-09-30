/**
 * US-011 / RNF-08. Texto PROVISÓRIO (P-02, E-09): o P08-06 publica o texto do advogado com versão
 * nova, e o Plano 06 exige o novo aceite no login. Aceite gravado em `consents` (uma linha por versão).
 */
export const TERMO_PACIENTE_VERSAO = '0.1-provisorio';
export const TERMO_PACIENTE = `termo-paciente-${TERMO_PACIENTE_VERSAO}`;
export const TERMO_PACIENTE_TITULO = 'Termo de Uso e Privacidade';
export const TERMO_PACIENTE_ROTULO = `Li e aceito o Termo de Uso e Privacidade (versão ${TERMO_PACIENTE_VERSAO})`;
export const MSG_TERMO_NAO_ACEITO = 'Para continuar, aceite o Termo de Uso e Privacidade.';

export const TERMO_PACIENTE_PARAGRAFOS: readonly string[] = [
  'Versão provisória, a ser substituída pelo texto revisado por advogado antes do uso com pacientes reais.',
  'Quem cuida dos seus dados é a sua nutricionista (controladora). O NutriDebby é a plataforma que ela usa para guardar o prontuário e falar com você (operadora).',
  'Seus dados de saúde (anamnese, medidas, exames, plano alimentar e diário) são usados só no seu acompanhamento nutricional. Cada acesso ao seu prontuário fica registrado.',
  'Você pode pedir a qualquer momento uma cópia dos seus dados ou a exclusão deles. Por obrigação legal, o prontuário clínico fica guardado de forma bloqueada pelo prazo exigido e depois é anonimizado.',
  'Mensagens por WhatsApp só são enviadas se você autorizar, e você pode desistir quando quiser. Os lembretes continuam por e-mail.',
];
