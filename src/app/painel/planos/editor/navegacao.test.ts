import { describe, expect, it } from 'vitest';
import { comoSair, ehNavegacaoInterna, haAlteracaoNaoSalva } from './navegacao';
import type { StatusSalvamento } from './use-salvamento';

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

const tudoCerto = { edicaoEsperando: false, falhou: false, parado: false };
const STATUS: StatusSalvamento[] = ['salvo', 'salvando', 'offline', 'erro', 'parado'];

describe('há alteração que ainda não foi salva? (o botão "Sair" não perde a edição)', () => {
  it('só tudo salvo e nenhuma edição esperando o debounce não tem alteração pendente', () => {
    expect(haAlteracaoNaoSalva('salvo', false)).toBe(false);
  });

  it('qualquer outro status tem: salvando, offline, erro, parado', () => {
    for (const status of STATUS.filter((s) => s !== 'salvo')) expect(haAlteracaoNaoSalva(status, false), status).toBe(true);
  });

  it('edição esperando o debounce tem, mesmo com o status ainda "salvo"', () => {
    expect(haAlteracaoNaoSalva('salvo', true)).toBe(true);
  });
});

describe('como "Sair" trata a edição do editor (US-022: nunca perder edição sem avisar)', () => {
  it('tudo salvo e nada esperando: sai direto, sem perguntar', () => {
    expect(comoSair('salvo', tudoCerto)).toBe('direto');
  });

  it('só o debounce pendente (ou um envio normal em voo): envia na hora e espera gravar antes de sair', () => {
    expect(comoSair('salvo', { ...tudoCerto, edicaoEsperando: true })).toBe('enviar-antes'); // clique antes do render do "Salvando…"
    expect(comoSair('salvando', { ...tudoCerto, edicaoEsperando: true })).toBe('enviar-antes');
    expect(comoSair('salvando', tudoCerto)).toBe('enviar-antes'); // PUT em voo, sem nada esperando: espera ele terminar
  });

  it('sem rede, erro de campo (422), conflito/paciente bloqueado (parado) ou última tentativa sem sucesso: pede confirmação', () => {
    for (const status of ['offline', 'erro', 'parado'] as const) {
      expect(comoSair(status, tudoCerto), status).toBe('confirmar');
      expect(comoSair(status, { ...tudoCerto, edicaoEsperando: true }), `${status} com edição esperando`).toBe('confirmar');
    }
    expect(comoSair('salvando', { ...tudoCerto, falhou: true, edicaoEsperando: true })).toBe('confirmar'); // editou de novo depois da falha
    expect(comoSair('salvando', { ...tudoCerto, parado: true })).toBe('confirmar');
  });
});
