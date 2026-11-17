import { describe, expect, it } from 'vitest';
import type { AlimentoEncontrado } from '@/modules/alimentos/busca';
import { MAX_ITENS, MAX_REFEICOES } from '@/modules/plano-alimentar/constantes';
import type { PlanoDoCliente } from '@/modules/plano-alimentar/tipos';
import { estadoInicial, legendaDosDias, nomesAcessiveis, paraEnvio, reduzir, refeicoesDoFiltro, totaisDoFiltro, type Acao, type EstadoEditor } from './estado';

// Teste de tempo: no CI roda à parte, depois da suíte e sozinho (pnpm test:tempo, test/arquivos-de-tempo.ts)
const plano: PlanoDoCliente = {
  id: 'p', patientId: 'pac', isTemplate: false, titulo: 'Plano', metaKcal: 2000, energyCalcId: null, status: 'rascunho', versao: 1, revisao: 0,
  publicadoEm: null, mostrarCalorias: false, orientacoes: '', modo: 'calculado', macrosPrescritos: null, pdfStatus: null, refeicoes: [], origemIa: null, iaOrigemEm: null,
  referenciaId: null, referenciaCongelada: null, nutrientesExibidos: [], mostrarMicrosPdf: false,
};
const alimento = (k: number): AlimentoEncontrado => ({
  id: `f${k}`, nome: `Alimento ${k}`, nomeOriginal: null, grupo: 'Miscelâneas', fonte: 'propria', origem: 'Meu alimento', micros: {},
  porCem: { kcal: 100 + k, proteinaG: 3, carboidratoG: 15, lipidioG: 2, fibraG: 1 }, medidas: [],
});

/**
 * PM-PA9 (RN-249, RNF-230): o recálculo do editor é síncrono a cada tecla (reducer + totais do filtro + legenda dos dias
 * + nomes acessíveis). Com 50 refeições e 400 itens (metade em dias de semana, metade no fim de semana), cada tecla
 * precisa caber num quadro de 60 Hz (16 ms). A medição de verdade (digitação no navegador) é o E2E da Tarefa 11.
 */
describe('editor — recálculo por tecla com 50 refeições e 400 itens', () => {
  it('reducer + totais + legenda + nomes abaixo de 16 ms por tecla (p95 de 200 teclas)', () => {
    let e: EstadoEditor = estadoInicial(plano);
    for (let r = 0; r < MAX_REFEICOES; r++) {
      e = reduzir(e, { tipo: 'novaRefeicao', id: `r${r}` });
      e = reduzir(e, { tipo: 'refeicao', id: `r${r}`, campo: 'nome', valor: r % 5 === 0 ? 'Almoço' : `Refeição ${r}` });
      if (r % 2) for (const dia of [1, 2, 3, 4, 5] as const) e = reduzir(e, { tipo: 'dia', id: `r${r}`, dia, marcado: false });
      else for (const dia of [0, 6] as const) e = reduzir(e, { tipo: 'dia', id: `r${r}`, dia, marcado: false });
    }
    for (let k = 0; k < MAX_ITENS; k++) e = reduzir(e, { tipo: 'adicionarItem', refeicaoId: `r${k % MAX_REFEICOES}`, id: `i${k}`, alimento: alimento(k) });
    expect(e.refeicoes.reduce((n, r) => n + r.itens.length, 0)).toBe(MAX_ITENS);

    /** O que o editor recalcula a cada tecla (`editor-plano.tsx`), com "Todos" e com um dia escolhido. */
    const tecla = (s: EstadoEditor, a: Acao, filtro: 'todos' | 1) => {
      const novo = reduzir(s, a);
      totaisDoFiltro(novo, filtro);
      refeicoesDoFiltro(novo, filtro);
      legendaDosDias(novo);
      nomesAcessiveis(novo);
      paraEnvio(novo, 0); // o corpo do PUT é montado no fim do debounce, mas contar não custa
      return novo;
    };
    for (let k = 0; k < 20; k++) e = tecla(e, { tipo: 'quantidade', itemId: `i${k}`, valor: String(100 + k) }, 'todos'); // aquecimento (JIT)

    const tempos: number[] = [];
    for (let k = 0; k < 200; k++) {
      const inicio = performance.now();
      e = tecla(e, { tipo: 'quantidade', itemId: `i${k % MAX_ITENS}`, valor: String(50 + k) }, k % 2 ? 'todos' : 1);
      tempos.push(performance.now() - inicio);
    }
    tempos.sort((a, b) => a - b);
    const p95 = tempos[Math.floor(tempos.length * 0.95)];
    console.info(`editor: p95 do recálculo por tecla = ${p95.toFixed(2)} ms (50 refeições, 400 itens)`);
    expect(p95).toBeLessThan(16);
  });
});
