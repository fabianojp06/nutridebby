import { describe, expect, it } from 'vitest';
import manifest from './manifest';

describe('manifest do PWA do paciente', () => {
  it('start_url fica dentro do scope (senão o navegador ignora o scope e usa "/")', () => {
    const { start_url, scope } = manifest();
    expect(scope).toBe('/p/');
    expect(start_url!.startsWith(scope!)).toBe(true);
  });
});
