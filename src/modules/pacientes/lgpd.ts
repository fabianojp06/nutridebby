import { and, asc, eq, isNotNull, isNull, lt, max, or, sql } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { appointments, consultations, dataExports, diaryEntries, exams, mealPlans, notifications, patients, privacyRequests, pushSubscriptions } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { enqueueEmail } from '@/email/queue';
import { logger } from '@/lib/logger';
import { apagarArquivo, motivoDoErro } from '@/modules/plataforma/armazenamento';
import { recordAudit } from '@/modules/plataforma/audit';
import { listarTenantsParaVarredura } from '@/modules/plataforma/tenant-status';
import { cancelarFuturasPelaExclusao } from '@/modules/agenda/cancelamento';
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
 * `anonimizar_apos` = última consulta (ou hoje) + PRAZO_GUARDA_ANOS. Tudo numa transação, com o
 * e-mail ao paciente na fila. As fotos do diário saem logo depois, por apagarFotosDoDiario (arquivo fora da
 * transação; quem chama — a Server Action da aba Privacidade — e, como rede de segurança, o job diário).
 */
export async function atenderPedidoExclusao(
  ctx: TenantContext,
  tenant: { fuso: string; nomeExibicao: string },
  patientId: string,
  nomeDigitado: string,
  deps: { db?: Db; now?: Date } = {},
): Promise<{ anonimizarApos: string }> {
  const now = deps.now ?? new Date();
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
      await recordAudit(tx, {
        acao: 'bloquear',
        entidade: 'patients',
        entidadeId: p.id,
        patientId: p.id,
      });
      await enqueueEmail(
        {
          tipo: 'exclusao_atendida',
          para: p.email,
          nome: p.nome,
          nutri: tenant.nomeExibicao,
          anonimizarApos: formatarData(anonimizarApos),
        },
        { tenantId: ctx.tenantId, tx },
      );
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

/** Quadro "Pedidos do titular" do painel (US-046): os abertos, com o nome e o prazo, prazo mais curto primeiro. */
export async function pedidosDoTitularAbertos(
  ctx: TenantContext,
  db: Db = getDb(),
): Promise<{ patientId: string; nome: string; tipo: 'exclusao' | 'exportacao'; prazo: string }[]> {
  const r = await withTenant(
    ctx,
    (tx) =>
      tx
        .select({ patientId: privacyRequests.patientId, nome: patients.nome, tipo: privacyRequests.tipo, prazo: privacyRequests.prazo })
        .from(privacyRequests)
        .innerJoin(patients, eq(patients.id, privacyRequests.patientId))
        .where(eq(privacyRequests.status, 'aberto'))
        .orderBy(asc(privacyRequests.prazo), asc(patients.nome)),
    db,
  );
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
        { err: err instanceof Error ? err.message : String(err), tenantId: t.id },
        'falha ao listar pacientes a anonimizar',
      );
      continue;
    }
    for (const { id } of vencidos) {
      try {
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
            // rodada 1 (T13): inscrições de push gravadas depois do pedido de exclusão também saem (D14: só as do vínculo)
            if (r.length) await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.patientId, id));
            if (r.length) await anonimizarAgenda(tx, id, now);
            // P06-08 (D18): a conta de login perde a identificação se não tiver outro vínculo — conferido aqui, na
            // mesma transação, depois do UPDATE que a soltou deste prontuário (a função trava a conta)
            if (r.length && pendente.userId && (await contaSemOutroVinculo(tx, pendente.userId)))
              await anonimizarContaSemVinculo(tx, pendente.userId, now);
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
          { err: err instanceof Error ? err.message : String(err), tenantId: t.id },
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
