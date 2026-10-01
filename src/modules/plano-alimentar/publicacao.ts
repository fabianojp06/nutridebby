import { and, eq, sql } from 'drizzle-orm';
import { fromDrizzle, type PgBoss } from 'pg-boss';
import { getDb, type Db } from '@/db/client';
import { mealPlans } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getBoss } from '@/jobs/boss';
import { carregarPacienteParaEscrita, idValido } from '@/modules/pacientes/base';
import { lerPlanoNaTransacao } from './carregar';
import { MSG_PLANO } from './constantes';
import { PdfEmPreparoError, PlanoError, PlanoNaoEditavelError, PlanoNaoEncontradoError } from './erros';
import { copiarConteudo, proximaVersao } from './rascunho';
import type { PlanoCompleto } from './tipos';

type Deps = { db?: Db; now?: Date; boss?: PgBoss };

function exigirPublicavel(p: PlanoCompleto) {
  if (!p.refeicoes.length || !p.refeicoes.some((r) => r.itens.length)) throw new PlanoError({ geral: MSG_PLANO.publicarVazio });
  if (p.refeicoes.some((r) => !r.horario)) throw new PlanoError({ geral: MSG_PLANO.publicarHorario });
  const vazia = p.refeicoes.find((r) => !r.itens.some((i) => !i.substituiItemId));
  if (vazia) throw new PlanoError({ geral: MSG_PLANO.publicarRefeicaoVazia(vazia.nome) });
}

/**
 * Só o plano do paciente da URL: plano de outro paciente (ou modelo, que não tem paciente) não é encontrado, como
 * o inexistente e o de outro tenant (RLS). Vale na leitura sem trava (antes de travar o paciente) e na releitura.
 */
const doPaciente = (patientId: string, planId: string) => and(eq(mealPlans.id, planId), eq(mealPlans.patientId, patientId));

/**
 * US-025 / RN-01, numa transação: arquiva o publicado anterior, congela os nutrientes dos itens (D10),
 * publica e enfileira o PDF (US-026). Travas na mesma ordem do salvamento: paciente → plano.
 * Plano 06: o aviso ao paciente (push + e-mail, adiado — ver desvios) entra aqui, enfileirado nesta transação.
 */
export async function publicarPlano(ctx: TenantContext, patientId: string, planId: string, deps: Deps = {}): Promise<{ versao: number }> {
  if (!idValido(planId) || !idValido(patientId)) throw new PlanoNaoEncontradoError();
  const now = deps.now ?? new Date();
  const boss = deps.boss ?? (await getBoss());
  return withTenant(
    ctx,
    async (tx) => {
      const [antes] = await tx.select({ id: mealPlans.id }).from(mealPlans).where(doPaciente(patientId, planId));
      if (!antes) throw new PlanoNaoEncontradoError(); // modelo também: não se publica
      await carregarPacienteParaEscrita(tx, patientId);
      const [p] = await tx.select().from(mealPlans).where(doPaciente(patientId, planId)).for('update');
      if (!p) throw new PlanoNaoEncontradoError(); // descartado entre a leitura e a trava
      if (p.status !== 'rascunho') throw new PlanoNaoEditavelError();
      const completo = (await lerPlanoNaTransacao(tx, planId, { auditar: false, comMedidas: false }))!;
      exigirPublicavel(completo);

      await tx
        .update(mealPlans)
        .set({ status: 'arquivado', updatedAt: now })
        .where(and(eq(mealPlans.patientId, patientId), eq(mealPlans.status, 'publicado')));
      // D10: cópia dos valores por 100 g e do nome de cada alimento no momento da publicação
      const congelados = await tx.execute(sql`
        update meal_items mi set nutrientes = jsonb_build_object(
          'nome', f.nome,
          'origem', case when f.tenant_id is null then 'TACO' else 'Meu alimento' end,
          'kcal', f.kcal, 'proteinaG', f.proteina_g, 'carboidratoG', f.carboidrato_g, 'lipidioG', f.lipidio_g, 'fibraG', f.fibra_g),
          updated_at = ${now}
        from foods f
        where f.id = mi.food_id and mi.plan_id = ${planId}`);
      // plano publicado é imutável (RN-01): nenhum item pode ficar sem a cópia dos valores
      if (congelados.rowCount !== completo.refeicoes.reduce((n, r) => n + r.itens.length, 0)) throw new Error('Não foi possível congelar os valores dos alimentos do plano');
      await tx
        .update(mealPlans)
        .set({ status: 'publicado', publicadoEm: now, pdfStatus: 'pendente', pdfPedidoEm: now, pdfPath: null, updatedAt: now })
        .where(eq(mealPlans.id, planId));
      const job = await boss.send('plano-pdf', { tenantId: ctx.tenantId, planId }, { db: fromDrizzle(tx, sql) });
      if (!job) throw new Error('A fila recusou o PDF do plano');
      return { versao: p.versao };
    },
    deps.db ?? getDb(),
  );
}

/**
 * US-025 "Editar": rascunho versão + 1 copiado do publicado (ou o rascunho que já existe, D11).
 * Só a versão publicada se edita: uma aba velha que ainda mostra "Editar" numa versão já arquivada
 * não pode criar o rascunho a partir do conteúdo antigo.
 */
export async function editarPublicado(ctx: TenantContext, patientId: string, planId: string, deps: Deps = {}): Promise<{ id: string; criado: boolean }> {
  if (!idValido(planId) || !idValido(patientId)) throw new PlanoNaoEncontradoError();
  return withTenant(
    ctx,
    async (tx) => {
      const [antes] = await tx.select({ id: mealPlans.id }).from(mealPlans).where(doPaciente(patientId, planId));
      if (!antes) throw new PlanoNaoEncontradoError();
      await carregarPacienteParaEscrita(tx, patientId);
      const [p] = await tx.select().from(mealPlans).where(doPaciente(patientId, planId)); // com o paciente travado: a publicação em curso já terminou
      if (!p) throw new PlanoNaoEncontradoError();
      if (p.status !== 'publicado') throw new PlanoError({ geral: MSG_PLANO.naoPublicado });
      const [rasc] = await tx.select({ id: mealPlans.id }).from(mealPlans).where(and(eq(mealPlans.patientId, patientId), eq(mealPlans.status, 'rascunho')));
      if (rasc) return { id: rasc.id, criado: false };
      const [novo] = await tx
        .insert(mealPlans)
        .values({
          tenantId: ctx.tenantId,
          patientId,
          titulo: p.titulo,
          metaKcal: p.metaKcal,
          energyCalcId: p.energyCalcId,
          mostrarCalorias: p.mostrarCalorias,
          orientacoes: p.orientacoes,
          origemPlanId: p.id,
          versao: await proximaVersao(tx, patientId),
        })
        .returning({ id: mealPlans.id });
      await copiarConteudo(tx, p.id, novo.id);
      return { id: novo.id, criado: true };
    },
    deps.db ?? getDb(),
  );
}

/**
 * "Gerar o PDF de novo": enfileira só de 'falhou' (volta a 'pendente' na mesma transação; fila recusou → desfaz).
 * Já 'pendente' → PdfEmPreparoError; já 'pronto' (outra aba pediu, ou o worker terminou entre a tela e o clique) →
 * nada a fazer, sem erro: a página recarregada mostra "Baixar PDF". Rascunho não tem PDF → não encontrado.
 * Paciente bloqueado ou anonimizado (US-018) não ganha PDF novo: gerar é tratar dado de quem pediu a exclusão.
 * Travas: paciente → plano, como na publicação e no job.
 */
export async function pedirNovoPdf(ctx: TenantContext, patientId: string, planId: string, deps: Deps = {}): Promise<void> {
  if (!idValido(planId) || !idValido(patientId)) throw new PlanoNaoEncontradoError();
  const boss = deps.boss ?? (await getBoss());
  await withTenant(
    ctx,
    async (tx) => {
      const [antes] = await tx.select({ id: mealPlans.id }).from(mealPlans).where(doPaciente(patientId, planId));
      if (!antes) throw new PlanoNaoEncontradoError();
      await carregarPacienteParaEscrita(tx, patientId); // bloqueado/anonimizado → PacienteBloqueadoError
      const [p] = await tx.select({ pdfStatus: mealPlans.pdfStatus }).from(mealPlans).where(doPaciente(patientId, planId)).for('update');
      if (!p?.pdfStatus) throw new PlanoNaoEncontradoError(); // descartado entre a leitura e a trava, ou rascunho
      if (p.pdfStatus === 'pendente') throw new PdfEmPreparoError();
      if (p.pdfStatus === 'pronto') return;
      const now = deps.now ?? new Date();
      await tx
        .update(mealPlans)
        .set({ pdfStatus: 'pendente', pdfPedidoEm: now, updatedAt: now })
        .where(eq(mealPlans.id, planId));
      const job = await boss.send('plano-pdf', { tenantId: ctx.tenantId, planId }, { db: fromDrizzle(tx, sql) });
      if (!job) throw new Error('A fila recusou o PDF do plano'); // desfaz: o plano não fica "pendente" sem job
    },
    deps.db ?? getDb(),
  );
}
