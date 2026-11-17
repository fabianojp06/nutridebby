import { and, desc, eq, gt, gte, inArray, lt, ne, or } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { appointments, diaryEntries, examSubmissions, mealPlans, patients } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { podeAlterarPeloPaciente } from '@/modules/agenda/cancelamento';
import { listarConsultasNaTransacao, STATUS_ATIVOS, type TenantAgenda } from '@/modules/agenda/consultas';
import { inicioDoDia, partesNoFuso, somarDias } from '@/modules/agenda/fuso';
import { novosNoPortalNaTransacao } from '@/modules/documentos/portal';
import { situacaoParaPaciente } from '@/modules/pacientes/exames-enviados-constantes';
import { lerPlanoNaTransacao } from '@/modules/plano-alimentar/carregar';
import { diaDaSemanaNoFuso, refeicoesDoDia } from '@/modules/plano-alimentar/dias';
import { auditRead } from '@/modules/plataforma/audit';
import { conteudosNovosNaTransacao } from './conteudos';
import { paraRegistro } from './diario';
import { comporMural, JANELA_MURAL_DIAS, LIMITE_DIARIO_NO_MURAL, MAX_CONTEUDOS_NO_MURAL, type FontesDoMural, type Mural } from './mural-regras';
import { primeiroNome } from './perfil';
import { pacienteDaSessao } from './sessao';

const DIA_MS = 86_400_000;

/**
 * Plano 16 (§4.3, RN-199, RN-200, RNF-190): as fontes do mural numa transação, com o contexto do paciente (a RLS entrega só
 * as linhas dele). auditRead uma vez por entidade com dado de saúde: o plano (lerPlanoNaTransacao, com o id do plano), o
 * diário e os exames enviados; agenda, conteúdos e a contagem de documentos não (P05 D10, P07 D6, 10A D17). Nada é gravado.
 * Índices: diary_entries_paciente_idx, exam_submissions_paciente_idx, o de appointments e o de meal_plans por paciente.
 */
export async function muralDoPaciente(ctx: TenantContext, tenant: TenantAgenda, agora: Date, db: Db = getDb()): Promise<Mural> {
  const patientId = pacienteDaSessao(ctx, 'muralDoPaciente');
  const hoje = partesNoFuso(agora, tenant.fuso).data;
  const janela = inicioDoDia(somarDias(hoje, -JANELA_MURAL_DIAS), tenant.fuso);
  const fontes = await withTenant(
    ctx,
    async (tx): Promise<FontesDoMural> => {
      const [p] = await tx.select({ nome: patients.nome }).from(patients).where(eq(patients.id, patientId));

      const [publicado] = await tx.select({ id: mealPlans.id }).from(mealPlans).where(and(eq(mealPlans.patientId, patientId), eq(mealPlans.status, 'publicado')));
      // auditRead do plano dentro (D22), só se há plano; sem a liberação das receitas (o mural não mostra receita)
      const plano = publicado ? await lerPlanoNaTransacao(tx, publicado.id, { comMedidas: false }) : null;

      const diario = await tx
        .select()
        .from(diaryEntries)
        .where(and(eq(diaryEntries.patientId, patientId), or(gte(diaryEntries.dataHora, janela), gte(diaryEntries.comentadoEm, janela))))
        .orderBy(desc(diaryEntries.dataHora))
        .limit(LIMITE_DIARIO_NO_MURAL);
      if (diario.length) await auditRead(tx, { entidade: 'diario', entidadeId: null, patientId });

      const envios = await tx
        .select()
        .from(examSubmissions)
        .where(and(eq(examSubmissions.patientId, patientId), ne(examSubmissions.status, 'cancelado'), or(gte(examSubmissions.createdAt, janela), gte(examSubmissions.updatedAt, janela))))
        .orderBy(desc(examSubmissions.createdAt))
        .limit(20);
      if (envios.length) await auditRead(tx, { entidade: 'exames_enviados', entidadeId: null, patientId });

      const [consulta] = await listarConsultasNaTransacao(
        tx,
        and(eq(appointments.patientId, patientId), inArray(appointments.status, [...STATUS_ATIVOS]), gt(appointments.fim, agora), lt(appointments.inicio, new Date(agora.getTime() + JANELA_MURAL_DIAS * DIA_MS))),
        { ordem: 'asc', limite: 1 },
      );
      const conteudos = await conteudosNovosNaTransacao(tx, patientId, janela, MAX_CONTEUDOS_NO_MURAL);
      const documentosNovos = await novosNoPortalNaTransacao(tx, ctx);

      return {
        primeiroNome: primeiroNome(p?.nome ?? ''),
        plano: plano
          ? {
              publicadoEm: plano.publicadoEm ? new Date(plano.publicadoEm) : null,
              // RN-247 (b) / CS-233: só as refeições que valem hoje no fuso do consultório (projeção fechada, RN-240)
              refeicoes: refeicoesDoDia(plano.refeicoes, diaDaSemanaNoFuso(agora, tenant.fuso)).map((r) => ({
                id: r.id,
                nome: r.nome,
                horario: r.horario,
                itens: r.itens.filter((i) => i.substituiItemId === null).map((i) => ({ nome: i.nome })),
              })),
            }
          : null,
        diario: diario.map((e) => {
          const r = paraRegistro(e);
          return { id: r.id, dataHora: r.dataHora, refeicao: r.refeicao, texto: r.texto, foto: r.foto, resposta: r.resposta, refeicaoDoPlano: r.refeicaoDoPlano, comentario: r.comentario, comentadoEm: r.comentadoEm };
        }),
        // mudouEm (FontesDoMural): o processamento não é mudança — só a revisão, a expiração e a falha
        envios: envios.map((e) => ({
          id: e.id,
          nome: e.nome,
          enviadoEm: e.createdAt,
          mudouEm: e.status === 'processando' || e.status === 'recebido' ? e.createdAt : (e.revisadoEm ?? e.updatedAt),
          situacao: situacaoParaPaciente(e),
        })),
        consulta: consulta
          ? { id: consulta.id, inicio: consulta.inicio, modalidade: consulta.modalidade, podeConfirmar: consulta.status === 'agendada' && podeAlterarPeloPaciente(consulta.inicio, tenant.cancelamentoMinH, agora) }
          : null,
        conteudos,
        documentosNovos,
      };
    },
    db,
  );
  return comporMural(fontes, agora, tenant.fuso);
}
