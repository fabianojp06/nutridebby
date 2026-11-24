import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { espiarErrosDoBanco } from '../../../test/erros-do-banco';
import { jpegDe, ligarExames } from '../../../test/exames-enviados';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { diaryEntries, examSubmissions } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { registrarNoDiario } from './diario';
import { comentarRegistro } from './diario-nutri';
import { enviarExame } from './exames-enviados';

/**
 * SUS-110 (regra 3): o NUL e o surrogate UTF-16 sem par no texto do diário (do paciente e o comentário da nutricionista) e
 * no nome e na observação do exame enviado pelo paciente saem em silêncio — antes o NUL era recusado com "Formulário
 * inválido." (F-4) e o surrogate virava U+FFFD no banco. O espião anota o SQLSTATE de todo erro do banco.
 */
const app = makeDb(inject('appDatabaseUrl'));
const errosDoBanco = espiarErrosDoBanco(app.pool);
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-texto-invalido-portal-'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});
const SP = { fuso: 'America/Sao_Paulo' };
const AGORA = new Date('2026-10-07T15:00:00Z');

const INVALIDOS = [
  ['NUL', '\u0000'],
  ['surrogate alto sem par', '\ud800'],
  ['surrogate baixo sem par', '\udc00'],
] as const;
const sujo = (t: string, c: string) => `${t}${c} baixa 🙂`;
const limpo = (t: string) => `${t} baixa 🙂`;

async function semErroDoBanco<T>(f: () => Promise<T>): Promise<T> {
  errosDoBanco.length = 0;
  const r = await f().then(
    (v) => ({ ok: true as const, v }),
    (e: unknown) => ({ ok: false as const, e }),
  );
  expect(errosDoBanco).toEqual([]);
  if (!r.ok) throw r.e;
  return r.v;
}

describe('SUS-110: texto com NUL ou surrogate sem par no portal', () => {
  it.each(INVALIDOS)('diário: o texto do paciente e o comentário da nutricionista com %s vão limpos', async (_nome, ch) => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const { id } = await semErroDoBanco(() => registrarNoDiario(ctxPaciente(T.tenantId, p.id), SP, { refeicao: 'Almoço', texto: sujo('Arroz e feijão', ch), foto: null }, { db: app.db, dataDir, agora: AGORA }));
    await semErroDoBanco(() => comentarRegistro(T.ctx, id, sujo('Ótima escolha', ch), { db: app.db, agora: AGORA }));
    const [e] = await withTenant(T.ctx, (tx) => tx.select({ texto: diaryEntries.texto, comentario: diaryEntries.comentarioNutri }).from(diaryEntries).where(eq(diaryEntries.id, id)), app.db);
    expect(e).toEqual({ texto: limpo('Arroz e feijão'), comentario: limpo('Ótima escolha') });
  });

  it.each(INVALIDOS)('exame enviado: nome e observação com %s vão limpos', async (_nome, ch) => {
    const T = await novoTenant(app.db);
    await ligarExames(app.db, T.tenantId);
    const p = await novoPaciente(app.db, T.ctx);
    const { id } = await semErroDoBanco(async () =>
      enviarExame(ctxPaciente(T.tenantId, p.id), SP, { dataColeta: '2026-09-28', nome: sujo('Hemograma', ch), observacao: sujo('Pedido\nna consulta', ch), arquivos: [await jpegDe(2000)] }, { db: app.db, dataDir, agora: AGORA }),
    );
    const [e] = await withTenant(T.ctx, (tx) => tx.select({ nome: examSubmissions.nome, observacao: examSubmissions.observacao }).from(examSubmissions).where(eq(examSubmissions.id, id)), app.db);
    expect(e).toEqual({ nome: limpo('Hemograma'), observacao: limpo('Pedido\nna consulta') });
  });
});
