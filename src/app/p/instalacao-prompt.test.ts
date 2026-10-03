import { describe, expect, it, vi } from 'vitest';
import { assinarInstalacao, estadoDoPrompt, ouvirInstalacao, promptUsado } from './instalacao-prompt';

describe('beforeinstallprompt guardado no módulo do layout do portal (US-040, Android)', () => {
  it('o evento que chega antes do Início montar fica guardado (com preventDefault); quem assina depois o encontra; appinstalled o descarta', () => {
    const janela = new EventTarget();
    ouvirInstalacao(janela);
    const evento = new Event('beforeinstallprompt', { cancelable: true });
    janela.dispatchEvent(evento); // antes de qualquer componente assinar
    expect(evento.defaultPrevented).toBe(true);
    expect(estadoDoPrompt()).toEqual({ prompt: evento, instalado: false });
    expect(estadoDoPrompt()).toBe(estadoDoPrompt()); // snapshot estável do useSyncExternalStore
    const aviso = vi.fn();
    const sair = assinarInstalacao(aviso);
    promptUsado();
    expect(estadoDoPrompt().prompt).toBeNull();
    janela.dispatchEvent(new Event('beforeinstallprompt', { cancelable: true }));
    janela.dispatchEvent(new Event('appinstalled'));
    expect(estadoDoPrompt()).toEqual({ prompt: null, instalado: true });
    expect(aviso).toHaveBeenCalledTimes(3);
    sair();
  });
});
