import { afterEach, describe, expect, it, vi } from 'vitest';
import { rolarAteOFim } from './rolagem';

// Rodada da T7 (I3): `scrollIntoView` no próprio rodapé `sticky` não rola (ele já está "visível", grudado embaixo). A conversa
// rola a janela até o fim do documento; a margem de rolagem dos itens (`scroll-mb-64`) cobre o rodapé no foco.
describe('rolarAteOFim', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('rola a janela até a altura do documento', () => {
    const scrollTo = vi.fn();
    vi.stubGlobal('window', { scrollTo });
    vi.stubGlobal('document', { documentElement: { scrollHeight: 4321 } });
    rolarAteOFim();
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 4321 });
  });
});
