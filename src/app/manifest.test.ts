import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import manifest from './manifest';

describe('manifest do PWA do paciente', () => {
  it('start_url fica dentro do scope (senão o navegador ignora o scope e usa "/")', () => {
    const { start_url, scope } = manifest();
    expect(scope).toBe('/p/');
    expect(start_url!.startsWith(scope!)).toBe(true);
  });

  it('instalável (Chrome Android): ícones 192 e 512 que existem em public/, um maskable, id, idioma e cor', () => {
    const m = manifest();
    expect(m.id).toBe('/p/inicio');
    expect(m.lang).toBe('pt-BR');
    expect(m.icons!.map((i) => `${i.sizes} ${i.purpose}`)).toEqual(['192x192 any', '512x512 any', '512x512 maskable']);
    for (const i of m.icons!) expect(existsSync(path.join('public', i.src)), i.src).toBe(true);
  });

  it('WCAG 2.1 AA 1.3.4 (Orientação): o app instalado não trava em retrato nem em paisagem', () => {
    expect(manifest().orientation).toBeUndefined();
  });
});
