import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { stopBoss } from '@/jobs/boss';
import { novoTenant } from '../../../../../../test/pacientes';
import { POST as confirmar } from '../confirmar/route';
import { POST as horario } from '../horario/route';
import { POST } from './route';

const db = getDb();
afterAll(async () => {
  await stopBoss();
  await closeDb();
});

/** As três rotas recebem o mesmo `{ params: { slug } }` (cada uma com o seu RouteContext tipado). */
type Rota = (req: Request, ctx: { params: Promise<{ slug: string }> }) => Promise<Response>;
const chamar = (rota: Rota, acao: string) => (slug: string, corpo: string, ip: string) =>
  rota(new Request(`http://localhost:3000/api/n/${slug}/${acao}`, { method: 'POST', body: corpo, headers: { 'content-type': 'application/json', 'x-forwarded-for': ip } }), {
    params: Promise.resolve({ slug }),
  });
const pedir = chamar(POST, 'codigo');
/** Um bloco de IPs por execução (o limite de 10 por hora é por IP e o banco é o mesmo para todos os arquivos). */
const bloco = `203.0.${Math.floor(Math.random() * 250)}`;

async function slugDeTeste(): Promise<string> {
  const T = await novoTenant(db);
  // migration 0067: a página pública nasce desligada — o consultório destes testes a ligou
  const [{ slug }] = await db.update(tenants).set({ agendamentoPublicoAtivo: true }).where(eq(tenants.id, T.tenantId)).returning({ slug: tenants.slug });
  return slug;
}

describe('POST /api/n/[slug]/codigo (RN-16)', () => {
  it('404 sem conta; 400 JSON inválido ou que não é objeto; 413 corpo grande; 422 campos; sem cache', async () => {
    const slug = await slugDeTeste();
    const r404 = await pedir('nao-existe-xyz', '{}', `${bloco}.71`);
    expect(r404.status).toBe(404);
    expect(await r404.json()).toEqual({ erro: 'Agendamento online indisponível. Entre em contato.' });
    expect((await pedir(slug, '{x', `${bloco}.72`)).status).toBe(400);
    expect((await pedir(slug, '[1]', `${bloco}.72`)).status).toBe(400);
    expect((await pedir(slug, 'null', `${bloco}.72`)).status).toBe(400);
    expect((await pedir(slug, JSON.stringify({ nome: 'x'.repeat(9000) }), `${bloco}.73`)).status).toBe(413);
    const r = await pedir(slug, JSON.stringify({ nome: 'A' }), `${bloco}.74`);
    expect(r.status).toBe(422);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect((await r.json()).erros.nome).toBe('Informe o nome');
  });

  it('HTTP 429 a partir da 11ª tentativa na hora pelo mesmo IP — também em /confirmar e /horario', async () => {
    const slug = await slugDeTeste();
    const ip = `${bloco}.${100 + Math.floor(Math.random() * 100)}`;
    for (let i = 0; i < 10; i++) expect((await pedir(slug, '{}', ip)).status).toBe(422);
    const r = await pedir(slug, '{}', ip);
    expect(r.status).toBe(429);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.json()).toEqual({ erro: 'Muitas tentativas. Tente novamente mais tarde.' });
    expect((await chamar(confirmar, 'confirmar')(slug, '{}', ip)).status).toBe(429);
    expect((await chamar(horario, 'horario')(slug, '{}', ip)).status).toBe(429);
  });

  it('IPv6: o limite conta pelo /64 — 10 endereços diferentes do mesmo /64 esgotam o balde; outro /64 segue livre', async () => {
    const slug = await slugDeTeste();
    const r = () => Math.floor(Math.random() * 0xfffe + 1).toString(16);
    const prefixo = `2001:db8:${r()}:${r()}`;
    for (let i = 1; i <= 10; i++) expect((await pedir(slug, '{}', `${prefixo}::${i.toString(16)}`)).status).toBe(422);
    expect((await pedir(slug, '{}', `${prefixo}:ffff:1:2:3`)).status).toBe(429);
    expect((await pedir(slug, '{}', `2001:db8:${r()}:${r()}::1`)).status).toBe(422);
  });
});

describe('POST /api/n/[slug]/confirmar e /horario', () => {
  it('pedido inexistente ou malformado → 410 "Código expirado…"; JSON inválido → 400; conta inexistente → 404', async () => {
    const slug = await slugDeTeste();
    for (const [rota, acao] of [
      [confirmar, 'confirmar'],
      [horario, 'horario'],
    ] as const) {
      const r = await chamar(rota, acao)(slug, JSON.stringify({ pedido: 'x'.repeat(43), codigo: '123456' }), `${bloco}.80`);
      expect(r.status).toBe(410);
      expect(r.headers.get('cache-control')).toBe('no-store');
      expect(await r.json()).toEqual({ erro: 'Código expirado. Peça um novo código.' });
      expect((await chamar(rota, acao)(slug, JSON.stringify({ pedido: { $ne: null } }), `${bloco}.81`)).status).toBe(410);
      expect((await chamar(rota, acao)(slug, 'pedido=1', `${bloco}.82`)).status).toBe(400);
      expect((await chamar(rota, acao)('nao-existe-xyz', '{}', `${bloco}.83`)).status).toBe(404);
    }
  });
});
