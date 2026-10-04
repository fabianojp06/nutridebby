import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { diaryEntries, patients, storedFiles, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getBoss, stopBoss } from '@/jobs/boss';
import { COTA_BYTES, resolverCaminho, salvarArquivo } from '@/modules/plataforma/armazenamento';
import { registrarNoDiario } from './diario';
import { semDetalhe } from '@/worker/sem-detalhe';
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

  it('cota no limite com o original grande ainda contado: a troca pelo JPEG (menor) conclui pela diferença, sem perder a foto', async () => {
    const r = await registro(await fotoComExif());
    const { fotoOriginalPath } = await r.ler();
    const [orig] = await withTenant(r.T.ctx, (tx) => tx.select().from(storedFiles).where(eq(storedFiles.caminho, fotoOriginalPath!)), app.db);
    // sobra 1 byte: o JPEG (de qualquer tamanho) não caberia somado ao original, que só sai depois
    await app.db.update(tenants).set({ armazenamentoBytes: COTA_BYTES - 1 }).where(eq(tenants.id, r.T.tenantId));
    expect(await converterFotoDoDiario({ tenantId: r.T.tenantId, entryId: r.id }, { ...deps, ultimaTentativa: true })).toBe('pronta');
    const depois = await r.ler();
    expect(depois).toMatchObject({ fotoStatus: 'pronta', fotoOriginalPath: null });
    const [jpeg] = await withTenant(r.T.ctx, (tx) => tx.select().from(storedFiles).where(eq(storedFiles.caminho, depois.fotoPath!)), app.db);
    expect(jpeg.bytes).toBeLessThan(orig.bytes);
    expect((await app.db.select().from(tenants).where(eq(tenants.id, r.T.tenantId)))[0].armazenamentoBytes).toBe(COTA_BYTES - 1 - orig.bytes + jpeg.bytes);
  });

  it('a diferença só vale para o arquivo substituído: um JPEG MAIOR que o original, sem espaço, é barrado pela cota — "falhou" já na 1ª tentativa (definitivo, F-2) e o original sai', async () => {
    // PNG 16 × 16 de cor única (~100 bytes) → JPEG maior que ele (só as tabelas do JPEG já passam disso)
    const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#88aa44' } }).png({ compressionLevel: 9, palette: true }).toBuffer();
    const r = await registro(png);
    const { fotoOriginalPath } = await r.ler();
    await app.db.update(tenants).set({ armazenamentoBytes: COTA_BYTES - 1 }).where(eq(tenants.id, r.T.tenantId));
    // ultimaTentativa: false — as outras tentativas do pg-boss esbarrariam na mesma cota
    expect(await converterFotoDoDiario({ tenantId: r.T.tenantId, entryId: r.id }, deps)).toBe('falhou');
    expect(await r.ler()).toMatchObject({ fotoStatus: 'falhou', fotoPath: null, fotoOriginalPath: null });
    expect(existsSync(resolverCaminho(dataDir, fotoOriginalPath!))).toBe(false);
    const arquivos = await withTenant(r.T.ctx, (tx) => tx.select().from(storedFiles).where(eq(storedFiles.patientId, r.p.id)), app.db);
    expect(arquivos).toEqual([]);
  });

  it('erro de infraestrutura (original sumiu do disco) antes da última tentativa: relançado e, como o worker registra o job (semDetalhe), só com o código, sem caminho nem ids (vai para o output do pg-boss, RNF-11)', async () => {
    const r = await registro(await fotoComExif());
    const { fotoOriginalPath } = await r.ler();
    rmSync(resolverCaminho(dataDir, fotoOriginalPath!));
    const job = semDetalhe('diario-foto', converterFotoDoDiario);
    const err = await job({ tenantId: r.T.tenantId, entryId: r.id }, deps).then(
      () => {
        throw new Error('esperava o erro relançado');
      },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('ENOENT');
    // o que o pg-boss guarda (serialize-error: message, stack e as propriedades próprias, como `path`)
    const serializado = JSON.stringify(err, Object.getOwnPropertyNames(err));
    for (const segredo of [fotoOriginalPath!, dataDir, r.T.tenantId, r.id, r.p.id]) expect(serializado).not.toContain(segredo);
    expect(await r.ler()).toMatchObject({ fotoStatus: 'processando', fotoOriginalPath }); // o pg-boss tenta de novo
    expect(await converterFotoDoDiario({ tenantId: r.T.tenantId, entryId: r.id }, { ...deps, ultimaTentativa: true })).toBe('falhou');
    expect(await r.ler()).toMatchObject({ fotoStatus: 'falhou', fotoOriginalPath: null });
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

  it('F-3: HEIC de 48 MP (8064 × 6048, modo HEIF Max do iPhone 14 Pro e posteriores) passa dos 40 MP → "falhou" sem decodificar (limite mantido)', async () => {
    const r = await registro(HEIC_FALSO);
    let decodificou = false;
    const abrirHeic = async () => ({
      width: 8064,
      height: 6048,
      decode: async () => {
        decodificou = true;
        return { data: new Uint8ClampedArray(0) };
      },
    });
    expect(8064 * 6048).toBeGreaterThan(MAX_PIXELS);
    expect(await converterFotoDoDiario({ tenantId: r.T.tenantId, entryId: r.id }, { ...deps, abrirHeic })).toBe('falhou');
    expect(decodificou).toBe(false);
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

  it('ordem de travas paciente → registro → tenant (a de salvarArquivo): com o paciente travado por outro, o job espera sem segurar o tenant (sem deadlock com o envio do diário)', async () => {
    const r = await registro(await fotoComExif());
    const outra = await owner.pool.connect();
    let solto = false;
    try {
      await outra.query('begin');
      await outra.query('select 1 from patients where id = $1 for update', [r.p.id]); // como o conferirLimite do envio seguinte
      const pid = (await outra.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid;
      const job = converterFotoDoDiario({ tenantId: r.T.tenantId, entryId: r.id }, deps);
      for (let i = 0; ; i++) {
        if ((await owner.pool.query('select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid))', [pid])).rowCount) break;
        if (i > 500) throw new Error('o job não ficou preso na trava do paciente');
        await new Promise((ok) => setTimeout(ok, 10));
      }
      // o envio seguinte (que segura o paciente) conseguiria a cota: o job não pegou o tenant antes do paciente
      await expect(owner.pool.query('select 1 from tenants where id = $1 for update nowait', [r.T.tenantId])).resolves.toMatchObject({ rowCount: 1 });
      await outra.query('commit');
      solto = true;
      expect(await job).toBe('pronta');
    } finally {
      if (!solto) await outra.query('rollback').catch(() => undefined);
      outra.release();
    }
  });

  it('paciente bloqueado (exclusão atendida) entre o envio e a conversão → "removida", sem JPEG e sem o original (disco, stored_files e cota)', async () => {
    const r = await registro(await fotoComExif());
    const { fotoOriginalPath } = await r.ler();
    await withTenant(r.T.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado' }).where(eq(patients.id, r.p.id)), app.db);
    expect(await converterFotoDoDiario({ tenantId: r.T.tenantId, entryId: r.id }, deps)).toBe('falhou');
    expect(await r.ler()).toMatchObject({ fotoStatus: 'removida', fotoPath: null, fotoOriginalPath: null });
    expect(existsSync(resolverCaminho(dataDir, fotoOriginalPath!))).toBe(false);
    const arquivos = await withTenant(r.T.ctx, (tx) => tx.select().from(storedFiles).where(eq(storedFiles.patientId, r.p.id)), app.db);
    expect(arquivos).toEqual([]);
    expect((await app.db.select().from(tenants).where(eq(tenants.id, r.T.tenantId)))[0].armazenamentoBytes).toBe(0);
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
