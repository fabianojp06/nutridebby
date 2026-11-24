import { describe, expect, it } from 'vitest';
import { semInvalidosNoBanco } from './texto-seguro';

describe('semInvalidosNoBanco (SUS-109)', () => {
  it('tira o NUL e os surrogates sem par, em qualquer posição', () => {
    expect(semInvalidosNoBanco('a\u0000b')).toBe('ab');
    expect(semInvalidosNoBanco('\ud800a')).toBe('a');
    expect(semInvalidosNoBanco('a\udc00')).toBe('a');
    expect(semInvalidosNoBanco('\u0000𐀀\u0000')).toBe('𐀀'); // o par que sobra é válido (U+10000)
    expect(semInvalidosNoBanco('\udc00\ud800')).toBe(''); // invertidos: nenhum tem par
    expect(semInvalidosNoBanco('x\ud800𐀀y')).toBe('x𐀀y'); // o primeiro alto fica sem par; o par segue
    expect(semInvalidosNoBanco('\u0000𐀀'.slice(0, 2))).toBe('');
  });

  it('preserva os pares válidos (emoji), acentos, quebras de linha e espaços', () => {
    const texto = '  Ferritina 🙂 baixa;\r\n\tconduta: ↑ ferro 👩🏽‍⚕️  ';
    expect(semInvalidosNoBanco(texto)).toBe(texto);
    expect(semInvalidosNoBanco('🙂\u0000🙂')).toBe('🙂🙂');
    expect(semInvalidosNoBanco('🙂'.slice(0, 1) + 'ok')).toBe('ok'); // emoji cortado ao meio
  });

  it('o resultado é sempre UTF-16 bem formado', () => {
    const amostras = ['\ud800', '\udc00', '🙂\ud83d', '\ude42🙂', 'a\u0000\ud800\u0000\udc00b'];
    for (const s of amostras) expect(semInvalidosNoBanco(s).isWellFormed()).toBe(true);
  });
});
