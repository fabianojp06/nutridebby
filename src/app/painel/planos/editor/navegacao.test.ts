import { describe, expect, it } from 'vitest';
import { ehCliqueEmSair, ehNavegacaoInterna, haAlteracaoNaoSalva } from './navegacao';

const AQUI = 'https://app.nutridebby.test/painel/pacientes/p1/plano-alimentar/v1';
const clique = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
const link = (href: string, extra: Partial<{ target: string; temDownload: boolean }> = {}) => ({ href, target: '', temDownload: false, ...extra });

describe('clique que sai do editor por navegação interna (US-022: aviso antes de perder edição)', () => {
  it('link da mesma origem, botão principal, sem modificadores nem target: é navegação interna', () => {
    expect(ehNavegacaoInterna(clique, link('/painel/pacientes/p1/plano-alimentar'), AQUI)).toBe(true);
    expect(ehNavegacaoInterna(clique, link('https://app.nutridebby.test/painel'), AQUI)).toBe(true);
    expect(ehNavegacaoInterna(clique, link('/painel', { target: '_self' }), AQUI)).toBe(true);
  });

  it('nova aba/janela, download, outra origem, âncora na própria página ou clique já tratado: não intercepta', () => {
    for (const k of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey'] as const) expect(ehNavegacaoInterna({ ...clique, [k]: true }, link('/painel'), AQUI), k).toBe(false);
    expect(ehNavegacaoInterna({ ...clique, button: 1 }, link('/painel'), AQUI)).toBe(false); // botão do meio
    expect(ehNavegacaoInterna({ ...clique, defaultPrevented: true }, link('/painel'), AQUI)).toBe(false);
    expect(ehNavegacaoInterna(clique, link('/painel/alimentos/x', { target: '_blank' }), AQUI)).toBe(false); // "Cadastrar medida caseira"
    expect(ehNavegacaoInterna(clique, link('/api/arquivos?x=1', { temDownload: true }), AQUI)).toBe(false);
    expect(ehNavegacaoInterna(clique, link('https://outro.test/painel'), AQUI)).toBe(false);
    expect(ehNavegacaoInterna(clique, link('mailto:ana@exemplo.test'), AQUI)).toBe(false);
    expect(ehNavegacaoInterna(clique, link('#orientacoes'), AQUI)).toBe(false);
    expect(ehNavegacaoInterna(clique, null, AQUI)).toBe(false); // clique fora de link
  });
});

describe('clique no botão "Sair" (formulário com data-sair, não link): sai do editor e encerra a sessão', () => {
  it('clique no botão Sair é interceptado, com ou sem modificadores (o envio do formulário sai do mesmo jeito)', () => {
    expect(ehCliqueEmSair(clique, true)).toBe(true);
    for (const k of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey'] as const) expect(ehCliqueEmSair({ ...clique, [k]: true }, true), k).toBe(true);
  });

  it('clique fora do botão Sair, ou já tratado por outro listener: não intercepta', () => {
    expect(ehCliqueEmSair(clique, false)).toBe(false); // outro botão, link ou campo
    expect(ehCliqueEmSair({ ...clique, defaultPrevented: true }, true)).toBe(false);
  });
});

describe('há alteração que ainda não foi salva? (pede confirmação ao sair)', () => {
  it('só tudo salvo e nenhuma edição esperando o debounce sai sem perguntar', () => {
    expect(haAlteracaoNaoSalva('salvo', false)).toBe(false);
  });

  it('qualquer outro status pergunta: salvando, offline, erro, parado', () => {
    for (const status of ['salvando', 'offline', 'erro', 'parado']) expect(haAlteracaoNaoSalva(status, false), status).toBe(true);
  });

  it('edição esperando o debounce pergunta, mesmo com o status ainda "salvo"', () => {
    expect(haAlteracaoNaoSalva('salvo', true)).toBe(true);
  });
});
