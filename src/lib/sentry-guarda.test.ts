import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// D1 / RNF-11: o Sentry sobe num lugar só (com o filtro), nunca no navegador e nunca com Replay.
const ARQUIVOS = readdirSync(path.resolve('src'), { recursive: true, withFileTypes: true })
  .filter((d) => d.isFile() && /\.(ts|tsx)$/.test(d.name) && !d.name.endsWith('.test.ts'))
  .map((d) => path.join(d.parentPath, d.name));

describe('guarda do Sentry', () => {
  it('Sentry.init só em src/lib/sentry.ts', () => {
    const com = ARQUIVOS.filter((f) => /Sentry\.init\(/.test(readFileSync(f, 'utf8'))).map((f) => path.relative(process.cwd(), f));
    expect(com).toEqual(['src/lib/sentry.ts']);
  });
  it('nenhum SDK de navegador, Replay ou tracing', () => {
    for (const f of ARQUIVOS) {
      const s = readFileSync(f, 'utf8');
      // a chave de amostragem é proibida com qualquer valor: no v8+ até o zero liga a instrumentação de tracing
      expect(s, f).not.toMatch(/@sentry\/(nextjs|browser|react)|replayIntegration|browserTracingIntegration|\btraces(SampleRate|Sampler)\s*:/);
    }
  });
  it('@sentry/node não é importado por componente de cliente', () => {
    for (const f of ARQUIVOS) {
      const s = readFileSync(f, 'utf8');
      if (/^['"]use client['"]/m.test(s)) expect(s, f).not.toMatch(/@sentry\/|@\/lib\/sentry/);
    }
  });
});
