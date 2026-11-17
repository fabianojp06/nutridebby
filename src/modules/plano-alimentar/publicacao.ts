import { and, eq, sql } from 'drizzle-orm';
import { fromDrizzle, type PgBoss } from 'pg-boss';
import { getDb, type Db } from '@/db/client';
import { mealPlans, referenciasNutrientes, type ReferenciaCongelada } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getEnv } from '@/env';
import { getBoss } from '@/jobs/boss';
import { FILA_DO_PDF_DO_PLANO } from '@/jobs/queues';
import { FONTES, FONTES_DE_ALIMENTO, seloDaFonte } from '@/modules/alimentos/fontes';
import { carregarPacienteParaEscrita, idValido } from '@/modules/pacientes/base';
import { avisarPlanoNovo } from '@/modules/portal/avisos';
import { lerPlanoNaTransacao } from './carregar';
import { MSG_DIAS, MSG_PLANO, MSG_TEXTO_LIVRE } from './constantes';
import { diasSemRefeicao } from './dias';
import { PdfEmPreparoError, PlanoError, PlanoNaoEditavelError, PlanoNaoEncontradoError } from './erros';
import { cabecalhoDaCopia, copiarConteudo, proximaVersao } from './rascunho';
import type { PlanoCompleto } from './tipos';

/** `appUrl`: o link do e-mail "Seu novo plano alimentar está disponível" (padrão: APP_URL). */
type Deps = { db?: Db; now?: Date; boss?: PgBoss; appUrl?: string };

function exigirPublicavel(p: PlanoCompleto) {
  if (p.modo === 'livre') {
    // RN-244: ao menos uma refeição, horário e texto em todas (os dias, o CHECK meals_dias_validos garante)
    if (!p.refeicoes.length) throw new PlanoError({ geral: MSG_TEXTO_LIVRE.publicarVazio });
    if (p.refeicoes.some((r) => !r.horario)) throw new PlanoError({ geral: MSG_PLANO.publicarHorario });
    const semTexto = p.refeicoes.find((r) => !r.descricaoLivre);
    // a chave do campo: o botão "Publicar" mostra o erro como link que leva o foco à caixa "O que comer" da refeição
    if (semTexto) throw new PlanoError({ [`refeicao:${semTexto.id}:descricaoLivre`]: MSG_TEXTO_LIVRE.semTexto(semTexto.nome) });
    return;
  }
  if (!p.refeicoes.length || !p.refeicoes.some((r) => r.itens.length)) throw new PlanoError({ geral: MSG_PLANO.publicarVazio });
  if (p.refeicoes.some((r) => !r.horario)) throw new PlanoError({ geral: MSG_PLANO.publicarHorario });
  const vazia = p.refeicoes.find((r) => !r.itens.some((i) => !i.substituiItemId));
  if (vazia) throw new PlanoError({ geral: MSG_PLANO.publicarRefeicaoVazia(vazia.nome) });
}

/** D31: o que não barra a publicação, mas a nutricionista precisa ver antes ("Publicar mesmo assim"). */
function avisosDaPublicacao(p: PlanoCompleto): string[] {
  const avisos: string[] = [];
  if (p.modo === 'livre' && p.metaKcal === null) avisos.push(MSG_TEXTO_LIVRE.semVet); // RN-244
  const semRefeicao = diasSemRefeicao(p.refeicoes);
  if (semRefeicao.length) avisos.push(MSG_DIAS.semRefeicao(semRefeicao)); // RN-246
  return avisos;
}

/** RN-237: `fonte`, versão e selo pela fonte do alimento (`foods.fonte`, nunca `tenant_id`). */
const porFonte = (valor: (f: (typeof FONTES_DE_ALIMENTO)[number]) => string | null) =>
  sql.join(
    FONTES_DE_ALIMENTO.map((f) => sql`when ${f} then ${valor(f)}::text`),
    sql` `,
  );

/**
 * Só o plano do paciente da URL: plano de outro paciente (ou modelo, que não tem paciente) não é encontrado, como
 * o inexistente e o de outro tenant (RLS). Vale na leitura sem trava (antes de travar o paciente) e na releitura.
 */
const doPaciente = (patientId: string, planId: string) => and(eq(mealPlans.id, planId), eq(mealPlans.patientId, patientId));

/** Publicado (`versao`), ou nada publicado e os avisos para "Publicar mesmo assim" (D31). */
export type ResultadoPublicacao = { versao: number; avisos?: never } | { avisos: string[]; versao?: never };

/**
 * US-025 / RN-01, numa transação: arquiva o publicado anterior, congela os nutrientes dos itens (D10),
 * publica e enfileira o PDF (US-026). Travas na mesma ordem do salvamento: paciente → plano.
 * Plano 06 (US-025): o aviso ao paciente com acesso ao portal (push + e-mail) é gravado nesta transação.
 * Plano 19: congela também fonte, versão da tabela, fonte de origem e micros de cada item (RN-237) e o perfil de
 * referência (RN-238: `referencia_congelada`, e `referencia_id` zerado). Com aviso (sem VET no modo livre, dia sem
 * refeição — D31), nada é publicado e os avisos voltam; publica quando todos estão em `confirmarAvisos` (o "Publicar
 * mesmo assim" manda os que mostrou: um aviso novo, nascido de uma edição depois deles, volta a ser mostrado).
 */
export async function publicarPlano(
  ctx: TenantContext,
  patientId: string,
  planId: string,
  deps: Deps = {},
  o: { confirmarAvisos?: readonly string[] } = {},
): Promise<ResultadoPublicacao> {
  if (!idValido(planId) || !idValido(patientId)) throw new PlanoNaoEncontradoError();
  const now = deps.now ?? new Date();
  const boss = deps.boss ?? (await getBoss());
  return withTenant(
    ctx,
    async (tx) => {
      const [antes] = await tx.select({ id: mealPlans.id }).from(mealPlans).where(doPaciente(patientId, planId));
      if (!antes) throw new PlanoNaoEncontradoError(); // modelo também: não se publica
      const paciente = await carregarPacienteParaEscrita(tx, patientId);
      const [p] = await tx.select().from(mealPlans).where(doPaciente(patientId, planId)).for('update');
      if (!p) throw new PlanoNaoEncontradoError(); // descartado entre a leitura e a trava
      if (p.status !== 'rascunho') throw new PlanoNaoEditavelError();
      const completo = (await lerPlanoNaTransacao(tx, planId, { auditar: false, comMedidas: false }))!;
      exigirPublicavel(completo);
      const avisos = avisosDaPublicacao(completo);
      if (avisos.some((a) => !o.confirmarAvisos?.includes(a))) return { avisos };

      // RN-238: o perfil como está agora (a FK com SET NULL garante que existe). Sem trava: a exclusão do perfil trava o
      // perfil e depois este plano (SET NULL), a ordem contrária à daqui; a que chegar depois espera o COMMIT e já não
      // acha o ponteiro, zerado abaixo
      let referenciaCongelada: ReferenciaCongelada | null = null;
      if (p.referenciaId) {
        const [r] = await tx.select().from(referenciasNutrientes).where(eq(referenciasNutrientes.id, p.referenciaId));
        if (r) referenciaCongelada = { id: r.id, nome: r.nome, fonte: r.fonte, valores: r.valores };
      }
      await tx
        .update(mealPlans)
        .set({ status: 'arquivado', updatedAt: now })
        .where(and(eq(mealPlans.patientId, patientId), eq(mealPlans.status, 'publicado')));
      // D10: cópia dos valores por 100 g e do nome de cada alimento no momento da publicação. RN-237: também a fonte (de
      // foods.fonte), a versão da tabela, a fonte de origem do "Meu alimento" duplicado (RN-233) e os micros (`{}` = o
      // alimento não tem nenhum; `micros` ausente fica para o formato antigo). `origem` (o selo) fica para os leitores antigos
      const congelados = await tx.execute(sql`
        update meal_items mi set nutrientes = jsonb_build_object(
          'nome', f.nome,
          'origem', case f.fonte ${porFonte(seloDaFonte)} end,
          'fonte', f.fonte,
          'fonteVersao', case f.fonte ${porFonte((x) => (x === 'propria' ? null : FONTES[x].versao))} end,
          'fonteOrigem', o.fonte,
          'kcal', f.kcal, 'proteinaG', f.proteina_g, 'carboidratoG', f.carboidrato_g, 'lipidioG', f.lipidio_g, 'fibraG', f.fibra_g,
          'micros', coalesce(f.micros, '{}'::jsonb)),
          updated_at = ${now}
        from foods f
        left join foods o on o.id = f.origem_food_id and f.fonte = 'propria' and o.fonte <> 'propria'
        where f.id = mi.food_id and mi.plan_id = ${planId}`);
      // plano publicado é imutável (RN-01): nenhum item pode ficar sem a cópia dos valores
      if (congelados.rowCount !== completo.refeicoes.reduce((n, r) => n + r.itens.length, 0)) throw new Error('Não foi possível congelar os valores dos alimentos do plano');
      await tx
        .update(mealPlans)
        .set({ status: 'publicado', publicadoEm: now, pdfStatus: 'pendente', pdfPedidoEm: now, pdfPath: null, referenciaId: null, referenciaCongelada, updatedAt: now })
        .where(eq(mealPlans.id, planId));
      const job = await boss.send(FILA_DO_PDF_DO_PLANO, { tenantId: ctx.tenantId, planId }, { db: fromDrizzle(tx, sql) });
      if (!job) throw new Error('A fila recusou o PDF do plano');
      await avisarPlanoNovo(tx, paciente, now, deps.appUrl ?? getEnv().APP_URL);
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
          iaOrigemEm: p.iaOrigemEm, // RN-117 (Plano 14B, D16): a nova versão de um plano feito com apoio da IA continua com o selo
          ...(await cabecalhoDaCopia(tx, p)), // RN-256 (Plano 19): modo, nutrientes, distribuição e o perfil (RN-238)
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
      const job = await boss.send(FILA_DO_PDF_DO_PLANO, { tenantId: ctx.tenantId, planId }, { db: fromDrizzle(tx, sql) });
      if (!job) throw new Error('A fila recusou o PDF do plano'); // desfaz: o plano não fica "pendente" sem job
    },
    deps.db ?? getDb(),
  );
}
