import { and, asc, eq, lt, sql } from 'drizzle-orm';
import { strToU8, zipSync } from 'fflate';
import { fromDrizzle, type PgBoss } from 'pg-boss';
import type { Db, Tx } from '@/db/client';
import {
  anamneses,
  anthropometry,
  consultations,
  dataExports,
  energyCalcs,
  exams,
  patients,
  privacyRequests,
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
  salvarArquivo,
} from '@/modules/plataforma/armazenamento';
import {
  buscarTenant,
  listarTenantsParaVarredura,
  tenantIsActive,
} from '@/modules/plataforma/tenant-status';
import { respostaParaCampo } from './anamnese-tipos';
import { hojeNoFuso } from './datas';
import { EXPORTACAO_VALIDADE_MS, linkDaExportacao } from './exportacao';
import { FORMULAS_TMB, kcal } from './formulas';
import { formatarTelefone } from './telefone';
import { renderizarProntuario } from './prontuario-pdf';

// Só o worker importa este arquivo (e o PDF): @react-pdf/renderer fica fora do grafo do Next.

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
    valores: { nome: string; valor: number; unidade: string | null; referencia: string | null }[];
  }[];
  /** Só as orientações: notas privadas (staff_only) nunca saem (US-016). */
  atendimentos: { data: string; orientacoes: string | null }[];
  pedidosLgpd: { tipo: string; status: string; prazo: string; concluidoEm: string | null }[];
};

const texto = (v: string | string[]) =>
  Array.isArray(v) ? v.join(', ') : v === 'sim' ? 'Sim' : v === 'nao' ? 'Não' : v;
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
): Promise<DadosExportacao> {
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
  return {
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
          resposta: texto(respostaParaCampo(a.respostas[q.id])),
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
      valores: e.valores,
    })),
    atendimentos: at,
    pedidosLgpd: pr.map((r) => ({
      tipo: r.tipo,
      status: r.status,
      prazo: r.prazo,
      concluidoEm: r.concluidoEm?.toISOString() ?? null,
    })),
  };
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
};

/** Outro worker marcou o pedido antes: o `registrar` desiste e o salvarArquivo desfaz ZIP, registro e cota. */
class JaConcluidaError extends Error {}

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
    const dados = await withTenant(
      ctx,
      (tx) => montarDados(tx, pedido.patientId, now, tenant?.fuso ?? 'America/Sao_Paulo'),
      db,
    );
    const pdf = await (deps.renderizar ?? renderizarProntuario)(
      dados,
      tenant?.nomeExibicao ?? 'NutriDebby',
    );
    const zip = zipSync({
      'dados.json': strToU8(JSON.stringify(dados, null, 2)),
      'prontuario.pdf': new Uint8Array(pdf.buffer, pdf.byteOffset, pdf.length),
    });
    const boss = deps.boss ?? (await getBoss());
    const expiraEm = new Date(now.getTime() + EXPORTACAO_VALIDADE_MS);
    await salvarArquivo(
      ctx,
      {
        tipo: 'exportacao',
        conteudo: Buffer.from(zip.buffer, zip.byteOffset, zip.length),
        permitidos: ['zip'],
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
                link: linkDaExportacao(deps.appUrl, pedido.patientId, pedido.id),
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
    return 'pronta';
  } catch (err) {
    if (err instanceof JaConcluidaError) return 'ignorada';
    const definitivo = deps.ultimaTentativa || err instanceof CotaEsgotadaError;
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
