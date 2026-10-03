import { describe, expect, it } from 'vitest';
import { estadoDeInstalacao } from './instalacao';

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

describe('instalação do PWA (US-040)', () => {
  it('Android com o prompt nativo → botão "Instalar app"; já instalado → nada', () => {
    expect(estadoDeInstalacao({ ua: ANDROID, standalone: false, temPrompt: true, toques: 5, plataforma: 'Linux armv8l' })).toBe('android');
    expect(estadoDeInstalacao({ ua: ANDROID, standalone: true, temPrompt: false, toques: 5, plataforma: 'Linux armv8l' })).toBe('instalado');
    expect(estadoDeInstalacao({ ua: ANDROID, standalone: false, temPrompt: false, toques: 5, plataforma: 'Linux armv8l' })).toBe('nada');
  });
  it('Safari no iPhone (e no iPad, que se diz Mac) fora do modo standalone → tutorial; instalado → nada', () => {
    expect(estadoDeInstalacao({ ua: IPHONE, standalone: false, temPrompt: false, toques: 5, plataforma: 'iPhone' })).toBe('ios');
    expect(estadoDeInstalacao({ ua: IPAD, standalone: false, temPrompt: false, toques: 5, plataforma: 'MacIntel' })).toBe('ios');
    expect(estadoDeInstalacao({ ua: IPHONE, standalone: true, temPrompt: false, toques: 5, plataforma: 'iPhone' })).toBe('instalado');
    expect(estadoDeInstalacao({ ua: IPAD, standalone: false, temPrompt: false, toques: 0, plataforma: 'MacIntel' })).toBe('nada'); // Mac de verdade
  });
});
