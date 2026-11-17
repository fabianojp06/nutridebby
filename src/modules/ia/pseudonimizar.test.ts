import { describe, expect, it } from 'vitest';
import { comNomeSocial, mascarar, respostaDaAnamnese, textoLivre } from './pseudonimizar';

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

describe('mascarar com a equipe e o consultório (Plano 15, PM-3, §7.3)', () => {
  const ana = { nome: 'Ana Souza', email: null, telefone: null };

  it('outrosNomes seguem a regra do nome do paciente; frasesExatas saem inteiras', () =>
    expect(
      mascarar('Qualquer dúvida, fale com a Debby ou com a Débora Lima. Consultório Bem Viver.', {
        ...ana,
        outrosNomes: ['Debby Silva', 'Débora Lima'],
        frasesExatas: ['Consultório Bem Viver'],
      }),
    ).toBe('Qualquer dúvida, fale com a [removido] ou com a [removido]. [removido].'));

  it('o nome do consultório só sai inteiro (sem acento, maiúsculas e espaços diferentes); parte dele fica', () => {
    const alvoC = { ...ana, frasesExatas: ['Consultório Bem Viver'] };
    expect(mascarar('O consultório abre às 8h; quero viver bem.', alvoC)).toBe('O consultório abre às 8h; quero viver bem.');
    expect(mascarar('Volte ao CONSULTORIO  bem\nviver amanhã.', alvoC)).toBe('Volte ao [removido] amanhã.');
    expect(mascarar('Consultório Bem Viveres', alvoC)).toBe('Consultório Bem Viveres');
  });

  it('frase vazia ou só com espaços não apaga nada', () =>
    expect(mascarar('Ana Souza comeu.', { ...ana, frasesExatas: ['', '   '], outrosNomes: [''] })).toBe('[removido] comeu.'));

  it('sem os campos novos, o resultado não muda', () => {
    const t = 'A Debby, da Clínica Bem Viver, falou com Ana Souza.';
    expect(mascarar(t, ana)).toBe(mascarar(t, { ...ana, outrosNomes: [], frasesExatas: [] }));
    expect(mascarar(t, ana)).toBe('A Debby, da Clínica Bem Viver, falou com [removido].');
  });
});

describe('nome social na máscara (Plano 18, RN-282, D7)', () => {
  const joao = { nome: 'João Silva', email: null, telefone: null };

  it('comNomeSocial soma o nome social a outrosNomes (mantém a equipe); sem nome social, o alvo não muda', () => {
    expect(comNomeSocial(joao, 'Joana Silva')).toEqual({ ...joao, outrosNomes: ['Joana Silva'] });
    const comEquipe = { ...joao, outrosNomes: ['Debby Lima'], frasesExatas: ['Consultório Bem Viver'] };
    expect(comNomeSocial(comEquipe, 'Joana Silva')).toEqual({ ...comEquipe, outrosNomes: ['Debby Lima', 'Joana Silva'] });
    expect(comNomeSocial(joao, null)).toBe(joao);
    expect(comNomeSocial(joao, '   ')).toBe(joao);
  });

  it('o nome social some do texto livre pela regra do nome (completo, com sobrenome e o primeiro nome sozinho)', () => {
    const alvo = comNomeSocial(joao, 'Joana Silva');
    expect(textoLivre('Joana Silva relata fome. A Joana trouxe exames; joana silva voltou.', alvo)).toBe('[removido] relata fome. A [removido] trouxe exames; [removido] voltou.');
    // o nome de registro continua saindo
    expect(mascarar('João Silva, ou Joana, comeu.', alvo)).toBe('[removido], ou [removido], comeu.');
  });

  it('o limite declarado vale também para o nome social (primeiro nome que é palavra de alimentação só sai com o sobrenome)', () => {
    const alvo = comNomeSocial(joao, 'Rosa Lima');
    expect(mascarar('Uma rosa no prato. Rosa Lima comeu.', alvo)).toBe('Uma rosa no prato. [removido] comeu.');
  });
});
