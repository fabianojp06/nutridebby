import { describe, expect, it } from 'vitest';
import { cpfValido, formatarCpf, normalizarCpf } from './cpf';

describe('CPF (RN-261)', () => {
  it('normaliza tirando pontos, traço e espaços; null se não sobram 11 dígitos', () => {
    expect(normalizarCpf('529.982.247-25')).toBe('52998224725');
    expect(normalizarCpf(' 529 982 247 25 ')).toBe('52998224725');
    expect(normalizarCpf('52998224725')).toBe('52998224725');
    expect(normalizarCpf('529.982.247-2')).toBeNull(); // 10 dígitos
    expect(normalizarCpf('5299822472')).toBeNull();
    expect(normalizarCpf('529982247250')).toBeNull(); // 12
    expect(normalizarCpf('529.982.247-2a')).toBeNull(); // letra não some
    expect(normalizarCpf('529/982/247-25')).toBeNull(); // só ponto, traço e espaço saem
    expect(normalizarCpf('')).toBeNull();
    expect(normalizarCpf('٥٢٩٩٨٢٢٤٧٢٥')).toBeNull(); // dígitos de outra escrita não contam
  });

  it('confere os dígitos verificadores; 11 dígitos iguais são inválidos', () => {
    expect(cpfValido('52998224725')).toBe(true);
    expect(cpfValido('11144477735')).toBe(true);
    expect(cpfValido('11111111111')).toBe(false);
    for (let d = 0; d <= 9; d++) expect(cpfValido(String(d).repeat(11))).toBe(false);
    expect(cpfValido('52998224726')).toBe(false); // segundo dígito trocado
    expect(cpfValido('52998224715')).toBe(false); // primeiro dígito trocado
    expect(cpfValido('52998224752')).toBe(false); // dígitos invertidos
    expect(cpfValido('5299822472')).toBe(false);
    expect(cpfValido('529.982.247-25')).toBe(false); // só aceita os 11 dígitos já normalizados
  });

  it('formata 000.000.000-00', () => {
    expect(formatarCpf('52998224725')).toBe('529.982.247-25');
    expect(formatarCpf('01234567890')).toBe('012.345.678-90');
  });
});
