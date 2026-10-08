import { describe, expect, it } from 'vitest';
import { mensagemDaFase, MSG_COMI_ASSIM, mostraBotao, PRAZO_DESFAZER_MS, sobra } from './comi-assim-estado';

describe('"Comi assim" com "Desfazer" (G-D5 ★ = c, RN-198)', () => {
  it('prazo de 10 s que pausa (WCAG 2.2.1): o que sobra nunca é negativo', () => {
    expect(PRAZO_DESFAZER_MS).toBe(10_000);
    expect(sobra(10_000, 3_500)).toBe(6_500);
    expect(sobra(2_000, 5_000)).toBe(0);
  });
  it('mensagens da região viva (sempre montada) e o botão que some depois da resposta', () => {
    expect(mensagemDaFase('pronto')).toBe('');
    expect(mensagemDaFase('aguardando')).toBe('Registrado no diário.');
    expect(mensagemDaFase('feito')).toBe('Registrado no diário.');
    expect(mensagemDaFase('desfeito')).toBe(MSG_COMI_ASSIM.desfeito);
    expect(MSG_COMI_ASSIM).toEqual({ desfazer: 'Desfazer', desfeito: 'Registro desfeito.', semConexao: 'Sem conexão. Registre quando voltar.', podeDesfazer: 'Para desfazer, use o botão Desfazer logo abaixo.' });
    expect(['pronto', 'aguardando', 'enviando', 'feito', 'desfeito', 'erro'].filter((f) => mostraBotao(f as never))).toEqual(['pronto', 'desfeito', 'erro']);
  });
});
