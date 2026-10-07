import { describe, expect, it } from 'vitest';
import { MSG_FALHA, MSG_IA } from '@/modules/ia/constantes';
import { chaveDaMensagemIa, mensagemIaDaChave } from './exames-enviados-ia';

describe('mensagem da IA pela URL (US-163 "Aceitar e ler, com a IA recusando o pedido")', () => {
  it('só uma CHAVE de lista fechada vai à URL; a tela mostra o texto da lista, nunca o que veio na URL', () => {
    const chave = chaveDaMensagemIa(MSG_IA.cotaAcabou)!;
    expect(chave).toBe('ia.cotaAcabou');
    expect(mensagemIaDaChave(chave)).toBe('O limite de uso da IA deste mês acabou. Ele renova no dia 1º ou quando o suporte ampliar o limite.');
    expect(mensagemIaDaChave(chaveDaMensagemIa(MSG_FALHA.arquivo_invalido))).toBe(MSG_FALHA.arquivo_invalido);
    expect(chaveDaMensagemIa('texto qualquer')).toBeNull();
    for (const ruim of ['<script>alert(1)</script>', 'ia.usoDoMes', 'toString', '__proto__', undefined, 42]) expect(mensagemIaDaChave(ruim)).toBeNull();
  });
});
