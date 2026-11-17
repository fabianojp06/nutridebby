import { describe, expect, it } from 'vitest';
import { lerMarcacao } from './marcacao';

const t = (texto: string, negrito = false) => ({ texto, negrito });

describe('lerMarcacao (RN-395)', () => {
  it('texto vazio ou só espaços → []', () => {
    expect(lerMarcacao('')).toEqual([]);
    expect(lerMarcacao('  \n\n \n')).toEqual([]);
  });
  it('parágrafos separados por linha em branco; quebra simples fica dentro do parágrafo', () => {
    expect(lerMarcacao('Jejum de 8 horas.\r\nVenha cedo.\n\n\nTraga o pedido.')).toEqual([
      { tipo: 'paragrafo', trechos: [t('Jejum de 8 horas.\nVenha cedo.')] },
      { tipo: 'paragrafo', trechos: [t('Traga o pedido.')] },
    ]);
  });
  it('lista: linhas seguidas que começam com "- "; texto antes vira parágrafo', () => {
    expect(lerMarcacao('Preparo:\n- jejum de 8 h\n- sem exercício na véspera\n-sem espaço não é lista')).toEqual([
      { tipo: 'paragrafo', trechos: [t('Preparo:')] },
      { tipo: 'lista', itens: [[t('jejum de 8 h')], [t('sem exercício na véspera')]] },
      { tipo: 'paragrafo', trechos: [t('-sem espaço não é lista')] },
    ]);
  });
  it('linha "- " sem texto não vira item vazio (é descartada)', () => {
    expect(lerMarcacao('- jejum de 8 h\n- \n-    \n- sem exercício')).toEqual([{ tipo: 'lista', itens: [[t('jejum de 8 h')], [t('sem exercício')]] }]);
    expect(lerMarcacao('- ')).toEqual([]);
    expect(lerMarcacao('Preparo:\n- \nVenha cedo.')).toEqual([{ tipo: 'paragrafo', trechos: [t('Preparo:\nVenha cedo.')] }]);
  });
  it('negrito **…**, também dentro da lista', () => {
    expect(lerMarcacao('Tome **2 cápsulas** ao dia e **beba água**.')).toEqual([
      { tipo: 'paragrafo', trechos: [t('Tome '), t('2 cápsulas', true), t(' ao dia e '), t('beba água', true), t('.')] },
    ]);
    expect(lerMarcacao('- **Manhã:** 1 cápsula')).toEqual([{ tipo: 'lista', itens: [[t('Manhã:', true), t(' 1 cápsula')]] }]);
  });
  it('asterisco solto fica; **sem fim fica literal; **** vazio fica literal', () => {
    expect(lerMarcacao('Vitamina D* conforme laudo')).toEqual([{ tipo: 'paragrafo', trechos: [t('Vitamina D* conforme laudo')] }]);
    expect(lerMarcacao('**sem fim')).toEqual([{ tipo: 'paragrafo', trechos: [t('**sem fim')] }]);
    expect(lerMarcacao('a **** b')).toEqual([{ tipo: 'paragrafo', trechos: [t('a **** b')] }]);
    expect(lerMarcacao('**a** e **b')).toEqual([{ tipo: 'paragrafo', trechos: [t('a', true), t(' e **b')] }]);
  });
  it('HTML, links, imagens, títulos e entidades saem como texto literal', () => {
    for (const s of ['<script>alert(1)</script>', '[link](http://x)', '<b>x</b>', '&amp;', '# Título', '![img](http://x/a.png)', '<img src=x onerror=alert(1)>']) {
      expect(lerMarcacao(s), s).toEqual([{ tipo: 'paragrafo', trechos: [t(s)] }]);
    }
    expect(lerMarcacao('**<i>x</i>**')).toEqual([{ tipo: 'paragrafo', trechos: [t('<i>x</i>', true)] }]);
  });
});
