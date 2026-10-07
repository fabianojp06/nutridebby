import { describe, expect, it } from 'vitest';
import { caminhoSeguro, filtrarBreadcrumb, filtrarEvento, type EventoSentry } from './sentry-filtro';

const SAUDE = ['Glicemia 180', 'Ana Souza', 'ana@ex.com', '11912345678', 'anamnese: diabetes tipo 2', 'Diário: comi um bolo'];
const semSaude = (e: unknown) => {
  const s = JSON.stringify(e);
  for (const t of SAUDE) expect(s, t).not.toContain(t);
};

describe('filtrarEvento (RNF-11, regra 3)', () => {
  it('mensagem de erro sai como [removido]; tipo fica se for um nome de classe', () => {
    const e = filtrarEvento<EventoSentry>({
      exception: { values: [{ type: 'ZodError', value: 'Glicemia 180 inválida para Ana Souza' }, { type: 'Error: <script>', value: 'x' }] },
    });
    expect(e.exception!.values![0]).toMatchObject({ type: 'ZodError', value: '[removido]' });
    expect(e.exception!.values![1].type).toBe('Error');
    semSaude(e);
  });

  it('classes com mensagem fixa do próprio código mantêm a mensagem (até 200 caracteres)', () => {
    const e = filtrarEvento<EventoSentry>({ exception: { values: [{ type: 'TenantContextError', value: 'patientId obrigatório para sessão de paciente' }] } });
    expect(e.exception!.values![0].value).toBe('patientId obrigatório para sessão de paciente');
  });

  it('pilha sem variáveis locais nem linhas de código', () => {
    const e = filtrarEvento<EventoSentry>({
      exception: {
        values: [{ type: 'Error', value: 'x', stacktrace: { frames: [{ filename: '/app/src/x.ts', function: 'f', lineno: 3, vars: { nome: 'Ana Souza' }, context_line: 'const t = "Glicemia 180"', pre_context: ['a'], post_context: ['b'] }] } }],
      },
    });
    expect(e.exception!.values![0].stacktrace!.frames![0]).toEqual({ filename: '/app/src/x.ts', function: 'f', lineno: 3 });
  });

  it('request: só método e caminho (sem query, corpo, cookies, cabeçalhos); tokens e UUIDs trocados', () => {
    const e = filtrarEvento<EventoSentry>({
      request: {
        method: 'POST',
        url: 'https://nutri.wsscloud.tech/convite/paciente/AbCdEfGhIjKlMnOpQrStUvWx?email=ana@ex.com',
        data: { anamnese: 'anamnese: diabetes tipo 2' },
        cookies: { 'nd.session_token': 'segredo' },
        headers: { cookie: 'nd.session_token=segredo', 'user-agent': 'Mozilla' },
        query_string: 'email=ana@ex.com',
        env: { REMOTE_ADDR: '200.1.2.3' },
      },
    });
    expect(e.request).toEqual({ method: 'POST', url: '/convite/paciente/:token' });
    semSaude(e);
  });

  it('user só com id; e-mail, IP e nome saem', () => {
    const e = filtrarEvento<EventoSentry>({ user: { id: 'u-1', email: 'ana@ex.com', ip_address: '200.1.2.3', username: 'Ana Souza' } });
    expect(e.user).toEqual({ id: 'u-1' });
  });

  it('extra sai; tags só da lista e com valor curto e sem espaço; contexts só runtime/os/trace', () => {
    const e = filtrarEvento<EventoSentry>({
      extra: { corpo: 'Diário: comi um bolo' },
      tags: { request_id: 'b1c2', rota: '/painel/pacientes/[id]', nome: 'Ana Souza', fila: 'email', motivo: 'ECONNREFUSED' },
      contexts: { runtime: { name: 'node' }, os: { name: 'Linux' }, trace: { trace_id: 't' }, paciente: { nome: 'Ana Souza' } },
    });
    expect(e.extra).toBeUndefined();
    expect(e.tags).toEqual({ request_id: 'b1c2', rota: '/painel/pacientes/[id]', fila: 'email', motivo: 'ECONNREFUSED' });
    expect(Object.keys(e.contexts!).sort()).toEqual(['os', 'runtime', 'trace']);
    semSaude(e);
  });

  it('tag motivo só com cara de código (Plano 11, spec da IA §5.7): SQLSTATE e motivo da RN-112 ficam; hífen, ponto ou barra saem', () => {
    expect(filtrarEvento<EventoSentry>({ tags: { motivo: '23505' } }).tags).toEqual({ motivo: '23505' });
    expect(filtrarEvento<EventoSentry>({ tags: { motivo: 'resultado_incerto' } }).tags).toEqual({ motivo: 'resultado_incerto' });
    for (const motivo of ['Ana-Souza', 'glicose.92', 'a/b', 'x'.repeat(61)]) expect(filtrarEvento<EventoSentry>({ tags: { fila: 'ia', motivo } }).tags).toEqual({ fila: 'ia' });
    // as outras tags seguem com o formato geral (o hífen continua valendo em rota)
    expect(filtrarEvento<EventoSentry>({ tags: { rota: '/painel/pacientes/[id]/exames-x' } }).tags).toEqual({ rota: '/painel/pacientes/[id]/exames-x' });
  });

  it('tag rota de uma página do portal (grupo de rota com parênteses) fica', () => {
    const e = filtrarEvento<EventoSentry>({ tags: { rota: '/p/(portal)/plano/page', tipo_rota: 'render' } });
    expect(e.tags).toEqual({ rota: '/p/(portal)/plano/page', tipo_rota: 'render' });
  });

  it('mensagem (captureMessage) só se for uma das fixas; logentry sai; transaction com caminho seguro', () => {
    expect(filtrarEvento<EventoSentry>({ message: 'erro no navegador' }).message).toBe('erro no navegador');
    expect(filtrarEvento<EventoSentry>({ message: 'Paciente Ana Souza' }).message).toBe('[removido]');
    expect(filtrarEvento<EventoSentry>({ logentry: { message: 'Ana Souza' } }).logentry).toBeUndefined();
    expect(filtrarEvento<EventoSentry>({ transaction: 'GET /painel/pacientes/0b8f2a3c-1d2e-4f50-8a9b-0c1d2e3f4a5b/exames' }).transaction).toBe(
      'GET /painel/pacientes/:id/exames',
    );
  });

  it('breadcrumbs: console, ui e consultas saem; http fica só com método, status e origem', () => {
    const e = filtrarEvento<EventoSentry>({
      breadcrumbs: [
        { category: 'console', message: 'Ana Souza' },
        { category: 'ui.click', message: 'button[aria-label="Abrir Ana Souza"]' },
        { category: 'query', message: 'select * from patients where nome = $1' },
        { category: 'http', type: 'http', data: { method: 'POST', status_code: 500, url: 'https://api.resend.com/emails?to=ana@ex.com', 'http.query': 'to=ana' } },
      ],
    });
    expect(e.breadcrumbs).toEqual([{ category: 'http', type: 'http', data: { method: 'POST', status_code: 500, url: 'https://api.resend.com' } }]);
  });

  it('não muda campos técnicos (event_id, release, environment, server_name)', () => {
    const e = filtrarEvento<EventoSentry>({ event_id: 'abc', release: 'sha', environment: 'producao', server_name: 'nutri_app.1' });
    expect(e).toMatchObject({ event_id: 'abc', release: 'sha', environment: 'producao', server_name: 'nutri_app.1' });
  });
});

describe('filtrarBreadcrumb', () => {
  it('fetch do Node também fica só com origem; outros somem', () => {
    expect(filtrarBreadcrumb({ category: 'fetch', data: { method: 'GET', status_code: 200, url: 'https://www.youtube.com/oembed?url=x' } })).toEqual({
      category: 'fetch',
      data: { method: 'GET', status_code: 200, url: 'https://www.youtube.com' },
    });
    expect(filtrarBreadcrumb({ category: 'navigation', data: { from: '/p/plano', to: '/p/diario' } })).toBeNull();
  });
});

describe('caminhoSeguro', () => {
  it.each([
    ['/consulta/AbCdEfGhIjKlMnOpQrStUvWx', '/consulta/:token'],
    ['/convite/xYz123-_abcdefghijklmnop', '/convite/:token'],
    ['/documento/AbCddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd', '/documento/:token'],
    ['/api/documento/AbCddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd/pdf', '/api/documento/:token/pdf'],
    ['/documento/curto', '/documento/:token'],
    ['/v/ABCDEFGHJKMN', '/v/:codigo'],
    ['/v/abcd-efgh-jkmn?x=1', '/v/:codigo'],
    ['/v', '/v'],
    ['https://x.test/definir-senha?token=abc', '/definir-senha'],
    ['/p/conteudos/0b8f2a3c-1d2e-4f50-8a9b-0c1d2e3f4a5b?de=plano#x', '/p/conteudos/:id'],
    ['/painel/pacientes/novo', '/painel/pacientes/novo'],
    ['/api/arquivos?c=t1/exame/a.pdf&e=1&s=assinatura', '/api/arquivos'],
  ])('%s → %s', (de, para) => expect(caminhoSeguro(de)).toBe(para));
  it('URL inválida não lança', () => expect(caminhoSeguro('http://[::1')).toBe('[removido]'));
});
