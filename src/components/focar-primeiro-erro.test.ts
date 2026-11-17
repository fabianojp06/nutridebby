import { describe, expect, it, vi } from 'vitest';
import { focarPrimeiroErro, SELETOR_DO_PRIMEIRO_ERRO } from './focar-primeiro-erro';

/** Plano 22 (revisão da T3): sem DOM no Vitest — o seletor e a ordem rolar → focar; o foco de verdade fica no Playwright. */
describe('focarPrimeiroErro (src/components/focar-primeiro-erro.ts)', () => {
  it('procura o campo marcado ou o aviso de erro focável, rola até ele e foca sem rolar de novo', () => {
    const chamadas: string[] = [];
    const alvo = {
      scrollIntoView: vi.fn((o: ScrollIntoViewOptions) => chamadas.push(`rolar ${o.block}`)),
      focus: vi.fn((o: FocusOptions) => chamadas.push(`focar preventScroll=${o.preventScroll}`)),
    };
    const querySelector = vi.fn(() => alvo);
    const raiz = { querySelector } as unknown as ParentNode;
    expect(focarPrimeiroErro(raiz)).toBe(alvo);
    expect(querySelector).toHaveBeenCalledWith(SELETOR_DO_PRIMEIRO_ERRO);
    expect(chamadas).toEqual(['rolar center', 'focar preventScroll=true']);
  });

  it('o seletor pega o campo com aria-invalid e só o aviso role="alert" marcado como focável (tabindex -1)', () => {
    expect(SELETOR_DO_PRIMEIRO_ERRO).toBe('[aria-invalid="true"], [role="alert"][tabindex="-1"]');
  });

  it('sem erro marcado (ou sem formulário), nada acontece', () => {
    expect(focarPrimeiroErro({ querySelector: () => null } as unknown as ParentNode)).toBeNull();
    expect(focarPrimeiroErro(null)).toBeNull();
  });
});
