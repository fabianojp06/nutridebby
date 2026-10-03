import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MSG_POUCOS_DADOS } from '@/modules/pacientes/evolucao';

// A página só monta o que evolucaoParaPaciente devolve: sessão e dados simulados.
const estado = vi.hoisted(() => ({ evolucao: null as unknown }));
vi.mock('@/lib/paciente-session', () => ({ requirePaciente: async () => ({ ctx: {}, tenant: { mostrarPercGorduraPaciente: false } }) }));
vi.mock('@/modules/portal/evolucao', () => ({ evolucaoParaPaciente: async () => estado.evolucao }));
const { default: MinhaEvolucao } = await import('./page');

const pagina = async () => renderToStaticMarkup(await MinhaEvolucao());

describe('/p/evolucao: Medidas (US-044)', () => {
  it('2 avaliações sem nenhuma medida repetida → "poucos dados", não uma seção vazia', async () => {
    estado.evolucao = {
      avaliacoes: 2,
      series: [
        { id: 'peso', rotulo: 'Peso', unidade: 'kg', casas: 1, pontos: [{ data: '2026-09-01', valor: 70 }] },
        { id: 'cintura', rotulo: 'Cintura', unidade: 'cm', casas: 1, pontos: [{ data: '2026-09-20', valor: 80 }] },
      ],
      diferencas: [],
      orientacoes: [],
    };
    const html = await pagina();
    expect(html).toContain(MSG_POUCOS_DADOS);
    expect(html).not.toContain('<ul');
  });

  it('com uma medida repetida mostra a diferença', async () => {
    const primeiro = { data: '2026-09-01', valor: 70 };
    const ultimo = { data: '2026-09-20', valor: 68.5 };
    estado.evolucao = {
      avaliacoes: 2,
      series: [{ id: 'peso', rotulo: 'Peso', unidade: 'kg', casas: 1, pontos: [primeiro, ultimo] }],
      diferencas: [{ rotulo: 'Peso', casas: 1, unidade: 'kg', primeiro, ultimo, texto: '−1,5 kg' }],
      orientacoes: [],
    };
    const html = await pagina();
    expect(html).not.toContain(MSG_POUCOS_DADOS);
    expect(html).toContain('Peso: 70,0 (01/09/2026) → 68,5 (20/09/2026) · −1,5 kg');
  });
});
