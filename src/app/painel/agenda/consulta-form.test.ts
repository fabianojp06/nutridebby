import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * Plano 23 (AG-D82): no "Alterar" da consulta marcada pelo paciente num local online com sala fixa, o "Link da chamada" é
 * só leitura com "Sala fixa do local" (o gatilho `appointments_link_da_sala` grava a sala); fora disso, o campo de sempre.
 */
vi.mock('server-only', () => ({}));
const { ConsultaForm } = await import('./consulta-form');

const VIDEO = { id: 'l-video', nome: 'Videoconferência', tipo: 'online' as const, linkSala: 'https://sala.exemplo.test/fixa' };
const VIDEO_SEM_SALA = { id: 'l-video-livre', nome: 'Chamada avulsa', tipo: 'online' as const, linkSala: null };
const CONSULTORIO = { id: 'l-consultorio', nome: 'Consultório', tipo: 'presencial' as const, linkSala: null };
const locais = [CONSULTORIO, VIDEO, VIDEO_SEM_SALA];

const render = (localId: string, doPaciente?: boolean) =>
  renderToStaticMarkup(
    createElement(ConsultaForm, {
      acao: async () => ({}),
      inicial: { data: '2026-12-01', hora: '10:00', duracaoMin: '60', localId, linkOnline: 'https://sala.exemplo.test/fixa' },
      locais,
      doPaciente,
      botao: 'Salvar alteração',
    }),
  );
const campoDoLink = (html: string) => html.match(/<input[^>]*id="linkOnline"[^>]*>/)?.[0] ?? null;

describe('ConsultaForm — "Link da chamada" (AG-D82)', () => {
  it('origem paciente + local online com sala fixa: só leitura, "Sala fixa do local", sem name (nada a enviar)', () => {
    const html = render(VIDEO.id, true);
    expect(html).toMatch(/<label for="linkOnline"[^>]*>Link da chamada<\/label>/);
    const campo = campoDoLink(html)!;
    expect(campo).toMatch(/readonly=""/i);
    expect(campo).toContain('value="Sala fixa do local"');
    expect(campo).not.toContain('name=');
    expect(html).not.toContain('Vazio = a sala fixa do local.');
  });

  it('origem nutri no mesmo local: o campo editável de sempre, com o link gravado e a dica', () => {
    for (const doPaciente of [false, undefined]) {
      const campo = campoDoLink(render(VIDEO.id, doPaciente))!;
      expect(campo).toContain('name="linkOnline"');
      expect(campo).toContain('type="url"');
      expect(campo).not.toMatch(/readonly/i);
      expect(campo).toContain('value="https://sala.exemplo.test/fixa"');
    }
  });

  it('origem paciente em local online sem sala: o campo editável; em local presencial, sem campo', () => {
    const campo = campoDoLink(render(VIDEO_SEM_SALA.id, true))!;
    expect(campo).toContain('name="linkOnline"');
    expect(campo).not.toMatch(/readonly/i);
    expect(campoDoLink(render(CONSULTORIO.id, true))).toBeNull();
  });
});
