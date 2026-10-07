import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { emailsNaFila, novoPaciente, novoTenant } from '../../../test/pacientes';
import { pacienteInformado, tarefaNoBanco } from '../../../test/ia';
import { closeDb } from '@/db/client';
import { iaTarefas, patients } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { PacienteBloqueadoError } from '@/modules/pacientes/base';
import { definirRecusaIa, desfazerAvisoPendente, usoDeIaVisivel, enviarAvisoPorEmail, motivoDoPaciente, registrarCienciaPorEmail, registrarEntregaEmMaos, situacaoDaCiencia } from './ciencia-paciente';
import { AVISO_IA_VERSAO } from './textos-legais';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
const agora = new Date('2026-10-06T15:00:00Z');
const lerPaciente = async (T: { ctx: Parameters<typeof withTenant>[0] }, id: string) => (await withTenant(T.ctx, (tx) => tx.select().from(patients).where(eq(patients.id, id)), app.db))[0];

describe('US-104 — ciência do paciente sobre o uso de IA (A-D19)', () => {
  it('sem registro: "não informado" → motivo paciente_nao_informado', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    expect(situacaoDaCiencia(p)).toEqual({ tipo: 'nao_informado' });
    expect(motivoDoPaciente(p)).toBe('paciente_nao_informado');
  });

  it('entrega em mãos: versão, data e canal na hora; auditado como alteração do cadastro', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await registrarEntregaEmMaos(T.ctx, p.id, { db: app.db, agora });
    const x = await lerPaciente(T, p.id);
    expect(x).toMatchObject({ iaAvisoVersao: AVISO_IA_VERSAO, iaAvisoEm: agora, iaAvisoCanal: 'em_maos', iaAvisoEnviadoEm: null });
    expect(situacaoDaCiencia(x)).toMatchObject({ tipo: 'informado', canal: 'em_maos' });
    expect(motivoDoPaciente(x)).toBeNull();
  });

  it('por e-mail: enfileira o aviso e fica "aguardando"; a ciência só entra no pós-envio (D5)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
    await enviarAvisoPorEmail(T.ctx, T.tenant, p.id, { db: app.db, agora });
    expect(await emailsNaFila('aviso_ia', p.email)).toEqual([{ tipo: 'aviso_ia', para: p.email, nome: 'Ana', consultorio: T.tenant.nomeExibicao, versao: AVISO_IA_VERSAO, patientId: p.id, enviadoEm: agora.toISOString() }]);
    const aguardando = await lerPaciente(T, p.id);
    expect(situacaoDaCiencia(aguardando)).toEqual({ tipo: 'aguardando_email', enviadoEm: agora });
    expect(motivoDoPaciente(aguardando)).toBe('paciente_nao_informado');
    expect(await registrarCienciaPorEmail(app.db, T.tenantId, p.id, AVISO_IA_VERSAO, 'outro@x.dev', agora)).toBe(false); // entregue a outro endereço
    expect(await registrarCienciaPorEmail(app.db, T.tenantId, p.id, AVISO_IA_VERSAO, p.email, new Date(agora.getTime() + 60_000))).toBe(true);
    expect(await lerPaciente(T, p.id)).toMatchObject({ iaAvisoCanal: 'email', iaAvisoVersao: AVISO_IA_VERSAO, iaAvisoEnviadoEm: null });
    expect(await registrarCienciaPorEmail(app.db, T.tenantId, p.id, AVISO_IA_VERSAO, p.email, agora)).toBe(false); // nada pendente: não regrava
  });

  it('a nutricionista trocou o e-mail do paciente entre o enfileiramento e o envio: o envio ao endereço antigo não vale como ciência', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
    await enviarAvisoPorEmail(T.ctx, T.tenant, p.id, { db: app.db, agora });
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ email: 'novo@x.dev' }).where(eq(patients.id, p.id)), app.db);
    expect(await registrarCienciaPorEmail(app.db, T.tenantId, p.id, AVISO_IA_VERSAO, p.email, agora)).toBe(false);
    expect(situacaoDaCiencia(await lerPaciente(T, p.id))).toMatchObject({ tipo: 'aguardando_email' });
  });

  it('code review do PR #23 (item 5): o job do aviso desistiu (conta suspensa, tentativas esgotadas) → o "aguardando" é desfeito; um reenvio mais novo não é tocado', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
    await enviarAvisoPorEmail(T.ctx, T.tenant, p.id, { db: app.db, agora });
    const depois = new Date(agora.getTime() + 60_000);
    await enviarAvisoPorEmail(T.ctx, T.tenant, p.id, { db: app.db, agora: depois }); // a nutricionista reenviou
    expect(await desfazerAvisoPendente(app.db, T.tenantId, p.id, agora.toISOString())).toBe(false); // o job antigo não apaga o novo
    expect(situacaoDaCiencia(await lerPaciente(T, p.id))).toEqual({ tipo: 'aguardando_email', enviadoEm: depois });
    expect(await desfazerAvisoPendente(app.db, T.tenantId, p.id, depois.toISOString())).toBe(true);
    const x = await lerPaciente(T, p.id);
    expect(situacaoDaCiencia(x)).toEqual({ tipo: 'nao_informado' });
    expect(x.iaAvisoEnviadoEm).toBeNull();
    expect(await desfazerAvisoPendente(app.db, T.tenantId, p.id, 'não é data')).toBe(false);
    // já informado (o pós-envio gravou): nada a desfazer
    await enviarAvisoPorEmail(T.ctx, T.tenant, p.id, { db: app.db, agora });
    await registrarCienciaPorEmail(app.db, T.tenantId, p.id, AVISO_IA_VERSAO, p.email, depois);
    expect(await desfazerAvisoPendente(app.db, T.tenantId, p.id, agora.toISOString())).toBe(false);
    expect(situacaoDaCiencia(await lerPaciente(T, p.id))).toMatchObject({ tipo: 'informado', canal: 'email' });
  });

  it('versão abaixo da mínima volta a "não informado"; canal portal ainda não conta (spec §5.3)', () => {
    const base = { iaAvisoEnviadoEm: null, iaAvisoEm: agora };
    expect(situacaoDaCiencia({ ...base, iaAvisoVersao: '0.0', iaAvisoCanal: 'em_maos' })).toEqual({ tipo: 'nao_informado' });
    expect(situacaoDaCiencia({ ...base, iaAvisoVersao: AVISO_IA_VERSAO, iaAvisoCanal: 'portal' })).toEqual({ tipo: 'nao_informado' });
  });

  it('paciente bloqueado (exclusão atendida) não recebe aviso nem registro', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx, { status: 'bloqueado', bloqueadoEm: agora });
    await expect(registrarEntregaEmMaos(T.ctx, p.id, { db: app.db, agora })).rejects.toBeInstanceOf(PacienteBloqueadoError);
    await expect(enviarAvisoPorEmail(T.ctx, T.tenant, p.id, { db: app.db, agora })).rejects.toBeInstanceOf(PacienteBloqueadoError);
    expect(await registrarCienciaPorEmail(app.db, T.tenantId, p.id, AVISO_IA_VERSAO, p.email, agora)).toBe(false);
  });
});

describe('code review do PR #23 (item 2): a seção "Uso de IA" da aba Privacidade', () => {
  const tenant = { iaLiberada: true, iaAditivoVersao: null };
  const paciente = { iaAvisoVersao: null, iaAvisoEnviadoEm: null, iaRecusadaEm: null };
  it('aparece com a IA liberada; some sem IA_PROVEDOR (a IA não existe) ou num consultório que nunca teve a IA liberada', () => {
    expect(usoDeIaVisivel('fake', tenant, paciente)).toBe(true);
    expect(usoDeIaVisivel('ausente', tenant, paciente)).toBe(false);
    expect(usoDeIaVisivel('anthropic', { iaLiberada: false, iaAditivoVersao: null }, paciente)).toBe(false);
  });
  it('bloqueada pela admin ou em emergência depois de ativada alguma vez, ou com histórico do paciente: continua (D19 — a recusa precisa ser registrável)', () => {
    const bloqueada = { iaLiberada: false, iaAditivoVersao: '0.1-provisorio' };
    expect(usoDeIaVisivel('anthropic', bloqueada, paciente)).toBe(true);
    expect(usoDeIaVisivel('emergencia', bloqueada, paciente)).toBe(true);
    const nunca = { iaLiberada: false, iaAditivoVersao: null };
    expect(usoDeIaVisivel('anthropic', nunca, { ...paciente, iaAvisoVersao: '0.1-provisorio' })).toBe(true);
    expect(usoDeIaVisivel('anthropic', nunca, { ...paciente, iaAvisoEnviadoEm: agora })).toBe(true);
    expect(usoDeIaVisivel('anthropic', nunca, { ...paciente, iaRecusadaEm: agora })).toBe(true);
  });
});

describe('US-103 — "Não usar IA com os dados deste paciente" (A-D9)', () => {
  it('marca a recusa, cancela fila e sugestões do paciente; o motivo vira paciente_indisponivel; desfazer volta', async () => {
    const T = await novoTenant(app.db);
    const p = await pacienteInformado(app.db, T.ctx);
    const pronta = await tarefaNoBanco(app.db, T.ctx, p.id, null, { status: 'pronta', resultado: { versao: 1, dataColeta: null, linhas: [], descartadas: 0 } });
    await definirRecusaIa(T.ctx, p.id, true, { db: app.db, agora });
    const x = await lerPaciente(T, p.id);
    expect(x.iaRecusadaEm).toEqual(agora);
    expect(motivoDoPaciente(x)).toBe('paciente_indisponivel');
    const [t] = await withTenant(T.ctx, (tx) => tx.select().from(iaTarefas).where(eq(iaTarefas.id, pronta)), app.db);
    expect(t).toMatchObject({ status: 'cancelada', resultado: null });
    await definirRecusaIa(T.ctx, p.id, false, { db: app.db, agora });
    expect(motivoDoPaciente(await lerPaciente(T, p.id))).toBeNull();
  });

  it('arquivado ou anonimizado também é paciente_indisponivel', () => {
    const informado = { iaAvisoVersao: AVISO_IA_VERSAO, iaAvisoEm: agora, iaAvisoCanal: 'em_maos', iaAvisoEnviadoEm: null, iaRecusadaEm: null, anonimizadoEm: null };
    expect(motivoDoPaciente({ ...informado, status: 'arquivado' } as never)).toBe('paciente_indisponivel');
    expect(motivoDoPaciente({ ...informado, status: 'ativo', anonimizadoEm: agora } as never)).toBe('paciente_indisponivel');
  });
});
