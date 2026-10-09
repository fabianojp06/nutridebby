import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { caminhoAte, grafoDeImports, raizesDoNext } from '../../../test/grafo-de-imports';

const fontes = (dir: string): string[] =>
  readdirSync(path.resolve(dir), { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && /\.(ts|tsx|mjs|js)$/.test(d.name) && !/\.test\.tsx?$/.test(d.name))
    .map((d) => path.relative(process.cwd(), path.join(d.parentPath, d.name)).split(path.sep).join('/'));
const importa = (pacote: string) => (f: string) => new RegExp(`from '${pacote}(/[^']*)?'|import\\('${pacote}`).test(readFileSync(f, 'utf8'));

describe('RNF-103 / RNF-105: o SDK, o pdf-lib e o que o provedor pode usar', () => {
  it('@anthropic-ai/sdk só em src/modules/ia/provedor-anthropic.ts (src e scripts)', () => {
    expect([...fontes('src'), ...fontes('scripts')].filter(importa('@anthropic-ai/sdk'))).toEqual(['src/modules/ia/provedor-anthropic.ts']);
  });

  it('@anthropic-ai/bedrock-sdk só em src/modules/ia/provedor-bedrock.ts (src e scripts)', () => {
    expect([...fontes('src'), ...fontes('scripts')].filter(importa('@anthropic-ai/bedrock-sdk'))).toEqual(['src/modules/ia/provedor-bedrock.ts']);
  });

  it('RNF-105 no Bedrock: só InvokeModel do perfil eu. — sem Batch, S3, URL, count_tokens, Mantle, inference_geo nem streaming', () => {
    const codigo = readFileSync('src/modules/ia/provedor-bedrock.ts', 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    for (const proibido of [/\bbatches\b/, /CreateModelInvocationJob/, /\bs3\b/i, /type:\s*'url'/, /countTokens|count_tokens/, /Mantle/, /inference_geo/, /\bstream\b/, /\bbetas?\b/, /\bfiles\b/, /\btools\b/, /\bthinking\b/, /\bfallbacks\b/]) {
      expect(codigo, String(proibido)).not.toMatch(proibido);
    }
    expect(codigo).toMatch(/maxRetries:\s*0/);
    expect(codigo).toMatch(/logLevel:\s*'off'/);
    expect(codigo).toMatch(/awsSessionToken:\s*null/);
    expect(codigo).toMatch(/apiKey:\s*null/);
  });

  it('pdf-lib só na thread do preparo do laudo e no gerador dos laudos fictícios', () => {
    expect([...fontes('src'), ...fontes('scripts')].filter(importa('pdf-lib')).sort()).toEqual(
      ['src/modules/ia/avaliacao/laudos-ficticios.ts', 'src/modules/ia/preparar-pdf-thread.ts'].filter((f) => existsSync(f)).sort(),
    );
  });

  it('ZDR: o provedor não usa Batch, Files, código, MCP, fallbacks, speed, betas, citações nem source url', () => {
    const codigo = readFileSync('src/modules/ia/provedor-anthropic.ts', 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    for (const proibido of [/\bbatches\b/, /\bfiles\b/, /code_execution/, /mcp_servers/, /\bfallbacks\b/, /\bspeed\b/, /\bbetas\b/, /\bbeta\./, /citations/, /type:\s*'url'/, /\bthinking\b/, /\btools\b/]) {
      expect(codigo, String(proibido)).not.toMatch(proibido);
    }
    expect(codigo).toMatch(/maxRetries:\s*0/);
    expect(codigo).toMatch(/logLevel:\s*'off'/);
    expect(codigo, 'sem count_tokens: o laudo sai uma vez só').not.toMatch(/countTokens|count_tokens/);
  });

  it('nada do grafo do Next alcança o SDK, o pdf-lib, o provedor real, o preparo, o job da leitura nem a avaliação', () => {
    const g = grafoDeImports(raizesDoNext());
    for (const proibido of [
      'src/modules/ia/provedor-anthropic.ts',
      'src/modules/ia/provedor-bedrock.ts',
      'src/modules/ia/provedor-do-ambiente.ts',
      'src/modules/ia/preparar-arquivo.ts',
      'src/modules/ia/preparar-pdf-thread.ts',
      'src/modules/ia/leitura-job.ts',
      'src/modules/ia/avaliacao/laudos-ficticios.ts',
      'src/modules/ia/avaliacao/avaliar.ts',
    ]) {
      expect(g.arquivos.has(proibido), `${proibido} alcançado por: ${caminhoAte(g, proibido).join(' → ')}`).toBe(false);
    }
    expect(g.pacotes.get('@anthropic-ai/sdk'), '@anthropic-ai/sdk importado (no grafo do Next) por').toBeUndefined();
    expect(g.pacotes.get('@anthropic-ai/bedrock-sdk'), '@anthropic-ai/bedrock-sdk importado (no grafo do Next) por').toBeUndefined();
    expect(g.pacotes.get('pdf-lib'), 'pdf-lib importado (no grafo do Next) por').toBeUndefined();
  });
});
