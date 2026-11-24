import { describe, expect, it } from 'vitest';
import { caminhoNaFicha } from './adicionar';

// Plano 25 (CH-D44): o href absoluto do Adicionar pode levar `{id}`, trocado pelo paciente (o "Enviar mensagem" da seção
// "Mensagens" vai para /painel/mensagens/{id}); relativo, continua dentro da ficha.
const P = '0b6c3c9e-8a3f-4a1d-9a54-6f7c2a1e9d11';
describe('caminhoNaFicha', () => {
  it('relativo → dentro da ficha; absoluto → como está; {id} → o paciente', () => {
    expect(caminhoNaFicha(P, 'antropometria#nova-avaliacao')).toBe(`/painel/pacientes/${P}/antropometria#nova-avaliacao`);
    expect(caminhoNaFicha(P, '/painel/exames-recebidos/abc')).toBe('/painel/exames-recebidos/abc');
    expect(caminhoNaFicha(P, '/painel/mensagens/{id}')).toBe(`/painel/mensagens/${P}`);
    expect(caminhoNaFicha(P, '/painel/x/{id}/y/{id}')).toBe(`/painel/x/${P}/y/${P}`);
  });
});
