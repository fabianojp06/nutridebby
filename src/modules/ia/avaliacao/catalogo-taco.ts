import { readFileSync } from 'node:fs';
import { lerAba } from '../../../../scripts/seeds/planilhas';
import { BUSCA_LIMITE, palavrasDaBusca, type AlimentoEncontrado } from '@/modules/alimentos/busca';
import { converterTaco, idTaco, TACO_FONTE } from '@/modules/alimentos/taco';
import type { BuscaAlimentos } from '../ferramentas-alimentos';

/**
 * RN-127 (Plano 14B-1, D7): a busca de alimentos da AVALIAÇÃO, em memória, sobre a planilha oficial da TACO (a mesma do
 * seed, com os mesmos ids: `idTaco(n)`) — a avaliação roda o laço de produção sem banco. Como a de produção: cada palavra
 * do termo (as mesmas palavras de `palavrasDaBusca`) no nome, sem acento e sem maiúsculas; até 20; aqui, do nome mais
 * curto (a de produção também ordena pelo começo e pela semelhança). Sem as medidas caseiras do IBGE nem alimentos de um
 * consultório. Só o script `pnpm ia:avaliar` e os testes importam (guarda de grafo do Next).
 */
const semAcento = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

let tabela: { alimento: AlimentoEncontrado; chave: string }[] | null = null;
function carregar() {
  return (tabela ??= converterTaco(lerAba(readFileSync(TACO_FONTE.arquivo), TACO_FONTE.aba)).map((r) => ({
    alimento: {
      id: idTaco(r.tacoId),
      nome: r.nome,
      grupo: r.grupo,
      origem: 'TACO' as const,
      porCem: { kcal: r.kcal, proteinaG: r.proteinaG, carboidratoG: r.carboidratoG, lipidioG: r.lipidioG, fibraG: r.fibraG },
      medidas: [],
    },
    chave: semAcento(r.nome),
  })));
}

export function catalogoTaco(): BuscaAlimentos {
  const todos = carregar();
  return async (termo) => {
    const palavras = palavrasDaBusca(termo).map(semAcento);
    if (palavras.join('').length < 2) return [];
    return todos
      .filter((x) => palavras.every((w) => x.chave.includes(w)))
      .sort((a, b) => a.alimento.nome.length - b.alimento.nome.length) // estável: no empate, a ordem da planilha
      .slice(0, BUSCA_LIMITE)
      .map((x) => x.alimento);
  };
}
