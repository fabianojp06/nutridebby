import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TenantContext } from '@/db/tenant';
import { AREAS_MODELOS_IA, MSG_MODELOS_IA } from '@/modules/ia/constantes';
import type { SituacaoDasAreas } from '@/modules/ia/modelos-sugeridos';

// US-123 "Gerar" (revisão da T5, Important): a seção dos modelos é a última de Configurações; depois do redirect
// (?modelos=pedido#modelos-ia) a âncora leva a tela até ela e a confirmação "Gerando os modelos de {área}…" recebe o foco.
vi.mock('server-only', () => ({}));
const situacao = vi.fn<() => Promise<SituacaoDasAreas>>();
vi.mock('@/modules/ia/modelos-sugeridos', () => ({ situacaoDasAreas: () => situacao() }));
vi.mock('@/app/painel/ia/estado-tarefa', () => ({ EstadoTarefa: () => null }));
vi.mock('./modelos-ia-form', () => ({ ModelosIaForm: () => '[ModelosIaForm]' }));

const { ModelosIa } = await import('./modelos-ia');

const ctx = { tenantId: '00000000-0000-4000-8000-000000000001', role: 'nutri' } as TenantContext;
const vazia = () => Object.fromEntries(AREAS_MODELOS_IA.map((a) => [a, { geradoEm: null, emAndamento: null, falhou: null }])) as SituacaoDasAreas;
const html = async (pedido?: boolean) => renderToStaticMarkup(await ModelosIa({ ctx, fuso: 'America/Sao_Paulo', pedido }));

describe('Configurações > Modelos sugeridos pela IA: confirmação do "Gerar modelos"', () => {
  it('a seção tem a âncora do redirect, com margem para o cabeçalho', async () => {
    situacao.mockResolvedValue(vazia());
    expect(await html()).toMatch(/<section id="modelos-ia"[^>]*class="scroll-mt-24 /);
  });

  it('com o pacote em andamento, a confirmação é uma região de status que pode receber foco', async () => {
    const s = vazia();
    s.diabetes.emAndamento = { id: '00000000-0000-4000-8000-000000000009' };
    situacao.mockResolvedValue(s);
    for (const pedido of [true, false]) {
      expect(await html(pedido)).toContain(`<p tabindex="-1" role="status">${MSG_MODELOS_IA.gerando('Diabetes')}</p>`);
    }
  });

  it('sem pacote em andamento, o formulário volta (nada para focar)', async () => {
    situacao.mockResolvedValue(vazia());
    const h = await html(true);
    expect(h).toContain('[ModelosIaForm]');
    expect(h).not.toContain('role="status"');
  });
});
