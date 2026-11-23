import { and, asc, eq, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { fromDrizzle, type PgBoss } from 'pg-boss';
import { getDb, type Db, type Tx } from '@/db/client';
import {
  appointments,
  dataExports,
  diaryEntries,
  examSubmissionFiles,
  examSubmissions,
  exams,
  iaAutorizacoes,
  iaTarefas,
  lembretesRotina,
  mealPlans,
  notifications,
  patientCadastro,
  patients,
  privacyRequests,
  pushSubscriptions,
} from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { enqueueEmail } from '@/email/queue';
import { getBoss } from '@/jobs/boss';
import { logger } from '@/lib/logger';
import { apagarArquivo, motivoDoErro } from '@/modules/plataforma/armazenamento';
import { recordAudit } from '@/modules/plataforma/audit';
import { buscarTenant, listarTenantsParaVarredura } from '@/modules/plataforma/tenant-status';
import { cancelarFuturasPelaExclusao } from '@/modules/agenda/cancelamento';
import { cancelarTarefas } from '@/modules/ia/cancelar';
import { apagarIaNutriDoTitular, limparIaNutriNaAnonimizacao } from '@/modules/ia/nutri-paciente/lgpd';
import { anonimizarDocumentosDoPaciente, pdfsDeDocumentosRestantes } from '@/modules/documentos/lgpd-documentos';
import { apagarUsoDeConteudo } from '@/modules/conteudo/titular';
import { anexosDeChatRestantes, apagarConversaDoTitular, apagarConversasDosAnonimizados } from '@/modules/mensagens/lgpd';
import { temLancamentos } from '@/modules/financeiro/titular';
import { apagarAcessosDoTitular } from '@/modules/portal/acesso';
import { carregarPacienteParaEscrita } from './base';
import { anonimizarContaSemVinculo, contaSemOutroVinculo } from './conta-titular';
import { apagarConvitesPendentes } from './convite-paciente';
import { formatarData, hojeNoFuso, somarAnos, somarDias } from './datas';

/**
 * P-01: referência da spec (20 anos, Lei 13.787/2018; Res. CFN 594/2017, art. 3º, VI, "b"). Validar com CRN/advogado antes do
 * go-live. Conta do último registro do prontuário — a data do bloqueio (JUR-01, atenderPedidoExclusao). A migration 0110 usa
 * o mesmo número.
 */
export const PRAZO_GUARDA_ANOS = 20;
/** RNF-08 / §7 privacy_requests: prazo de resposta ao titular. */
export const PRAZO_RESPOSTA_DIAS = 15;

export const MSG_LGPD = {
  confirmarNome: 'Digite o nome do paciente exatamente como está no cadastro para confirmar.',
  /** Plano 18 (D7, RN-266): com nome social, a instrução pede e mostra o nome de registro (a conferência é com `patients.nome`). */
  confirmarNomeDeRegistro: (nome: string) => `Digite o nome de registro do paciente (${nome}) exatamente como está no cadastro para confirmar.`,
} as const;

export class LgpdError extends Error {
  override name = 'LgpdError';
}

/** RN-08: o prontuário fica; portal, notificações e audiências leem o status (Planos 05, 06 e 07). */
export async function arquivarPaciente(
  ctx: TenantContext,
  patientId: string,
  db: Db = getDb(),
): Promise<void> {
  await withTenant(
    ctx,
    async (tx) => {
      const p = await carregarPacienteParaEscrita(tx, patientId);
      if (p.status !== 'ativo') return;
      await tx
        .update(patients)
        .set({ status: 'arquivado', updatedAt: new Date() })
        .where(eq(patients.id, p.id));
      await apagarConvitesPendentes(tx, ctx.tenantId, p.id);
    },
    db,
  );
}

export async function desarquivarPaciente(
  ctx: TenantContext,
  patientId: string,
  db: Db = getDb(),
): Promise<void> {
  await withTenant(
    ctx,
    async (tx) => {
      const p = await carregarPacienteParaEscrita(tx, patientId); // bloqueado → PacienteBloqueadoError
      if (p.status === 'arquivado')
        await tx
          .update(patients)
          .set({ status: 'ativo', updatedAt: new Date() })
          .where(eq(patients.id, p.id));
    },
    db,
  );
}

const nomeParaConferir = (s: string) =>
  s.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');

/**
 * US-018 "Pedido de exclusão durante o prazo de guarda": o prontuário clínico fica identificado e só
 * para consulta (status `bloqueado`); saem na hora os dados não obrigatórios (opt-ins, convites, inscrições de push, lembretes de rotina) e
 * as consultas futuras (canceladas pelo "sistema", sem aviso ao paciente — fechamento do Plano 05).
 * `anonimizar_apos` = data do bloqueio (hoje no fuso do consultório) + PRAZO_GUARDA_ANOS — JUR-01 (decisão do dono,
 * 09/10/2026; Res. CFN 594/2017, art. 3º, VI, "b"): o prazo conta do último registro do prontuário, e no pedido de
 * exclusão o último registro é o próprio bloqueio (a 0110 recalculou quem já estava bloqueado). Tudo numa transação, com o job
 * `exclusao-atendida` na fila. As fotos do diário saem logo depois, por apagarFotosDoDiario (arquivo fora da
 * transação): no próprio job e, como rede de segurança, no job diário.
 * F-13: o e-mail ao paciente ("Foram apagados agora: as fotos do diário…") sai pelo job, só depois das fotos
 * (concluirExclusaoAtendida); o job nasce nesta transação, então o aviso nunca se perde.
 */
export async function atenderPedidoExclusao(
  ctx: TenantContext,
  tenant: { fuso: string; nomeExibicao: string },
  patientId: string,
  nomeDigitado: string,
  deps: { db?: Db; now?: Date; boss?: PgBoss } = {},
): Promise<{ anonimizarApos: string }> {
  const now = deps.now ?? new Date();
  const boss = deps.boss ?? (await getBoss());
  return withTenant(
    ctx,
    async (tx) => {
      const p = await carregarPacienteParaEscrita(tx, patientId);
      if (!nomeDigitado.trim() || nomeParaConferir(nomeDigitado) !== nomeParaConferir(p.nome)) {
        // Plano 18 (D7, RN-266): com nome social, o erro pede o nome de registro, como a instrução da Privacidade
        const [c] = await tx.select({ nomeSocial: patientCadastro.nomeSocial }).from(patientCadastro).where(eq(patientCadastro.patientId, p.id));
        throw new LgpdError(c?.nomeSocial ? MSG_LGPD.confirmarNomeDeRegistro(p.nome) : MSG_LGPD.confirmarNome);
      }
      const hoje = hojeNoFuso(tenant.fuso, now);
      // JUR-01: o bloqueio é o último registro do prontuário — depois dele nada mais é registrado —, então o prazo de
      // guarda conta de hoje (a data do bloqueio no fuso do consultório), não da última consulta
      const anonimizarApos = somarAnos(hoje, PRAZO_GUARDA_ANOS);

      const [aberto] = await tx
        .select({ id: privacyRequests.id })
        .from(privacyRequests)
        .where(
          and(
            eq(privacyRequests.patientId, p.id),
            eq(privacyRequests.tipo, 'exclusao'),
            eq(privacyRequests.status, 'aberto'),
          ),
        )
        .for('update');
      if (aberto)
        await tx
          .update(privacyRequests)
          .set({ status: 'concluido', concluidoEm: now })
          .where(eq(privacyRequests.id, aberto.id));
      else {
        await tx.insert(privacyRequests).values({
          tenantId: ctx.tenantId,
          patientId: p.id,
          tipo: 'exclusao',
          status: 'concluido',
          prazo: somarDias(hoje, PRAZO_RESPOSTA_DIAS),
          concluidoEm: now,
          createdAt: now,
        });
      }
      await tx
        .update(patients)
        .set({
          status: 'bloqueado',
          bloqueadoEm: now,
          anonimizarApos,
          whatsappOptinEm: null,
          whatsappOptinOrigem: null,
          whatsappOptoutEm: now,
          // Plano 17: a pausa dos lembretes sai neste mesmo UPDATE que leva a `bloqueado` — a única limpeza que o gatilho
          // patients_lembretes_do_paciente (0119) deixa à sessão `nutri`
          lembretesPausadosEm: null,
          updatedAt: now,
        })
        .where(eq(patients.id, p.id));
      await apagarConvitesPendentes(tx, ctx.tenantId, p.id);
      // decisão do dono (fechamento do Plano 05): consultas futuras canceladas pelo "sistema", sem aviso ao paciente; a
      // nutricionista recebe um aviso. Depois, nada mais pendente sai para o paciente bloqueado (o envio já ignoraria —
      // RN-08 —, mas fica explícito e sem texto cifrado na fila): lembretes, respostas "1"/"2", convite por WhatsApp
      await cancelarFuturasPelaExclusao(tx, { tenantId: ctx.tenantId, patientId: p.id, nome: p.nome }, now);
      await tx
        .update(notifications)
        .set({ status: 'ignorada', motivoIgnorada: 'paciente_inativo', conteudoSelado: null, updatedAt: now })
        .where(and(eq(notifications.patientId, p.id), eq(notifications.status, 'pendente')));
      // US-018: "inscrições de push … apagadas na hora" (só as deste vínculo — D14)
      await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.patientId, p.id));
      await apagarUsoDeConteudo(tx, p.id); // D15: sai das audiências de conteúdo (US-018), sem uso em conteúdo (RNF-08)
      await apagarAcessosDoTitular(tx, p.id); // D13: acessos ao portal (CS-02) são dado de uso, não obrigatório (RNF-08)
      // Plano 11 (spec §5.3): leituras de IA na fila canceladas (reserva estornada) e sugestões esvaziadas na hora; as que
      // estão em processamento falham no worker (RN-100 de novo: paciente bloqueado). Ordem de travas da cota (cota.ts):
      // paciente (já travado acima) → tenant (travado por cancelarTarefas) → tarefas → ia_uso → plataforma
      await cancelarTarefas(tx, { tenantId: ctx.tenantId, patientId: p.id, agora: now, por: ctx.actorUserId ?? null });
      // Plano 17 (§5.5): a configuração dos lembretes é ajuste do app, não prontuário. A conduta (plano alimentar, receita do
      // suplemento) fica nos registros próprios (Res. CFN 594/2017; Res. CFN 656/2020, art. 3º, XI e XII). Por isso a equipe
      // apaga de fato, e a exclusão atendida apaga na hora, como as notificações no aparelho e as conversas da IA Nutri (termo
      // do paciente 1.0, parágrafo "Algumas coisas saem logo: …", termo-paciente-textos.ts); o `audit_log` guarda quem criou,
      // alterou e excluiu, sem o conteúdo. A marca do último envio (lembretes_rotina_envios) sai em cascata. Duas condições
      // de ordem: (1) depois do UPDATE que leva a `bloqueado` — o gatilho lembretes_rotina_sem_apagar (0120) só deixa a
      // sessão `nutri` apagar o lembrete que o paciente desligou com o titular já `bloqueado`; (2) depois da trava do tenant
      // (cancelarTarefas, FOR NO KEY UPDATE) — ordem paciente → tenant → linhas, porque o `marcar` do worker dos lembretes
      // segura o tenant FOR SHARE antes de gravar a marca (KEY SHARE no lembrete pela FK); apagar antes faria um ciclo.
      await tx.delete(lembretesRotina).where(eq(lembretesRotina.patientId, p.id));
      await recordAudit(tx, {
        acao: 'bloquear',
        entidade: 'patients',
        entidadeId: p.id,
        patientId: p.id,
      });
      const dados: DadosExclusaoAtendida = { tenantId: ctx.tenantId, patientId: p.id };
      const job = await boss.send('exclusao-atendida', dados, { db: fromDrizzle(tx, sql) });
      if (!job) throw new Error('A fila recusou o aviso da exclusão');
      return { anonimizarApos };
    },
    deps.db ?? getDb(),
  );
}

/** Plano 06: os registros do diário com foto (convertida ou original) do paciente. */
async function fotosDoDiario(tx: Tx, patientId: string): Promise<{ id: string; caminho: string }[]> {
  const r = await tx
    .select({ id: diaryEntries.id, foto: diaryEntries.fotoPath, original: diaryEntries.fotoOriginalPath })
    .from(diaryEntries)
    .where(and(eq(diaryEntries.patientId, patientId), or(isNotNull(diaryEntries.fotoPath), isNotNull(diaryEntries.fotoOriginalPath))));
  return r.flatMap((e) => [e.foto, e.original].filter((c): c is string => c !== null).map((caminho) => ({ id: e.id, caminho })));
}

/**
 * US-018 "fotos do diário … apagadas na hora" (Plano 06): o registro fica (prontuário guardado), sem a foto
 * (`foto_status = 'removida'`). Chamado depois de atenderPedidoExclusao (arquivo fora da transação) e, como rede de
 * segurança, pelo job diário de retenção para quem está bloqueado. Idempotente. O arquivo sai do disco antes do
 * commit (como na anonimização): se o `rm` falhar, o registro continua apontando e a próxima varredura tenta de novo.
 */
export async function apagarFotosDoDiario(
  ctx: TenantContext,
  patientId: string,
  deps: { db?: Db; dataDir?: string } = {},
): Promise<number> {
  const db = deps.db ?? getDb();
  let n = 0;
  for (const f of await withTenant(ctx, (tx) => fotosDoDiario(tx, patientId), db)) {
    const ok = await apagarArquivo(ctx, { caminho: f.caminho }, {
      db,
      dataDir: deps.dataDir,
      removerAntesDoCommit: true,
      naMesmaTransacao: async (tx) => {
        await tx
          .update(diaryEntries)
          .set({
            fotoPath: sql`case when ${diaryEntries.fotoPath} = ${f.caminho} then null else ${diaryEntries.fotoPath} end`,
            fotoOriginalPath: sql`case when ${diaryEntries.fotoOriginalPath} = ${f.caminho} then null else ${diaryEntries.fotoOriginalPath} end`,
            fotoStatus: 'removida',
            updatedAt: new Date(),
          })
          .where(eq(diaryEntries.id, f.id));
        return true;
      },
    });
    if (ok) n++;
  }
  return n;
}

/**
 * §13.3 (US-018): os envios de exame do titular bloqueado (pedido de exclusão atendido) ou anonimizado — cada arquivo (PDF
 * limpo, originais e páginas) no seu apagarArquivo, com o `rm` antes do commit (como as fotos do diário; o ponteiro do PDF
 * limpo sai no naMesmaTransacao, e as linhas de arquivo pela FK em cascata), e depois as linhas dos envios NÃO aceitos (não são
 * prontuário). `todos`: também as dos aceitos (a anonimização as apaga dentro da própria transação). O gatilho
 * exam_submissions_sem_apagar (0102) só deixa o worker apagar, e só com o titular bloqueado ou anonimizado. Idempotente.
 */
export async function apagarEnviosDoTitular(
  ctx: TenantContext,
  patientId: string,
  deps: { db?: Db; dataDir?: string; todos?: boolean } = {},
): Promise<number> {
  const db = deps.db ?? getDb();
  const caminhos = await withTenant(
    ctx,
    async (tx) => [
      ...(
        await tx
          .select({ c: examSubmissions.arquivoPath })
          .from(examSubmissions)
          .where(and(eq(examSubmissions.patientId, patientId), isNotNull(examSubmissions.arquivoPath)))
      ).map((x) => x.c!),
      ...(await tx.select({ c: examSubmissionFiles.arquivoPath }).from(examSubmissionFiles).where(eq(examSubmissionFiles.patientId, patientId))).map((x) => x.c),
    ],
    db,
  );
  let n = 0;
  for (const caminho of caminhos) {
    const ok = await apagarArquivo(ctx, { caminho }, {
      db,
      dataDir: deps.dataDir,
      removerAntesDoCommit: true,
      naMesmaTransacao: async (tx) => {
        await tx
          .update(examSubmissions)
          .set({ arquivoPath: null, updatedAt: new Date() })
          .where(and(eq(examSubmissions.patientId, patientId), eq(examSubmissions.arquivoPath, caminho)));
        return true;
      },
    });
    if (ok) n++;
  }
  await withTenant(
    ctx,
    (tx) => tx.delete(examSubmissions).where(and(eq(examSubmissions.patientId, patientId), deps.todos ? undefined : ne(examSubmissions.status, 'aceito'))),
    db,
  );
  return n;
}

/**
 * US-113 (Plano 14A): os termos em papel da autorização de IA do titular — cada arquivo no seu apagarArquivo, com o `rm`
 * antes do commit e o ponteiro anulado no naMesmaTransacao pela função SECURITY DEFINER (FK NO ACTION; o UPDATE de
 * ia_autorizacoes é revogado do app). Só na anonimização (contexto worker, titular bloqueado): nunca no pedido de exclusão,
 * em que o termo ainda é a prova do consentimento (art. 8º, § 2º). Fora de anexosDoPaciente por causa da FK.
 */
export async function apagarTermosDeAutorizacao(ctx: TenantContext, patientId: string, deps: { db?: Db; dataDir?: string }): Promise<number> {
  const db = deps.db ?? getDb();
  const termos = await withTenant(
    ctx,
    (tx) =>
      tx
        .select({ id: iaAutorizacoes.id, caminho: iaAutorizacoes.arquivoPath })
        .from(iaAutorizacoes)
        .where(and(eq(iaAutorizacoes.patientId, patientId), isNotNull(iaAutorizacoes.arquivoPath))),
    db,
  );
  let apagados = 0;
  for (const t of termos) {
    const ok = await apagarArquivo(ctx, { caminho: t.caminho! }, {
      db,
      dataDir: deps.dataDir,
      removerAntesDoCommit: true,
      naMesmaTransacao: async (tx) =>
        ((await tx.execute(sql`select app_ia_autorizacao_soltar_termo(${t.id}) as ok`)).rows[0] as { ok?: boolean } | undefined)?.ok === true,
    });
    if (ok) apagados++;
  }
  return apagados;
}

/** Com o paciente travado: um termo gravado depois da lista desfaz a anonimização (o dia seguinte tenta de novo). */
export async function termosDeAutorizacaoRestantes(tx: Tx, patientId: string): Promise<boolean> {
  const [t] = await tx
    .select({ id: iaAutorizacoes.id })
    .from(iaAutorizacoes)
    .where(and(eq(iaAutorizacoes.patientId, patientId), isNotNull(iaAutorizacoes.arquivoPath)))
    .limit(1);
  return !!t;
}

/** Job `exclusao-atendida` (F-13): só ids — o e-mail, o nome e a data saem do banco na hora do aviso. */
export type DadosExclusaoAtendida = { tenantId: string; patientId: string };

/**
 * F-13 (decisão do controlador, débitos pré-go-live): o e-mail "Seu pedido de exclusão de dados foi atendido" diz
 * "Foram apagados agora: as fotos do diário…" — então ele só sai depois que as fotos saíram do disco. Disco com erro:
 * o job tenta de novo (o erro devolvido ao pg-boss leva só o código, nunca o caminho — RNF-11, F-1). Na última
 * tentativa o aviso sai assim mesmo: o titular não fica sem a resposta ao pedido, e a varredura diária
 * (apagarFotosDosBloqueados) termina as fotos. Plano 12 (§13.3): os envios de exame não aceitos saem do mesmo jeito
 * (apagarEnviosDoTitular; rede de segurança: apagarEnviosDosBloqueados). Plano 15 (§7.6): as conversas da IA Nutri e a
 * participação também (apagarIaNutriDoTitular), menos a pergunta com risco não aberta (D22). Só para quem está bloqueado e
 * ainda identificado.
 */
export async function concluirExclusaoAtendida(
  data: DadosExclusaoAtendida,
  deps: { db?: Db; dataDir?: string; ultimaTentativa: boolean; boss?: PgBoss },
): Promise<'avisado' | 'ignorado'> {
  const db = deps.db ?? getDb();
  const ctx: TenantContext = { tenantId: data.tenantId, role: 'worker' };
  // antes de apagar qualquer coisa: o job só age sobre quem teve o pedido atendido (bloqueado é definitivo)
  const [p] = await withTenant(
    ctx,
    (tx) =>
      tx
        .select({ email: patients.email, nome: patients.nome, status: patients.status, anonimizarApos: patients.anonimizarApos, anonimizadoEm: patients.anonimizadoEm })
        .from(patients)
        .where(eq(patients.id, data.patientId)),
    db,
  );
  if (!p || p.status !== 'bloqueado' || p.anonimizadoEm || !p.anonimizarApos) return 'ignorado';
  try {
    await apagarFotosDoDiario(ctx, data.patientId, { db, dataDir: deps.dataDir });
  } catch (err) {
    const motivo = motivoDoErro(err);
    logger.error({ motivo, tenantId: data.tenantId, definitivo: deps.ultimaTentativa }, 'falha ao apagar fotos do diário antes do aviso da exclusão');
    if (!deps.ultimaTentativa) throw new Error(`falha ao apagar as fotos do diário (${motivo})`);
  }
  // Plano 12 (§13.3): os envios de exame não aceitos (arquivos e linhas) também saem antes do aviso
  try {
    await apagarEnviosDoTitular(ctx, data.patientId, { db, dataDir: deps.dataDir });
  } catch (err) {
    const motivo = motivoDoErro(err);
    logger.error({ motivo, tenantId: data.tenantId, definitivo: deps.ultimaTentativa }, 'falha ao apagar os envios de exame antes do aviso da exclusão');
    if (!deps.ultimaTentativa) throw new Error(`falha ao apagar os envios de exame (${motivo})`);
  }
  // Plano 15 (§7.6): as conversas da IA Nutri saem antes do aviso, menos a pergunta com risco não aberta (D22)
  try {
    await apagarIaNutriDoTitular(ctx, data.patientId, db);
  } catch (err) {
    const motivo = motivoDoErro(err);
    logger.error({ motivo, tenantId: data.tenantId, definitivo: deps.ultimaTentativa }, 'falha ao apagar as conversas da IA Nutri antes do aviso da exclusão');
    if (!deps.ultimaTentativa) throw new Error(`falha ao apagar as conversas da IA Nutri (${motivo})`);
  }
  const tenant = await buscarTenant(db, data.tenantId);
  await enqueueEmail(
    {
      tipo: 'exclusao_atendida',
      para: p.email,
      nome: p.nome,
      nutri: tenant?.nomeExibicao ?? 'NutriDebby',
      anonimizarApos: formatarData(p.anonimizarApos),
    },
    { tenantId: data.tenantId, boss: deps.boss },
  );
  return 'avisado';
}

/** Quadro "Pedidos do titular" do painel (US-046): os abertos, com o nome e o prazo, prazo mais curto primeiro. */
export async function pedidosDoTitularAbertos(
  ctx: TenantContext,
  db: Db = getDb(),
): Promise<PedidoDoTitularAberto[]> {
  return withTenant(ctx, pedidosDoTitularAbertosNaTransacao, db);
}

export type PedidoDoTitularAberto = { patientId: string; nome: string; tipo: 'exclusao' | 'exportacao'; prazo: string };

export async function pedidosDoTitularAbertosNaTransacao(tx: Tx): Promise<PedidoDoTitularAberto[]> {
  const r = await tx
    .select({ patientId: privacyRequests.patientId, nome: patients.nome, tipo: privacyRequests.tipo, prazo: privacyRequests.prazo })
    .from(privacyRequests)
    .innerJoin(patients, eq(patients.id, privacyRequests.patientId))
    .where(eq(privacyRequests.status, 'aberto'))
    .orderBy(asc(privacyRequests.prazo), asc(patients.nome));
  return r.map((x) => ({ ...x, tipo: x.tipo as 'exclusao' | 'exportacao' }));
}

/** Arquivos em /data ligados ao paciente: laudos, exportações, PDFs de plano, fotos do diário (e originais) e arquivos de envio de exame. */
export async function anexosDoPaciente(tx: Tx, patientId: string): Promise<string[]> {
  const deExames = await tx
    .select({ c: exams.arquivoPath })
    .from(exams)
    .where(and(eq(exams.patientId, patientId), isNotNull(exams.arquivoPath)));
  const deExportacoes = await tx
    .select({ c: dataExports.arquivoPath })
    .from(dataExports)
    .where(and(eq(dataExports.patientId, patientId), isNotNull(dataExports.arquivoPath)));
  const dePlanos = await tx
    .select({ c: mealPlans.pdfPath })
    .from(mealPlans)
    .where(and(eq(mealPlans.patientId, patientId), isNotNull(mealPlans.pdfPath)));
  // Plano 12 (§13.3, defesa): o PDF limpo de envio não aceito e os originais/páginas que tenham sobrado
  const deEnvios = await tx
    .select({ c: examSubmissions.arquivoPath })
    .from(examSubmissions)
    .where(and(eq(examSubmissions.patientId, patientId), isNotNull(examSubmissions.arquivoPath)));
  const arquivosDeEnvios = await tx.select({ c: examSubmissionFiles.arquivoPath }).from(examSubmissionFiles).where(eq(examSubmissionFiles.patientId, patientId));
  return [
    ...[...deExames, ...deExportacoes, ...dePlanos].map((e) => e.c!),
    ...(await fotosDoDiario(tx, patientId)).map((f) => f.caminho),
    ...deEnvios.map((e) => e.c!),
    ...arquivosDeEnvios.map((e) => e.c),
  ];
}

/**
 * D10 (Tarefa 15): textos livres e destinos de mensagem do titular na agenda. O motivo do cancelamento sai; o link da
 * consulta online vira um endereço inválido (o CHECK exige https para online); o número do WhatsApp (`provider_jid`)
 * sai das mensagens; o que ainda estava na fila não sai mais (o convite cifrado é apagado). Horários, situação, canal e
 * tipo ficam (histórico da agenda e métricas, sem identificação).
 */
async function anonimizarAgenda(tx: Tx, patientId: string, now: Date): Promise<void> {
  await tx
    .update(appointments)
    .set({ motivoCancelamento: null, linkOnline: sql`case when ${appointments.modalidade} = 'online' then 'https://anonimizado.invalid' end`, updatedAt: now })
    .where(and(eq(appointments.patientId, patientId), or(isNotNull(appointments.motivoCancelamento), isNotNull(appointments.linkOnline))));
  await tx
    .update(notifications)
    .set({ status: 'ignorada', motivoIgnorada: 'paciente_inativo', conteudoSelado: null, updatedAt: now })
    .where(and(eq(notifications.patientId, patientId), eq(notifications.status, 'pendente')));
  await tx
    .update(notifications)
    .set({ providerJid: null, conteudoSelado: null, updatedAt: now })
    .where(and(eq(notifications.patientId, patientId), or(isNotNull(notifications.providerJid), isNotNull(notifications.conteudoSelado))));
}

/**
 * US-018 "Fim do prazo de guarda": job diário (fila retencao-lgpd). Para cada tenant (§4.1: a varredura
 * parte de `tenants`), anonimiza quem está bloqueado com `anonimizar_apos` já passado no fuso do tenant
 * ("guardado até 15/09/2046; depois dessa data…": no próprio dia 15 ainda não).
 * Primeiro os anexos (fotos do diário inclusive), com o `rm` confirmado antes do commit (se o arquivo não sair do
 * disco, o registro fica e o dia seguinte tenta de novo), depois a identificação — e a conta de login do titular, se
 * ela não tiver outro vínculo (P06-08, D18). Antes, a rede de segurança das fotos do diário de quem está bloqueado
 * (US-018 "apagadas na hora": a Server Action do atendimento pode ter falhado no meio). Um tenant com erro não para os outros.
 */
export async function anonimizarVencidos(
  db: Db,
  now: Date,
  deps: { dataDir?: string } = {},
): Promise<{ anonimizados: number }> {
  let anonimizados = 0;
  for (const t of await listarTenantsParaVarredura(db)) {
    const ctx: TenantContext = { tenantId: t.id, role: 'worker' };
    const hoje = hojeNoFuso(t.fuso, now);
    // Plano 18 (RN-283): a rede do cadastro complementar roda aqui, antes da listagem — o `continue` abaixo pula o tenant
    await apagarCadastrosDosAnonimizados(ctx, db);
    // Plano 25 (RN-466, §9.9): a rede da conversa por mensagens de quem a imagem antiga anonimizou sem conhecer o chat
    await apagarConversasDosAnonimizados(ctx, { db, dataDir: deps.dataDir });
    await apagarFotosDosBloqueados(ctx, db, deps);
    await apagarEnviosDosBloqueados(ctx, db, deps);
    let vencidos: { id: string }[];
    try {
      vencidos = await withTenant(
        ctx,
        (tx) =>
          tx
            .select({ id: patients.id })
            .from(patients)
            .where(
              and(
                eq(patients.status, 'bloqueado'),
                isNull(patients.anonimizadoEm),
                lt(patients.anonimizarApos, hoje),
              ),
            ),
        db,
      );
    } catch (err) {
      logger.error(
        { motivo: motivoDoErro(err), tenantId: t.id },
        'falha ao listar pacientes a anonimizar',
      );
      continue;
    }
    for (const { id } of vencidos) {
      try {
        // RN-140 (c) (Plano 10A): documentos assinados primeiro, pela função de anonimização (nunca por anexosDoPaciente)
        await anonimizarDocumentosDoPaciente(ctx, id, { db, dataDir: deps.dataDir });
        // Plano 12 (§13.3): os envios de exame (arquivos e linhas dos não aceitos), cada arquivo no seu apagarArquivo
        await apagarEnviosDoTitular(ctx, id, { db, dataDir: deps.dataDir });
        // Plano 14A (US-113): os termos em papel da autorização de IA, num passo próprio (FK NO ACTION, função do worker)
        await apagarTermosDeAutorizacao(ctx, id, { db, dataDir: deps.dataDir });
        // Plano 25 (RN-466): a conversa por mensagens — anexos (originais, depois convertidos) e as linhas, pela função do worker
        await apagarConversaDoTitular(ctx, id, { db, dataDir: deps.dataDir });
        for (const caminho of await withTenant(ctx, (tx) => anexosDoPaciente(tx, id), db)) {
          await apagarArquivo(
            ctx,
            { caminho },
            { db, dataDir: deps.dataDir, removerAntesDoCommit: true },
          );
        }
        const feito = await withTenant(
          ctx,
          async (tx) => {
            // outra execução já anonimizou: nada a fazer (idempotente, sem erro)
            const [pendente] = await tx.select({ id: patients.id, userId: patients.userId }).from(patients).where(and(eq(patients.id, id), isNull(patients.anonimizadoEm))).for('update');
            if (!pendente) return false;
            // D13 (Tarefa 15): aceites do termo sem IP e sem a conta — antes do UPDATE, que solta a conta (0065)
            await tx.execute(sql`select app_anonimizar_aceites(${id})`);
            // Plano 20 (RN-316, F-D23): os lançamentos do Financeiro perdem os textos e os em aberto viram cancelados; valor,
            // datas, categoria e forma ficam. Antes do UPDATE (a função exige o paciente ainda não anonimizado) e só com
            // lançamento: a função confere o prazo pelo relógio do banco, e o `now` daqui pode ser outro (testes)
            if (await temLancamentos(tx, id)) await tx.execute(sql`select app_anonimizar_financeiro(${id})`);
            // Plano 14A (US-113): as autorizações de IA ficam (prova), sem IP, user-agent, HMAC e, no canal app, sem a conta
            await tx.execute(sql`select app_anonimizar_autorizacoes_ia(${id})`);
            // Plano 15: os consentimentos da IA Nutri ficam (prova), sem IP, user-agent e conta
            await tx.execute(sql`select app_anonimizar_consentimentos_ia_nutri(${id})`);
            const r = await tx
              .update(patients)
              .set({
                nome: 'Paciente anonimizado',
                email: sql`'anonimo-' || ${patients.id}::text || '@anonimizado.invalid'`,
                telefoneE164: null,
                dataNascimento: null,
                userId: null,
                lembretesPausadosEm: null, // Plano 17: a pausa dos lembretes gravada depois do bloqueio (contexto worker)
                anonimizadoEm: now,
                updatedAt: now,
              })
              .where(and(eq(patients.id, id), isNull(patients.anonimizadoEm)))
              .returning({ id: patients.id });
            // Com o paciente já travado pelo UPDATE: uma exportação gravada depois da lista de anexos
            // desfaz tudo e fica para o dia seguinte, que apaga o ZIP antes (exportacao-job.ts)
            if (r.length && (await anexosDoPaciente(tx, id)).length)
              throw new Error('anexo novo durante a anonimização');
            // RN-140 (c): nenhum PDF de documento (assinado ou preparado) pode ter sobrado
            if (r.length && (await pdfsDeDocumentosRestantes(tx, id))) throw new Error('documento novo durante a anonimização');
            // Plano 14A (US-113): nenhum termo em papel da autorização de IA pode ter sobrado
            if (r.length && (await termosDeAutorizacaoRestantes(tx, id))) throw new Error('termo de autorização novo durante a anonimização');
            // Plano 25 (RN-466): nenhum anexo de chat pode ter sobrado
            if (r.length && (await anexosDeChatRestantes(tx, id))) throw new Error('anexo de chat novo durante a anonimização');
            // Plano 18 (D18, RN-283): o cadastro complementar (CPF, endereço, observação…) sai inteiro — depois do UPDATE
            // acima, que grava anonimizado_em (o gatilho patient_cadastro_sem_apagar só deixa o worker apagar com o titular
            // já anonimizado; o patient_cadastro_titular_ativo recusa gravar de novo). O gatilho de auditoria registra o
            // "excluir" de ator nulo. Manter esta ordem no rebase (os Planos 17 e 20 mexem neste trecho).
            if (r.length) await tx.delete(patientCadastro).where(eq(patientCadastro.patientId, id));
            // Plano 22 (§13.3, /code-review do PR 1): os exames ficam (prontuário), sem o texto livre das versões anteriores
            // (justificativa) e das notas de interpretação — pela função do worker (0128), com o titular já anonimizado
            if (r.length) await tx.execute(sql`select app_anonimizar_exames_textos(${t.id}, ${id})`);
            // rodada 1 (T13): inscrições de push gravadas depois do pedido de exclusão também saem (D14: só as do vínculo)
            if (r.length) await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.patientId, id));
            // Plano 17 (§5.5): os lembretes de rotina gravados depois do bloqueio também saem (as marcas em cascata) — mesma
            // classificação da exclusão atendida (ajuste do app, não prontuário; ver atenderPedidoExclusao)
            if (r.length) await tx.delete(lembretesRotina).where(eq(lembretesRotina.patientId, id));
            // D15: alvo, visualização ou favorito de conteúdo gravados depois do bloqueio também saem (idempotente)
            if (r.length) await apagarUsoDeConteudo(tx, id);
            // D13: acessos ao portal gravados depois do bloqueio também saem
            if (r.length) await apagarAcessosDoTitular(tx, id);
            // Plano 11 (§5.3, RNF-110): a única exclusão de ia_tarefas — no contexto worker (gatilho ia_tarefas_sem_apagar).
            // O registro técnico sem titular continua em ia_uso; o que foi aplicado já está em exams.valores (prontuário).
            if (r.length) await tx.delete(iaTarefas).where(eq(iaTarefas.patientId, id));
            // Plano 15 (§13.3): as conversas da IA Nutri que sobraram (a pergunta com risco da D22) e a participação — contexto
            // worker, titular já anonimizado (gatilho ia_nutri_mensagens_sem_apagar)
            if (r.length) await limparIaNutriNaAnonimizacao(tx, id);
            // Plano 12 (§13.3): as linhas de envio que sobraram (as dos aceitos: o exame já é o prontuário) — contexto worker,
            // titular já anonimizado (gatilho exam_submissions_sem_apagar)
            if (r.length) await tx.delete(examSubmissions).where(eq(examSubmissions.patientId, id));
            if (r.length) await anonimizarAgenda(tx, id, now);
            // P06-08 (D18): a conta de login perde a identificação se não tiver outro vínculo — conferido aqui, na
            // mesma transação, depois do UPDATE que a soltou deste prontuário (a função trava a conta)
            // B-1: conta que não é de paciente fica intacta (bug a montante) — só o aviso, sem dado da conta
            if (r.length && pendente.userId && (await contaSemOutroVinculo(tx, pendente.userId)) && !(await anonimizarContaSemVinculo(tx, pendente.userId, now)))
              logger.warn({ tenantId: t.id }, 'conta do titular anonimizado não é de paciente: conta de login não anonimizada');
            if (r.length)
              await recordAudit(tx, {
                acao: 'anonimizar',
                entidade: 'patients',
                entidadeId: id,
                patientId: id,
              });
            return r.length > 0;
          },
          db,
        );
        if (feito) anonimizados++;
      } catch (err) {
        // Sem nome nem dado do paciente no log (RNF-11); o próximo dia tenta de novo
        logger.error(
          { motivo: motivoDoErro(err), tenantId: t.id },
          'falha ao anonimizar paciente',
        );
      }
    }
  }
  return { anonimizados };
}

/**
 * Plano 18 (RN-283): rede de segurança do cadastro complementar. Na janela do deploy (ou numa volta atrás para a imagem
 * anterior ao Plano 18), a anonimização da imagem antiga marca `anonimizado_em` sem apagar a linha de `patient_cadastro`;
 * esta varredura apaga a linha de todo titular já anonimizado do tenant (idempotente: em dia normal, nada a apagar). Roda
 * no início de cada tenant, num `withTenant` worker próprio, antes da listagem dos vencidos — se a listagem falhar, a rede
 * já passou. Erro só no log, sem dado (RNF-11, RNF-262).
 */
async function apagarCadastrosDosAnonimizados(ctx: TenantContext, db: Db): Promise<void> {
  try {
    await withTenant(
      ctx,
      (tx) =>
        tx.execute(
          sql`delete from patient_cadastro c using patients p where p.tenant_id = c.tenant_id and p.id = c.patient_id and p.anonimizado_em is not null`,
        ),
      db,
    );
  } catch (err) {
    logger.error({ motivo: motivoDoErro(err), tenantId: ctx.tenantId }, 'falha ao apagar o cadastro de titular anonimizado');
  }
}

/** Rede de segurança (US-018): bloqueado com foto no diário perde as fotos; erro só no log, como o resto da varredura. */
async function apagarFotosDosBloqueados(ctx: TenantContext, db: Db, deps: { dataDir?: string }): Promise<void> {
  // Erro de disco leva o caminho na mensagem (RNF-11): no log, só o código
  const falhou = (err: unknown) =>
    logger.error({ motivo: motivoDoErro(err), tenantId: ctx.tenantId }, 'falha ao apagar fotos do diário de paciente bloqueado');
  let comFoto: { id: string }[];
  try {
    comFoto = await withTenant(
      ctx,
      (tx) =>
        tx
          .selectDistinct({ id: patients.id })
          .from(patients)
          .innerJoin(diaryEntries, and(eq(diaryEntries.tenantId, patients.tenantId), eq(diaryEntries.patientId, patients.id)))
          .where(and(eq(patients.status, 'bloqueado'), or(isNotNull(diaryEntries.fotoPath), isNotNull(diaryEntries.fotoOriginalPath)))),
      db,
    );
  } catch (err) {
    return falhou(err);
  }
  for (const { id } of comFoto) {
    try {
      await apagarFotosDoDiario(ctx, id, { db, dataDir: deps.dataDir });
    } catch (err) {
      falhou(err);
    }
  }
}

/** Rede de segurança (§13.3): bloqueado com envio não aceito (o job da exclusão falhou de vez) perde os envios; erro só no log. */
async function apagarEnviosDosBloqueados(ctx: TenantContext, db: Db, deps: { dataDir?: string }): Promise<void> {
  try {
    const comEnvio = await withTenant(
      ctx,
      (tx) =>
        tx
          .selectDistinct({ id: patients.id })
          .from(patients)
          .innerJoin(examSubmissions, and(eq(examSubmissions.tenantId, patients.tenantId), eq(examSubmissions.patientId, patients.id)))
          .where(and(eq(patients.status, 'bloqueado'), ne(examSubmissions.status, 'aceito'))),
      db,
    );
    for (const { id } of comEnvio) await apagarEnviosDoTitular(ctx, id, { db, dataDir: deps.dataDir });
  } catch (err) {
    logger.error({ motivo: motivoDoErro(err), tenantId: ctx.tenantId }, 'falha ao apagar envios de exame de paciente bloqueado');
  }
}
