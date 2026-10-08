import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MSG_POUCOS_DADOS } from '@/modules/pacientes/evolucao';

// "Desde {mês}" depende do ano de hoje: o relógio fica fixo em 08/10/2026.
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date('2026-10-08T12:00:00Z'));

// A página só monta o que evolucaoParaPaciente devolve: sessão e dados simulados.
const estado = vi.hoisted(() => ({ evolucao: null as unknown }));
vi.mock('@/lib/paciente-session', () => ({ requirePaciente: async () => ({ ctx: {}, tenant: { mostrarPercGorduraPaciente: false, fuso: 'America/Sao_Paulo' } }) }));
vi.mock('@/modules/portal/evolucao', () => ({ evolucaoParaPaciente: async () => estado.evolucao }));
const { default: TodasAsMedidas } = await import('./page');

const pagina = async () => renderToStaticMarkup(await TodasAsMedidas());

describe('/p/evolucao — "Todas as medidas" (US-194, F-Medidas)', () => {
  it('2 avaliações sem nenhuma medida repetida → "poucos dados", sem tabela', async () => {
    estado.evolucao = {
      avaliacoes: 2,
      series: [
        { id: 'peso', rotulo: 'Peso', unidade: 'kg', casas: 1, pontos: [{ data: '2026-09-01', valor: 70 }] },
        { id: 'circ_cintura', rotulo: 'Cintura', unidade: 'cm', casas: 1, pontos: [{ data: '2026-09-20', valor: 80 }] },
      ],
      diferencas: [],
    };
    const html = await pagina();
    expect(html).toContain(MSG_POUCOS_DADOS);
    expect(html).not.toContain('<table');
  });

  it('tabela: uma coluna por avaliação, uma linha por medida, "Desde {mês}" com a diferença; th com scope; região que rola sozinha', async () => {
    const primeiro = { data: '2026-03-18', valor: 82.8 };
    const ultimo = { data: '2026-09-22', valor: 78.6 };
    estado.evolucao = {
      avaliacoes: 2,
      series: [
        { id: 'peso', rotulo: 'Peso', unidade: 'kg', casas: 1, pontos: [primeiro, ultimo] },
        { id: 'circ_cintura', rotulo: 'Cintura', unidade: 'cm', casas: 1, pontos: [{ data: '2026-09-22', valor: 86 }] },
      ],
      diferencas: [{ rotulo: 'Peso', casas: 1, unidade: 'kg', primeiro, ultimo, texto: '−4,2 kg' }],
    };
    const html = await pagina();
    expect(html).toMatch(/<div role="region" aria-labelledby="tabela-medidas" tabindex="0" class="[^"]*\boverflow-x-auto\b/);
    expect(html).toContain('<th scope="col">18/03/2026</th><th scope="col">22/09/2026</th><th scope="col">Desde março</th>');
    expect(html).toContain('<th scope="row">Peso (kg)</th><td>82,8</td><td>78,6</td><td>−4,2 kg</td>');
    expect(html).toContain('<th scope="row">Cintura (cm)</th><td>—</td><td>86,0</td><td>—</td>');
    expect(html).toContain('aria-label="Voltar para Jornada"');
  });
});
