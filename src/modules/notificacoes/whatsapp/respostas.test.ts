import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { interpretarResposta } from './respostas';

describe('resposta do paciente (D3)', () => {
  it('"1", "sim", "confirmo" → confirmar; "2", "preciso remarcar", "não posso" → remarcar (sem acento, maiúscula, pontuação, emoji)', () => {
    expect(['1', ' 1 ', '1.', 'Sim!', 'CONFIRMO 👍', 'Confirmado'].map(interpretarResposta)).toEqual(Array(6).fill('confirmar'));
    expect(['2', 'Preciso remarcar', 'não posso', 'Não vou poder.'].map(interpretarResposta)).toEqual(Array(4).fill('remarcar'));
  });
  it('qualquer outra coisa é ignorada (a nutricionista lê no próprio WhatsApp)', () => {
    expect(['12', 'oi', '1 2', 'sim, mas atraso 10 min', '', 'x'.repeat(61)].map(interpretarResposta)).toEqual(Array(6).fill(null));
  });
  it('revisão 1 (item 8): o código não tem caracteres combinantes invisíveis (os acentos saem por classe Unicode)', () => {
    const fonte = readFileSync(path.resolve('src/modules/notificacoes/whatsapp/respostas.ts'), 'utf8');
    expect(fonte).not.toMatch(/[\u0300-\u036f]/);
    expect(['Não', 'NÃO', 'não'.normalize('NFC'), 'não'.normalize('NFD')].map((x) => interpretarResposta(`${x} posso`))).toEqual(Array(4).fill('remarcar'));
  });
});
