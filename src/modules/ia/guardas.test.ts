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

  it('pdf-lib só na thread do preparo do laudo e no gerador dos laudos fictícios', () => {
    expect([...fontes('src'), ...fontes('scripts')].filter(importa('pdf-lib')).sort()).toEqual(
      ['src/modules/ia/avaliacao/laudos-ficticios.ts', 'src/modules/ia/preparar-pdf-thread.ts'].filter((f) => existsSync(f)).sort(),
    );
  });

  for (const arquivo of ['src/modules/ia/provedor-anthropic.ts', 'src/modules/ia/provedor-bedrock.ts']) {
    it(`RNF-105 (${arquivo}): ferramentas só strict e auto; sem streaming, thinking, fallbacks, betas, Batch, Files, código, MCP, URL nem citações`, () => {
      const codigo = readFileSync(arquivo, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      for (const proibido of [/\bbatches\b/, /\bfiles\b/, /code_execution/, /mcp_servers/, /\bfallbacks\b/, /\bspeed\b/, /\bbetas?\b/, /\bbeta\./, /citations/, /type:\s*'url'/, /\bthinking\b/, /\bstream\b/, /countTokens|count_tokens/, /CreateModelInvocationJob/, /Mantle/, /type:\s*'(any|tool)'/, /eager_input_streaming/, /disable_parallel_tool_use/]) {
        expect(codigo, String(proibido)).not.toMatch(proibido);
      }
      expect(codigo).toMatch(/strict:\s*true/);
      expect(codigo).toMatch(/tool_choice:\s*\{\s*type:\s*'auto'\s*\}/);
      expect(codigo).toMatch(/maxRetries:\s*0/);
      expect(codigo).toMatch(/logLevel:\s*'off'/);
    });
  }
  it('RNF-105 no Bedrock: credenciais explícitas, sem inference_geo e sem S3', () => {
    const codigo = readFileSync('src/modules/ia/provedor-bedrock.ts', 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(codigo).not.toMatch(/inference_geo/);
    // R2 (pre-flight da 14B-1): a proibição de S3 do teste da 14A continua (a lista comum não a tem)
    expect(codigo).not.toMatch(/\bs3\b/i);
    expect(codigo).toMatch(/awsSessionToken:\s*null/);
    expect(codigo).toMatch(/apiKey:\s*null/);
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
      // Plano 14B: o laço, os jobs e a avaliação do assistente (os arquivos nascem nas T3, T4, T9, T10 e T12)
      ...['src/modules/ia/laco-ferramentas.ts', 'src/modules/ia/modelos-job.ts', 'src/modules/ia/resumo-job.ts', 'src/modules/ia/rascunho-job.ts', 'src/modules/ia/avaliacao/avaliar-assistente.ts'].filter((f) => existsSync(f)),
    ]) {
      expect(g.arquivos.has(proibido), `${proibido} alcançado por: ${caminhoAte(g, proibido).join(' → ')}`).toBe(false);
    }
    expect(g.pacotes.get('@anthropic-ai/sdk'), '@anthropic-ai/sdk importado (no grafo do Next) por').toBeUndefined();
    expect(g.pacotes.get('@anthropic-ai/bedrock-sdk'), '@anthropic-ai/bedrock-sdk importado (no grafo do Next) por').toBeUndefined();
    expect(g.pacotes.get('pdf-lib'), 'pdf-lib importado (no grafo do Next) por').toBeUndefined();
  });
});
