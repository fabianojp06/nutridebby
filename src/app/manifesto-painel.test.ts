import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import manifestDoPortal from './manifest';
import { MANIFESTO_DO_PAINEL_URL, manifestoDoPainel, METADADOS_DO_PAINEL } from './manifesto-painel';
import { GET } from './painel.webmanifest/route';

const dentro = (url: string, escopo: string) => new URL(url, 'https://x.dev').pathname.startsWith(escopo);

describe('manifest do painel da nutricionista (P09-05)', () => {
  it('app próprio: id e ícones diferentes dos do portal; abre no Início do painel numa janela sem barra de endereço', () => {
    const m = manifestoDoPainel();
    expect(m).toMatchObject({ id: '/painel', start_url: '/painel', display: 'standalone', lang: 'pt-BR', name: 'NutriDebby — Painel', short_name: 'Painel ND' });
    expect(m.id).not.toBe(manifestDoPortal().id);
    expect(m.icons!.map((i) => `${i.sizes} ${i.purpose}`)).toEqual(['192x192 any', '512x512 any', '512x512 maskable']);
    for (const i of m.icons!) {
      expect(existsSync(path.join('public', i.src)), i.src).toBe(true);
      expect(manifestDoPortal().icons!.map((p) => p.src)).not.toContain(i.src);
    }
    expect(m.orientation).toBeUndefined(); // WCAG 1.3.4
  });

  it('Review Focus 5 (D7): o escopo cobre o painel, o login e a Segurança — o login a cada 12 h ociosas fica na janela do app', () => {
    const { scope, start_url } = manifestoDoPainel();
    for (const url of [start_url!, '/painel/pacientes', '/entrar', '/entrar/2fa', '/conta/seguranca', '/conta/outro-papel']) expect(dentro(url, scope!), url).toBe(true);
  });

  it('D8: o manifest não declara service worker', () => {
    expect(manifestoDoPainel()).not.toHaveProperty('serviceworker');
  });

  it('a rota serve o mesmo manifest com o tipo certo; o layout do painel aponta para ela', async () => {
    const r = GET();
    expect(r.headers.get('content-type')).toBe('application/manifest+json');
    expect(await r.json()).toEqual(JSON.parse(JSON.stringify(manifestoDoPainel())));
    expect(METADADOS_DO_PAINEL.manifest).toBe(MANIFESTO_DO_PAINEL_URL);
    expect(readFileSync('src/app/painel/layout.tsx', 'utf8')).toContain('export const metadata: Metadata = METADADOS_DO_PAINEL;');
  });
});
