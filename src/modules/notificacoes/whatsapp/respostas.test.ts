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
});
