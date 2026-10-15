import { and, asc, eq, sql } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { iaNutriConsentimentos, iaNutriMensagens, iaNutriParticipacoes, iaUso, patients, tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { DESTINO_ROTULO, type DestinoIA } from '../constantes';
import { estornar, marcarIncerto } from '../cota';
import { MSG_IA_NUTRI, RISCO_REVOGADO_MAX_DIAS, ROTULO_CATEGORIA, type CategoriaConversa } from './constantes';
import { TEXTOS_FIXOS, type CodigoTextoFixo } from './textos';

/** D22: a pergunta com risco que a nutricionista ainda não abriu fica (proteção da vida; a confirmar com o advogado). */
const riscoNaoAberto = sql`(${iaNutriMensagens.autor} = 'paciente' and ${iaNutriMensagens.risco} is not null and ${iaNutriMensagens.encaminhadaEm} is not null and ${iaNutriMensagens.abertaPelaNutriEm} is null and ${iaNutriMensagens.resolvidaEm} is null)`;

/**
 * RN-182 / D30: a reserva da cota de uma pergunta que vai sair (ainda no job, ou que falhou antes da conciliação) — sem a
 * linha, nem o job nem a varredura a acham depois. A que não saiu é estornada; a que saiu fica `incerto` (o provedor pode
 * ter cobrado). Ordem da cota (revogacao-job.ts): paciente (já travado por quem chama) → tenant → mensagens → ia_uso →
 * plataforma. Idempotente (só age sobre `reservado`).
 */
async function conciliarReservas(tx: Tx, tenantId: string, patientId: string, agora: Date): Promise<void> {
  const daCota = () =>
    tx
      .select({ id: iaNutriMensagens.id, enviadoEm: iaNutriMensagens.enviadoEm })
      .from(iaNutriMensagens)
      .innerJoin(iaUso, and(eq(iaUso.tarefaId, iaNutriMensagens.id), eq(iaUso.situacao, 'reservado')))
      .where(eq(iaNutriMensagens.patientId, patientId))
      .orderBy(iaNutriMensagens.id);
  if (!(await daCota()).length) return; // o caso comum: nada reservado, sem a trava do tenant
  await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId)).for('no key update');
  const pendentes = await daCota().for('update', { of: iaNutriMensagens });
  for (const m of pendentes) {
    if (m.enviadoEm) await marcarIncerto(tx, m.id, agora);
    else await estornar(tx, m.id, agora);
  }
}

/**
 * §7.6 / §13.3: pedido de exclusão atendido — no job `exclusao-atendida`, antes do e-mail, com o titular já bloqueado (o
 * gatilho ia_nutri_mensagens_sem_apagar só deixa o worker apagar assim). O consentimento fica (prova, até a anonimização).
 * D22 (LGPD art. 18, VI: a exceção é só a janela curta): a pergunta com risco não aberta que fica recebe as MESMAS regras
 * de app_ia_nutri_revogar — `revogada_em` e `expira_em` ≤ agora + 30 dias —, para ser apagada ao abrir (abrirDuvida, gatilho
 * de DELETE) e virar aviso mínimo sem texto depois de 30 dias (retenção). O paciente travado primeiro (ordem DP-10).
 * Idempotente (o job tenta de novo).
 */
export async function apagarIaNutriDoTitular(ctx: TenantContext, patientId: string, db: Db = getDb()): Promise<void> {
  await withTenant(
    ctx,
    async (tx) => {
      const [p] = await tx.select({ id: patients.id }).from(patients).where(eq(patients.id, patientId)).for('update');
      if (!p) return;
      await conciliarReservas(tx, ctx.tenantId, patientId, new Date());
      await tx.delete(iaNutriMensagens).where(and(eq(iaNutriMensagens.patientId, patientId), sql`not ${riscoNaoAberto}`));
      await tx
        .update(iaNutriMensagens)
        .set({
          revogadaEm: sql`coalesce(${iaNutriMensagens.revogadaEm}, now())`,
          expiraEm: sql`least(${iaNutriMensagens.expiraEm}, now() + ${RISCO_REVOGADO_MAX_DIAS} * interval '1 day')`,
          updatedAt: new Date(),
        })
        .where(and(eq(iaNutriMensagens.patientId, patientId), riscoNaoAberto));
      await tx.delete(iaNutriParticipacoes).where(eq(iaNutriParticipacoes.patientId, patientId));
    },
    db,
  );
}

/**
 * §13.3: na anonimização (worker, depois do UPDATE que grava `anonimizado_em`, na mesma transação — o paciente já travado):
 * o que restou sai (a pergunta com risco da D22 também: a guarda dela acabou com a identificação). O consentimento fica, sem
 * IP, user-agent e conta (app_anonimizar_consentimentos_ia_nutri, antes do UPDATE).
 */
export async function limparIaNutriNaAnonimizacao(tx: Tx, patientId: string): Promise<void> {
  const [t] = await tx.select({ tenantId: patients.tenantId }).from(patients).where(eq(patients.id, patientId));
  if (t) await conciliarReservas(tx, t.tenantId, patientId, new Date());
  await tx.delete(iaNutriMensagens).where(eq(iaNutriMensagens.patientId, patientId));
  await tx.delete(iaNutriParticipacoes).where(eq(iaNutriParticipacoes.patientId, patientId));
}

const AUTOR_ROTULO = { paciente: MSG_IA_NUTRI.autorPaciente, ia: MSG_IA_NUTRI.autorIa, sistema: MSG_IA_NUTRI.autorSistema } as const;
const RISCO_ROTULO = { emergencia: 'Sinal de risco (emergência)', transtorno_alimentar: 'Sinal de risco (alimentação)', modelo: 'Sinal de risco (percebido pela IA)' } as const;

/** Rótulos legíveis da exportação (a avaliação com os textos dos botões do app). */
const AVALIACAO_ROTULO = { ajudou: MSG_IA_NUTRI.ajudou, nao_ajudou: MSG_IA_NUTRI.naoAjudou } as const;
const SITUACAO_DA_DUVIDA = { aberta: 'Aguardando a nutricionista', vista: 'Vista pela nutricionista', encerrada: 'Encerrada' } as const;

export type IaNutriExportado = {
  consentimentos: { evento: string; versao: string | null; destino: string | null; data: string; ip: string | null; userAgent: string | null }[];
  mensagens: {
    data: string;
    autor: string;
    texto: string | null;
    categoria: string | null;
    risco: string | null;
    /** Só na resposta da IA que o paciente avaliou. */
    avaliacao?: string;
    /** Só na pergunta que saiu ao provedor (RN-109). */
    enviadaEm?: string;
    destino?: string | null;
    /** Só na pergunta enviada à nutricionista. */
    enviadaANutricionistaEm?: string;
    situacaoDaDuvida?: string;
  }[];
};

/**
 * §7.6 "Exportação" (US-018, US-046, RN-109; LGPD art. 19, § 3º — cópia integral no tratamento por consentimento): os
 * consentimentos (com IP e user-agent, como `aceitesDoTermo` e `autorizacoesIa`; nulos depois da anonimização) e as
 * mensagens, com rótulos legíveis: a avaliação "Ajudou"/"Não ajudou", e nas perguntas enviadas à nutricionista a data e a
 * situação da dúvida. Datas em ISO 8601 (com a hora), como os outros blocos do `dados.json`. Nunca fontes, motivo técnico,
 * modelo, versão do prompt ou custo (dados técnicos do controlador). O esqueleto da revogação (sem texto, texto fixo nem
 * risco, D32) fica de fora; o aviso mínimo da D22 (só o risco) entra. Na mesma data, a pergunta antes da resposta.
 */
export async function iaNutriParaExportacao(tx: Tx, patientId: string): Promise<IaNutriExportado> {
  const consentimentos = (
    await tx.select().from(iaNutriConsentimentos).where(eq(iaNutriConsentimentos.patientId, patientId)).orderBy(asc(iaNutriConsentimentos.registradoEm), asc(iaNutriConsentimentos.id))
  ).map((c) => ({
    evento: c.evento === 'aceite' ? 'Autorizou' : c.canal === 'nutricionista' ? 'Desativou (pedido registrado pela nutricionista)' : 'Desativou',
    versao: c.versao,
    destino: c.destino ? DESTINO_ROTULO[c.destino as DestinoIA] : null,
    data: c.registradoEm.toISOString(),
    ip: c.ip,
    userAgent: c.userAgent,
  }));
  const mensagens = (
    await tx
      .select()
      .from(iaNutriMensagens)
      .where(and(eq(iaNutriMensagens.patientId, patientId), sql`(${iaNutriMensagens.texto} is not null or ${iaNutriMensagens.textoFixo} is not null or ${iaNutriMensagens.risco} is not null)`))
      .orderBy(asc(iaNutriMensagens.createdAt), sql`${iaNutriMensagens.autor} <> 'paciente'`, asc(iaNutriMensagens.id))
  ).map((m) => ({
    data: m.createdAt.toISOString(),
    autor: AUTOR_ROTULO[m.autor as keyof typeof AUTOR_ROTULO],
    texto: m.texto ?? (m.textoFixo ? TEXTOS_FIXOS[m.textoFixo as CodigoTextoFixo] : null),
    categoria: m.categoria ? ROTULO_CATEGORIA[m.categoria as CategoriaConversa] : null,
    risco: m.risco ? RISCO_ROTULO[m.risco as keyof typeof RISCO_ROTULO] : null,
    ...(m.avaliacao ? { avaliacao: AVALIACAO_ROTULO[m.avaliacao as keyof typeof AVALIACAO_ROTULO] } : {}),
    ...(m.saiuEm ? { enviadaEm: m.saiuEm.toISOString(), destino: m.destino ? DESTINO_ROTULO[m.destino as DestinoIA] : null } : {}),
    ...(m.encaminhadaEm
      ? { enviadaANutricionistaEm: m.encaminhadaEm.toISOString(), situacaoDaDuvida: SITUACAO_DA_DUVIDA[(m.resolucao as 'vista' | 'encerrada' | null) ?? 'aberta'] }
      : {}),
  }));
  return { consentimentos, mensagens };
}
