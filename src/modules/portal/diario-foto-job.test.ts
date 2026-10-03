import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { diaryEntries, storedFiles, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getBoss, stopBoss } from '@/jobs/boss';
import { resolverCaminho, salvarArquivo } from '@/modules/plataforma/armazenamento';
import { registrarNoDiario } from './diario';
import { converterFotoDoDiario, expirarFotosPendentes, MAX_PIXELS } from './diario-foto-job';

const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-diario-foto-'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  await owner.pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});

/** JPEG 3000 × 2000 com EXIF (Copyright marcado) — o resultado não pode levar nada disso. */
const fotoComExif = () =>
  sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#88aa44' } })
    .withExif({ IFD0: { Copyright: 'marca-exif-gps' } })
    .jpeg()
    .toBuffer();

async function registro(foto: Buffer) {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx);
  const { id } = await registrarNoDiario(ctxPaciente(T.tenantId, p.id), { fuso: 'America/Sao_Paulo' }, { refeicao: 'Almoço', texto: null, foto }, { db: app.db, dataDir });
  const ler = async () => (await withTenant(T.ctx, (tx) => tx.select().from(diaryEntries).where(eq(diaryEntries.id, id)), app.db))[0];
  return { T, p, id, ler };
}
const deps = { db: app.db, dataDir, ultimaTentativa: false };
/** Passa pelo detectarTipo como HEIC (caixa ftyp) — o conteúdo de verdade vem do `abrirHeic` simulado. */
const HEIC_FALSO = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.from([0, 0, 0, 0]), Buffer.from('mif1heic'), Buffer.alloc(64)]);

describe('conversão da foto do diário (RN-07)', () => {
  it('JPEG grande com EXIF → JPEG de no máximo 1600 px, sem EXIF; original apagado do disco e da cota', async () => {
    const r = await registro(await fotoComExif());
    const antes = await r.ler();
    const usadoAntes = (await app.db.select().from(tenants).where(eq(tenants.id, r.T.tenantId)))[0].armazenamentoBytes;
    expect(await converterFotoDoDiario({ tenantId: r.T.tenantId, entryId: r.id }, deps)).toBe('pronta');
    const depois = await r.ler();
    expect(depois).toMatchObject({ fotoStatus: 'pronta', fotoOriginalPath: null });
    const jpeg = await sharp(resolverCaminho(dataDir, depois.fotoPath!)).metadata();
    expect([jpeg.format, Math.max(jpeg.width!, jpeg.height!)]).toEqual(['jpeg', 1600]);
    expect(jpeg.exif).toBeUndefined();
    expect(existsSync(resolverCaminho(dataDir, antes.fotoOriginalPath!))).toBe(false);
    const sobra = await withTenant(r.T.ctx, (tx) => tx.select().from(storedFiles).where(eq(storedFiles.caminho, antes.fotoOriginalPath!)), app.db);
    expect(sobra).toEqual([]);
    const usadoDepois = (await app.db.select().from(tenants).where(eq(tenants.id, r.T.tenantId)))[0].armazenamentoBytes;
    expect(usadoDepois).toBeLessThan(usadoAntes);
  });

  it('HEIC: decodificado pelo heic-decode (aqui simulado) e convertido do mesmo jeito; a memória do decodificador é liberada', async () => {
    const r = await registro(HEIC_FALSO);
    let liberou = 0;
    const abrirHeic = async () => ({
      width: 2400,
      height: 1800,
      decode: async () => ({ data: new Uint8ClampedArray(2400 * 1800 * 4).fill(200) }),
      liberar: () => void liberou++,
    });
    expect(await converterFotoDoDiario({ tenantId: r.T.tenantId, entryId: r.id }, { ...deps, abrirHeic })).toBe('pronta');
    const m = await sharp(resolverCaminho(dataDir, (await r.ler()).fotoPath!)).metadata();
    expect([m.format, m.width, m.height]).toEqual(['jpeg', 1600, 1200]);
    expect(liberou).toBe(1);
  });

  it('HEIC que declara 20000 × 20000 ("bomba de descompressão"): recusado pelo cabeçalho, os pixels nunca são decodificados', async () => {
    const r = await registro(HEIC_FALSO);
    let decodificou = false;
    let liberou = 0;
    const abrirHeic = async () => ({
      width: 20_000,
      height: 20_000,
      decode: async () => {
        decodificou = true; // o heic-decode de verdade alocaria ~1,6 GB aqui
        return { data: new Uint8ClampedArray(0) };
      },
      liberar: () => void liberou++,
    });
    expect(await converterFotoDoDiario({ tenantId: r.T.tenantId, entryId: r.id }, { ...deps, abrirHeic })).toBe('falhou');
    expect(decodificou).toBe(false);
    expect(liberou).toBe(1);
    expect(await r.ler()).toMatchObject({ fotoStatus: 'falhou', fotoOriginalPath: null, fotoPath: null });
  });

  it('HEIC cujo decode devolve menos pixels que o cabeçalho declarou → "falhou" (nada de ler além do buffer)', async () => {
    const r = await registro(HEIC_FALSO);
    const abrirHeic = async () => ({ width: 2400, height: 1800, decode: async () => ({ data: new Uint8ClampedArray(16) }) });
    expect(await converterFotoDoDiario({ tenantId: r.T.tenantId, entryId: r.id }, { ...deps, abrirHeic })).toBe('falhou');
  });

  it('imagem acima de 40 MP ("bomba de descompressão") ou que não decodifica → "falhou", original apagado (definitivo)', async () => {
    const enorme = await sharp({ create: { width: 8000, height: 6000, channels: 3, background: '#000' } }).png({ compressionLevel: 9 }).toBuffer();
    expect(8000 * 6000).toBeGreaterThan(MAX_PIXELS);
    const r = await registro(enorme);
    expect(await converterFotoDoDiario({ tenantId: r.T.tenantId, entryId: r.id }, deps)).toBe('falhou');
    expect(await r.ler()).toMatchObject({ fotoStatus: 'falhou', fotoOriginalPath: null, fotoPath: null });
    const quebrada = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(500, 7)]);
    const q = await registro(quebrada);
    expect(await converterFotoDoDiario({ tenantId: q.T.tenantId, entryId: q.id }, deps)).toBe('falhou');
  });

  it('idempotente: rodar de novo depois de pronta não faz nada', async () => {
    const r = await registro(await fotoComExif());
    await converterFotoDoDiario({ tenantId: r.T.tenantId, entryId: r.id }, deps);
    expect(await converterFotoDoDiario({ tenantId: r.T.tenantId, entryId: r.id }, deps)).toBe('ignorada');
  });

  it('regra 9: o worker caiu entre gravar o JPEG e apagar o original → a nova tentativa só apaga o original (disco, stored_files e cota) e solta o ponteiro', async () => {
    const r = await registro(await fotoComExif());
    const { fotoOriginalPath } = await r.ler();
    // O estado que a queda deixa: JPEG gravado e apontado, registro "pronta" ainda apontando para o original
    const pequeno = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    const jpeg = await salvarArquivo(r.T.ctx, { tipo: 'diario_foto', conteudo: pequeno, permitidos: ['jpg'], patientId: r.p.id }, { db: app.db, dataDir });
    await withTenant(r.T.ctx, (tx) => tx.update(diaryEntries).set({ fotoStatus: 'pronta', fotoPath: jpeg.caminho }).where(eq(diaryEntries.id, r.id)), app.db);
    const usadoAntes = (await app.db.select().from(tenants).where(eq(tenants.id, r.T.tenantId)))[0].armazenamentoBytes;
    expect(await converterFotoDoDiario({ tenantId: r.T.tenantId, entryId: r.id }, deps)).toBe('ignorada');
    expect(await r.ler()).toMatchObject({ fotoStatus: 'pronta', fotoOriginalPath: null, fotoPath: jpeg.caminho });
    expect(existsSync(resolverCaminho(dataDir, fotoOriginalPath!))).toBe(false);
    const sobra = await withTenant(r.T.ctx, (tx) => tx.select().from(storedFiles).where(eq(storedFiles.caminho, fotoOriginalPath!)), app.db);
    expect(sobra).toEqual([]);
    expect((await app.db.select().from(tenants).where(eq(tenants.id, r.T.tenantId)))[0].armazenamentoBytes).toBeLessThan(usadoAntes);
  });

  describe('varredura expirar-diario-foto (registro parado com o original)', () => {
    // datas de 2000 só aqui: a varredura cruza todos os tenants do banco de teste e não pode mexer nos registros de outros testes
    const parado = (id: string, quando = '2000-01-01T00:00:00Z') => owner.pool.query(`update diary_entries set updated_at = $2 where id = $1`, [id, quando]);
    const usado = async (tenantId: string) => (await app.db.select().from(tenants).where(eq(tenants.id, tenantId)))[0].armazenamentoBytes;
    const varrer = async (quando: string) => expirarFotosPendentes({ db: app.db, dataDir, boss: await getBoss() }, new Date(quando));

    it('"processando" sem job vivo há mais de 30 min → "falhou", original fora do disco, de stored_files e da cota; com job na fila espera; recente fica', async () => {
      const r = await registro(await fotoComExif());
      const recente = await registro(await fotoComExif());
      const { fotoOriginalPath } = await r.ler();
      await parado(r.id);
      await parado(recente.id, '2000-01-01T00:45:00Z');
      const usadoAntes = await usado(r.T.tenantId);

      // O job do envio ainda está na fila (worker parado, voltando agora): a varredura não mexe
      expect(await varrer('2000-01-01T01:00:00Z')).toEqual({ descartadas: 0, originais: 0 });
      expect(await r.ler()).toMatchObject({ fotoStatus: 'processando', fotoOriginalPath });

      // O job acabou sem terminar (expirou na última tentativa): sem job vivo, o registro é descartado
      const boss = await getBoss();
      const [job] = await boss.findJobs('diario-foto', { data: { entryId: r.id } });
      await boss.cancel('diario-foto', job.id);
      const [jobRecente] = await boss.findJobs('diario-foto', { data: { entryId: recente.id } });
      await boss.cancel('diario-foto', jobRecente.id);
      expect(await varrer('2000-01-01T01:00:00Z')).toEqual({ descartadas: 1, originais: 0 });
      expect(await r.ler()).toMatchObject({ fotoStatus: 'falhou', fotoOriginalPath: null, fotoPath: null });
      expect(existsSync(resolverCaminho(dataDir, fotoOriginalPath!))).toBe(false);
      const sobra = await withTenant(r.T.ctx, (tx) => tx.select().from(storedFiles).where(eq(storedFiles.caminho, fotoOriginalPath!)), app.db);
      expect(sobra).toEqual([]);
      expect(await usado(r.T.tenantId)).toBeLessThan(usadoAntes);
      expect(await recente.ler()).toMatchObject({ fotoStatus: 'processando' }); // 15 min: ainda dentro do prazo
      expect(await varrer('2000-01-01T01:00:00Z')).toEqual({ descartadas: 0, originais: 0 }); // idempotente
    });

    it('"pronta" que ainda aponta para o original há mais de 30 min → só apaga o original e solta o ponteiro', async () => {
      const r = await registro(await fotoComExif());
      const { fotoOriginalPath } = await r.ler();
      const pequeno = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).jpeg().toBuffer();
      const jpeg = await salvarArquivo(r.T.ctx, { tipo: 'diario_foto', conteudo: pequeno, permitidos: ['jpg'], patientId: r.p.id }, { db: app.db, dataDir });
      await withTenant(r.T.ctx, (tx) => tx.update(diaryEntries).set({ fotoStatus: 'pronta', fotoPath: jpeg.caminho }).where(eq(diaryEntries.id, r.id)), app.db);
      await parado(r.id);
      const usadoAntes = await usado(r.T.tenantId);
      expect(await varrer('2000-01-01T01:00:00Z')).toEqual({ descartadas: 0, originais: 1 });
      expect(await r.ler()).toMatchObject({ fotoStatus: 'pronta', fotoOriginalPath: null, fotoPath: jpeg.caminho });
      expect(existsSync(resolverCaminho(dataDir, fotoOriginalPath!))).toBe(false);
      expect(existsSync(resolverCaminho(dataDir, jpeg.caminho))).toBe(true);
      expect(await usado(r.T.tenantId)).toBeLessThan(usadoAntes);
    });
  });

  it('o heic-decode de verdade carrega no Node (WASM), expõe decode.all e recusa o que não é HEIC', async () => {
    const { default: decode } = await import('heic-decode');
    expect(typeof decode.all).toBe('function');
    await expect(decode.all({ buffer: Buffer.from('não é heic') })).rejects.toThrow();
  });
});
