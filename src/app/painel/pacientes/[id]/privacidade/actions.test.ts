import { existsSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { diaryEntries, iaAutorizacoes, patients, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getEnv } from '@/env';
import { getBoss, stopBoss } from '@/jobs/boss';
import { getAuth } from '@/lib/auth';
import { MSG_AUTORIZACAO } from '@/modules/ia/constantes';
import { concluirExclusaoAtendida, type DadosExclusaoAtendida } from '@/modules/pacientes/lgpd';
import { resolverCaminho, salvarArquivo } from '@/modules/plataforma/armazenamento';
import { autorizacaoNoBanco, iaPronta } from '../../../../../../test/ia';
import { nutriComDpa } from '../../../../../../test/nutri';
import { emailsNaFila, novoPaciente } from '../../../../../../test/pacientes';

// atenderExclusaoAction pelo caminho real (requireNutri → Postgres via Testcontainers), como os outros actions.test.ts;
// só o runtime do Next é simulado: headers da requisição, navegação e revalidatePath.
const req = vi.hoisted(() => ({ headers: new Headers() }));
// R4 (pre-flight do Plano 14A): o getEnv() guarda o ambiente na primeira leitura (o getAuth lê antes do bloco da IA) —
// IA_PROVEDOR entra antes de qualquer import; o CI não define a variável no job de testes.
const iaAntes = vi.hoisted(() => {
  const antes = process.env.IA_PROVEDOR;
  process.env.IA_PROVEDOR = 'sandbox';
  return antes;
});
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: async () => req.headers }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
  notFound: () => {
    throw new Error('notFound');
  },
}));

const { atenderExclusaoAction, enviarPedidoIaAction, retiradaIaAction } = await import('./actions');
const db = getDb();
afterAll(async () => {
  await stopBoss();
  await closeDb();
  if (iaAntes === undefined) delete process.env.IA_PROVEDOR;
  else process.env.IA_PROVEDOR = iaAntes;
});
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 1)]);
const confirmacao = (nome: string) => {
  const f = new FormData();
  f.set('confirmacao', nome);
  return f;
};

describe('atenderExclusaoAction (US-018, Plano 06)', () => {
  it('"Atender pedido de exclusão" bloqueia e deixa as fotos do diário para o job exclusao-atendida (achado 6 do /code-review: um lugar só), que as apaga antes do aviso', async () => {
    const N = await nutriComDpa(db, getAuth());
    req.headers = new Headers({ cookie: N.cookie });
    const p = await novoPaciente(db, N.ctx);
    const foto = await salvarArquivo(N.ctx, { tipo: 'diario_foto', conteudo: JPEG, permitidos: ['jpg'], patientId: p.id }, { db });
    await withTenant(N.ctx, (tx) => tx.insert(diaryEntries).values({ tenantId: N.tenantId, patientId: p.id, refeicao: 'Almoço', texto: 'arroz', fotoPath: foto.caminho, fotoStatus: 'pronta' }), db);

    expect(await atenderExclusaoAction(p.id, {}, confirmacao(p.nome))).toEqual({});

    const [paciente] = await withTenant(N.ctx, (tx) => tx.select().from(patients).where(eq(patients.id, p.id)), db);
    expect(paciente.status).toBe('bloqueado');
    // a action não apaga: a foto continua até o job rodar
    expect(existsSync(resolverCaminho(getEnv().DATA_DIR, foto.caminho))).toBe(true);
    const jobs = (await (await getBoss()).findJobs<DadosExclusaoAtendida>('exclusao-atendida')).map((j) => j.data).filter((d) => d.patientId === p.id);
    expect(jobs).toEqual([{ tenantId: N.tenantId, patientId: p.id }]);
    // o job (como o worker o roda) apaga as fotos e só então avisa
    expect(await concluirExclusaoAtendida(jobs[0], { db, ultimaTentativa: false })).toBe('avisado');
    const [e] = await withTenant(N.ctx, (tx) => tx.select().from(diaryEntries).where(eq(diaryEntries.patientId, p.id)), db);
    expect(e).toMatchObject({ fotoPath: null, fotoStatus: 'removida', texto: 'arroz' });
    expect(existsSync(resolverCaminho(getEnv().DATA_DIR, foto.caminho))).toBe(false);
  });

  it('nome errado: nada é bloqueado nem apagado', async () => {
    const N = await nutriComDpa(db, getAuth());
    req.headers = new Headers({ cookie: N.cookie });
    const p = await novoPaciente(db, N.ctx);
    const foto = await salvarArquivo(N.ctx, { tipo: 'diario_foto', conteudo: JPEG, permitidos: ['jpg'], patientId: p.id }, { db });
    await withTenant(N.ctx, (tx) => tx.insert(diaryEntries).values({ tenantId: N.tenantId, patientId: p.id, refeicao: 'Almoço', fotoPath: foto.caminho, fotoStatus: 'pronta' }), db);
    expect((await atenderExclusaoAction(p.id, {}, confirmacao('Outra Pessoa'))).erro).toBeTruthy();
    const [e] = await withTenant(N.ctx, (tx) => tx.select().from(diaryEntries).where(eq(diaryEntries.patientId, p.id)), db);
    expect(e).toMatchObject({ fotoPath: foto.caminho, fotoStatus: 'pronta' });
    expect(existsSync(resolverCaminho(getEnv().DATA_DIR, foto.caminho))).toBe(true);
  });
});

describe('Uso de IA (US-105, US-109) — Plano 14A', () => {
  const PERFIL = { nomeProfissional: 'Debora Silva', crn: 'CRN-3 12345', contatoEmail: 'contato@debby.test' };

  it('"Enviar pedido de autorização por e-mail": grava o pedido e enfileira o e-mail; o segundo devolve o texto do pedido aberto', async () => {
    const N = await nutriComDpa(db, getAuth());
    req.headers = new Headers({ cookie: N.cookie });
    await iaPronta(db, N.tenantId);
    await db.update(tenants).set(PERFIL).where(eq(tenants.id, N.tenantId));
    const p = await novoPaciente(db, N.ctx);
    expect(await enviarPedidoIaAction(p.id, {}, new FormData())).toEqual({ ok: MSG_AUTORIZACAO.pedidoEnviado });
    expect(await emailsNaFila('autorizacao_ia', p.email!)).toHaveLength(1);
    expect((await enviarPedidoIaAction(p.id, {}, new FormData())).erro).toMatch(/^Já há um pedido por e-mail válido até /);
    expect(await emailsNaFila('autorizacao_ia', p.email!)).toHaveLength(1);
  });

  it('pedido com o perfil profissional incompleto: o texto do desvio 7, nada gravado', async () => {
    const N = await nutriComDpa(db, getAuth());
    req.headers = new Headers({ cookie: N.cookie });
    await iaPronta(db, N.tenantId);
    const p = await novoPaciente(db, N.ctx);
    expect(await enviarPedidoIaAction(p.id, {}, new FormData())).toEqual({ erro: MSG_AUTORIZACAO.perfilIncompleto });
    const linhas = await withTenant(N.ctx, (tx) => tx.select().from(iaAutorizacoes).where(eq(iaAutorizacoes.patientId, p.id)), db);
    expect(linhas).toHaveLength(0);
  });

  it('"Registrar retirada a pedido do paciente": grava a retirada da nutricionista', async () => {
    const N = await nutriComDpa(db, getAuth());
    req.headers = new Headers({ cookie: N.cookie });
    const p = await novoPaciente(db, N.ctx);
    await autorizacaoNoBanco(db, N.tenantId, p.id);
    await retiradaIaAction(p.id);
    const [r] = await withTenant(N.ctx, (tx) => tx.select().from(iaAutorizacoes).where(eq(iaAutorizacoes.evento, 'retirou')), db);
    expect(r).toMatchObject({ patientId: p.id, canal: 'nutricionista', registradoPor: N.ctx.actorUserId });
  });

  it('id de paciente de outro consultório: notFound, nada gravado', async () => {
    const A = await nutriComDpa(db, getAuth());
    const B = await nutriComDpa(db, getAuth());
    const p = await novoPaciente(db, B.ctx);
    await autorizacaoNoBanco(db, B.tenantId, p.id);
    req.headers = new Headers({ cookie: A.cookie });
    await expect(retiradaIaAction(p.id)).rejects.toThrow('notFound');
    await expect(enviarPedidoIaAction(p.id, {}, new FormData())).rejects.toThrow('notFound');
    const linhas = await withTenant(B.ctx, (tx) => tx.select().from(iaAutorizacoes).where(eq(iaAutorizacoes.patientId, p.id)), db);
    expect(linhas).toHaveLength(1);
  });
});
