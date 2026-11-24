import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { espiarErrosDoBanco, INVALIDOS, limpo, semErroDoBanco, sujo } from '../../../test/erros-do-banco';
import { autorizacaoNoBanco, IA_TESTE, iaPronta, prontuarioCompleto } from '../../../test/ia';
import { aceiteNoBanco, iaNutriPronta, liberarNoBanco, SEM_PAUSA } from '../../../test/ia-nutri';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { planoPublicado } from '../../../test/plano';
import { pacienteComConta } from '../../../test/portal';
import { closeDb } from '@/db/client';
import { iaNutriMensagens, iaTarefas, tenants, type TenantRow } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { enviarANutri, perguntar, type DepsIaNutri } from './nutri-paciente/conversa';
import { pedirRascunhoIa } from './rascunho-ia';

/**
 * SUS-110 (regra 3): o NUL e o surrogate UTF-16 sem par na pergunta do paciente à IA Nutri (e na dúvida enviada direto à
 * nutricionista) e nas restrições do rascunho de plano pela IA não chegam ao banco — o parâmetro `text` da função
 * recusaria o NUL (22021, com a pergunta no CONTEXT) e o jsonb `ia_tarefas.parametros` recusaria os dois (22P05/22P02).
 * O espião anota o SQLSTATE de todo erro do banco.
 */
const app = makeDb(inject('appDatabaseUrl'));
const errosDoBanco = espiarErrosDoBanco(app.pool);
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});

const depsNutri: DepsIaNutri = { ia: IA_TESTE, appUrl: 'https://app.teste', db: app.db, pausa: SEM_PAUSA };
async function iaNutriDoPaciente() {
  const T = await novoTenant(app.db);
  await iaNutriPronta(app.db, T.tenantId);
  const { paciente: p, userId } = await pacienteComConta(app.db, T);
  const ctxP = ctxPaciente(T.tenantId, p.id, userId);
  await liberarNoBanco(app.db, T.ctx, p.id);
  await aceiteNoBanco(app.db, ctxP);
  await planoPublicado(app.db, T, p.id);
  return { T, ctxP };
}
const textoDaMensagem = async (T: Awaited<ReturnType<typeof novoTenant>>, id: string | null) =>
  (await withTenant(T.ctx, (tx) => tx.select({ texto: iaNutriMensagens.texto }).from(iaNutriMensagens).where(eq(iaNutriMensagens.id, id!)), app.db))[0].texto;

describe('SUS-110: texto com NUL ou surrogate sem par na IA', () => {
  it.each(INVALIDOS)('IA Nutri: a pergunta do paciente com %s vai limpa', async (_nome, ch) => {
    const { T, ctxP } = await iaNutriDoPaciente();
    const r = await semErroDoBanco(errosDoBanco, () => perguntar(ctxP, sujo('Quanto de arroz no almoço?', ch), depsNutri));
    expect(r.codigo).toBe('ok');
    expect(await textoDaMensagem(T, r.mensagemId)).toBe(limpo('Quanto de arroz no almoço?'));
  });

  it.each(INVALIDOS)('IA Nutri: a dúvida enviada direto à nutricionista com %s vai limpa', async (_nome, ch) => {
    const { T, ctxP } = await iaNutriDoPaciente();
    const r = await semErroDoBanco(errosDoBanco, () => enviarANutri(ctxP, sujo('Posso trocar o jantar de dia?', ch), depsNutri));
    expect(r.codigo).toBe('encaminhada');
    expect(await textoDaMensagem(T, r.mensagemId)).toBe(limpo('Posso trocar o jantar de dia?'));
  });

  it.each(INVALIDOS)('rascunho pela IA: as restrições e o nome da refeição com %s vão limpos aos parâmetros da tarefa', async (_nome, ch) => {
    const T = await novoTenant(app.db);
    await iaPronta(app.db, T.tenantId);
    const p = await novoPaciente(app.db, T.ctx);
    await autorizacaoNoBanco(app.db, T.tenantId, p.id, {});
    await prontuarioCompleto(app.db, T.ctx, p.id);
    const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId));
    const metas = {
      metaKcal: '1800',
      proteinaPct: '20',
      carboidratoPct: '50',
      lipidioPct: '30',
      refeicoes: [{ nome: sujo('Almoço', ch), horario: '12:00' }],
      restricoes: sujo('Sem lactose\r\n', ch),
      considerarAnamnese: false,
    };
    const id = await semErroDoBanco(errosDoBanco, () => pedirRascunhoIa(T.ctx, tenant as TenantRow, p.id, metas, { db: app.db, ia: IA_TESTE, avisarTeto: async () => 0 }));
    const [t] = await withTenant(T.ctx, (tx) => tx.select({ parametros: iaTarefas.parametros }).from(iaTarefas).where(eq(iaTarefas.id, id)), app.db);
    expect(t.parametros).toMatchObject({ refeicoes: [{ nome: limpo('Almoço'), horario: '12:00' }], restricoes: limpo('Sem lactose\n') });
  });
});
