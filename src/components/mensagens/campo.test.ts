import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { aplicarResposta } from './campo';

// E2E "rodada T6b (I4)": falha de rede → o rascunho volta; a rede volta e o envio dá certo → o campo esvazia.
describe('aplicarResposta (o campo da conversa, painel e portal)', () => {
  it('falha de rede e depois sucesso no MESMO textarea: o rascunho volta e, no sucesso, o campo fica vazio', () => {
    const campo = { value: 'Escrito sem rede' };
    expect(aplicarResposta(campo, { texto: 'Escrito sem rede', enviada: false })).toBe(false);
    expect(campo.value).toBe('Escrito sem rede');
    expect(aplicarResposta(campo, { texto: '', enviada: true })).toBe(true);
    expect(campo.value).toBe('');
    // sem resposta ainda (o render inicial ou uma mensagem nova que refaz a tela): nada muda no rascunho
    campo.value = 'rascunho em andamento';
    expect(aplicarResposta(campo, null)).toBe(false);
    expect(campo.value).toBe('rascunho em andamento');
  });

  it('nos dois lados, o textarea não remonta por `key` e a resposta entra por aplicarResposta num efeito sobre o estado', () => {
    for (const f of ['src/app/painel/mensagens/[patientId]/campo.tsx', 'src/app/p/(portal)/mensagens/conversa-portal.tsx']) {
      const fonte = readFileSync(f, 'utf8');
      expect(fonte, f).not.toMatch(/<Texto[^>]*\bkey=/);
      expect(fonte, f).toMatch(/<Texto estado=\{estado\}/);
      expect(fonte, f).toMatch(/aplicarResposta\(ref\.current, estado\)/);
      expect(fonte, f).toMatch(/\}, \[estado(, depois)?\]\);/);
    }
  });
});
