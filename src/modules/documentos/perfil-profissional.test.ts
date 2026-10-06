import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novoTenant } from '../../../test/pacientes';
import { tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { DocumentoError } from './erros';
import { copiaDoPerfil, declararFitoterapia, MSG_PERFIL_PROF, perfilCompleto, PerfilIncompletoError, retirarFitoterapia, salvarDadosParaDocumentos } from './perfil-profissional';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
const tenantDe = async (id: string) => (await app.db.select().from(tenants).where(eq(tenants.id, id)))[0];

describe('perfil profissional (US-140)', () => {
  it('valida com as mensagens da spec; grava o telefone em E.164 e audita "Perfil profissional"', async () => {
    const T = await novoTenant(app.db);
    await expect(salvarDadosParaDocumentos(T.ctx, { nomeProfissional: 'Deb', contatoEmail: 'x', contatoTelefone: '123' }, app.db)).rejects.toSatisfy(
      (e) => e instanceof DocumentoError && e.erros.nomeProfissional === MSG_PERFIL_PROF.nome && e.erros.contatoEmail === MSG_PERFIL_PROF.email && e.erros.contatoTelefone === MSG_PERFIL_PROF.telefone,
    );
    await salvarDadosParaDocumentos(T.ctx, { nomeProfissional: '  Débora  Silva Santos ', contatoEmail: 'debby@consultorio.com', contatoTelefone: '(11) 91234-5678' }, app.db);
    const t = await tenantDe(T.tenantId);
    expect(t).toMatchObject({ nomeProfissional: 'Débora Silva Santos', contatoEmail: 'debby@consultorio.com', contatoTelefoneE164: '+5511912345678' });
    const audit = await withTenant(T.ctx, (tx) => tx.execute(sql`select acao, entidade from audit_log where entidade = 'perfil_profissional'`), app.db);
    expect(audit.rows).toEqual([{ acao: 'alterar', entidade: 'perfil_profissional' }]);
  });

  it('perfil completo exige nome, CRN, e-mail e telefone; a cópia formata o telefone e diz se há habilitação', async () => {
    const T = await novoTenant(app.db);
    const t0 = await tenantDe(T.tenantId);
    expect(perfilCompleto(t0)).toBe(false);
    expect(() => copiaDoPerfil(t0)).toThrow(PerfilIncompletoError);
    await app.db.update(tenants).set({ crn: 'CRN-3 12345' }).where(eq(tenants.id, T.tenantId));
    await salvarDadosParaDocumentos(T.ctx, { nomeProfissional: 'Débora Silva Santos', contatoEmail: 'debby@consultorio.com', contatoTelefone: '11912345678' }, app.db);
    const t = await tenantDe(T.tenantId);
    expect(perfilCompleto(t)).toBe(true);
    expect(copiaDoPerfil(t)).toEqual({ nomeCompleto: 'Débora Silva Santos', crn: 'CRN-3 12345', email: 'debby@consultorio.com', telefone: '(11) 91234-5678', endereco: null, fitoterapia: false });
  });

  it('D6: declarar a habilitação exige o registro e a confirmação; grava data e versão do termo; retirar limpa os três', async () => {
    const T = await novoTenant(app.db);
    await expect(declararFitoterapia(T.ctx, { registro: '', confirmo: 'on' }, { db: app.db })).rejects.toSatisfy((e) => e instanceof DocumentoError && e.erros.registro === MSG_PERFIL_PROF.registro);
    await expect(declararFitoterapia(T.ctx, { registro: 'CRN-3 nº 1234/2024' }, { db: app.db })).rejects.toSatisfy((e) => e instanceof DocumentoError && e.erros.confirmo === MSG_PERFIL_PROF.declaracao);
    await declararFitoterapia(T.ctx, { registro: 'CRN-3 nº 1234/2024', confirmo: 'on' }, { db: app.db, agora: new Date('2026-10-05T12:00:00Z') });
    expect(await tenantDe(T.tenantId)).toMatchObject({ fitoterapiaRegistro: 'CRN-3 nº 1234/2024', fitoterapiaTermoVersao: '2026-10-05', fitoterapiaDeclaradaEm: new Date('2026-10-05T12:00:00Z') });
    await retirarFitoterapia(T.ctx, { db: app.db });
    expect(await tenantDe(T.tenantId)).toMatchObject({ fitoterapiaRegistro: null, fitoterapiaDeclaradaEm: null, fitoterapiaTermoVersao: null });
    // retirar de novo (duas abas, clique duplo) não grava outra retirada
    await retirarFitoterapia(T.ctx, { db: app.db });
    // US-140/D6: a declaração (com a versão do termo) e a retirada ficam no audit_log, sem paciente, distintas da edição do contato
    const audit = await withTenant(
      T.ctx,
      (tx) => tx.execute(sql`select acao, entidade, entidade_id, patient_id from audit_log where entidade = 'perfil_profissional' order by criado_em, id`),
      app.db,
    );
    expect(audit.rows).toEqual([
      { acao: 'criar', entidade: 'perfil_profissional', entidade_id: 'fitoterapia:2026-10-05', patient_id: null },
      { acao: 'excluir', entidade: 'perfil_profissional', entidade_id: 'fitoterapia', patient_id: null },
    ]);
  });
});
