import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Jornada } from '@/modules/portal/jornada-regras';

const estado = vi.hoisted(() => ({ jornada: null as unknown as Jornada }));
vi.mock('@/lib/paciente-session', () => ({ requirePaciente: async () => ({ ctx: {}, tenant: { fuso: 'America/Sao_Paulo', mostrarPercGorduraPaciente: false } }) }));
vi.mock('@/app/p/moldura', () => ({ molduraDaSecao: async () => ({ marca: { nome: 'Consultório', cor: '#1d6b5a', corNoEscuro: '#6fcfb2', logoUrl: null }, secoes: [] }) }));
vi.mock('@/modules/portal/jornada', () => ({ jornadaDoPaciente: async () => estado.jornada }));
const { default: Jornada } = await import('./page');

describe('/p/jornada (US-194)', () => {
  it('título na faixa, gráfico com a alternativa em tabela, linha do tempo da próxima consulta à primeira, orientação com a voz dela', async () => {
    estado.jornada = {
      titulo: 'Sua jornada desde março',
      podeAgendar: true,
      vazia: false,
      grafico: { id: 'peso', rotulo: 'Peso nas consultas', unidade: 'kg', casas: 1, pontos: [{ data: '2026-03-18', valor: 82.8 }, { data: '2026-09-22', valor: 78.6 }] },
      marcos: [
        { tipo: 'proxima', consultaId: 'c9', quando: { semFuso: 'amanhã, 14:00', comFuso: 'amanhã, 14:00 (horário de Brasília)' }, modalidade: 'Online.' },
        { tipo: 'atendimento', data: '2026-09-22', titulo: '22 de setembro', primeira: false, medidas: [{ id: 'peso', texto: '78,6 kg' }, { id: 'circ_cintura', texto: 'cintura 86 cm' }], orientacao: 'Manter as frutas.' },
        { tipo: 'atendimento', data: '2026-03-18', titulo: '18 de março', primeira: true, medidas: [], orientacao: null },
      ],
    };
    const html = renderToStaticMarkup(await Jornada());
    expect(html).toMatch(/<h1[^>]*>Sua jornada desde março<\/h1>/);
    expect(html).toContain('Peso nas consultas');
    expect(html).toContain('Ver os dados em tabela');
    expect(html).toContain('amanhã, 14:00 (horário de Brasília)'); // sem JavaScript, com a sigla (QuandoLocal)
    expect(html).toContain('próxima consulta');
    expect(html).toContain('href="/p/agenda/c9"');
    expect(html).toContain('78,6 kg · cintura 86 cm');
    expect(html).toContain('Orientação da sua nutricionista');
    expect(html).toContain('18 de março · primeira consulta');
    expect(html.indexOf('22 de setembro')).toBeLessThan(html.indexOf('18 de março'));
    for (const href of ['/p/evolucao', '/p/agenda', '/p/agenda/nova']) expect(html).toContain(`href="${href}"`);
    expect(html).not.toMatch(/Leve suas dúvidas/); // texto do sistema com voz de orientação: não entra (§4.5)
  });

  it('ainda sem consulta: "Sua jornada começa na primeira consulta." e, sem poder agendar, sem o botão', async () => {
    estado.jornada = { titulo: 'Sua jornada', podeAgendar: false, vazia: true, grafico: null, marcos: [] };
    const html = renderToStaticMarkup(await Jornada());
    expect(html).toContain('Sua jornada começa na primeira consulta.');
    expect(html).not.toContain('href="/p/agenda/nova"');
  });
});
