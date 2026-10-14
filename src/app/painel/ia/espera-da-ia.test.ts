import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MSG_RESUMO } from '@/modules/ia/constantes';

// Revisão da T11: a linha de estado do resumo e do rascunho é UMA região viva que fica montada; o "Preparando…" e o
// resultado trocam DENTRO dela (nenhum filho com região viva própria).
vi.mock('@/app/painel/ia/estado-tarefa', () => ({ EstadoTarefa: () => null }));
const { EsperaDaIa } = await import('./espera-da-ia');

const TEXTOS = { andamento: MSG_RESUMO.preparando, pronto: MSG_RESUMO.pronto };
const montar = (p: Partial<Parameters<typeof EsperaDaIa>[0]>) =>
  renderToStaticMarkup(createElement(EsperaDaIa, { andamento: null, textos: TEXTOS, pronto: false, falha: null, indisponivel: null, ...p }));

describe('EsperaDaIa (revisão da T11)', () => {
  it('toda situação fica dentro de uma única região viva, que existe até vazia', () => {
    const casos = [
      {},
      { andamento: { id: 't1' } },
      { pronto: true },
      { falha: MSG_RESUMO.falha },
      { indisponivel: 'Esta sugestão não está mais disponível.' },
      { pronto: true, falha: MSG_RESUMO.falha },
    ];
    for (const c of casos) {
      const html = montar(c);
      expect(html.startsWith('<div aria-live="polite"'), html).toBe(true);
      expect(html.match(/aria-live|role="(status|alert)"/g), html).toHaveLength(1);
    }
    expect(montar({})).toBe('<div aria-live="polite" class="space-y-2"></div>');
  });

  it('em andamento, o texto da espera; pronto, o fim da espera só para leitor de tela; falha e indisponível com o aviso', () => {
    expect(montar({ andamento: { id: 't1' } })).toContain(`<p>${MSG_RESUMO.preparando}</p>`);
    expect(montar({ andamento: { id: 't1' }, pronto: true })).not.toContain(MSG_RESUMO.pronto);
    expect(montar({ pronto: true })).toContain(`<p class="sr-only">${MSG_RESUMO.pronto}</p>`);
    expect(montar({ falha: MSG_RESUMO.falha })).toMatch(new RegExp(`<p class="[^"]*border-aviso[^"]*">${MSG_RESUMO.falha}</p>`));
    expect(montar({ indisponivel: 'Esta sugestão não está mais disponível.' })).toContain('Esta sugestão não está mais disponível.');
  });
});
