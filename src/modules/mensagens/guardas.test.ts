import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { caminhoAte, fontesDe, grafoDeImports } from '../../../test/grafo-de-imports';

/**
 * Plano 25 (RN-469, RN-470, RNF-444; CH-D34): guardas de texto e de grafo do módulo de Mensagens.
 * - Nada do chat em log ou Sentry: nenhuma chamada de `logger.*`/`Sentry.*` recebe texto, nome de anexo, recado ou caminho.
 * - Texto como texto: nenhum `dangerouslySetInnerHTML` nem link automático nas telas de mensagens.
 * - Nada do chat na IA: src/modules/ia/** não alcança src/modules/mensagens nem cita as tabelas; src/modules/mensagens só
 *   importa de src/modules/ia os dois arquivos permitidos.
 */
const ROTAS_DE_MENSAGENS = (raiz: string) =>
  existsSync(raiz)
    ? readdirSync(raiz, { recursive: true, encoding: 'utf8' })
        .map((f) => path.join(raiz, f))
        .filter((f) => /(^|\/)mensagens(\/|$)/.test(path.relative(raiz, f)) && /\.(tsx?|jsx?)$/.test(f) && !/\.test\./.test(f))
    : [];
const FONTES = () => [...fontesDe('src/modules/mensagens'), ...ROTAS_DE_MENSAGENS('src/app')];

/** As chamadas `logger.x(…)`/`Sentry.x(…)`/`console.x(…)` de uma fonte (do nome até o parêntese que fecha). */
function chamadasDeLog(fonte: string): string[] {
  const out: string[] = [];
  const re = /\b(logger|Sentry|console)\.\w+\s*\(/g;
  for (let m = re.exec(fonte); m; m = re.exec(fonte)) {
    let nivel = 0;
    let i = m.index + m[0].length - 1;
    for (; i < fonte.length; i++) {
      if (fonte[i] === '(') nivel++;
      else if (fonte[i] === ')' && --nivel === 0) break;
    }
    out.push(fonte.slice(m.index, i + 1));
  }
  return out;
}
/** `new Error(` (ou de uma subclasse `…Error(`) cujo argumento é um template com `${…}`. */
function errosInterpolados(fonte: string): string[] {
  return [...fonte.matchAll(/new\s+\w*Error\s*\(\s*`[^`]*\$\{[^`]*`/g)].map((m) => m[0]);
}
const PROIBIDO_NO_LOG = /\b(texto|anexoNome|anexo_nome|recado|caminho|anexoPath|anexo_path|anexoOriginalPath|nome|email)\b/i;

describe('RN-470: nada do chat em log, console ou Sentry', () => {
  it('a regra pega a chamada em várias linhas e deixa passar a que leva só ids e códigos', () => {
    expect(chamadasDeLog("logger.warn(\n  { patientId, texto },\n  'x',\n);")).toEqual(["logger.warn(\n  { patientId, texto },\n  'x',\n)"]);
    expect(PROIBIDO_NO_LOG.test(chamadasDeLog("logger.warn({ patientId, texto }, 'x')")[0])).toBe(true);
    expect(PROIBIDO_NO_LOG.test(chamadasDeLog("Sentry.captureException(err, { extra: { caminho } })")[0])).toBe(true);
    expect(PROIBIDO_NO_LOG.test(chamadasDeLog("logger.error({ err: nomeDoErro(e), sqlstate, mensagemId }, 'chat: falhou')")[0])).toBe(false);
    expect(PROIBIDO_NO_LOG.test(chamadasDeLog('console.log(texto)')[0])).toBe(true);
    expect(errosInterpolados('throw new Error(`mensagens: ${texto}`);')).toHaveLength(1);
    expect(errosInterpolados("throw new Error('mensagens: só a sessão nutri');")).toEqual([]);
    expect(errosInterpolados('throw new Error(`falhou`);')).toEqual([]);
  });

  it('nenhum `new Error(` com template interpolado (o texto da mensagem acabaria na mensagem do erro, no log e no Sentry)', () => {
    const violacoes = FONTES().flatMap((f) => errosInterpolados(readFileSync(f, 'utf8')).map((c) => `${f}: ${c}`));
    expect(violacoes).toEqual([]);
  });

  it('nenhuma chamada de logger/Sentry em src/modules/mensagens e nas rotas de mensagens leva texto, nome de anexo, recado ou caminho', () => {
    const fontes = FONTES();
    expect(fontes.length).toBeGreaterThan(3);
    const violacoes = fontes.flatMap((f) => chamadasDeLog(readFileSync(f, 'utf8')).filter((c) => PROIBIDO_NO_LOG.test(c)).map((c) => `${f}: ${c}`));
    expect(violacoes).toEqual([]);
  });
});

describe('RNF-444 / CH-D34: texto como texto', () => {
  it('nenhum dangerouslySetInnerHTML, linkify nem link automático nas fontes de mensagens', () => {
    const com = FONTES().filter((f) => /dangerouslySetInnerHTML|linkify|autolink/i.test(readFileSync(f, 'utf8')));
    expect(com).toEqual([]);
  });
});

describe('RN-469: nada do chat na IA', () => {
  const raizesIa = fontesDe('src/modules/ia');
  const g = grafoDeImports(raizesIa);

  it('o grafo da IA anda de verdade', () => {
    expect(raizesIa.length).toBeGreaterThan(10);
    expect(g.arquivos.has('src/db/tenant.ts')).toBe(true);
  });

  it('nada alcançável a partir de src/modules/ia/** é do módulo de Mensagens', () => {
    const proibidos = [...g.arquivos.keys()].filter((a) => a.startsWith('src/modules/mensagens/'));
    expect(proibidos.map((p) => caminhoAte(g, p).join(' → '))).toEqual([]);
  });

  it('nenhum arquivo de src/modules/ia/** (testes incluídos) cita as tabelas do chat ou dos recados', () => {
    const arquivos = readdirSync('src/modules/ia', { recursive: true, encoding: 'utf8' })
      .map((f) => path.join('src/modules/ia', f))
      .filter((f) => /\.(tsx?|jsx?|sql)$/.test(f));
    const comTexto = arquivos.filter((f) => /\bchat_(mensagens|conversas|leituras|configuracoes|horarios|avisos_nutri)\b|\brecados\b|\bchat(Mensagens|Conversas|Leituras)\b|modules\/mensagens/.test(readFileSync(f, 'utf8')));
    expect(comTexto).toEqual([]);
  });

  it('src/modules/mensagens importa de src/modules/ia só nutri-paciente/sinais-risco.ts e nutri-paciente/duvidas.ts (também por import type)', () => {
    const permitidos = new Set(['src/modules/ia/nutri-paciente/sinais-risco', 'src/modules/ia/nutri-paciente/duvidas']);
    const usados = fontesDe('src/modules/mensagens').flatMap((f) =>
      [...readFileSync(f, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)]
        .map((m) => m[1] ?? m[2])
        .map((s) => (s.startsWith('@/') ? `src/${s.slice(2)}` : s.startsWith('.') ? path.join(path.dirname(path.relative('.', f)), s) : s))
        .map((s) => s.replace(/\.(tsx?|jsx?)$/, ''))
        .filter((s) => s.startsWith('src/modules/ia/')),
    );
    expect(usados.filter((s) => !permitidos.has(s))).toEqual([]);
  });
});

describe('constantes das mensagens sem banco (componentes cliente importam MSG_*)', () => {
  it('constantes.ts não alcança drizzle-orm nem o barril do schema em tempo de execução', () => {
    const g = grafoDeImports(['src/modules/mensagens/constantes.ts']);
    expect(g.pacotes.get('drizzle-orm'), 'drizzle-orm importado por').toBeUndefined();
    expect(g.arquivos.has('src/db/schema/index.ts')).toBe(false);
    expect(g.arquivos.has('src/db/client.ts')).toBe(false);
  });
});
