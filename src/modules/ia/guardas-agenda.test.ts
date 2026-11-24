import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { caminhoAte, fontesDe, grafoDeImports } from '../../../test/grafo-de-imports';

/**
 * Plano 23 (RN-439): nada da agenda nova entra em contexto de IA — locais, aniversário, previsão de retorno e pedido. Guarda
 * por grafo (também por caminho indireto, como a do Financeiro, RN-323) e guarda de texto: nenhum arquivo de
 * src/modules/ia/** cita a coluna da previsão. A coluna é montada aqui para este arquivo não a conter escrita.
 */
const PROIBIDOS = ['locais', 'aniversarios', 'retorno', 'solicitacoes'].map((m) => `src/modules/agenda/${m}.ts`);
const COLUNA = ['retorno', 'previsto'].join('_');
const CAMPO = ['retorno', 'Previsto'].join('');

describe('RN-439: a agenda nova fica fora da IA', () => {
  const raizes = fontesDe('src/modules/ia');
  const g = grafoDeImports(raizes);

  it('o grafo anda de verdade (a IA alcança o banco e outros módulos)', () => {
    expect(raizes.length).toBeGreaterThan(10);
    expect(g.arquivos.has('src/db/tenant.ts')).toBe(true);
  });

  it('nenhum arquivo alcançável a partir de src/modules/ia/** é locais.ts, aniversarios.ts, retorno.ts ou solicitacoes.ts', () => {
    const alcancados = PROIBIDOS.filter((p) => g.arquivos.has(p));
    expect(alcancados.map((p) => caminhoAte(g, p).join(' → '))).toEqual([]);
  });

  it('nenhum arquivo de src/modules/ia/** (testes incluídos) contém a coluna da previsão de retorno nem o campo dela', () => {
    const arquivos = readdirSync('src/modules/ia', { recursive: true, encoding: 'utf8' })
      .map((f) => path.join('src/modules/ia', f))
      .filter((f) => /\.(tsx?|jsx?|mjs|cjs|sql|md|txt)$/.test(f));
    expect(arquivos.length).toBeGreaterThan(10);
    const comTexto = arquivos.filter((f) => {
      const fonte = readFileSync(f, 'utf8');
      return fonte.includes(COLUNA) || fonte.includes(CAMPO);
    });
    expect(comTexto).toEqual([]);
  });

  it('os quatro módulos proibidos existem (a guarda não passa por um nome errado)', () => {
    // aniversarios.ts chega na T10; até lá, a guarda vale para o nome
    const existentes = PROIBIDOS.filter((p) => {
      try {
        readFileSync(p);
        return true;
      } catch {
        return false;
      }
    });
    expect(existentes).toEqual(expect.arrayContaining(['src/modules/agenda/locais.ts', 'src/modules/agenda/retorno.ts', 'src/modules/agenda/solicitacoes.ts']));
  });
});
