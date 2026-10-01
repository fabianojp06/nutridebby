import { describe, expect, it } from 'vitest';
import { urlDoApp } from './url-do-app';

describe('urlDoApp', () => {
  it('junta APP_URL e caminho com uma única barra', () => {
    expect(urlDoApp('https://nutri.exemplo.com', '/admin')).toBe('https://nutri.exemplo.com/admin');
    expect(urlDoApp('https://nutri.exemplo.com/', '/admin')).toBe('https://nutri.exemplo.com/admin');
  });
  it('mantém o prefixo de caminho do APP_URL (diferente de new URL("/x", base))', () => {
    expect(urlDoApp('https://exemplo.com/nutri', '/n/')).toBe('https://exemplo.com/nutri/n/');
    expect(urlDoApp('https://exemplo.com/nutri/', '/convite/abc')).toBe('https://exemplo.com/nutri/convite/abc');
  });
});
