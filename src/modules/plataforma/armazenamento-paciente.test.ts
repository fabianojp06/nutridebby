import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { storedFiles } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { apagarArquivo, salvarArquivo } from './armazenamento';

// R3: arquivo à parte — o armazenamento.test.ts tem o próprio novoTenant() (sem nutricionista nem pacientes)
const app = makeDb(inject('appDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-arq-pac-'));
afterAll(async () => {
  await app.pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});

const PNG = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)]);

describe('stored_files por paciente (P-16 d, D4)', () => {
  it('laudo, PDF, foto e exportação levam o patient_id; logo não pode levar', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const a = await salvarArquivo(T.ctx, { tipo: 'exame', conteudo: PNG(), permitidos: ['png'], patientId: p.id }, { db: app.db, dataDir });
    const [linha] = await withTenant(T.ctx, (tx) => tx.select().from(storedFiles).where(eq(storedFiles.id, a.id)), app.db);
    expect(linha.patientId).toBe(p.id);
    await expect(salvarArquivo(T.ctx, { tipo: 'exame', conteudo: PNG(), permitidos: ['png'] }, { db: app.db, dataDir })).rejects.toThrow(/patientId/);
    await expect(
      salvarArquivo(T.ctx, { tipo: 'logo', conteudo: PNG(), permitidos: ['png'], patientId: p.id }, { db: app.db, dataDir }),
    ).rejects.toThrow(/patientId/);
  });

  it('a sessão de paciente só vê os próprios arquivos e os do consultório (logo); grava só os próprios', async () => {
    const T = await novoTenant(app.db);
    const [p1, p2] = [await novoPaciente(app.db, T.ctx), await novoPaciente(app.db, T.ctx)];
    await salvarArquivo(T.ctx, { tipo: 'logo', conteudo: PNG(), permitidos: ['png'] }, { db: app.db, dataDir });
    const de1 = await salvarArquivo(T.ctx, { tipo: 'exame', conteudo: PNG(), permitidos: ['png'], patientId: p1.id }, { db: app.db, dataDir });
    await salvarArquivo(T.ctx, { tipo: 'exame', conteudo: PNG(), permitidos: ['png'], patientId: p2.id }, { db: app.db, dataDir });
    const vistos = await withTenant(
      ctxPaciente(T.tenantId, p1.id),
      (tx) => tx.select({ tipo: storedFiles.tipo, patientId: storedFiles.patientId }).from(storedFiles),
      app.db,
    );
    expect(vistos).toEqual(expect.arrayContaining([{ tipo: 'logo', patientId: null }, { tipo: 'exame', patientId: p1.id }]));
    expect(vistos).toHaveLength(2);
    // grava a própria foto (Tarefa 7); a de outro paciente, não
    await salvarArquivo(
      ctxPaciente(T.tenantId, p1.id),
      { tipo: 'diario_foto_original', conteudo: PNG(), permitidos: ['png'], patientId: p1.id },
      { db: app.db, dataDir },
    );
    await expect(
      salvarArquivo(
        ctxPaciente(T.tenantId, p1.id),
        { tipo: 'diario_foto_original', conteudo: PNG(), permitidos: ['png'], patientId: p2.id },
        { db: app.db, dataDir },
      ),
    ).rejects.toThrow();
    // e não apaga nem o próprio laudo (paciente_sem_delete)
    expect(await apagarArquivo(ctxPaciente(T.tenantId, p1.id), { id: de1.id }, { db: app.db, dataDir })).toBe(false);
  });
});
