import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { stopBoss } from '@/jobs/boss';
import { assinarLinkDocumento, MSG_LINK, pedirCodigoDocumento } from '@/modules/documentos/link-documento';
import { documentoNoBanco, liberarDocumentos } from '../../../../../test/documentos';
import { emailsNaFila, novoPaciente, novoTenant } from '../../../../../test/pacientes';
import { POST as pedir } from './codigo/route';
import { POST as confirmar } from './confirmar/route';
import { GET as pdf } from './pdf/route';
import { sessaoDoCookie } from './link';
import { POST as recebido } from './recebido/route';

const db = getDb();
afterAll(async () => {
  await stopBoss();
  await closeDb();
});

/** Um bloco de IPs por execução (os limites são por IP e o banco é o mesmo para todos os arquivos). */
const bloco = `198.18.${Math.floor(Math.random() * 250)}`;
let n = 0;
type Rota = (req: Request, ctx: { params: Promise<{ token: string }> }) => Promise<Response>;
const chamar = (rota: Rota, acao: string, token: string, o: { corpo?: string; cookie?: string; origem?: string; metodo?: string } = {}) =>
  rota(
    new Request(`http://localhost:3000/api/documento/${token}/${acao}`, {
      method: o.metodo ?? 'POST',
      body: o.metodo === 'GET' ? undefined : (o.corpo ?? '{}'),
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `${bloco}.${++n % 250}`, ...(o.cookie ? { cookie: o.cookie } : {}), ...(o.origem ? { origin: o.origem } : {}) },
    }),
    { params: Promise.resolve({ token }) },
  );

async function link() {
  const T = await novoTenant(db);
  await liberarDocumentos(db, T.tenantId);
  const p = await novoPaciente(db, T.ctx);
  const d = await documentoNoBanco(db, T.ctx, p.id, { status: 'assinado' });
  const token = assinarLinkDocumento({ tenantId: T.tenantId, patientId: p.id, documentoId: d.id, emitidoEm: new Date(), email: p.email });
  return { p, d, token };
}

describe('rotas do link do documento (RN-158)', () => {
  it('code review do PR #19 (item 7): a sessão do link é lida pelo lerCookie de sempre, sem um parser próprio', () => {
    const fonte = readFileSync('src/app/api/documento/[token]/link.ts', 'utf8');
    expect(fonte).toContain('lerCookie(');
    expect(fonte).not.toContain(".split(';')");
    const req = (cookie: string) => new Request('http://localhost:3000/', { headers: { cookie } });
    expect(sessaoDoCookie(req('a=1; nd_doc=abc=def; b=2'))).toBe('abc=def');
    expect(sessaoDoCookie(req('nd_doc_x=1'))).toBeUndefined();
    expect(sessaoDoCookie(new Request('http://localhost:3000/'))).toBeUndefined();
  });

  it('codigo: outra origem → 403; JSON inválido → 400; sem Turnstile → 403 com a mensagem; sem cache', async () => {
    const x = await link();
    expect((await chamar(pedir, 'codigo', x.token, { origem: 'https://evil.example' })).status).toBe(403);
    expect((await chamar(pedir, 'codigo', x.token, { corpo: '{x' })).status).toBe(400);
    const r = await chamar(pedir, 'codigo', x.token, { corpo: '{}' });
    expect(r.status).toBe(403);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.json()).toEqual({ erro: MSG_LINK.turnstile });
    expect(await emailsNaFila('codigo_documento', x.p.email)).toEqual([]);
  });

  it('confirmar: código errado → 400; certo → 200 com o cookie nos dois caminhos do token; a sessão abre o PDF (303) e confirma o recebimento', async () => {
    const x = await link();
    expect((await chamar(confirmar, 'confirmar', x.token, { origem: 'null' })).status).toBe(403);
    await pedirCodigoDocumento(x.token, { turnstile: 't' }, { db, ip: null, ipDoLimite: `${bloco}.251`, verificarTurnstile: async () => 'ok', appUrl: 'http://localhost:3000' });
    const codigo = (await emailsNaFila('codigo_documento', x.p.email)).at(-1)!.codigo;
    const errado = await chamar(confirmar, 'confirmar', x.token, { corpo: JSON.stringify({ codigo: codigo === '000000' ? '111111' : '000000' }) });
    expect(errado.status).toBe(400);
    expect(await errado.json()).toEqual({ erro: MSG_LINK.codigoInvalido });
    expect(errado.headers.get('set-cookie')).toBeNull();

    const r = await chamar(confirmar, 'confirmar', x.token, { corpo: JSON.stringify({ codigo }) });
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const cookies = r.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    const sessao = /^nd_doc=([A-Za-z0-9_-]{43});/.exec(cookies[0])![1];
    // APP_URL dos testes é http: sem `Secure` (em produção, https, com `Secure`)
    expect(cookies).toEqual([
      `nd_doc=${sessao}; Path=/documento/${x.token}; HttpOnly; SameSite=Strict; Max-Age=900`,
      `nd_doc=${sessao}; Path=/api/documento/${x.token}; HttpOnly; SameSite=Strict; Max-Age=900`,
    ]);

    // sem a sessão (cookie de 15 min vencido): volta à página do link, que pede o código de novo (nunca um 404 vazio)
    const semCookie = await chamar(pdf, 'pdf', x.token, { metodo: 'GET' });
    expect(semCookie.status).toBe(303);
    expect(semCookie.headers.get('location')).toBe(`/documento/${x.token}`);
    expect(semCookie.headers.get('cache-control')).toBe('no-store');
    const aberto = await chamar(pdf, 'pdf', x.token, { metodo: 'GET', cookie: `outro=1; nd_doc=${sessao}` });
    expect(aberto.status).toBe(303);
    expect(aberto.headers.get('location')).toMatch(/^\/api\/arquivos\?c=/);
    expect(aberto.headers.get('cache-control')).toBe('no-store');

    const semSessao = await chamar(recebido, 'recebido', x.token);
    expect(semSessao.status).toBe(410);
    expect(await semSessao.json()).toEqual({ erro: MSG_LINK.invalido });
    expect((await chamar(recebido, 'recebido', x.token, { cookie: `nd_doc=${sessao}`, origem: 'https://evil.example' })).status).toBe(403);
    const ok = await chamar(recebido, 'recebido', x.token, { cookie: `nd_doc=${sessao}` });
    expect(ok.status).toBe(200);
    const { em } = (await ok.json()) as { em: string };
    expect(Number.isNaN(Date.parse(em))).toBe(false);
    // de novo: a mesma data (um recibo por evento)
    expect(await (await chamar(recebido, 'recebido', x.token, { cookie: `nd_doc=${sessao}` })).json()).toEqual({ em });
  });

  it('token inválido: confirmar → 410 "não está mais disponível"; pdf → 303 para a página do link (que mostra o aviso)', async () => {
    const r = await chamar(confirmar, 'confirmar', 'x'.repeat(92), { corpo: JSON.stringify({ codigo: '123456' }) });
    expect(r.status).toBe(410);
    expect(await r.json()).toEqual({ erro: MSG_LINK.invalido });
    const p = await chamar(pdf, 'pdf', 'x'.repeat(92), { metodo: 'GET', cookie: `nd_doc=${'a'.repeat(43)}` });
    expect(p.status).toBe(303);
    expect(p.headers.get('location')).toBe(`/documento/${'x'.repeat(92)}`);
    // o token vem da URL: no Location, sempre codificado (nada de outro caminho nem de quebra de cabeçalho)
    expect((await chamar(pdf, 'pdf', 'a/../b?c', { metodo: 'GET' })).headers.get('location')).toBe('/documento/a%2F..%2Fb%3Fc');
  });
});
