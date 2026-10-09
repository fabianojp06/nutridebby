import { createElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MSG_FALHA, MSG_IA } from '@/modules/ia/constantes';
import type { SituacaoDoExame } from '@/modules/ia/tarefas';

// Revisão da T13: a região viva que anuncia o fim da leitura, o silêncio antes de ativar a IA (US-101) e os campos
// controlados da conferência e o envio sem o reset do React 19 (depois de uma action com erro). Só a montagem; as ações
// não rodam.
vi.mock('./estado-ia', () => ({ EstadoIa: () => null }));
vi.mock('./pedir-leitura-form', () => ({ PedirLeituraForm: ({ titulo }: { titulo: string }) => createElement('button', null, `Ler valores com IA do exame ${titulo}`) }));
vi.mock('./actions', () => ({ aplicarSugestaoAction: vi.fn() }));
const hooks = vi.hoisted(() => ({ estado: {} as Record<string, unknown>, soInicial: false }));
vi.mock('react', async (orig) => {
  const r = await orig<typeof import('react')>();
  // soInicial: useState de mentira (só o valor inicial), para chamar o componente como função e ver as props dos campos
  const useState = ((i: unknown) => (hooks.soInicial ? [typeof i === 'function' ? (i as () => unknown)() : i, () => {}] : r.useState(i))) as typeof r.useState;
  return { ...r, useState, useActionState: () => [hooks.estado, () => {}, false] };
});

const { IaDoExame, iaNoExame } = await import('./ia-exame');
const { ConferenciaIa } = await import('./conferencia-ia');

const AGORA = new Date('2026-10-06T12:00:00Z');
const EXAME = { id: 'e1', titulo: 'Hemograma' };
const LIVRE = { podePedir: true, aviso: null } as const;
const situacao = (s: Partial<SituacaoDoExame>) => ({ id: 't1', status: 'pronta', erro: null, expiraEm: new Date('2026-10-10T00:00:00Z'), ...s }) as SituacaoDoExame;
const montar = (s: SituacaoDoExame | undefined, ia: Parameters<typeof IaDoExame>[0]['ia']) =>
  renderToStaticMarkup(createElement(IaDoExame, { patientId: 'p', exame: EXAME, situacao: s, ia, agora: AGORA }));
const base = { motivo: null, situacao: { tipo: 'nunca' } as const, cota: null };

describe('IA em cada exame (revisão da T13)', () => {
  it('toda situação fica dentro de uma região viva que não muda; o "Lendo o laudo…" não tem região própria', () => {
    for (const s of [situacao({ status: 'processando' }), situacao({}), situacao({ status: 'falhou', erro: 'laudo_longo' }), undefined]) {
      const html = montar(s, LIVRE);
      expect(html.startsWith('<div aria-live="polite">'), html).toBe(true);
      expect(html.match(/aria-live|role="status"/g), html).toHaveLength(1);
    }
    expect(montar(situacao({ status: 'na_fila' }), LIVRE)).toContain(MSG_IA.lendo);
    expect(montar(situacao({}), LIVRE)).toContain('Ver valores encontrados');
    expect(montar(situacao({ status: 'falhou', erro: 'laudo_longo' }), LIVRE)).toContain(MSG_FALHA.laudo_longo);
  });

  it('IA não ativada (US-101): sem botão e sem aviso; a sugestão pronta vigente continua (D19)', () => {
    const ia = iaNoExame({ estadoIa: 'nao_ativada', ...base });
    expect(ia).toEqual({ podePedir: false, aviso: null });
    expect(montar(undefined, ia)).toBe('<div aria-live="polite"></div>');
    expect(montar(situacao({ status: 'falhou', erro: 'laudo_longo' }), ia)).toBe('<div aria-live="polite"></div>');
    expect(montar(situacao({}), ia)).toContain('Ver valores encontrados');
  });

  it('o "indisponível" é só do IA_DESLIGADA; os demais avisos seguem como antes', () => {
    expect(iaNoExame({ estadoIa: 'emergencia', ...base })).toEqual({ podePedir: false, aviso: MSG_IA.indisponivel });
    expect(iaNoExame({ estadoIa: 'nao_liberada', ...base })).toEqual({ podePedir: false, aviso: MSG_IA.naoLiberada }); // R7
    expect(iaNoExame({ estadoIa: 'aditivo_desatualizado', ...base })).toEqual({ podePedir: false, aviso: MSG_IA.aditivoDesatualizado });
    // Plano 14A (US-105, D8, D9): o motivo do paciente pela autorização; sem retenção zero → "indisponível"
    const nunca = { tipo: 'nunca' } as const;
    expect(iaNoExame({ estadoIa: 'ativa', motivo: 'sem_autorizacao', situacao: nunca, cota: null }).aviso).toBe(MSG_IA.semAutorizacao);
    expect(iaNoExame({ estadoIa: 'ativa', motivo: 'sem_autorizacao', situacao: { tipo: 'retirada', id: 'r', em: new Date(), canal: 'app' }, cota: null }).aviso).toBe(MSG_IA.retirouAutorizacao);
    expect(iaNoExame({ estadoIa: 'ativa', motivo: 'paciente_indisponivel', situacao: nunca, cota: null }).aviso).toBe(MSG_FALHA.paciente_indisponivel);
    expect(iaNoExame({ estadoIa: 'sem_retencao', motivo: null, situacao: nunca, cota: null })).toEqual({ podePedir: false, aviso: MSG_IA.indisponivel });
    expect(iaNoExame({ estadoIa: 'ativa', ...base, cota: { usadoMicroUsd: 1, cotaMicroUsd: 1, percentual: 100, nivel: 'esgotada' } }).aviso).toBe(MSG_IA.cotaAcabou);
    expect(iaNoExame({ estadoIa: 'ativa', ...base })).toEqual(LIVRE);
    expect(montar(undefined, iaNoExame({ estadoIa: 'emergencia', ...base }))).toContain(MSG_IA.indisponivel);
    expect(montar(undefined, LIVRE)).toContain('Ler valores com IA do exame Hemograma');
  });
});

/** Os elementos da árvore que o componente devolve (sem renderizar os filhos que são componentes). */
function elementos(n: ReactNode, fora: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(n)) n.forEach((x) => elementos(x, fora));
  else if (n && typeof n === 'object' && 'props' in n) {
    const el = n as ReactElement<{ children?: ReactNode }>;
    fora.push(el);
    elementos(el.props.children, fora);
  }
  return fora;
}

describe('tabela de conferência: nada se perde depois de um erro (revisão da T13)', () => {
  it('caixas, nome, valor, unidade, referência e "usar a data" são controlados (o React 19 reseta os não controlados)', () => {
    hooks.estado = { erros: { geral: 'Um exame pode ter no máximo 50 valores. Desmarque 5 linhas.', data: 'Confira a data.' } };
    const linhas = [0, 1].map((i) => ({ indice: i, nomeSugerido: `M${i}`, nomeAjustado: false, valorInicial: '92', valorTexto: '92', unidade: 'mg/dL', referencia: '70 a 99', pagina: 1, jaLancado: false }));
    const props = { patientId: 'p', tarefaId: 't', linhas, dataColeta: { iso: '2026-10-01', texto: '01/10/2026' }, descartadas: 0 };
    hooks.soInicial = true;
    const arvore = (ConferenciaIa as (p: typeof props) => ReactNode)(props);
    hooks.soInicial = false;
    // rodada 2: `<form action={…}>` faz o React chamar form.reset(), que desmarca até as caixas controladas no DOM (prova
    // no navegador: e2e/conferencia-ia.spec.ts); o envio é à mão, com method="post" para antes da hidratação
    const form = elementos(arvore).find((e) => e.type === 'form') as ReactElement<Record<string, unknown>>;
    expect(form.props).not.toHaveProperty('action');
    expect(form.props.method).toBe('post');
    expect(typeof form.props.onSubmit).toBe('function');
    const campos = elementos(arvore).filter((e) => e.type === 'input') as ReactElement<Record<string, unknown>>[];
    expect(campos.map((c) => c.props.name)).toEqual(['sel', 'nome-0', 'valor-0', 'unidade-0', 'referencia-0', 'sel', 'nome-1', 'valor-1', 'unidade-1', 'referencia-1', 'usarData']);
    for (const c of campos) {
      const nome = String(c.props.name);
      expect(c.props, nome).not.toHaveProperty('defaultValue');
      expect(c.props, nome).not.toHaveProperty('defaultChecked');
      expect(typeof c.props.onChange, nome).toBe('function');
      expect(c.props, nome).toHaveProperty(c.props.type === 'checkbox' ? 'checked' : 'value');
    }
    expect(campos.find((c) => c.props.name === 'nome-0')?.props.value).toBe('M0');
    expect(campos.find((c) => c.props.name === 'sel')?.props.checked).toBe(false); // caixas começam desmarcadas (US-111)
  });
});
