import { formatarData } from './datas';

/**
 * US-011 / RNF-08. Termo de Uso e Privacidade do paciente. P08-06 (15/10/2026): a 1.0 definitiva substitui a 0.1
 * provisória, publicada pelo dono sem a revisão do advogado (na linha da A-D27). Mudar a versão obriga o novo aceite, uma
 * vez por consultório (US-011 "Nova versão do termo": `requirePaciente` leva a /p/termo). Aceite gravado em `consents`
 * (`termo-paciente-<versão>`, uma linha por versão; só INSERT).
 */
export const TERMO_PACIENTE_VERSAO = '1.0';
/** A data impressa no fim da versão em vigor. */
export const TERMO_PACIENTE_VERSAO_DATA = '2026-10-15';
export const TERMO_PACIENTE = `termo-paciente-${TERMO_PACIENTE_VERSAO}`;
export const TERMO_PACIENTE_TITULO = 'Termo de Uso e Privacidade';
export const TERMO_PACIENTE_ROTULO = `Li e aceito o Termo de Uso e Privacidade (versão ${TERMO_PACIENTE_VERSAO})`;
export const MSG_TERMO_NAO_ACEITO = 'Para continuar, aceite o Termo de Uso e Privacidade.';

/** Aviso de /p/termo para quem já aceitou uma versão anterior neste consultório (P08-06; como o `DPA_MUDOU` do painel). */
export const TERMO_PACIENTE_MUDOU = `O termo mudou (versão ${TERMO_PACIENTE_VERSAO}, de ${formatarData(TERMO_PACIENTE_VERSAO_DATA)}). Leia e aceite para continuar usando o app.`;
