import { TIPO_DOCUMENTO_ROTULO, type TipoDocumento } from './constantes';
import type { ConteudoDocumento } from './parecer';

/**
 * Plano 22 (RN-397, DEP-E7, EP-D34): o ponto único da infraestrutura dos tipos de documento. Todo código que decide pelo
 * tipo usa `switch` com `assertNever` no `default` — um tipo novo não compila até ganhar o caso dele, em vez de cair no
 * ramo da receita por exclusão. PURO (sem import do servidor; guarda em `tipos-de-documento.test.ts`): o formulário
 * 'use client' e o worker leem daqui.
 */
export const TIPOS_DE_DOCUMENTO = ['receita', 'parecer', 'solicitacao_exames'] as const satisfies readonly TipoDocumento[];

/** O `default` de um `switch` exaustivo. A mensagem é fixa: nunca leva o valor (pode ser um conteúdo, regra 3). */
export function assertNever(x: never): never {
  void x;
  throw new Error('documentos: tipo de documento inesperado');
}

/** O conteúdo de um documento anonimizado (`'{}'`, RN-140 c): sem tipo. Quem lê o conteúdo gravado trata este caso. */
export type ConteudoAnonimizado = { tipo?: undefined };

/** O rascunho vazio de cada tipo ("Nova receita", "Novo parecer nutricional", "Nova solicitação de exames"). */
export function conteudoVazio(tipo: TipoDocumento): ConteudoDocumento {
  switch (tipo) {
    case 'receita':
      return { versao: 1, tipo: 'receita', itens: [], orientacoes: '' };
    case 'parecer':
      return { versao: 1, tipo: 'parecer', exames: [], avaliacao: '', conduta: '', encaminhamentos: '' };
    case 'solicitacao_exames':
      // RN-395: conteúdo novo sempre em marcação mínima
      return { versao: 1, tipo: 'solicitacao_exames', exames: [], indicacaoClinica: null, orientacoes: '', orientacoesFormato: 'marcacao' };
    default:
      return assertNever(tipo);
  }
}

/**
 * O rótulo do tipo (título do PDF, da digitalizada e do link). Por `switch`: um tipo lido do banco que o código não
 * conhece lança, em vez de sair `undefined` ou "Receita".
 */
export function rotuloDoTipo(tipo: TipoDocumento): string {
  switch (tipo) {
    case 'receita':
    case 'parecer':
    case 'solicitacao_exames':
      return TIPO_DOCUMENTO_ROTULO[tipo];
    default:
      return assertNever(tipo);
  }
}

/**
 * NGS1.12.02 / RN-397: a versão nova (retificação) nasce do conteúdo da vigente com **todas** as chaves do tipo (inclusive
 * `orientacoesFormato`, `indicacaoClinica` e as que vierem depois), menos a cópia do perfil/paciente e a declaração, que
 * nascem de novo no preparo (RN-154). Não muda o original.
 */
export function semCopia(c: ConteudoDocumento): ConteudoDocumento {
  const resto: Record<string, unknown> = { ...c };
  delete resto.copia;
  delete resto.declaracao;
  return resto as ConteudoDocumento;
}

/** RN-392: a regra única de "exige habilitação em Fitoterapia" (Zod, preparo e assinatura). */
export { exigeHabilitacao } from './prescricao';
