import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { exams, storedFiles, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { signFileUrl, verifyFileUrl } from '@/lib/signed-url';
import { apagarArquivo } from '@/modules/plataforma/armazenamento';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from './base';
import { agruparMarcadores, criarExame, EXAME_MAX_BYTES, ExameError, excluirExame, lerValores, listarExames, marcadoresDoPaciente, MSG_EXAME } from './exames';

const app = makeDb(inject('appDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-exames-'));
const now = new Date('2026-10-01T15:00:00Z');
const deps = { db: app.db, now, dataDir };
afterAll(async () => {
  await app.pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});

const PDF = (bytes: number) => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(bytes - 9, 0x20)]);
const usado = async (id: string) => (await app.db.select().from(tenants).where(eq(tenants.id, id)))[0].armazenamentoBytes;
const erros = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof ExameError) return e.erros;
    throw e;
  }
  throw new Error('esperava ExameError');
};

describe('exames (US-015)', () => {
  it('"Anexar laudo": PDF de 3 MB com título e data vai para /data e só sai por URL assinada de 5 min', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const id = await criarExame(T.ctx, T.tenant, p.id, { titulo: 'Hemograma', data: '2026-09-01', valores: [], arquivo: PDF(3 * 1024 * 1024) }, deps);
    const [e] = await listarExames(T.ctx, p.id, app.db);
    expect(e).toMatchObject({ id, titulo: 'Hemograma', data: '2026-09-01' });
    expect(e.arquivoPath).toMatch(new RegExp(`^${T.tenantId}/exame/[0-9a-f-]{36}\\.pdf$`));
    expect(readFileSync(path.join(dataDir, e.arquivoPath!)).subarray(0, 5).toString()).toBe('%PDF-');
    expect(await usado(T.tenantId)).toBe(3 * 1024 * 1024);
    const url = new URL(signFileUrl(e.arquivoPath!, { now }), 'http://x');
    expect(verifyFileUrl(url.searchParams, { now: new Date(now.getTime() + 299_000) })).toMatchObject({ ok: true });
    expect(verifyFileUrl(url.searchParams, { now: new Date(now.getTime() + 301_000) })).toEqual({ ok: false, motivo: 'expirado' });
  });

  it('"Arquivo inválido": .exe ou PDF de 25 MB → "Envie PDF, JPEG ou PNG de até 20 MB" e nada é gravado', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(1000)]);
    expect(await erros(criarExame(T.ctx, T.tenant, p.id, { titulo: 'X', data: '2026-09-01', valores: [], arquivo: exe }, deps))).toEqual({ arquivo: 'Envie PDF, JPEG ou PNG de até 20 MB' });
    expect(await erros(criarExame(T.ctx, T.tenant, p.id, { titulo: 'X', data: '2026-09-01', valores: [], arquivo: PDF(EXAME_MAX_BYTES + 1) }, deps))).toEqual({ arquivo: MSG_EXAME.arquivo });
    expect(await listarExames(T.ctx, p.id, app.db)).toEqual([]);
    expect(await usado(T.tenantId)).toBe(0);
  });

  it('valores sem laudo; linhas vazias somem; valor não numérico é recusado', async () => {
    expect(lerValores([{ nome: ' Glicemia de jejum ', valor: '110', unidade: 'mg/dL', referencia: '70–99' }, { nome: '', valor: '', unidade: '', referencia: '' }])).toEqual([
      { nome: 'Glicemia de jejum', valor: 110, unidade: 'mg/dL', referencia: '70–99' },
    ]);
    expect(lerValores([{ nome: 'Glicemia', valor: 'alta' }])).toBeNull();
    expect(lerValores([{ nome: 'Glicemia', valor: '9'.repeat(400) }])).toBeNull(); // Infinity não entra (viraria null no jsonb)
    expect(lerValores([{ nome: '', valor: '10' }])).toBeNull();
    expect(lerValores('lixo')).toBeNull();
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    expect(await erros(criarExame(T.ctx, T.tenant, p.id, { titulo: '', data: '2026-10-09', valores: [{ nome: 'G', valor: 'x' }], arquivo: null }, deps))).toEqual({
      titulo: MSG_EXAME.titulo,
      data: MSG_EXAME.futuro,
      valores: MSG_EXAME.valores,
    });
  });

  it('"Valores e gráfico": Glicemia de jejum 110 em 01/06 e 95 em 01/09 → uma série com 2 pontos em ordem cronológica', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await criarExame(T.ctx, T.tenant, p.id, { titulo: 'Rotina', data: '2026-09-01', valores: [{ nome: ' glicemia de jejum ', valor: '95', unidade: 'mg/dL' }], arquivo: null }, deps);
    await criarExame(T.ctx, T.tenant, p.id, { titulo: 'Rotina', data: '2026-06-01', valores: [{ nome: 'Glicemia de jejum', valor: '110', unidade: 'mg/dL' }, { nome: 'HbA1c', valor: '5,9', unidade: '%' }], arquivo: null }, deps);
    const series = await marcadoresDoPaciente(T.ctx, p.id, app.db);
    expect(series).toEqual([
      { nome: 'Glicemia de jejum', unidade: 'mg/dL', pontos: [{ data: '2026-06-01', valor: 110 }, { data: '2026-09-01', valor: 95 }] },
      { nome: 'HbA1c', unidade: '%', pontos: [{ data: '2026-06-01', valor: 5.9 }] },
    ]);
    expect(agruparMarcadores([])).toEqual([]);
    // mesma glicemia em outra unidade é outra série (não mistura mg/dL com mmol/L)
    const mistas = agruparMarcadores([
      { data: '2026-06-01', valores: [{ nome: 'Glicemia', valor: 110, unidade: 'mg/dL', referencia: null }] },
      { data: '2026-09-01', valores: [{ nome: 'glicemia', valor: 5.3, unidade: 'mmol/L', referencia: null }] },
    ]);
    expect(mistas.map((m) => [m.unidade, m.pontos.length])).toEqual([['mg/dL', 1], ['mmol/L', 1]]);
  });

  it('excluir apaga o laudo do disco e devolve a cota; apagar o arquivo pela API solta o vínculo (FK SET NULL)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const id = await criarExame(T.ctx, T.tenant, p.id, { titulo: 'A', data: '2026-09-01', valores: [], arquivo: PDF(1000) }, deps);
    expect(await excluirExame(T.ctx, p.id, id, deps)).toBe(true);
    expect(await usado(T.tenantId)).toBe(0);
    expect(await withTenant(T.ctx, (tx) => tx.select().from(storedFiles), app.db)).toEqual([]);
    const id2 = await criarExame(T.ctx, T.tenant, p.id, { titulo: 'B', data: '2026-09-01', valores: [], arquivo: PDF(1000) }, deps);
    const [e2] = await withTenant(T.ctx, (tx) => tx.select().from(exams).where(eq(exams.id, id2)), app.db);
    await apagarArquivo(T.ctx, { caminho: e2.arquivoPath! }, { db: app.db, dataDir });
    expect((await withTenant(T.ctx, (tx) => tx.select().from(exams).where(eq(exams.id, id2)), app.db))[0].arquivoPath).toBeNull();
  });

  it('paciente de outro tenant ou bloqueado: recusado antes de gravar o arquivo', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const pB = await novoPaciente(app.db, B.ctx);
    await expect(criarExame(A.ctx, A.tenant, pB.id, { titulo: 'X', data: '2026-09-01', valores: [], arquivo: PDF(1000) }, deps)).rejects.toBeInstanceOf(PacienteNaoEncontradoError);
    const bloqueado = await novoPaciente(app.db, A.ctx, { status: 'bloqueado' });
    await expect(criarExame(A.ctx, A.tenant, bloqueado.id, { titulo: 'X', data: '2026-09-01', valores: [], arquivo: PDF(1000) }, deps)).rejects.toBeInstanceOf(PacienteBloqueadoError);
    expect(await usado(A.tenantId)).toBe(0);
  });
});
