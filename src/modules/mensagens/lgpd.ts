/**
 * Plano 25 (RN-445, RN-465, RN-466, RN-467; CH-D2, CH-D25, CH-D41, CH-D59, CH-D74): a conversa do titular na exportação e na
 * anonimização. A conversa é prontuário (CH-D2): nada sai no pedido de exclusão (CH-D25) — só na anonimização, pelo worker,
 * com o titular na anonimização (bloqueado com o prazo vencido no fuso do consultório, ou já anonimizado; a mesma condição
 * do gatilho chat_mensagens_regras e das funções da 0133).
 *
 * Ordem global de travas (RN-447): paciente → conversa → mensagem. O passo (1) trava o paciente FOR UPDATE (serializa com o
 * FOR SHARE do job do anexo, T8) antes da primeira soltura; cada arquivo sai na sua transação (apagarArquivo, como
 * apagarFotosDoDiario); a conversa sai por app_chat_apagar_do_titular, que trava a conversa e depois as mensagens.
 * Nada daqui vai para log além de códigos e ids (RN-470).
 */
import { and, asc, eq, isNotNull, or, sql, type AnyColumn } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { chatConversas, chatMensagens, patients, type FormaTcle, type RiscoChat } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { logger, nomeDoErro, sqlstateDoErro } from '@/lib/logger';
import { apagarArquivo } from '@/modules/plataforma/armazenamento';
import { OPCOES_FORMA_TCLE } from './constantes';

/**
 * Nome e CRN gravados na própria linha da conversa (CH-D74); o `crn` já vem com o prefixo ("CRN-4 12345"). A profissão
 * completa a identificação de quem registrou (Res. CFN 594/2017, art. 8º, II; revisão CFN da T5).
 */
export type CarimboExportado = { nome: string; crn: string; profissao: 'Nutricionista' };
/**
 * RN-467 (CH-D74): a liberação (data, forma do TCLE e quem liberou, com nome e CRN do momento) e a pausa em curso. Uma
 * conversa que só recebeu recados (sem liberação) vem com os campos da liberação nulos.
 */
export type ConversaExportada = {
  liberadaEm: string | null;
  formaDoTcle: string | null;
  liberadaPor: CarimboExportado | null;
  pausadaEm: string | null;
  pausadaPor: CarimboExportado | null;
};
/**
 * RN-467: cada mensagem, na ordem da conversa. `autorNome`/`autorCrn` só nas da nutricionista (o carimbo da linha, RN-475);
 * `respostaADuvidaDe` só na resposta a uma dúvida da IA Nutri; `risco` só na do paciente com sinal de risco, pelo rótulo.
 * O anexo entra na T8 (PR 3).
 */
export type MensagemExportada = {
  criadaEm: string;
  autor: 'paciente' | 'nutricionista';
  autorNome?: string;
  autorCrn?: string;
  texto: string | null;
  recado: boolean;
  respostaADuvidaDe?: string;
  risco?: string;
};

/**
 * O risco gravado na mensagem do paciente (RN-449), como o titular o lê na exportação. Revisão CFN da T5: o rótulo diz que
 * o sinal foi detectado automaticamente pelo app (não é avaliação da nutricionista).
 */
export const ROTULO_RISCO_EXPORTACAO: Record<RiscoChat, string> = {
  emergencia: 'Sinal de risco detectado automaticamente pelo app (emergência)',
  sintoma_agudo: 'Sinal de risco detectado automaticamente pelo app (sintoma agudo)',
  transtorno_alimentar: 'Sinal de risco detectado automaticamente pelo app (alimentação)',
};

const doCarimbo = (nome: string | null, crn: string | null): CarimboExportado | null => (nome && crn ? { nome, crn, profissao: 'Nutricionista' } : null);

/**
 * RN-467: a conversa e as mensagens do titular para o `dados.json`, nos dois escopos (`montarDados`). Leitura incluída
 * explicitamente (o worker lê pela RLS do tenant); nada do Histórico de acessos — o registro é o "exportar" da própria
 * exportação.
 */
export async function mensagensParaExportacao(tx: Tx, patientId: string): Promise<{ conversa: ConversaExportada | null; mensagens: MensagemExportada[] }> {
  const [c] = await tx.select().from(chatConversas).where(eq(chatConversas.patientId, patientId));
  if (!c) return { conversa: null, mensagens: [] };
  const ms = await tx
    .select({
      criadaEm: chatMensagens.criadaEm,
      autor: chatMensagens.autor,
      autorNome: chatMensagens.autorNome,
      autorCrn: chatMensagens.autorCrn,
      texto: chatMensagens.texto,
      recadoId: chatMensagens.recadoId,
      duvidaEm: chatMensagens.duvidaEm,
      risco: chatMensagens.risco,
    })
    .from(chatMensagens)
    .where(eq(chatMensagens.patientId, patientId))
    .orderBy(asc(chatMensagens.criadaEm), asc(chatMensagens.id));
  return {
    conversa: {
      liberadaEm: c.liberadaEm?.toISOString() ?? null,
      formaDoTcle: c.tcleForma ? OPCOES_FORMA_TCLE[c.tcleForma as FormaTcle] : null,
      liberadaPor: doCarimbo(c.liberadaNome, c.liberadaCrn),
      pausadaEm: c.pausadaEm?.toISOString() ?? null,
      pausadaPor: doCarimbo(c.pausadaNome, c.pausadaCrn),
    },
    mensagens: ms.map((m) => ({
      criadaEm: m.criadaEm.toISOString(),
      autor: m.autor === 'nutri' ? ('nutricionista' as const) : ('paciente' as const),
      ...(m.autor === 'nutri' && m.autorNome && m.autorCrn ? { autorNome: m.autorNome, autorCrn: m.autorCrn } : {}),
      texto: m.texto,
      recado: m.recadoId !== null,
      ...(m.duvidaEm ? { respostaADuvidaDe: m.duvidaEm.toISOString() } : {}),
      ...(m.risco ? { risco: ROTULO_RISCO_EXPORTACAO[m.risco as RiscoChat] } : {}),
    })),
  };
}

function exigirWorker(ctx: TenantContext): void {
  if (ctx.role !== 'worker') throw new Error('mensagens: só o contexto worker');
}

/**
 * RN-466: apaga a conversa do titular na anonimização. (1) Numa transação: o paciente FOR UPDATE, a conferência de que ele
 * está na anonimização (senão, recusa: o papel `worker` também roda no processo web, e `bloqueado` dura todo o prazo de
 * guarda) e o anexo ainda em `processando` → `falhou` (o job que estiver convertendo é recusado pelo gatilho ao concluir).
 * (2) Em duas voltas (CH-D59): primeiro cada original, depois cada anexo convertido — cada um no seu apagarArquivo, com o
 * `rm` antes do commit e o ponteiro solto por app_chat_soltar_anexo no naMesmaTransacao (que leva o convertido a `removido`,
 * CH-D41). (3) app_chat_apagar_do_titular: marcadores, mensagens (as cópias de recado inclusive; a linha de `recados` fica)
 * e a conversa. Sem conversa, nada a fazer. Idempotente: uma volta interrompida recomeça do ponto em que parou.
 */
export async function apagarConversaDoTitular(ctx: TenantContext, patientId: string, deps: { db?: Db; dataDir?: string } = {}): Promise<void> {
  exigirWorker(ctx);
  const db = deps.db ?? getDb();
  const doTitular = and(eq(chatMensagens.tenantId, ctx.tenantId), eq(chatMensagens.patientId, patientId));
  const temConversa = await withTenant(
    ctx,
    async (tx) => {
      const [p] = (
        await tx.execute<{ saindo: boolean }>(sql`
          select (p.anonimizado_em is not null
                  or (p.status = 'bloqueado' and p.anonimizar_apos < (now() at time zone t.fuso)::date)) as saindo
            from patients p join tenants t on t.id = p.tenant_id
           where p.tenant_id = ${ctx.tenantId} and p.id = ${patientId}
             for update of p`)
      ).rows;
      if (!p) throw new Error('mensagens: titular fora deste consultório');
      const [c] = await tx
        .select({ id: chatConversas.id })
        .from(chatConversas)
        .where(and(eq(chatConversas.tenantId, ctx.tenantId), eq(chatConversas.patientId, patientId)));
      if (!c) return false;
      if (p.saindo !== true) throw new Error('mensagens: o titular não está na anonimização');
      await tx.update(chatMensagens).set({ anexoStatus: 'falhou', updatedAt: new Date() }).where(and(doTitular, eq(chatMensagens.anexoStatus, 'processando')));
      return true;
    },
    db,
  );
  if (!temConversa) return;
  const apontados = (coluna: AnyColumn) =>
    withTenant(ctx, (tx) => tx.select({ id: chatMensagens.id, caminho: sql<string>`${coluna}` }).from(chatMensagens).where(and(doTitular, isNotNull(coluna))), db);
  // CH-D59: os originais antes dos convertidos (soltar o convertido com o original preso daria 23514 em `removido`)
  for (const coluna of [chatMensagens.anexoOriginalPath, chatMensagens.anexoPath]) {
    for (const m of await apontados(coluna)) {
      await apagarArquivo(ctx, { caminho: m.caminho }, {
        db,
        dataDir: deps.dataDir,
        removerAntesDoCommit: true,
        // revisão da T5 (M2): o ponteiro foi lido numa transação anterior — relido aqui com a mensagem travada; se mudou ou
        // sumiu (o job soltou o original no meio), desiste sem erro (a função recusaria com 42501). O que sobrar, a
        // função do banco recusa no passo (3) e o dia seguinte tenta de novo
        naMesmaTransacao: async (tx) => {
          const [atual] = await tx
            .select({ caminho: sql<string | null>`${coluna}` })
            .from(chatMensagens)
            .where(and(doTitular, eq(chatMensagens.id, m.id)))
            .for('update');
          if (atual?.caminho !== m.caminho) return false;
          await tx.execute(sql`select app_chat_soltar_anexo(${m.id}, ${m.caminho})`);
          return true;
        },
      });
    }
  }
  await withTenant(ctx, (tx) => tx.execute(sql`select app_chat_apagar_do_titular(${patientId})`), db);
}

/**
 * RN-466: reconferência da transação final da anonimização (com o paciente travado), como anexosDoPaciente e
 * pdfsDeDocumentosRestantes — sobrou mensagem do titular com anexo apontado ou em processamento?
 */
export async function anexosDeChatRestantes(tx: Tx, patientId: string): Promise<boolean> {
  const [m] = await tx
    .select({ id: chatMensagens.id })
    .from(chatMensagens)
    .where(
      and(
        eq(chatMensagens.patientId, patientId),
        or(isNotNull(chatMensagens.anexoPath), isNotNull(chatMensagens.anexoOriginalPath), eq(chatMensagens.anexoStatus, 'processando')),
      ),
    )
    .limit(1);
  return !!m;
}

/**
 * RN-466 / §9.9 (volta atrás): rede de limpeza — a imagem anterior ao Plano 25 anonimiza sem conhecer o chat e deixa a
 * conversa de quem já tem `anonimizado_em`. Roda no início de cada tenant em anonimizarVencidos, antes da listagem dos
 * vencidos (molde apagarCadastrosDosAnonimizados); em dia normal, nada a apagar. Erro só no log, com o código.
 */
export async function apagarConversasDosAnonimizados(ctx: TenantContext, deps: { db?: Db; dataDir?: string } = {}): Promise<void> {
  exigirWorker(ctx);
  const db = deps.db ?? getDb();
  // revisão da T5 (M3): o nome e o SQLSTATE do erro (motivoDoErro devolve 'erro' para o erro do Drizzle), nunca a mensagem
  const falhou = (err: unknown) => logger.error({ err: nomeDoErro(err), sqlstate: sqlstateDoErro(err), tenantId: ctx.tenantId }, 'falha ao apagar a conversa de titular anonimizado');
  let ids: { id: string }[];
  try {
    ids = await withTenant(
      ctx,
      (tx) =>
        tx
          .selectDistinct({ id: patients.id })
          .from(patients)
          .innerJoin(chatConversas, and(eq(chatConversas.tenantId, patients.tenantId), eq(chatConversas.patientId, patients.id)))
          .where(isNotNull(patients.anonimizadoEm)),
      db,
    );
  } catch (err) {
    return falhou(err);
  }
  for (const { id } of ids) {
    try {
      await apagarConversaDoTitular(ctx, id, { db, dataDir: deps.dataDir });
    } catch (err) {
      falhou(err);
    }
  }
}
