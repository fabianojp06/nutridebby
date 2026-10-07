import { and, asc, eq, isNotNull, isNull, lt, max, or, sql } from 'drizzle-orm';
import { fromDrizzle, type PgBoss } from 'pg-boss';
import { getDb, type Db, type Tx } from '@/db/client';
import { appointments, consultations, dataExports, diaryEntries, exams, iaTarefas, mealPlans, notifications, patients, privacyRequests, pushSubscriptions, tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { enqueueEmail } from '@/email/queue';
import { getBoss } from '@/jobs/boss';
import { logger } from '@/lib/logger';
import { apagarArquivo, motivoDoErro } from '@/modules/plataforma/armazenamento';
import { recordAudit } from '@/modules/plataforma/audit';
import { buscarTenant, listarTenantsParaVarredura } from '@/modules/plataforma/tenant-status';
import { cancelarFuturasPelaExclusao } from '@/modules/agenda/cancelamento';
import { cancelarTarefas } from '@/modules/ia/cancelar';
import { anonimizarDocumentosDoPaciente, pdfsDeDocumentosRestantes } from '@/modules/documentos/lgpd-documentos';
import { apagarUsoDeConteudo } from '@/modules/conteudo/titular';
import { apagarAcessosDoTitular } from '@/modules/portal/acesso';
import { carregarPacienteParaEscrita } from './base';
import { anonimizarContaSemVinculo, contaSemOutroVinculo } from './conta-titular';
import { apagarConvitesPendentes } from './convite-paciente';
import { formatarData, hojeNoFuso, somarAnos, somarDias } from './datas';

/** P-01: referência da spec (20 anos, Lei 13.787/2018). Validar com CRN/advogado antes do go-live. */
export const PRAZO_GUARDA_ANOS = 20;
/** RNF-08 / §7 privacy_requests: prazo de resposta ao titular. */
export const PRAZO_RESPOSTA_DIAS = 15;

export const MSG_LGPD = {
  confirmarNome: 'Digite o nome do paciente exatamente como está no cadastro para confirmar.',
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
 * para consulta (status `bloqueado`); saem na hora os dados não obrigatórios (opt-ins, convites, inscrições de push) e
 * as consultas futuras (canceladas pelo "sistema", sem aviso ao paciente — fechamento do Plano 05).
 * `anonimizar_apos` = última consulta (ou hoje) + PRAZO_GUARDA_ANOS. Tudo numa transação, com o job
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
      if (!nomeDigitado.trim() || nomeParaConferir(nomeDigitado) !== nomeParaConferir(p.nome))
        throw new LgpdError(MSG_LGPD.confirmarNome);
      const hoje = hojeNoFuso(tenant.fuso, now);
      const [{ ultima }] = await tx
        .select({ ultima: max(consultations.data) })
        .from(consultations)
        .where(eq(consultations.patientId, p.id));
      const anonimizarApos = somarAnos(ultima ?? hoje, PRAZO_GUARDA_ANOS);

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
      // paciente (já travado acima) → tenant → tarefas → ia_uso → plataforma — o tenant antes de cancelarTarefas, como o
      // contrato dela pede
      await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, ctx.tenantId)).for('update');
      await cancelarTarefas(tx, { patientId: p.id, agora: now, por: ctx.actorUserId ?? null });
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

/** Job `exclusao-atendida` (F-13): só ids — o e-mail, o nome e a data saem do banco na hora do aviso. */
export type DadosExclusaoAtendida = { tenantId: string; patientId: string };

/**
 * F-13 (decisão do controlador, débitos pré-go-live): o e-mail "Seu pedido de exclusão de dados foi atendido" diz
 * "Foram apagados agora: as fotos do diário…" — então ele só sai depois que as fotos saíram do disco. Disco com erro:
 * o job tenta de novo (o erro devolvido ao pg-boss leva só o código, nunca o caminho — RNF-11, F-1). Na última
 * tentativa o aviso sai assim mesmo: o titular não fica sem a resposta ao pedido, e a varredura diária
 * (apagarFotosDosBloqueados) termina as fotos. Só para quem está bloqueado e ainda identificado.
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

/** Arquivos em /data ligados ao paciente: laudos, exportações, PDFs de plano e fotos do diário (e originais). */
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
  return [
    ...[...deExames, ...deExportacoes, ...dePlanos].map((e) => e.c!),
    ...(await fotosDoDiario(tx, patientId)).map((f) => f.caminho),
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
    await apagarFotosDosBloqueados(ctx, db, deps);
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
            const r = await tx
              .update(patients)
              .set({
                nome: 'Paciente anonimizado',
                email: sql`'anonimo-' || ${patients.id}::text || '@anonimizado.invalid'`,
                telefoneE164: null,
                dataNascimento: null,
                userId: null,
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
            // rodada 1 (T13): inscrições de push gravadas depois do pedido de exclusão também saem (D14: só as do vínculo)
            if (r.length) await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.patientId, id));
            // D15: alvo, visualização ou favorito de conteúdo gravados depois do bloqueio também saem (idempotente)
            if (r.length) await apagarUsoDeConteudo(tx, id);
            // D13: acessos ao portal gravados depois do bloqueio também saem
            if (r.length) await apagarAcessosDoTitular(tx, id);
            // Plano 11 (§5.3, RNF-110): a única exclusão de ia_tarefas — no contexto worker (gatilho ia_tarefas_sem_apagar).
            // O registro técnico sem titular continua em ia_uso; o que foi aplicado já está em exams.valores (prontuário).
            if (r.length) await tx.delete(iaTarefas).where(eq(iaTarefas.patientId, id));
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
