import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { and, asc, eq, lt, ne, or, sql } from 'drizzle-orm';
import { strToU8, zipSync } from 'fflate';
import { fromDrizzle, type PgBoss } from 'pg-boss';
import type { Db, Tx } from '@/db/client';
import {
  anamneses,
  anthropometry,
  appointments,
  consents,
  consultations,
  dataExports,
  diaryEntries,
  energyCalcs,
  exams,
  mealPlans,
  notifications,
  patients,
  privacyRequests,
  pushSubscriptions,
  storedFiles,
  user,
} from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { enqueueEmail } from '@/email/queue';
import { getBoss } from '@/jobs/boss';
import { getEnv } from '@/env';
import { logger } from '@/lib/logger';
import {
  apagarArquivo,
  CotaEsgotadaError,
  resolverCaminho,
  salvarArquivo,
} from '@/modules/plataforma/armazenamento';
import {
  buscarTenant,
  listarTenantsParaVarredura,
  tenantIsActive,
} from '@/modules/plataforma/tenant-status';
import { lerPlanoNaTransacao } from '@/modules/plano-alimentar/carregar';
import { respostaParaCampo } from './anamnese-tipos';
import { hojeNoFuso } from './datas';
import { EXPORTACAO_VALIDADE_MS, linkDaExportacao } from './exportacao';
import { FORMULAS_TMB, kcal } from './formulas';
import { formatarTelefone } from './telefone';
import { renderizarProntuario } from './prontuario-pdf';

// Só o worker importa este arquivo (e o PDF): @react-pdf/renderer fica fora do grafo do Next.

/** US-046 (Plano 06): `equipe` = pedida pela nutricionista; `titular` = pelo paciente no portal (sem rascunho). */
export type EscopoExportacao = 'equipe' | 'titular';

export type DadosExportacao = {
  versao: 1;
  geradoEm: string;
  /** Data da emissão no fuso do tenant (RN-06): 22h em São Paulo ainda é o mesmo dia. */
  dataEmissao: string;
  paciente: {
    nome: string;
    dataNascimento: string | null;
    sexo: string | null;
    email: string;
    telefone: string | null;
    status: string;
    cadastradoEm: string;
  };
  anamneses: {
    data: string;
    modelo: string;
    respostas: { pergunta: string; resposta: string }[];
  }[];
  antropometria: {
    data: string;
    pesoKg: number;
    alturaCm: number;
    imc: number | null;
    percGordura: number | null;
    protocolo: string;
    circunferencias: Record<string, number>;
    dobrasMm: Record<string, number>;
  }[];
  gastoEnergetico: {
    data: string;
    formula: string;
    pesoKg: number;
    alturaCm: number;
    idade: number;
    fatorAtividade: number;
    tmbKcal: number;
    getKcal: number;
  }[];
  exames: {
    data: string;
    titulo: string;
    temLaudo: boolean;
    /** Caminho do laudo dentro do ZIP (`laudos/…`); null se não há laudo ou se ele ficou de fora. */
    laudo: string | null;
    valores: { nome: string; valor: number; unidade: string | null; referencia: string | null }[];
  }[];
  /** Só as orientações: notas privadas (staff_only) nunca saem (US-016). */
  atendimentos: { data: string; orientacoes: string | null }[];
  /** Planos alimentares: todas as versões; o rascunho só no escopo da equipe. Publicado/arquivado com os valores congelados (D10). */
  planos: {
    versao: number;
    status: string;
    titulo: string;
    publicadoEm: string | null;
    metaKcal: number | null;
    orientacoes: string;
    refeicoes: { nome: string; horario: string; observacao: string; itens: { alimento: string; quantidadeG: number; medida: string | null; substituiDe: string | null }[] }[];
  }[];
  pedidosLgpd: { tipo: string; status: string; prazo: string; concluidoEm: string | null }[];
  /**
   * Plano 05: consultas da agenda. O motivo do cancelamento só quando o paciente cancelou: o da nutricionista é
   * anotação dela ("Só você vê.", como as notas privadas — US-016).
   */
  consultas: { inicio: string; fim: string; modalidade: string; status: string; origem: string; canceladoPor: string | null; motivoCancelamento: string | null }[];
  /** Plano 05: mensagens ao titular (tipo, canal, situação e datas) — sem texto, número de destino nem ids do provedor. */
  lembretes: { tipo: string; canal: string; status: string; agendadaPara: string; enviadaEm: string | null; motivoNaoEnviado: string | null }[];
  /** D13: aceites do termo do paciente neste consultório (pela conta ou pela página pública), com o IP do aceite. */
  aceitesDoTermo: { termoVersao: string; aceitoEm: string; ip: string | null }[];
  /** D14 / T13: aparelhos inscritos para notificação no app — só a data e o navegador (nunca o endereço ou as chaves). */
  dispositivosPush: { criadaEm: string; navegador: string | null }[];
  /** Plano 06: diário alimentar (US-042/043) — texto, refeição, comentário da nutricionista e a foto (em `diario/`). */
  diario: { dataHora: string; refeicao: string; texto: string | null; foto: string | null; comentarioNutri: string | null }[];
  /** Os laudos ou fotos do diário passaram do teto de memória da exportação e não foram no ZIP. */
  laudosForaDoZip: boolean;
};

/**
 * Arquivo a copiar para o ZIP: laudo (`indice` em `exames`) ou foto do diário (`indice` em `diario`); `nome` sem
 * texto do usuário (data + posição).
 */
type AnexoParaZip = { tipo: 'laudo' | 'foto'; indice: number; caminho: string; nome: string };

/** O ZIP é montado em memória no worker: acima disto, laudos e fotos ficam de fora (com aviso), não a exportação. */
export const LIMITE_LAUDOS_BYTES = 100 * 1024 ** 2;

/** "Sim"/"Não" só na pergunta sim/não: em texto livre, "nao" é o que foi digitado. */
const texto = (tipo: string, v: string | string[]) =>
  Array.isArray(v) ? v.join(', ') : tipo === 'sim_nao' ? ({ sim: 'Sim', nao: 'Não' }[v] ?? v) : v;
const NOME_FORMULA = Object.fromEntries(FORMULAS_TMB.map((f) => [f.id, f.nome]));

/**
 * Todas as tabelas do paciente, menos as staff_only (notas privadas, etiquetas). Consultas em sequência:
 * uma transação é uma conexão só, e consultas paralelas nela geram o aviso de descontinuação do pg 8.23
 * (erro no pg 9).
 */
export async function montarDados(
  tx: Tx,
  patientId: string,
  now: Date,
  fuso: string,
  escopo: EscopoExportacao = 'equipe',
): Promise<{ dados: DadosExportacao; laudos: AnexoParaZip[] }> {
  const [p] = await tx.select().from(patients).where(eq(patients.id, patientId));
  const as = await tx
    .select()
    .from(anamneses)
    .where(eq(anamneses.patientId, patientId))
    .orderBy(asc(anamneses.data));
  const an = await tx
    .select()
    .from(anthropometry)
    .where(eq(anthropometry.patientId, patientId))
    .orderBy(asc(anthropometry.data));
  const gs = await tx
    .select()
    .from(energyCalcs)
    .where(eq(energyCalcs.patientId, patientId))
    .orderBy(asc(energyCalcs.createdAt));
  const ex = await tx
    .select()
    .from(exams)
    .where(eq(exams.patientId, patientId))
    .orderBy(asc(exams.data));
  const at = await tx
    .select({ data: consultations.data, orientacoes: consultations.orientacoesPaciente })
    .from(consultations)
    .where(eq(consultations.patientId, patientId))
    .orderBy(asc(consultations.data));
  const pr = await tx
    .select()
    .from(privacyRequests)
    .where(eq(privacyRequests.patientId, patientId))
    .orderBy(asc(privacyRequests.createdAt));
  const cs = await tx.select().from(appointments).where(eq(appointments.patientId, patientId)).orderBy(asc(appointments.inicio));
  const ns = await tx
    .select({ tipo: notifications.tipo, canal: notifications.canal, status: notifications.status, agendadaPara: notifications.agendadaPara, enviadaEm: notifications.enviadaEm, motivo: notifications.motivoIgnorada })
    .from(notifications)
    .where(eq(notifications.patientId, patientId))
    .orderBy(asc(notifications.agendadaPara), asc(notifications.createdAt));
  // consents fica fora da RLS (RLS_EXCEPTIONS): filtra pelo tenant do contexto e pelo titular (prontuário ou conta)
  const ac = await tx
    .select({ termoVersao: consents.termoVersao, aceitoEm: consents.aceitoEm, ip: consents.ip })
    .from(consents)
    .where(and(eq(consents.tenantId, p.tenantId), or(eq(consents.patientId, p.id), p.userId ? eq(consents.userId, p.userId) : undefined)))
    .orderBy(asc(consents.aceitoEm));
  const ps = await tx
    .select({ criadaEm: pushSubscriptions.createdAt, navegador: pushSubscriptions.userAgent })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.patientId, patientId))
    .orderBy(asc(pushSubscriptions.createdAt));
  const di = await tx.select().from(diaryEntries).where(eq(diaryEntries.patientId, patientId)).orderBy(asc(diaryEntries.dataHora));
  // P-16 (b): o titular não recebe o rascunho (a sessão de paciente também não o vê — paciente_sem_rascunho)
  const ids = await tx
    .select({ id: mealPlans.id })
    .from(mealPlans)
    .where(and(eq(mealPlans.patientId, patientId), escopo === 'titular' ? ne(mealPlans.status, 'rascunho') : undefined))
    .orderBy(asc(mealPlans.versao));
  const planos: DadosExportacao['planos'] = [];
  for (const { id } of ids) {
    const pl = await lerPlanoNaTransacao(tx, id, { auditar: false, comMedidas: false }); // a exportação já registra "exportar"
    if (!pl) continue;
    planos.push({
      versao: pl.versao,
      status: pl.status,
      titulo: pl.titulo,
      publicadoEm: pl.publicadoEm,
      metaKcal: pl.metaKcal,
      orientacoes: pl.orientacoes,
      refeicoes: pl.refeicoes.map((r) => ({
        nome: r.nome,
        horario: r.horario,
        observacao: r.observacao,
        itens: r.itens.map((i) => ({
          alimento: i.nome,
          quantidadeG: i.quantidadeG,
          medida: i.medidaCaseiraTxt,
          substituiDe: i.substituiItemId ? (r.itens.find((x) => x.id === i.substituiItemId)?.nome ?? null) : null,
        })),
      })),
    });
  }
  const laudos: AnexoParaZip[] = ex.flatMap((e, i) =>
    e.arquivoPath
      ? [
          {
            tipo: 'laudo' as const,
            indice: i,
            caminho: e.arquivoPath,
            nome: `laudos/${e.data}-${String(i + 1).padStart(2, '0')}${path.extname(e.arquivoPath)}`,
          },
        ]
      : [],
  );
  // Fotos do diário (JPEG convertido): no ZIP, no mesmo teto dos laudos; o original nunca vai
  const fotos: AnexoParaZip[] = di.flatMap((e, i) =>
    e.fotoStatus === 'pronta' && e.fotoPath
      ? [{ tipo: 'foto' as const, indice: i, caminho: e.fotoPath, nome: `diario/${e.dataHora.toISOString().slice(0, 10)}-${i + 1}.jpg` }]
      : [],
  );
  const dados: DadosExportacao = {
    versao: 1,
    geradoEm: now.toISOString(),
    dataEmissao: hojeNoFuso(fuso, now),
    paciente: {
      nome: p.nome,
      dataNascimento: p.dataNascimento,
      sexo: p.sexo,
      email: p.email,
      telefone: p.telefoneE164 ? formatarTelefone(p.telefoneE164) : null,
      status: p.status,
      cadastradoEm: p.createdAt.toISOString(),
    },
    anamneses: as.map((a) => ({
      data: a.data,
      modelo: a.templateSnapshot.nome,
      respostas: a.templateSnapshot.perguntas
        .filter((q) => a.respostas[q.id] !== undefined)
        .map((q) => ({
          pergunta: q.rotulo,
          resposta: `${texto(q.tipo, respostaParaCampo(a.respostas[q.id]))}${q.tipo === 'numero' && q.unidade ? ` ${q.unidade}` : ''}`,
        })),
    })),
    antropometria: an.map((a) => ({
      data: a.data,
      pesoKg: a.pesoKg,
      alturaCm: a.alturaCm,
      imc: a.imc,
      percGordura: a.percGordura,
      protocolo: a.protocolo,
      circunferencias: a.circunferencias,
      dobrasMm: a.dobrasMm,
    })),
    gastoEnergetico: gs.map((g) => ({
      data: hojeNoFuso(fuso, g.createdAt),
      formula: NOME_FORMULA[g.formula] ?? g.formula,
      pesoKg: g.pesoKg,
      alturaCm: g.alturaCm,
      idade: g.idade,
      fatorAtividade: g.fatorAtividade,
      tmbKcal: kcal(g.tmb),
      getKcal: kcal(g.get),
    })),
    exames: ex.map((e) => ({
      data: e.data,
      titulo: e.titulo,
      temLaudo: !!e.arquivoPath,
      laudo: null,
      valores: e.valores,
    })),
    atendimentos: at,
    planos,
    pedidosLgpd: pr.map((r) => ({
      tipo: r.tipo,
      status: r.status,
      prazo: r.prazo,
      concluidoEm: r.concluidoEm?.toISOString() ?? null,
    })),
    consultas: cs.map((c) => ({
      inicio: c.inicio.toISOString(),
      fim: c.fim.toISOString(),
      modalidade: c.modalidade,
      status: c.status,
      origem: c.origem,
      canceladoPor: c.canceladoPor,
      motivoCancelamento: c.canceladoPor === 'paciente' ? c.motivoCancelamento : null,
    })),
    lembretes: ns.map((n) => ({
      tipo: n.tipo,
      canal: n.canal,
      status: n.status,
      agendadaPara: n.agendadaPara.toISOString(),
      enviadaEm: n.enviadaEm?.toISOString() ?? null,
      motivoNaoEnviado: n.motivo,
    })),
    aceitesDoTermo: ac.map((a) => ({ termoVersao: a.termoVersao, aceitoEm: a.aceitoEm.toISOString(), ip: a.ip })),
    dispositivosPush: ps.map((d) => ({ criadaEm: d.criadaEm.toISOString(), navegador: d.navegador })),
    diario: di.map((e) => ({ dataHora: e.dataHora.toISOString(), refeicao: e.refeicao, texto: e.texto, foto: null, comentarioNutri: e.comentarioNutri })),
    laudosForaDoZip: false,
  };
  return { dados, laudos: [...laudos, ...fotos] };
}

/**
 * Lê os laudos e as fotos do diário de /data para o ZIP e marca em `dados` onde cada um ficou. Acima do teto,
 * o que não cabe não vai (e `laudosForaDoZip` avisa); arquivo que sumiu do disco fica de fora sem derrubar a exportação.
 */
async function lerLaudos(
  dados: DadosExportacao,
  laudos: AnexoParaZip[],
  dataDir: string,
  limite: number,
  tenantId: string,
): Promise<Record<string, Uint8Array>> {
  const presentes: (AnexoParaZip & { bytes: number })[] = [];
  let ausentes = 0;
  for (const l of laudos) {
    try {
      presentes.push({ ...l, bytes: (await stat(resolverCaminho(dataDir, l.caminho))).size });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      ausentes++;
    }
  }
  // Entram os que cabem no teto, na ordem dos exames; os demais ficam de fora com o aviso
  const arquivos: Record<string, Uint8Array> = {};
  let total = 0;
  for (const l of presentes) {
    if (total + l.bytes > limite) {
      dados.laudosForaDoZip = true;
      continue;
    }
    let conteudo: Buffer;
    try {
      conteudo = await readFile(resolverCaminho(dataDir, l.caminho));
    } catch (err) {
      // Exame excluído entre o stat e a leitura: fica de fora como o que já não estava no disco
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      ausentes++;
      continue;
    }
    arquivos[l.nome] = conteudo;
    if (l.tipo === 'laudo') dados.exames[l.indice].laudo = l.nome;
    else dados.diario[l.indice].foto = l.nome;
    total += conteudo.length;
  }
  if (ausentes)
    logger.warn({ tenantId, ausentes }, 'laudo ausente no disco ficou fora da exportação');
  return arquivos;
}

type DadosJob = { tenantId: string; exportId: string };
type DepsJob = {
  db: Db;
  dataDir: string;
  appUrl: string;
  now?: Date;
  boss?: PgBoss;
  /** pg-boss: esta é a última tentativa (retryCount ≥ retryLimit) — em erro, marca "falhou". */
  ultimaTentativa: boolean;
  /** Testes trocam o PDF. */
  renderizar?: typeof renderizarProntuario;
  /** Testes baixam o teto dos laudos. */
  limiteLaudosBytes?: number;
};

/** Outro worker marcou o pedido antes: o `registrar` desiste e o salvarArquivo desfaz ZIP, registro e cota. */
class JaConcluidaError extends Error {}
/** A anonimização (retencao-lgpd) passou no meio: o ZIP montado antes teria dados identificados. */
class PacienteAnonimizadoError extends Error {}

/**
 * Job `exportacao-paciente`. Idempotente: só age sobre pedido `pendente` (um retry depois do sucesso
 * não gera outro ZIP). Tenant suspenso: não gera (RN-15) e marca "falhou" — senão o pedido ficaria
 * pendente para sempre e "Exportar dados" devolveria o mesmo id sem job. Erro: o pg-boss tenta de novo;
 * na última tentativa, "falhou" (a nutricionista pede de novo). ZIP, pedido "pronta", e-mail e job de
 * expiração vão na MESMA transação (`registrar`): uma queda no meio não deixa ZIP sem dono em /data.
 */
export async function gerarExportacao(
  data: DadosJob,
  deps: DepsJob,
): Promise<'pronta' | 'ignorada' | 'falhou'> {
  const { db } = deps;
  const now = deps.now ?? new Date();
  const ctx: TenantContext = { tenantId: data.tenantId, role: 'worker' };
  const marcarFalhou = () =>
    withTenant(
      ctx,
      (tx) =>
        tx
          .update(dataExports)
          .set({ status: 'falhou', updatedAt: now })
          .where(and(eq(dataExports.id, data.exportId), eq(dataExports.status, 'pendente'))),
      db,
    );
  if (!(await tenantIsActive(db, data.tenantId))) {
    await marcarFalhou();
    return 'ignorada';
  }
  const [pedido] = await withTenant(
    ctx,
    (tx) =>
      tx
        .select()
        .from(dataExports)
        .where(and(eq(dataExports.id, data.exportId), eq(dataExports.status, 'pendente'))),
    db,
  );
  if (!pedido) return 'ignorada';
  try {
    const tenant = await buscarTenant(db, data.tenantId);
    const { dados, laudos } = await withTenant(
      ctx,
      (tx) => montarDados(tx, pedido.patientId, now, tenant?.fuso ?? 'America/Sao_Paulo', pedido.escopo as EscopoExportacao),
      db,
    );
    const arquivosDosLaudos = await lerLaudos(
      dados,
      laudos,
      deps.dataDir,
      deps.limiteLaudosBytes ?? LIMITE_LAUDOS_BYTES,
      data.tenantId,
    );
    const pdf = await (deps.renderizar ?? renderizarProntuario)(
      dados,
      tenant?.nomeExibicao ?? 'NutriDebby',
    );
    const zip = zipSync({
      'dados.json': strToU8(JSON.stringify(dados, null, 2)),
      'prontuario.pdf': new Uint8Array(pdf.buffer, pdf.byteOffset, pdf.length),
      // Laudo (PDF/JPEG/PNG) já vem comprimido: guardado sem recomprimir, para poupar CPU do worker
      ...Object.fromEntries(
        Object.entries(arquivosDosLaudos).map(([nome, u8]) => [nome, [u8, { level: 0 }] as const]),
      ),
    });
    const boss = deps.boss ?? (await getBoss());
    const expiraEm = new Date(now.getTime() + EXPORTACAO_VALIDADE_MS);
    await salvarArquivo(
      ctx,
      {
        tipo: 'exportacao',
        conteudo: Buffer.from(zip.buffer, zip.byteOffset, zip.length),
        permitidos: ['zip'],
        naoBarrarPelaCota: true,
        patientId: pedido.patientId,
        // Trava o paciente (mesma ordem de travas dos laudos) e desiste se a anonimização chegou antes;
        // a anonimização, por sua vez, confere os anexos com o paciente travado (lgpd.ts).
        antesDaReserva: async (tx) => {
          const [p] = await tx
            .select({ anonimizadoEm: patients.anonimizadoEm })
            .from(patients)
            .where(eq(patients.id, pedido.patientId))
            .for('update');
          if (!p || p.anonimizadoEm) throw new PacienteAnonimizadoError();
        },
        registrar: async (tx, arquivo) => {
          const [e] = await tx
            .update(dataExports)
            .set({ status: 'pronta', arquivoPath: arquivo.caminho, expiraEm, updatedAt: now })
            .where(and(eq(dataExports.id, pedido.id), eq(dataExports.status, 'pendente')))
            .returning({ id: dataExports.id });
          if (!e) throw new JaConcluidaError();
          const [quem] = pedido.solicitadoPor
            ? await tx
                .select({ email: user.email })
                .from(user)
                .where(eq(user.id, pedido.solicitadoPor))
            : [];
          if (quem)
            await enqueueEmail(
              {
                tipo: 'exportacao_pronta',
                para: quem.email,
                link: linkDaExportacao(deps.appUrl, pedido.patientId, pedido.id, pedido.escopo as EscopoExportacao),
                titular: pedido.escopo === 'titular',
              },
              { tenantId: data.tenantId, tx, boss },
            );
          await boss.send('expirar-exportacao', data, {
            startAfter: expiraEm,
            db: fromDrizzle(tx, sql),
          });
        },
      },
      { db, dataDir: deps.dataDir },
    );
    await expirarAnteriores(ctx, pedido.patientId, pedido.id, pedido.escopo as EscopoExportacao, { db, dataDir: deps.dataDir });
    return 'pronta';
  } catch (err) {
    if (err instanceof JaConcluidaError) return 'ignorada';
    const definitivo =
      deps.ultimaTentativa ||
      err instanceof CotaEsgotadaError ||
      err instanceof PacienteAnonimizadoError;
    logger.error(
      {
        err: err instanceof Error ? err.message : String(err),
        tenantId: data.tenantId,
        exportId: data.exportId,
        definitivo,
      },
      'falha ao gerar exportação',
    );
    if (!definitivo) throw err;
    await marcarFalhou();
    return 'falhou';
  }
}

/**
 * Rede de segurança do "some em 24 h", chamada pelo job diário `retencao-lgpd`: pedidos prontos já
 * vencidos (o `expirar-exportacao` esgotou as tentativas) perdem o ZIP; pendentes esquecidos há mais de
 * um dia (worker caiu na última tentativa) viram "falhou".
 */
export async function expirarExportacoesVencidas(
  db: Db,
  now: Date,
  deps: { dataDir?: string } = {},
): Promise<{ expiradas: number }> {
  let expiradas = 0;
  for (const t of await listarTenantsParaVarredura(db)) {
    const ctx: TenantContext = { tenantId: t.id, role: 'worker' };
    try {
      const vencidas = await withTenant(
        ctx,
        (tx) =>
          tx
            .select({ id: dataExports.id })
            .from(dataExports)
            .where(and(eq(dataExports.status, 'pronta'), lt(dataExports.expiraEm, now))),
        db,
      );
      for (const { id } of vencidas) {
        await expirarExportacao(
          { tenantId: t.id, exportId: id },
          { db, dataDir: deps.dataDir ?? getEnv().DATA_DIR },
        );
        expiradas++;
      }
      await withTenant(
        ctx,
        (tx) =>
          tx
            .update(dataExports)
            .set({ status: 'falhou', updatedAt: now })
            .where(
              and(
                eq(dataExports.status, 'pendente'),
                lt(dataExports.createdAt, new Date(now.getTime() - EXPORTACAO_VALIDADE_MS)),
              ),
            ),
        db,
      );
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), tenantId: t.id },
        'falha ao expirar exportações vencidas',
      );
    }
  }
  return { expiradas };
}

/**
 * Um ZIP válido por paciente e escopo: o novo pronto apaga os anteriores do mesmo escopo (cota e disco) — o do
 * titular não apaga o que a nutricionista acabou de pedir, nem o contrário (D16). Falha aqui não desfaz a
 * exportação nova — o job de expiração e a varredura diária apagam o resto.
 */
async function expirarAnteriores(
  ctx: TenantContext,
  patientId: string,
  atual: string,
  escopo: EscopoExportacao,
  deps: { db: Db; dataDir: string },
) {
  try {
    const anteriores = await withTenant(
      ctx,
      (tx) =>
        tx
          .select({ id: dataExports.id })
          .from(dataExports)
          .where(
            and(
              eq(dataExports.patientId, patientId),
              eq(dataExports.escopo, escopo),
              eq(dataExports.status, 'pronta'),
              ne(dataExports.id, atual),
            ),
          ),
      deps.db,
    );
    for (const { id } of anteriores)
      await expirarExportacao({ tenantId: ctx.tenantId, exportId: id }, deps);
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), tenantId: ctx.tenantId },
      'falha ao apagar exportação anterior',
    );
  }
}

/** Job `expirar-exportacao` (24 h depois): apaga o ZIP e marca o pedido como expirado. */
export async function expirarExportacao(
  data: DadosJob,
  deps: { db: Db; dataDir: string },
): Promise<void> {
  const ctx: TenantContext = { tenantId: data.tenantId, role: 'worker' };
  const [e] = await withTenant(
    ctx,
    (tx) => tx.select().from(dataExports).where(eq(dataExports.id, data.exportId)),
    deps.db,
  );
  if (!e) return;
  // CLAUDE.md regra 9: o pedido deixa de apontar para o ZIP na mesma transação que apaga o arquivo
  const expirar = async (tx: Tx) => {
    // Ordem de travas da anonimização (apagarArquivo: stored_files → data_exports pelo SET NULL):
    // trava o arquivo antes do pedido, senão as duas juntas se travam em ordem inversa (deadlock)
    if (e.arquivoPath)
      await tx
        .select({ id: storedFiles.id })
        .from(storedFiles)
        .where(eq(storedFiles.caminho, e.arquivoPath))
        .for('update');
    await tx
      .update(dataExports)
      .set({ status: 'expirada', arquivoPath: null, updatedAt: new Date() })
      .where(eq(dataExports.id, e.id));
    return true;
  };
  if (e.arquivoPath)
    await apagarArquivo(ctx, { caminho: e.arquivoPath }, { ...deps, naMesmaTransacao: expirar });
  else await withTenant(ctx, expirar, deps.db);
}
