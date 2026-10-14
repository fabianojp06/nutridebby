import { describe, expect, it } from 'vitest';
import { mascarar, respostaDaAnamnese, textoLivre } from './pseudonimizar';

const alvo = { nome: 'Maria José da Silva', email: 'maria.jose@exemplo.com.br', telefone: '+5511987654321' };

describe('mascarar (RN-115, §5.4): o que some e o limite declarado', () => {
  it('nome completo, nome + sobrenome e o primeiro nome, sem diferença de acento e de maiúsculas', () => {
    expect(mascarar('Maria José da Silva relata fome à tarde.', alvo)).toBe('[removido] relata fome à tarde.');
    expect(mascarar('maria jose da silva', alvo)).toBe('[removido]');
    expect(mascarar('A Maria Silva voltou; a MARIA trouxe exames.', alvo)).toBe('A [removido] voltou; a [removido] trouxe exames.');
  });

  it('nome dentro de outra palavra não é tocado; nome de terceiro fica (limite declarado)', () => {
    expect(mascarar('Comeu mariana? Não, mariscos.', { ...alvo, nome: 'Mari Souza' })).toBe('Comeu mariana? Não, mariscos.');
    expect(mascarar('O marido, João, cozinha.', alvo)).toBe('O marido, João, cozinha.');
  });

  it('primeiro nome que é palavra comum de alimentação só sai acompanhado do sobrenome (PM-7)', () => {
    const clara = { nome: 'Clara Souza', email: null, telefone: null };
    expect(mascarar('Clara de ovo no café. Clara Souza disse que gostou.', clara)).toBe('Clara de ovo no café. [removido] disse que gostou.');
  });

  it('e-mail, telefone e CPF: os do paciente e os padrões', () => {
    expect(mascarar('Escreva para maria.jose@exemplo.com.br ou outra@x.io', alvo)).toBe('Escreva para [removido] ou [removido]');
    expect(mascarar('Ligar (11) 98765-4321 ou +55 11 3333-4444', alvo)).toBe('Ligar [removido] ou [removido]');
    expect(mascarar('CPF 123.456.789-09 e 12345678909', alvo)).toBe('CPF [removido] e [removido]');
  });

  it('o e-mail do paciente sai mesmo escrito com outras maiúsculas', () => {
    expect(mascarar('Mandou de MARIA.JOSE@Exemplo.com.br ontem.', alvo)).toBe('Mandou de [removido] ontem.');
  });

  it('caracteres fora do plano básico (emoji) não desalinham o que é tirado', () => {
    expect(mascarar('🍎 Maria José da Silva 🍌 comeu fruta.', alvo)).toBe('🍎 [removido] 🍌 comeu fruta.');
  });

  it('textoLivre: vazio vira null; mais de 2.000 caracteres é cortado e marcado com […] (desvio 5)', () => {
    expect(textoLivre('   ', alvo)).toBeNull();
    expect(textoLivre(null, alvo)).toBeNull();
    const t = textoLivre('a'.repeat(2500), alvo)!;
    expect(t).toHaveLength(2003);
    expect(t.endsWith('[…]')).toBe(true);
    expect(textoLivre('a'.repeat(2000), alvo)).toBe('a'.repeat(2000));
  });

  it('respostaDaAnamnese: sim/não, lista, número e texto', () => {
    expect(respostaDaAnamnese(true)).toBe('sim');
    expect(respostaDaAnamnese(false)).toBe('não');
    expect(respostaDaAnamnese(['ovo', 'leite'])).toBe('ovo, leite');
    expect(respostaDaAnamnese(72.5)).toBe('72.5');
    expect(respostaDaAnamnese('Dorme mal')).toBe('Dorme mal');
  });
});
