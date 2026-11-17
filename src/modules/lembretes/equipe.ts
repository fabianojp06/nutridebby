/**
 * Plano 17 (§5.3, §5.4): os lembretes de rotina de um paciente pela equipe — o que a seção "Lembretes no app" da aba
 * Plano alimentar (Tarefa 5) lê, salva, liga/desliga e apaga. Sempre pela sessão `nutri` (withTenant com ator e IP).
 *
 * A marca do paciente (`desligado_pelo_paciente_em`) e a pausa geral (`patients.lembretes_pausados_em`) nunca entram num
 * `set()` daqui: o Date do JS perde os microssegundos do clock_timestamp() e o gatilho (0119) recusaria com 42501.
 */
import { and, asc, count, desc, eq } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { uniqueViolation } from '@/db/errors';
import { lembretesRotina, mealPlans, meals, patients, pushSubscriptions, type LembreteRotinaRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { partesNoFuso } from '@/modules/agenda/fuso';
import { carregarPacienteParaEscrita, idValido, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { auditRead } from '@/modules/plataforma/audit';
import { sugestaoInicial, validarLembrete, type LembreteNovo } from './config';
import { MAX_LIVRES, MAX_SUPLEMENTOS, MSG_LEMBRETES, TETO_POR_DIA } from './constantes';
import { maiorDiaDaSemana, planoDoDia, type LembreteParaSlots, type RefeicaoDoPlano, type TipoSlot } from './slots';

export type LembreteNaEquipe = LembreteNovo & { id: string; ligado: boolean; desligadoPeloPacienteEm: Date | null };
export type VisaoDaEquipe = {
  lembretes: LembreteNaEquipe[];
  /** Só na primeira visão (paciente sem nenhum lembrete): a sugestão de §5.4, que só vale depois de "Salvar". */
  sugestao: LembreteNovo[] | null;
  previstoHoje: number;
  cortadosHoje: { total: number; tipos: TipoSlot[] };
  refeicoesSemHorario: string[];
  refeicoesForaDaJanela: string[];
  planoPublicado: boolean;
  aparelhosComNotificacao: number;
  pausadoEm: Date | null;
};

/** Mensagens de `salvarLembrete`, `ligarLembrete` e `apagarLembrete` (chave `geral`, junto do botão). */
export const MSG_EQUIPE = {
  teto: `Com este lembrete, o paciente receberia mais de ${TETO_POR_DIA} avisos em um dia. Diminua os horários ou aumente o intervalo da água.`,
  suplementos: `Você já tem ${MAX_SUPLEMENTOS} suplementos. Apague um para adicionar outro.`,
  livres: `Você já tem ${MAX_LIVRES} lembretes livres. Apague um para adicionar outro.`,
  jaExiste: 'Este paciente já tem esse lembrete. Edite o que existe.',
  naoEncontrado: 'Lembrete não encontrado. Recarregue a página.',
  desligadoPeloPaciente: 'O paciente desligou este lembrete. Você pode desligá-lo do seu lado, mas não apagá-lo.',
  /** A edição não troca o tipo (coluna fixa no gatilho 0119). */
  tipo: MSG_LEMBRETES.formulario,
} as const;

/** Erros por campo para o formulário (chaves de `validarLembrete` e `geral`). Nunca levam texto do paciente. */
export class LembreteError extends Error {
  override name = 'LembreteError';
  constructor(public erros: Record<string, string>) {
    super('Lembrete inválido');
  }
}

const ORDEM_TIPO: Record<LembreteNovo['tipo'], number> = { agua: 0, refeicoes: 1, suplemento: 2, livre: 3 };

/** A linha como o lembrete do formulário (o `config` foi validado por `validarLembrete` ao salvar). */
function comoLembrete(r: LembreteRotinaRow): LembreteNovo {
  const tipo = r.tipo as LembreteNovo['tipo'];
  if (tipo === 'suplemento' || tipo === 'livre') return { tipo, config: r.config, texto: r.texto ?? '' } as LembreteNovo;
  return { tipo, config: r.config } as LembreteNovo;
}

/** Para o cálculo dos slots: sem o texto (que não entra no plano do dia). */
function paraSlots(r: LembreteRotinaRow, ativo: boolean): LembreteParaSlots {
  return { id: r.id, ativo, tipo: r.tipo, config: r.config } as LembreteParaSlots;
}

const lembretesDe = (tx: Tx, patientId: string) =>
  tx.select().from(lembretesRotina).where(eq(lembretesRotina.patientId, patientId)).orderBy(asc(lembretesRotina.createdAt), asc(lembretesRotina.id));

/** Refeições do plano publicado (na ordem do plano), com o horário como o banco devolve; null sem plano publicado. */
async function refeicoesDoPlanoPublicado(tx: Tx, patientId: string): Promise<RefeicaoDoPlano[] | null> {
  const [plano] = await tx
    .select({ id: mealPlans.id })
    .from(mealPlans)
    .where(and(eq(mealPlans.patientId, patientId), eq(mealPlans.status, 'publicado')))
    .orderBy(desc(mealPlans.versao))
    .limit(1);
  if (!plano) return null;
  return tx.select({ nome: meals.nome, horario: meals.horario }).from(meals).where(eq(meals.planId, plano.id)).orderBy(asc(meals.ordem));
}

/**
 * Visão da seção do painel. Lê pela sessão da equipe e registra a leitura (`auditRead`, entidade `lembretes`) quando
 * devolve lembretes — o nome do suplemento e o texto livre são parte da conduta. O previsto para hoje (no fuso do
 * tenant) conta só o que sairia: lembrete ligado pelas duas partes e sem pausa geral; os avisos das refeições sem
 * horário ou fora da janela valem para o lembrete de refeições que existir, ligado ou não.
 */
export async function lembretesDoPaciente(ctx: TenantContext, patientId: string, tenant: { fuso: string }, deps: { db?: Db; agora?: Date } = {}): Promise<VisaoDaEquipe> {
  if (!idValido(patientId)) throw new PacienteNaoEncontradoError();
  return withTenant(
    ctx,
    async (tx) => {
      const [p] = await tx.select({ pausadoEm: patients.lembretesPausadosEm }).from(patients).where(eq(patients.id, patientId));
      if (!p) throw new PacienteNaoEncontradoError();
      const linhas = (await lembretesDe(tx, patientId)).sort((a, b) => ORDEM_TIPO[a.tipo as LembreteNovo['tipo']] - ORDEM_TIPO[b.tipo as LembreteNovo['tipo']]);
      const refeicoes = await refeicoesDoPlanoPublicado(tx, patientId);
      const [{ aparelhos }] = await tx.select({ aparelhos: count() }).from(pushSubscriptions).where(eq(pushSubscriptions.patientId, patientId));
      if (linhas.length) await auditRead(tx, { entidade: 'lembretes', entidadeId: null, patientId });

      const data = partesNoFuso(deps.agora ?? new Date(), tenant.fuso).data;
      const hoje = planoDoDia({
        lembretes: linhas.map((r) => paraSlots(r, r.ligado && r.desligadoPeloPacienteEm === null && p.pausadoEm === null)),
        refeicoes: refeicoes ?? [],
        data,
        fuso: tenant.fuso,
      });
      const lembreteDeRefeicoes = linhas.find((r) => r.tipo === 'refeicoes');
      const avisos = lembreteDeRefeicoes ? planoDoDia({ lembretes: [paraSlots(lembreteDeRefeicoes, true)], refeicoes: refeicoes ?? [], data, fuso: tenant.fuso }) : null;

      return {
        lembretes: linhas.map((r) => ({ id: r.id, ...comoLembrete(r), ligado: r.ligado, desligadoPeloPacienteEm: r.desligadoPeloPacienteEm })),
        sugestao: linhas.length ? null : sugestaoInicial(),
        previstoHoje: hoje.slots.length,
        cortadosHoje: hoje.cortados,
        refeicoesSemHorario: avisos?.refeicoesSemHorario ?? [],
        refeicoesForaDaJanela: avisos?.refeicoesForaDaJanela ?? [],
        planoPublicado: refeicoes !== null,
        aparelhosComNotificacao: aparelhos,
        pausadoEm: p.pausadoEm,
      };
    },
    deps.db ?? getDb(),
  );
}

/** `id` do formulário: ausente ou vazio = lembrete novo. */
function idDaEdicao(input: unknown): string | null | undefined {
  const id = typeof input === 'object' && input !== null ? (input as { id?: unknown }).id : undefined;
  if (id === undefined || id === null || id === '') return null;
  return idValido(id) ? id : undefined; // undefined: id que não é de lembrete nenhum
}

/**
 * Cria (sem `id`) ou edita (com `id`) um lembrete. Trava o paciente (recusa bloqueado/anonimizado), aplica os limites
 * (uma água e um de refeições, até 5 suplementos e 5 livres) e o teto de 24 avisos no maior dia da semana — contando
 * todos os lembretes do paciente como ativos (inclusive os desligados pela equipe ou pelo paciente, com o editado no
 * lugar do antigo) e as refeições do plano publicado; por isso ligar e religar nunca passam do teto. A edição não muda
 * o tipo, `ligado` nem a marca do paciente.
 */
export async function salvarLembrete(ctx: TenantContext, patientId: string, input: unknown, tenant: { fuso: string }, deps: { db?: Db } = {}): Promise<{ id: string }> {
  const v = validarLembrete(input);
  if (!v.ok) throw new LembreteError(v.erros);
  const lembrete = v.valor;
  const idEditado = idDaEdicao(input);
  if (idEditado === undefined) throw new LembreteError({ geral: MSG_EQUIPE.naoEncontrado });
  if (!ctx.actorUserId) throw new Error('salvarLembrete: sessão sem usuária');
  const criadoPor = ctx.actorUserId;
  const texto = lembrete.tipo === 'suplemento' || lembrete.tipo === 'livre' ? lembrete.texto : null;

  try {
    return await withTenant(
      ctx,
      async (tx) => {
        await carregarPacienteParaEscrita(tx, patientId);
        const linhas = await lembretesDe(tx, patientId);
        const atual = idEditado ? linhas.find((r) => r.id === idEditado) : undefined;
        if (idEditado && !atual) throw new LembreteError({ geral: MSG_EQUIPE.naoEncontrado });
        if (atual && atual.tipo !== lembrete.tipo) throw new LembreteError({ tipo: MSG_EQUIPE.tipo });

        const outros = linhas.filter((r) => r.id !== idEditado);
        const doTipo = outros.filter((r) => r.tipo === lembrete.tipo).length;
        if ((lembrete.tipo === 'agua' || lembrete.tipo === 'refeicoes') && doTipo > 0) throw new LembreteError({ geral: MSG_EQUIPE.jaExiste });
        if (lembrete.tipo === 'suplemento' && doTipo >= MAX_SUPLEMENTOS) throw new LembreteError({ geral: MSG_EQUIPE.suplementos });
        if (lembrete.tipo === 'livre' && doTipo >= MAX_LIVRES) throw new LembreteError({ geral: MSG_EQUIPE.livres });

        const maior = maiorDiaDaSemana({
          lembretes: [...outros.map((r) => paraSlots(r, true)), { ...lembrete, id: idEditado ?? 'novo', ativo: true }],
          refeicoes: (await refeicoesDoPlanoPublicado(tx, patientId)) ?? [],
          fuso: tenant.fuso,
        });
        if (maior > TETO_POR_DIA) throw new LembreteError({ geral: MSG_EQUIPE.teto });

        if (atual) {
          // nunca `desligadoPeloPacienteEm` aqui (ver o cabeçalho); `updatedAt` novo = o worker não manda slot anterior à edição
          await tx
            .update(lembretesRotina)
            .set({ config: lembrete.config, texto, updatedAt: new Date() })
            .where(and(eq(lembretesRotina.id, atual.id), eq(lembretesRotina.patientId, patientId)));
          return { id: atual.id };
        }
        const [novo] = await tx
          .insert(lembretesRotina)
          .values({ tenantId: ctx.tenantId, patientId, tipo: lembrete.tipo, config: lembrete.config, texto, criadoPor })
          .returning({ id: lembretesRotina.id });
        return novo;
      },
      deps.db ?? getDb(),
    );
  } catch (e) {
    // a trava do paciente serializa os salvamentos; o índice único é a segunda linha
    if (uniqueViolation(e) === 'lembretes_rotina_um_por_tipo') throw new LembreteError({ geral: MSG_EQUIPE.jaExiste });
    throw e;
  }
}

/** O lembrete do paciente, travado, na transação que já travou o paciente. */
async function lembreteParaEscrita(tx: Tx, patientId: string, id: string): Promise<LembreteRotinaRow> {
  const [r] = idValido(id)
    ? await tx.select().from(lembretesRotina).where(and(eq(lembretesRotina.id, id), eq(lembretesRotina.patientId, patientId))).for('update')
    : [];
  if (!r) throw new LembreteError({ geral: MSG_EQUIPE.naoEncontrado });
  return r;
}

/**
 * Interruptor da equipe: muda só `ligado` (a escolha do paciente fica como está). Não confere o teto: `salvarLembrete`
 * já conta os desligados. `updatedAt` novo: o worker não manda, ao religar, um slot de antes do religamento.
 */
export async function ligarLembrete(ctx: TenantContext, patientId: string, id: string, ligado: boolean, deps: { db?: Db } = {}): Promise<void> {
  await withTenant(
    ctx,
    async (tx) => {
      await carregarPacienteParaEscrita(tx, patientId);
      await lembreteParaEscrita(tx, patientId, id);
      await tx.update(lembretesRotina).set({ ligado, updatedAt: new Date() }).where(and(eq(lembretesRotina.id, id), eq(lembretesRotina.patientId, patientId)));
    },
    deps.db ?? getDb(),
  );
}

/**
 * Apaga o lembrete. O que o paciente desligou não é apagado pela equipe (autonomia do titular): ela pode desligá-lo do
 * lado dela. O gatilho lembretes_rotina_sem_apagar (0120) é a segunda linha.
 */
export async function apagarLembrete(ctx: TenantContext, patientId: string, id: string, deps: { db?: Db } = {}): Promise<void> {
  await withTenant(
    ctx,
    async (tx) => {
      await carregarPacienteParaEscrita(tx, patientId);
      const r = await lembreteParaEscrita(tx, patientId, id);
      if (r.desligadoPeloPacienteEm !== null) throw new LembreteError({ geral: MSG_EQUIPE.desligadoPeloPaciente });
      await tx.delete(lembretesRotina).where(and(eq(lembretesRotina.id, id), eq(lembretesRotina.patientId, patientId)));
    },
    deps.db ?? getDb(),
  );
}
