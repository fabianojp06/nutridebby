import { and, eq, type SQL } from 'drizzle-orm';
import { inject } from 'vitest';
import { closeDb } from '@/db/client';
import { consultations, mealPlans } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import type { DepsIaNutri } from '@/modules/ia/nutri-paciente/deps';
import type { DepsJobIaPaciente } from '@/modules/ia/nutri-paciente/job';
import type { ProvedorIA } from '@/modules/ia/provedor';
import { editarPublicado, publicarPlano } from '@/modules/plano-alimentar/publicacao';
import { makeDb } from './db';
import { IA_TESTE } from './ia';
import { aceiteNoBanco, iaNutriPronta, liberarNoBanco, SEM_PAUSA } from './ia-nutri';
import { ctxPaciente, novoTenant, type TenantDeTeste } from './pacientes';
import { planoPublicado } from './plano';
import { pacienteComConta } from './portal';

export { finalOk } from '@/modules/ia/provedor-fake';

/**
 * Plano 15 (T9): o harness da conversa com o worker — só testes (contexto.test.ts, job.test.ts, varredura.test.ts e, na
 * T13, logs.test.ts). O banco do Vitest (`appDatabaseUrl`); quem importa chama `fecharHarnessDaConversa()` no afterAll
 * (a publicação do plano e a pergunta enfileiram jobs).
 */
export const app = makeDb(inject('appDatabaseUrl'));
export async function fecharHarnessDaConversa(): Promise<void> {
  await stopBoss();
  await closeDb();
  await app.pool.end();
}

/** TACO 4ª ed.: arroz tipo 1 cozido, banana prata crua e maçã fuji com casca crua. */
export const TACO_ARROZ = 3;
export const TACO_BANANA = 182;
export const TACO_MACA = 222;
export const ORIENTACOES_DO_PLANO = 'Beba água. Qualquer dúvida, fale com a Debby.';

/**
 * O plano do caso (T9, Step 2): "Almoço 12:30" com 1 item (arroz) e "Lanche da tarde 16:00" com 1 item (banana) e a
 * substituição (maçã), as orientações do plano citando a nutricionista. Publicado pelos serviços de verdade.
 */
export const planoDoCaso = (T: TenantDeTeste, patientId: string, o: { mostrarCalorias?: boolean } = {}) =>
  planoPublicado(app.db, T, patientId, {
    mostrarCalorias: o.mostrarCalorias ?? false,
    orientacoes: ORIENTACOES_DO_PLANO,
    refeicoes: [
      { nome: 'Almoço', horario: '12:30', itens: [{ gramas: 100, taco: TACO_ARROZ }] },
      { nome: 'Lanche da tarde', horario: '16:00', itens: [{ gramas: 100, taco: TACO_BANANA }, { gramas: 130, taco: TACO_MACA, substitui: 0 }] },
    ],
  });

/** Dois atendimentos com orientações ao paciente (o mais recente cita o primeiro nome do paciente). */
export async function atendimentosDoCaso(T: TenantDeTeste, patientId: string): Promise<void> {
  await withTenant(
    T.ctx,
    (tx) =>
      tx.insert(consultations).values([
        { tenantId: T.tenantId, patientId, data: '2026-08-01', orientacoesPaciente: 'Caminhe 30 minutos por dia.' },
        { tenantId: T.tenantId, patientId, data: '2026-09-01', orientacoesPaciente: 'Evite frituras, Ana.' },
      ]),
    app.db,
  );
}

/** Plano 19 (T10c): outro plano publicado no lugar do plano do caso (dias, texto livre, lista de substituição ligada). */
type PlanoDoTeste = (T: TenantDeTeste, patientId: string) => Promise<unknown>;

/** O paciente com conta, liberado, com o consentimento e o plano do caso (ou o `plano` pedido). */
async function pacienteDoCaso(T: TenantDeTeste, o: { mostrarCalorias?: boolean; plano?: PlanoDoTeste } = {}) {
  const { paciente: p, userId } = await pacienteComConta(app.db, T);
  const ctxP = ctxPaciente(T.tenantId, p.id, userId);
  await liberarNoBanco(app.db, T.ctx, p.id);
  await aceiteNoBanco(app.db, ctxP);
  await (o.plano ? o.plano(T, p.id) : planoDoCaso(T, p.id, o));
  await atendimentosDoCaso(T, p.id);
  return { p, ctxP };
}

/** Consultório com a IA Nutri pronta e o paciente do caso. */
export async function pronto(o: { cotaUsd?: number; mostrarCalorias?: boolean; plano?: PlanoDoTeste } = {}) {
  const T = await novoTenant(app.db);
  await iaNutriPronta(app.db, T.tenantId, { cotaUsd: o.cotaUsd });
  const { p, ctxP } = await pacienteDoCaso(T, o);
  return { T, p, ctxP };
}

/** DP-9: um segundo paciente do MESMO consultório, liberado, com consentimento e o mesmo plano. */
export const outroPacientePronto = (T: TenantDeTeste) => pacienteDoCaso(T);

export const depsApp: DepsIaNutri = { ia: IA_TESTE, appUrl: 'https://app.teste', pausa: SEM_PAUSA, db: app.db };

/** Leitura (ou escrita) direta no contexto worker do tenant: devolve as linhas. */
export async function comoWorker(T: { tenantId: string }, consulta: SQL): Promise<Record<string, unknown>[]> {
  const r = await withTenant({ tenantId: T.tenantId, role: 'worker' }, (tx) => tx.execute(consulta), app.db);
  return r.rows as Record<string, unknown>[];
}

/** As dependências do job `ia-paciente` nos testes (provedor fake, destino `teste`, sem pausa, teto da plataforma folgado). */
export const depsDoJob = (provedor: ProvedorIA, extra: Partial<DepsJobIaPaciente> = {}): DepsJobIaPaciente => ({
  db: app.db, modo: 'fake', provedor, geo: 'us', tetoGlobalMicroUsd: 50_000_000_000, destino: 'teste', retencao: 'zero',
  modeloPaciente: 'claude-haiku-5-5', nutriDesligada: false, appUrl: 'https://app.teste', ultimaTentativa: false, pausa: SEM_PAUSA, ...extra,
});

/** "Editar" + "Publicar" pelos serviços de verdade: a versão que estava publicada vira `arquivado` (publicacao.ts). */
export async function editarEPublicarDeNovo(T: { ctx: TenantContext }, patientId: string): Promise<void> {
  const [pub] = await withTenant(
    T.ctx,
    (tx) => tx.select({ id: mealPlans.id }).from(mealPlans).where(and(eq(mealPlans.patientId, patientId), eq(mealPlans.status, 'publicado'))),
    app.db,
  );
  const { id } = await editarPublicado(T.ctx, patientId, pub.id, { db: app.db });
  await publicarPlano(T.ctx, patientId, id, { db: app.db });
}
