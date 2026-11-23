import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MSG_LEMBRETES } from '@/modules/lembretes/constantes';

// Sem DOM no Vitest: o clique no interruptor e no "Apagar" fica para o E2E (e2e/lembretes.spec.ts, caminho feliz). Aqui, a
// chamada das actions pelos dois (TRI-17-20 #60): a falha de rede ou o erro 500 vira a mensagem do alerta, em vez de
// estourar a transição (o useOptimistic volta ao valor salvo quando ela termina, como no interruptor do portal).
vi.mock('./actions', () => ({ apagarLembreteAction: vi.fn(), ligarLembreteAction: vi.fn() }));
const { chamarAcao, ListaDeLembretes } = await import('./lista');

describe('lista de lembretes do painel: a action que lança (TRI-17-20 #60)', () => {
  it('exceção (rede, 500) vira { erro } com a mensagem de falha do módulo; o resultado normal passa igual', async () => {
    expect(MSG_LEMBRETES.falhou).toBe('Não foi possível salvar. Verifique a conexão e tente de novo.');
    expect(await chamarAcao(() => Promise.reject(new TypeError('Failed to fetch')))).toEqual({ erro: MSG_LEMBRETES.falhou });
    expect(await chamarAcao(async () => ({ ok: 'Lembrete ligado.' }))).toEqual({ ok: 'Lembrete ligado.' });
    expect(await chamarAcao(async () => ({ erro: 'Lembrete não encontrado. Recarregue a página.' }))).toEqual({ erro: 'Lembrete não encontrado. Recarregue a página.' });
  });

  it('o interruptor monta com o estado salvo e sem alerta', () => {
    const html = renderToStaticMarkup(
      createElement(ListaDeLembretes, {
        patientId: 'p',
        tituloId: 't',
        lembretes: [{ id: 'l1', tipo: 'agua', config: { inicio: '08:00', fim: '20:00', intervaloMin: 120, dias: [0, 1, 2, 3, 4, 5, 6] }, ligado: true, desligadoPeloPacienteEm: null }],
        sugestao: null,
        modelos: { agua: { tipo: 'agua', config: { inicio: '08:00', fim: '20:00', intervaloMin: 120, dias: [1] } }, refeicoes: { tipo: 'refeicoes', config: { antecedenciaMin: 0, diarioDepoisMin: null } } },
        avisosDasRefeicoes: [],
        somenteLeitura: false,
      }),
    );
    expect(html).toMatch(/role="switch" aria-checked="true" aria-labelledby="l1-nome"/);
    expect(html).not.toContain('l1-interruptor-erro');
  });
});
