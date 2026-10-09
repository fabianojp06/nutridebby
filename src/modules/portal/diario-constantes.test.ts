import { describe, expect, it } from 'vitest';
import { REFEICAO_DO_PLANO_MAX, refeicaoDoDiario, RESPOSTAS_DO_DIARIO, ROTULO_RESPOSTA, ROTULO_RESPOSTA_NUTRI, rotuloDaRefeicao } from './diario-constantes';

describe('respostas do diário (Plano 16, RN-197)', () => {
  it('a refeição do diário vem do nome da refeição do plano, sem acento e sem diferença de maiúsculas; senão "Outro"', () => {
    expect(refeicaoDoDiario('Almoço')).toBe('Almoço');
    expect(refeicaoDoDiario('  almoco ')).toBe('Almoço');
    expect(refeicaoDoDiario('CAFÉ DA MANHÃ')).toBe('Café da manhã');
    expect(refeicaoDoDiario('Lanche da tarde')).toBe('Lanche da tarde');
    expect(refeicaoDoDiario('Pré-treino')).toBe('Outro');
    expect(refeicaoDoDiario('')).toBe('Outro');
  });

  it('o rótulo da refeição do plano é "{nome} · {HH:MM}" (sem horário, só o nome) e cabe no CHECK do banco', () => {
    expect(rotuloDaRefeicao('Almoço', '12:30')).toBe('Almoço · 12:30');
    expect(rotuloDaRefeicao('Ceia', '')).toBe('Ceia');
    // meals.nome tem até 60 caracteres (meals_textos_tamanho): 60 + " · 12:30" = 68 ≤ 80
    expect(rotuloDaRefeicao('x'.repeat(60), '23:59').length).toBeLessThanOrEqual(REFEICAO_DO_PLANO_MAX);
  });

  it('dois valores de resposta, com o texto do paciente e o do painel (§4.9)', () => {
    expect(RESPOSTAS_DO_DIARIO).toEqual(['como_no_plano', 'outra_coisa']);
    expect(ROTULO_RESPOSTA).toEqual({ como_no_plano: 'Comi assim', outra_coisa: 'Comi outra coisa' });
    expect(ROTULO_RESPOSTA_NUTRI).toEqual({ como_no_plano: 'Comeu como no plano', outra_coisa: 'Comeu outra coisa' });
  });
});
