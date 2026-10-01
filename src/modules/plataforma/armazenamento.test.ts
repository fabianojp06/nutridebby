import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { inject } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { storedFiles, tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { logger } from '@/lib/logger';
import {
  apagarArquivo,
  COTA_BYTES,
  CotaEsgotadaError,
  limparTmpOrfaos,
  nivelDeUso,
  resolverCaminho,
  salvarArquivo,
  TipoNaoPermitidoError,
} from './armazenamento';

const app = makeDb(inject('appDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-arq-'));
const deps = { db: app.db, dataDir };
afterAll(async () => {
  await app.pool.end();
  rmSync(dataDir, { recursive: true, force: true }); // T8-R2b
});

const PNG = (n = 100) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(n)]);
async function novoTenant(): Promise<TenantContext> {
  const [t] = await app.db.insert(tenants).values({ slug: `arq-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Arq' }).returning();
  return { tenantId: t.id, role: 'nutri', actorUserId: randomUUID(), ip: '203.0.113.1' };
}
const usado = async (id: string) => (await app.db.select().from(tenants).where(eq(tenants.id, id)))[0].armazenamentoBytes;
const definirUso = (id: string, bytes: number) => app.db.update(tenants).set({ armazenamentoBytes: bytes }).where(eq(tenants.id, id));

describe('salvarArquivo (RN-18, RNF-06)', () => {
  it('grava em <tenant>/<tipo>/<id>.<ext>, registra e soma na cota', async () => {
    const ctx = await novoTenant();
    const a = await salvarArquivo(ctx, { tipo: 'logo', conteudo: PNG(100), permitidos: ['png'] }, deps);
    expect(a.caminho).toBe(`${ctx.tenantId}/logo/${a.id}.png`);
    expect(readFileSync(path.join(dataDir, a.caminho)).equals(PNG(100))).toBe(true);
    expect(await usado(ctx.tenantId)).toBe(108);
    const [row] = await withTenant(ctx, (tx) => tx.select().from(storedFiles).where(eq(storedFiles.id, a.id)), app.db);
    expect(row).toMatchObject({ bytes: 108, mime: 'image/png', tipo: 'logo', criadoPor: ctx.actorUserId });
  });

  it('decide pelo conteúdo: HTML "como .png", PDF onde só cabe imagem e SVG são recusados (Review Focus 3)', async () => {
    const ctx = await novoTenant();
    await expect(
      salvarArquivo(ctx, { tipo: 'logo', conteudo: Buffer.from('<html><script>x</script></html>'), permitidos: ['png'] }, deps),
    ).rejects.toBeInstanceOf(TipoNaoPermitidoError);
    await expect(
      salvarArquivo(ctx, { tipo: 'logo', conteudo: Buffer.from('%PDF-1.4'), permitidos: ['png', 'jpg'] }, deps),
    ).rejects.toBeInstanceOf(TipoNaoPermitidoError);
    await expect(
      salvarArquivo(ctx, { tipo: 'logo', conteudo: Buffer.from('<svg/>'), permitidos: ['png', 'svg'] }, deps),
    ).rejects.toBeInstanceOf(TipoNaoPermitidoError);
    expect(await usado(ctx.tenantId)).toBe(0);
  });

  it('a 100% recusa com a mensagem da spec e não grava nada', async () => {
    const ctx = await novoTenant();
    await definirUso(ctx.tenantId, COTA_BYTES - 10);
    const e = await salvarArquivo(ctx, { tipo: 'logo', conteudo: PNG(20), permitidos: ['png'] }, deps).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(CotaEsgotadaError);
    expect((e as Error).message).toBe('Espaço de armazenamento esgotado. Fale com o suporte.');
    expect(await usado(ctx.tenantId)).toBe(COTA_BYTES - 10);
  });

  it('dois uploads simultâneos perto do limite: só um passa (Review Focus 4)', async () => {
    const ctx = await novoTenant();
    await definirUso(ctx.tenantId, COTA_BYTES - 1500);
    const r = await Promise.allSettled([
      salvarArquivo(ctx, { tipo: 'exame', conteudo: PNG(992), permitidos: ['png'] }, deps),
      salvarArquivo(ctx, { tipo: 'exame', conteudo: PNG(992), permitidos: ['png'] }, deps),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect((r.find((x) => x.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(CotaEsgotadaError);
    expect(await usado(ctx.tenantId)).toBe(COTA_BYTES - 500);
  });

  it('falha ao gravar o arquivo devolve a reserva e não deixa registro', async () => {
    const ctx = await novoTenant();
    const naoEhPasta = path.join(dataDir, `arquivo-${randomUUID()}`);
    writeFileSync(naoEhPasta, 'x');
    await expect(
      salvarArquivo(ctx, { tipo: 'logo', conteudo: PNG(), permitidos: ['png'] }, { db: app.db, dataDir: naoEhPasta }),
    ).rejects.toThrow();
    expect(await usado(ctx.tenantId)).toBe(0);
    expect(await withTenant(ctx, (tx) => tx.select().from(storedFiles), app.db)).toEqual([]);
  });
});

describe('apagarArquivo', () => {
  it('apaga o arquivo e devolve o espaço; outro tenant não consegue apagar', async () => {
    const ctx = await novoTenant();
    const outro = await novoTenant();
    const a = await salvarArquivo(ctx, { tipo: 'logo', conteudo: PNG(50), permitidos: ['png'] }, deps);
    expect(await apagarArquivo(outro, { id: a.id }, deps)).toBe(false);
    expect(existsSync(path.join(dataDir, a.caminho))).toBe(true);
    expect(await apagarArquivo(ctx, { caminho: a.caminho }, deps)).toBe(true);
    expect(existsSync(path.join(dataDir, a.caminho))).toBe(false);
    expect(await usado(ctx.tenantId)).toBe(0);
  });
});

describe('nivelDeUso e resolverCaminho', () => {
  it('aviso a partir de 80%, esgotado em 100%', () => {
    expect(nivelDeUso(0)).toEqual({ percentual: 0, nivel: 'ok' });
    expect(nivelDeUso(COTA_BYTES * 0.8)).toEqual({ percentual: 80, nivel: 'aviso' });
    expect(nivelDeUso(COTA_BYTES)).toEqual({ percentual: 100, nivel: 'esgotado' });
  });
  it('recusa caminhos que escapam do DATA_DIR', () => {
    for (const c of ['../x', '/etc/passwd', 'a/../../x', '']) expect(() => resolverCaminho(dataDir, c)).toThrow();
    expect(resolverCaminho(dataDir, 'a/b.png')).toBe(path.join(dataDir, 'a/b.png'));
  });
});

describe('arquivo e registro na mesma transação (P03, Tarefa 11)', () => {
  it('registrar que falha desfaz tudo: nem stored_files, nem arquivo, nem cota', async () => {
    const ctx = await novoTenant();
    let caminho = '';
    await expect(
      salvarArquivo(ctx, { tipo: 'exame', conteudo: PNG(100), permitidos: ['png'], registrar: async (_tx, a) => { caminho = a.caminho; throw new Error('exame recusado'); } }, deps),
    ).rejects.toThrow('exame recusado');
    expect(existsSync(path.join(dataDir, caminho))).toBe(false);
    expect(await withTenant(ctx, (tx) => tx.select().from(storedFiles), app.db)).toEqual([]);
    expect(await usado(ctx.tenantId)).toBe(0);
  });
  it('registrar grava na mesma transação que reserva a cota', async () => {
    const ctx = await novoTenant();
    const a = await salvarArquivo(ctx, { tipo: 'exame', conteudo: PNG(100), permitidos: ['png'], registrar: async (tx, arq) => {
      const [n] = (await tx.execute(sql`select count(*)::int as n from stored_files where caminho = ${arq.caminho}`)).rows as { n: number }[];
      expect(n.n).toBe(1); // já visível dentro da transação
    } }, deps);
    expect(existsSync(path.join(dataDir, a.caminho))).toBe(true);
  });
  it('naMesmaTransacao = false desiste: o arquivo e a cota ficam', async () => {
    const ctx = await novoTenant();
    const a = await salvarArquivo(ctx, { tipo: 'exame', conteudo: PNG(100), permitidos: ['png'] }, deps);
    expect(await apagarArquivo(ctx, { id: a.id }, { ...deps, naMesmaTransacao: async () => false })).toBe(false);
    expect(existsSync(path.join(dataDir, a.caminho))).toBe(true);
    expect(await usado(ctx.tenantId)).toBe(108);
  });
  it('removerAntesDoCommit: se o rm falha, o registro continua (a anonimização tenta de novo)', async () => {
    const ctx = await novoTenant();
    const a = await salvarArquivo(ctx, { tipo: 'exame', conteudo: PNG(100), permitidos: ['png'] }, deps);
    const alvo = path.join(dataDir, a.caminho);
    rmSync(alvo);
    mkdirSync(path.join(alvo, 'x'), { recursive: true }); // um diretório não vazio no lugar: rm sem recursive falha
    await expect(apagarArquivo(ctx, { id: a.id }, { ...deps, removerAntesDoCommit: true })).rejects.toThrow();
    expect(await withTenant(ctx, (tx) => tx.select().from(storedFiles).where(eq(storedFiles.id, a.id)), app.db)).toHaveLength(1);
    rmSync(alvo, { recursive: true });
    expect(await apagarArquivo(ctx, { id: a.id }, { ...deps, removerAntesDoCommit: true })).toBe(true); // ENOENT com force: segue
  });
});

describe('.tmp órfãos (item adiado do Plano 03)', () => {
  it('limparTmpOrfaos apaga só .tmp de salvarArquivo com mais de 24 h (queda no meio da gravação)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tmp-orfaos-'));
    const pasta = path.join(dir, '00000000-0000-4000-8000-000000000001', 'exame');
    mkdirSync(pasta, { recursive: true });
    const velho = path.join(pasta, 'a.pdf.123.tmp');
    const novo = path.join(pasta, 'b.pdf.456.tmp');
    const normal = path.join(pasta, 'c.pdf');
    for (const f of [velho, novo, normal]) writeFileSync(f, 'x');
    const agora = new Date('2026-10-02T12:00:00Z');
    await utimes(velho, new Date('2026-10-01T10:00:00Z'), new Date('2026-10-01T10:00:00Z'));
    await utimes(novo, new Date('2026-10-02T11:00:00Z'), new Date('2026-10-02T11:00:00Z'));
    await utimes(normal, new Date('2026-09-01T10:00:00Z'), new Date('2026-09-01T10:00:00Z'));
    expect(await limparTmpOrfaos(dir, agora)).toBe(1);
    expect(existsSync(velho)).toBe(false);
    expect(existsSync(novo)).toBe(true);
    expect(existsSync(normal)).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('pasta ilegível de um tenant ou de um tipo não interrompe a varredura: registra o motivo e segue para os outros', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tmp-orfaos-'));
    const [semLeitura, tipoSemLeitura, ok] = ['00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a3'];
    for (const t of [semLeitura, tipoSemLeitura, ok]) mkdirSync(path.join(dir, t, 'exame'), { recursive: true });
    const velho = path.join(dir, ok, 'exame', 'a.pdf.123.tmp');
    writeFileSync(velho, 'x');
    await utimes(velho, new Date('2026-10-01T10:00:00Z'), new Date('2026-10-01T10:00:00Z'));
    chmodSync(path.join(dir, semLeitura), 0o000); // readdir do tenant falha (EACCES)
    chmodSync(path.join(dir, tipoSemLeitura, 'exame'), 0o000); // readdir do tipo falha
    const avisos = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never);
    try {
      expect(await limparTmpOrfaos(dir, new Date('2026-10-02T12:00:00Z'))).toBe(1);
      expect(existsSync(velho)).toBe(false);
      const registrados = avisos.mock.calls.map(([o]) => o as Record<string, unknown>);
      expect(registrados).toEqual(
        expect.arrayContaining([
          { tenantId: semLeitura, motivo: 'EACCES' },
          { tenantId: tipoSemLeitura, motivo: 'EACCES' },
        ]),
      );
      expect(JSON.stringify(avisos.mock.calls)).not.toContain(dir); // sem caminho no log
    } finally {
      avisos.mockRestore();
      chmodSync(path.join(dir, semLeitura), 0o755);
      chmodSync(path.join(dir, tipoSemLeitura, 'exame'), 0o755);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
