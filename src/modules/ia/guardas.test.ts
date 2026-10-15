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
    it(`RNF-105 (${arquivo}): ferramentas só strict e auto; sem streaming, thinking, cache_control (D35), fallbacks, betas, Batch, Files, código, MCP, URL nem citações`, () => {
      const codigo = readFileSync(arquivo, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      for (const proibido of [/\bbatches\b/, /\bfiles\b/, /code_execution/, /mcp_servers/, /\bfallbacks\b/, /\bspeed\b/, /\bbetas?\b/, /\bbeta\./, /citations/, /type:\s*'url'/, /\bthinking\b/, /\bstream\b/, /countTokens|count_tokens/, /CreateModelInvocationJob/, /Mantle/, /cache_control/, /type:\s*'(any|tool)'/, /eager_input_streaming/, /disable_parallel_tool_use/,
        // ferramentas de servidor do SDK (ToolUnion) e o contêiner delas: nada sai para busca, navegador ou execução de terceiro
        /web_search|web_fetch|browser_toolset|computer_|memory_20|bash_20|text_editor|tool_search|\bcontainer\b/]) {
        expect(codigo, String(proibido)).not.toMatch(proibido);
      }
      // ferramentas só do cliente: `tools` aparece uma vez, montado só de p.ferramentas, e cada entrada tem exatamente
      // nome, descrição, schema e strict — sem `type` (que faria dela uma ferramenta de servidor) nem outra chave
      expect(codigo.match(/\btools\b/g), 'tools aparece uma única vez').toHaveLength(1);
      const ferramenta = codigo.match(/\btools:\s*p\.ferramentas\.map\(\(f\)\s*=>\s*\(\{([^{}]*)\}\)\)/);
      expect(ferramenta, 'tools: p.ferramentas.map((f) => ({ … }))').not.toBeNull();
      expect([...(ferramenta?.[1] ?? '').matchAll(/(\w+)\s*:/g)].map((m) => m[1])).toEqual(['name', 'description', 'input_schema', 'strict']);
      expect(ferramenta?.[1]).toMatch(/strict:\s*true/);
      expect(codigo.match(/\btool_choice\b/g), 'tool_choice aparece uma única vez').toHaveLength(1);
      expect(codigo).toMatch(/tool_choice:\s*\{\s*type:\s*'auto'\s*\}/);
      // Plano 14B (D1): o histórico e a classificação da resposta vêm do módulo comum (geracao-formato.ts) — nenhum
      // provedor monta tool_result nem lê tool_use por conta própria
      expect(codigo).toMatch(/from '\.\/geracao-formato'/);
      expect(codigo).not.toMatch(/tool_use|tool_result/);
      expect(codigo).toMatch(/maxRetries:\s*0/);
      expect(codigo).toMatch(/logLevel:\s*'off'/);
    });
  }
  it('D35 (Plano 15): o módulo comum que monta as mensagens dos dois provedores também não usa cache_control', () => {
    const codigo = readFileSync('src/modules/ia/geracao-formato.ts', 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(codigo).not.toMatch(/cache_control/);
  });

  it('RNF-169 (Plano 15): nenhum arquivo da IA Nutri do paciente importa o SDK nem um provedor real (só o worker escolhe o provedor)', () => {
    const arquivos = readdirSync(path.resolve('src/modules/ia/nutri-paciente'), { withFileTypes: true })
      .filter((d) => d.isFile() && /\.(ts|tsx)$/.test(d.name))
      .map((d) => path.join('src/modules/ia/nutri-paciente', d.name));
    expect(arquivos.length).toBeGreaterThan(10);
    // o SDK (e subcaminhos) e os módulos dos provedores reais por qualquer caminho (./, ../ ou o alias @/)
    const proibido = /(?:from\s+|import\(\s*)'(?:@anthropic-ai\/(?:sdk|bedrock-sdk)|[^']*\/provedor-(?:anthropic|bedrock|do-ambiente))(?:'|\/)/;
    expect(arquivos.filter((f) => proibido.test(readFileSync(f, 'utf8')))).toEqual([]);
    // a regex reconhece as formas proibidas (o teste não passa por não casar nada)
    expect(proibido.test("import { provedorFake } from '../provedor-fake';")).toBe(false);
    for (const amostra of ["import Anthropic from '@anthropic-ai/sdk';", "import { provedorBedrock } from '../provedor-bedrock';", "import { x } from './provedor-anthropic';", "const m = await import('../provedor-do-ambiente');", "import { y } from '@/modules/ia/provedor-do-ambiente';"]) {
      expect(proibido.test(amostra), amostra).toBe(true);
    }
  });

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
      // Plano 14B: o laço, os jobs, o roteador da fila ia-assistente e a avaliação do assistente (a avaliação dos pacotes e a
      // busca em memória da TACO, com o xlsx, na T5F; os prontuários fictícios do resumo e do rascunho na T12)
      'src/modules/ia/laco-ferramentas.ts',
      'src/modules/ia/modelos-job.ts',
      'src/modules/ia/assistente-job.ts',
      'src/modules/ia/resumo-job.ts',
      'src/modules/ia/rascunho-job.ts',
      'src/modules/ia/avaliacao/avaliar-assistente.ts',
      'src/modules/ia/avaliacao/catalogo-taco.ts',
      'src/modules/ia/avaliacao/prontuarios-ficticios.ts',
      // Plano 15 (T13): o worker da IA Nutri do paciente (o contexto na sessão de paciente sem conta, o job com o portão do
      // envio, a varredura, a revogação, o aviso de risco e a retenção) e a avaliação da conversa (RN-184)
      'src/modules/ia/nutri-paciente/contexto.ts',
      'src/modules/ia/nutri-paciente/job.ts',
      'src/modules/ia/nutri-paciente/varredura.ts',
      'src/modules/ia/nutri-paciente/revogacao-job.ts',
      'src/modules/ia/nutri-paciente/risco-job.ts',
      'src/modules/ia/nutri-paciente/retencao.ts',
      'src/modules/ia/avaliacao/conversas-ficticias.ts',
      'src/modules/ia/avaliacao/avaliar-conversa.ts',
    ]) {
      expect(existsSync(proibido), `${proibido} existe (a guarda não confere arquivo que sumiu)`).toBe(true);
      expect(g.arquivos.has(proibido), `${proibido} alcançado por: ${caminhoAte(g, proibido).join(' → ')}`).toBe(false);
    }
    expect(g.pacotes.get('@anthropic-ai/sdk'), '@anthropic-ai/sdk importado (no grafo do Next) por').toBeUndefined();
    expect(g.pacotes.get('@anthropic-ai/bedrock-sdk'), '@anthropic-ai/bedrock-sdk importado (no grafo do Next) por').toBeUndefined();
    expect(g.pacotes.get('pdf-lib'), 'pdf-lib importado (no grafo do Next) por').toBeUndefined();
  });
});
