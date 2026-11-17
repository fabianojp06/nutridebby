import { describe, expect, it } from 'vitest';
import { idDoCampo } from './campo-do-erro';

describe('idDoCampo (D31: o erro da publicação vira link para o campo do editor)', () => {
  const r = '0b9f3c1e-6c3a-4f7e-9d2a-1a2b3c4d5e6f';
  it('as chaves da refeição e do plano apontam para os ids do editor', () => {
    expect(idDoCampo(`refeicao:${r}:descricaoLivre`)).toBe(`${r}-descricao`);
    expect(idDoCampo(`refeicao:${r}:nome`)).toBe(`${r}-nome`);
    expect(idDoCampo(`refeicao:${r}:horario`)).toBe(`${r}-horario`);
    expect(idDoCampo(`refeicao:${r}:dias`)).toBe(`${r}-dias`);
    expect(idDoCampo('titulo')).toBe('titulo');
    expect(idDoCampo('metaKcal')).toBe('meta');
  });
  it('chave sem campo no editor (ou fora do formato) → null', () => {
    expect(idDoCampo('geral')).toBeNull();
    expect(idDoCampo(`refeicao:${r}:desconhecido`)).toBeNull();
    expect(idDoCampo('refeicao:<script>:nome')).toBeNull();
    expect(idDoCampo('toString')).toBeNull();
  });
});
