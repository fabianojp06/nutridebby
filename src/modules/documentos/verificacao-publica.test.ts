import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { documentoNoBanco } from '../../../test/documentos';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { tenants } from '@/db/schema';
import { formatarCodigo } from './codigo';
import { consultarVerificacao, textoSha256 } from './verificacao';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
let n = 0;
const ip = () => `2001:db8:${++n}::1`;

async function verificacao(situacao = 'valido', assinatura = 'digitalizada', tipo: 'receita' | 'parecer' = 'receita') {
  const T = await novoTenant(app.db);
  // 0092: a verificação aponta para um documento do mesmo tenant e com o mesmo código
  const d = await documentoNoBanco(app.db, T.ctx, (await novoPaciente(app.db, T.ctx)).id, { status: 'assinado', tipo });
  const codigo = d.codigo!;
  await app.db.execute(sql`insert into document_verifications (codigo, tenant_id, documento_id, tipo, situacao, assinado_em, emissor_nome, emissor_crn, assinante_nome, assinatura_tipo, pdf_sha256)
    values (${codigo}, ${T.tenantId}, ${d.id}, ${tipo}, ${situacao}, '2026-10-05T15:30:00Z', 'Débora Silva Santos', 'CRN-3 12345', ${assinatura === 'digitalizada' ? null : 'DEBORA SILVA SANTOS'}, ${assinatura}, ${'ab'.repeat(32)})`);
  return { T, codigo };
}

describe('verificação pública (US-147, RN-156, D8)', () => {
  it('válido: só os campos da D8 (nada do paciente), aceita minúsculas e hífen', async () => {
    const { codigo } = await verificacao();
    const r = await consultarVerificacao(formatarCodigo(codigo).toLowerCase(), { db: app.db, ipDoLimite: ip() });
    expect(r).toMatchObject({ tipo: 'ok', v: { codigo, tipo: 'Receita', situacao: 'valido', emissorNome: 'Débora Silva Santos', emissorCrn: 'CRN-3 12345', assinanteNome: null, assinatura: 'Digitalizado' } });
    expect(Object.keys((r as { v: object }).v).sort()).toEqual(['assinadoEm', 'assinanteNome', 'assinatura', 'codigo', 'emissorCrn', 'emissorNome', 'sha256', 'situacao', 'situacaoEm', 'tipo'].sort());
    expect(textoSha256('ab'.repeat(32))).toBe(Array(16).fill('abab').join(' '));
  });
  it('inexistente e malformado dão a mesma resposta; o 31º do mesmo IP na hora é recusado', async () => {
    const meu = ip();
    expect(await consultarVerificacao('ZZZZ-ZZZZ-ZZZZ', { db: app.db, ipDoLimite: meu })).toEqual({ tipo: 'nao_encontrado' });
    expect(await consultarVerificacao('<script>', { db: app.db, ipDoLimite: meu })).toEqual({ tipo: 'nao_encontrado' });
    for (let i = 3; i <= 30; i++) await consultarVerificacao('ZZZZZZZZZZZZ', { db: app.db, ipDoLimite: meu });
    expect(await consultarVerificacao('ZZZZZZZZZZZZ', { db: app.db, ipDoLimite: meu })).toEqual({ tipo: 'limite' });
  });
  it('tenant suspenso continua respondendo; digitalizada sem "Assinado por"', async () => {
    const { T, codigo } = await verificacao('valido', 'digitalizada');
    await app.db.update(tenants).set({ status: 'suspensa' }).where(eq(tenants.id, T.tenantId));
    expect(await consultarVerificacao(codigo, { db: app.db, ipDoLimite: ip() })).toMatchObject({ tipo: 'ok', v: { assinanteNome: null, assinatura: 'Digitalizado' } });
  });
  it('Plano 13 (US-147 v0.5): o parecer aparece como "Tipo: Parecer nutricional" e nada mais do parecer', async () => {
    const { codigo } = await verificacao('valido', 'digitalizada', 'parecer');
    const r = await consultarVerificacao(codigo, { db: app.db, ipDoLimite: ip() });
    expect(r).toMatchObject({ tipo: 'ok', v: { codigo, tipo: 'Parecer nutricional', situacao: 'valido' } });
    expect(Object.keys((r as { v: object }).v).sort()).toEqual(['assinadoEm', 'assinanteNome', 'assinatura', 'codigo', 'emissorCrn', 'emissorNome', 'sha256', 'situacao', 'situacaoEm', 'tipo'].sort());
  });
});
