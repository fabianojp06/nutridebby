import { afterAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { examSubmissions } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getAuth } from '@/lib/auth';
import { stopBoss } from '@/jobs/boss';
import { MSG_ENVIO } from '@/modules/pacientes/exames-enviados-constantes';
import { novoTenant } from '../../../../../test/pacientes';
import { pacienteComConta } from '../../../../../test/portal';
import { entrar } from '../../../../../test/sessao';
import { jpegDe, ligarExames } from '../../../../../test/exames-enviados';
import { PDF_MINIMO } from '../../../../../test/ia';
import { POST } from './route';

vi.mock('server-only', () => ({}));

const db = getDb();
const auth = getAuth();
afterAll(async () => {
  await stopBoss();
  await closeDb();
});

async function pacienteLogado(o: { ligado?: boolean } = {}) {
  const T = await novoTenant(db);
  if (o.ligado !== false) await ligarExames(db, T.tenantId);
  const { paciente, email } = await pacienteComConta(db, T);
  return { T, paciente, cookie: await entrar(auth, email) };
}
function enviar(campos: { dataColeta?: string; nome?: string; arquivos?: Blob[] }, o: { cookie?: string; origin?: string; headers?: Record<string, string> } = {}) {
  const f = new FormData();
  f.set('dataColeta', campos.dataColeta ?? '2026-09-28');
  if (campos.nome) f.set('nome', campos.nome);
  for (const a of campos.arquivos ?? []) f.append('arquivos', a);
  return POST(
    new Request('http://localhost:3000/api/p/exames', {
      method: 'POST',
      body: f,
      headers: { ...(o.cookie ? { cookie: o.cookie } : {}), origin: o.origin ?? 'http://localhost:3000', ...o.headers },
    }),
  );
}
const envios = (T: Awaited<ReturnType<typeof novoTenant>>, patientId: string) => withTenant(T.ctx, (tx) => tx.select().from(examSubmissions).where(eq(examSubmissions.patientId, patientId)), db);
const pdf = () => new Blob([PDF_MINIMO], { type: 'application/pdf' });

describe('POST /api/p/exames (US-160, RN-161)', () => {
  it('sem sessão → 401; outra origem → 403; recebimento desligado → 404; nada gravado', async () => {
    const A = await pacienteLogado();
    expect((await enviar({ arquivos: [pdf()] })).status).toBe(401);
    expect((await enviar({ arquivos: [pdf()] }, { cookie: A.cookie, origin: 'https://evil.example' })).status).toBe(403);
    const D = await pacienteLogado({ ligado: false });
    expect((await enviar({ arquivos: [pdf()] }, { cookie: D.cookie })).status).toBe(404);
    expect(await envios(A.T, A.paciente.id)).toEqual([]);
    expect(await envios(D.T, D.paciente.id)).toEqual([]);
  });

  it('PDF válido → 200 com "Exame enviado. Sua nutricionista vai revisar." e o envio "processando"; sem cache', async () => {
    const A = await pacienteLogado();
    const r = await enviar({ nome: 'Hemograma', arquivos: [pdf()] }, { cookie: A.cookie });
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const corpo = await r.json();
    expect(corpo).toMatchObject({ ok: true, mensagem: MSG_ENVIO.enviado });
    expect((await envios(A.T, A.paciente.id)).map((e) => [e.id, e.status])).toEqual([[corpo.id, 'processando']]);
  });

  it('content-length acima de 30 MB + margem → 413; arquivo inválido → 400 com a mensagem única; data futura → 400 no campo', async () => {
    const A = await pacienteLogado();
    const grande = await enviar({ arquivos: [pdf()] }, { cookie: A.cookie, headers: { 'content-length': String(31 * 1024 * 1024) } });
    expect(grande.status).toBe(413);
    expect(await grande.json()).toEqual({ erros: { arquivos: MSG_ENVIO.arquivos } });
    const docx = await enviar({ arquivos: [new Blob([Buffer.from('PK\u0003\u0004docx')])] }, { cookie: A.cookie });
    expect(docx.status).toBe(400);
    expect(await docx.json()).toEqual({ erros: { arquivos: MSG_ENVIO.arquivos } });
    const futura = await enviar({ dataColeta: '2999-01-01', arquivos: [new Blob([new Uint8Array(await jpegDe(2000))])] }, { cookie: A.cookie });
    expect(futura.status).toBe(400);
    expect(await futura.json()).toEqual({ erros: { dataColeta: MSG_ENVIO.dataFutura } });
    const comVazio = await enviar({ arquivos: [new Blob([new Uint8Array(await jpegDe(2000))]), new Blob([])] }, { cookie: A.cookie }); // foto de 0 byte no meio
    expect(comVazio.status).toBe(400);
    expect(await comVazio.json()).toEqual({ erros: { arquivos: MSG_ENVIO.arquivos } });
    expect(await envios(A.T, A.paciente.id)).toEqual([]);
  });

  it('US-160 "Muitos envios ao mesmo tempo": o 2º envio da mesma conta enquanto o 1º chega → 429, sem afetar outro paciente', async () => {
    const A = await pacienteLogado();
    const B = await pacienteLogado();
    const f = new FormData();
    f.set('dataColeta', '2026-09-28');
    f.append('arquivos', pdf());
    const pronto = new Request('http://localhost:3000/api/p/exames', { method: 'POST', body: f });
    const corpo = new Uint8Array(await pronto.arrayBuffer());
    let terminar!: () => void;
    let lendo!: () => void;
    const comecouALer = new Promise<void>((r) => (lendo = r));
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(corpo.slice(0, 10));
        terminar = () => {
          c.enqueue(corpo.slice(10));
          c.close();
        };
      },
      pull: () => lendo(),
    });
    const primeiro = POST(
      new Request('http://localhost:3000/api/p/exames', {
        method: 'POST',
        body,
        duplex: 'half',
        headers: { cookie: A.cookie, origin: 'http://localhost:3000', 'content-type': pronto.headers.get('content-type')! },
      } as RequestInit),
    );
    await comecouALer;
    const segundo = await enviar({ arquivos: [pdf()] }, { cookie: A.cookie });
    expect(segundo.status).toBe(429);
    expect(await segundo.json()).toEqual({ erros: { geral: MSG_ENVIO.ocupado } });
    expect((await enviar({ arquivos: [pdf()] }, { cookie: B.cookie })).status).toBe(200);
    terminar();
    expect((await primeiro).status).toBe(200);
    expect(await envios(A.T, A.paciente.id)).toHaveLength(1);
  });
});
