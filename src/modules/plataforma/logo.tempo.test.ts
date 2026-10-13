import { describe, expect, it, vi } from 'vitest';
import { contemFiltroSvg } from './logo';

vi.mock('server-only', () => ({})); // M16: logo.ts é só do servidor

// Teste de tempo: no CI roda à parte, depois da suíte e sozinho (pnpm test:tempo, test/arquivos-de-tempo.ts)
describe('contemFiltroSvg — tempo', () => {
  it('"<!--", "<?" ou "<![CDATA[" sem fechamento é recusado, em tempo linear mesmo com 200 mil (M15, G1)', () => {
    // Teto folgado (3 s): no runner próprio a cota de CPU é dividida com outros workers e a mesma conta levou 824 ms;
    // o que este teste pega é a volta do tempo quadrático, que com 200 mil aberturas fica ordens de grandeza acima
    const TETO = 3000;
    for (const abre of ['<!--', '<?', '<![CDATA[']) {
      const svg = Buffer.from(`<svg><style>${abre.repeat(200_000)}x</style></svg>`);
      const inicio = performance.now();
      expect(contemFiltroSvg(svg)).toBe(true);
      expect(performance.now() - inicio).toBeLessThan(TETO);
    }
    for (const par of [
      '<!---->',
      '<?x?>',
      '<![CDATA[]]>',
      '<',
      '<!DOCTYPE svg SYSTEM "',
      '<!DOCTYPE svg>',
      '<!DOCTYPE svg                 ',
    ]) {
      const svg = Buffer.from(`<svg><style>${par.repeat(200_000)}x</style></svg>`);
      const inicio = performance.now();
      contemFiltroSvg(svg);
      expect(performance.now() - inicio).toBeLessThan(TETO);
    }
  });
});
