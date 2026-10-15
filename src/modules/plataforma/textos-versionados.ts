/**
 * P08-06: o que o termo do paciente e o DPA têm em comum. Cada versão guarda a data e os parágrafos; o formulário de aceite
 * manda a versão que a pessoa leu (campo `versao`), e a action recusa o aceite se a versão em vigor mudou nesse meio-tempo
 * (deploy com a página aberta): a prova de aceite nunca registra um texto que a pessoa não viu.
 */
export type TextoVersionado = { data: string; paragrafos: readonly string[] };

export const MSG_TEXTO_ATUALIZADO = 'O texto mudou enquanto esta página estava aberta. Recarregue a página, leia a versão nova e aceite de novo.';

/** A versão lida (campo `versao` do formulário) é a versão em vigor? */
export const leuAVersaoEmVigor = (formData: FormData, emVigor: string): boolean => formData.get('versao') === emVigor;
