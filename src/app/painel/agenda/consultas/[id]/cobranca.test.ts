import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { LancamentoNaTela } from '@/modules/financeiro/tipos';

// Só a montagem da seção "Cobrança" com a cobrança pedida (as actions não rodam; o banco fica em cobranca-actions.test.ts).
vi.mock('./cobranca-actions', () => ({
  cancelarCobrancaAction: vi.fn(),
  receberCobrancaAction: vi.fn(),
  registrarCobrancaAction: vi.fn(),
  salvarValorCobrancaAction: vi.fn(),
}));
vi.mock('../../../financeiro/lancamentos/actions', () => ({
  cancelarLancamentoAction: vi.fn(),
  desfazerRecebimentoAction: vi.fn(),
  receberLancamentoAction: vi.fn(),
}));
const { SecaoCobranca } = await import('./cobranca');
const { MSG_FINANCEIRO: M } = await import('@/modules/financeiro/constantes');

const base: LancamentoNaTela = {
  id: '00000000-0000-4000-8000-000000000001',
  tipo: 'entrada',
  categoria: { id: '00000000-0000-4000-8000-000000000002', nome: 'Consultas' },
  valorCentavos: 25000,
  vencimento: '2026-11-10',
  pagoEm: null,
  forma: null,
  descricao: null,
  paciente: { id: '00000000-0000-4000-8000-000000000003', nome: 'Ana Souza', bloqueado: false, anonimizado: false },
  consulta: null,
  situacao: 'em_atraso',
  canceladoEm: null,
  motivoCancelamento: null,
  anonimizado: false,
};
const secao = (cobranca: LancamentoNaTela) =>
  renderToStaticMarkup(createElement(SecaoCobranca, { consultaId: 'c', cobranca, motivo: null, valorSugerido: null, hoje: '2026-11-23' }));

describe('seção "Cobrança": o aviso do paciente bloqueado ou anonimizado (TRI-17-20 #130)', () => {
  it('bloqueado: o aviso do bloqueado (as cobranças em aberto continuam valendo)', () => {
    const h = secao({ ...base, paciente: { ...base.paciente!, bloqueado: true } });
    expect(h).toContain(M.bloqueado);
    expect(h).not.toContain(M.pacienteAnonimizado);
  });

  // a cobrança em aberto é cancelada na anonimização (e some da seção); a recebida fica, anonimizada
  it('anonimizado: o aviso do anonimizado, sem o do bloqueado, e sem as ações', () => {
    const h = secao({
      ...base,
      pagoEm: '2026-11-10',
      forma: 'pix',
      situacao: 'recebido',
      anonimizado: true,
      paciente: { ...base.paciente!, nome: 'Paciente anonimizado', anonimizado: true },
    });
    expect(h).toContain(M.pacienteAnonimizado);
    expect(h).not.toContain(M.bloqueado);
    expect(h).not.toContain(M.consulta.salvarValor);
  });

  it('nem bloqueado nem anonimizado: nenhum dos dois avisos', () => {
    const h = secao(base);
    expect(h).not.toContain(M.bloqueado);
    expect(h).not.toContain(M.pacienteAnonimizado);
  });
});
