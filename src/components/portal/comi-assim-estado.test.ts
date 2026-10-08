import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { focoVaiAoDesfazer, mensagemDaFase, MSG_COMI_ASSIM, mostraBotao, PRAZO_DESFAZER_MS, saiuDaTela, sobra } from './comi-assim-estado';

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

describe('"Comi assim": o prazo corre no toque e sair da tela envia (revisão da T11, RN-198)', () => {
  it('o foco vai ao "Desfazer" (e pausa o prazo) só pelo teclado ou leitor de tela, nunca no toque ou no mouse', () => {
    expect(focoVaiAoDesfazer(0, false)).toBe(true); // Enter/Espaço, leitor de tela: clique sem ponteiro
    expect(focoVaiAoDesfazer(1, true)).toBe(true); // botão com :focus-visible (chegou pelo Tab)
    // toque ou mouse no Chrome: o botão já tem o foco no pointerdown, mas sem :focus-visible — o prazo de 10 s corre
    expect(focoVaiAoDesfazer(1, false)).toBe(false);
  });
  it('a página escondida (tela inicial, outro app) envia; a que volta a aparecer não', () => {
    expect(saiuDaTela('hidden')).toBe(true);
    expect(saiuDaTela('visible')).toBe(false);
  });
  it('o componente decide o foco por focoVaiAoDesfazer (não pelo activeElement) e ouve o visibilitychange com limpeza', () => {
    const fonte = readFileSync(new URL('./comi-assim.tsx', import.meta.url), 'utf8');
    expect(fonte).not.toMatch(/document\.activeElement/);
    expect(fonte).toContain('focoVaiAoDesfazer(e.detail, focoVisivel(e.currentTarget))');
    expect(fonte).toContain("el.matches(':focus-visible')");
    expect(fonte).toContain("document.addEventListener('visibilitychange', aoEsconder)");
    expect(fonte).toContain("document.removeEventListener('visibilitychange', aoEsconder)");
    expect(fonte).toContain('if (saiuDaTela(document.visibilityState)) void enviar(true)');
  });
});
