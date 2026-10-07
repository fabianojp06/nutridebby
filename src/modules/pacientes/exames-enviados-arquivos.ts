import { and, eq, notInArray } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { examSubmissionFiles, examSubmissions } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { logger, nomeDoErro } from '@/lib/logger';
import { apagarArquivo, motivoDoErro } from '@/modules/plataforma/armazenamento';

type Papel = 'original' | 'pagina';

/**
 * Quando cada arquivo do envio deixa de ser preciso (D23, RN-163 a RN-167): o original, depois do processamento; a página,
 * depois da revisão (ou do cancelamento, da expiração, da falha). `refazer`: uma nova tentativa do job refaz as páginas de
 * uma tentativa anterior que caiu no meio (o envio ainda está "processando").
 */
const PODE_SAIR: Record<Papel, (status: string, refazer: boolean) => boolean> = {
  original: (s) => s !== 'processando',
  pagina: (s, refazer) => (refazer ? s === 'processando' : s !== 'processando' && s !== 'recebido'),
};

/**
 * Para o aviso de falha (revisão da T2): o código do erro (SQLSTATE, ENOENT…) ou, sem código, o nome da classe — nunca a
 * mensagem, que leva caminho, SQL ou parâmetros (RNF-11). Distingue um erro determinístico (42501, TypeError), que a
 * varredura vai repetir, de um passageiro (40P01, 55P03).
 */
const codigoDoErro = (err: unknown): string => {
  const motivo = motivoDoErro(err);
  return motivo !== 'erro' ? motivo : nomeDoErro(err);
};

/**
 * Regra 9 / DEP-09 reduzida (spec §4.1): cada arquivo do envio sai no SEU apagarArquivo; a linha de exam_submission_files sai
 * junto (FK ON DELETE CASCADE, mesma transação) e o PDF limpo solta o ponteiro `arquivo_path` no naMesmaTransacao — só se o
 * envio, travado ali, ainda permite (situação relida). Ordem de travas: envio → tenant, sem o paciente na frente porque aqui nada
 * se grava com FK para `patients` (só o ponteiro do envio, o DELETE em cascata das linhas de arquivo — auditado, FK só para
 * `tenants` — e a devolução da cota); quem grava filha de `patients` trava o paciente antes (revisão do plano: a expiração da
 * T8). A de salvarArquivo é paciente → envio → tenant. A trava do envio é FOR NO KEY UPDATE (code review do PR #25, P12-22 a):
 * basta para serializar com quem muda a situação ou o ponteiro (todos UPDATE sem coluna-chave) e com a ação de RI do
 * `excluirExame` (o SET NULL de `exam_id` da FK exam_submissions_exame_fk, 0102, que trava o envio aceito) — e o excluirExame
 * trava o envio ANTES do tenant (paciente → envio → tenant), senão a ação de RI, depois do tenant, fechava ciclo com esta
 * função. Um arquivo que falha não para os outros: a varredura (exames-enviados-varredura.ts) tenta de novo. `papel`: só os
 * originais (fim do processamento) ou só as páginas. Devolve quantos arquivos saíram. Log só com ids (RNF-11).
 */
export async function apagarArquivosDoEnvio(
  ctx: TenantContext,
  envioId: string,
  deps: { db?: Db; dataDir?: string; papel?: Papel; refazer?: boolean } = {},
): Promise<number> {
  const db = deps.db ?? getDb();
  const refazer = !!deps.refazer;
  const lido = await withTenant(
    ctx,
    async (tx) => {
      const [e] = await tx.select({ status: examSubmissions.status, pdf: examSubmissions.arquivoPath }).from(examSubmissions).where(eq(examSubmissions.id, envioId));
      if (!e) return null;
      const arquivos = await tx
        .select({ caminho: examSubmissionFiles.arquivoPath, papel: examSubmissionFiles.papel })
        .from(examSubmissionFiles)
        .where(and(eq(examSubmissionFiles.submissionId, envioId), deps.papel ? eq(examSubmissionFiles.papel, deps.papel) : undefined));
      return { ...e, arquivos };
    },
    db,
  );
  if (!lido) return 0;
  const situacaoTravada = async (tx: Tx) => (await tx.select({ status: examSubmissions.status }).from(examSubmissions).where(eq(examSubmissions.id, envioId)).for('no key update'))[0]?.status;
  let n = 0;
  const codigos: string[] = [];
  const falhou = (err: unknown) => {
    codigos.push(codigoDoErro(err));
    return false;
  };
  for (const a of lido.arquivos) {
    const papel = a.papel as Papel;
    if (!PODE_SAIR[papel](lido.status, refazer)) continue;
    const ok = await apagarArquivo(ctx, { caminho: a.caminho }, {
      db,
      dataDir: deps.dataDir,
      naMesmaTransacao: async (tx) => {
        const s = await situacaoTravada(tx);
        return s !== undefined && PODE_SAIR[papel](s, refazer);
      },
    }).catch(falhou);
    if (ok) n++;
  }
  if (!deps.papel && lido.pdf && lido.status !== 'recebido' && lido.status !== 'processando') {
    const pdf = lido.pdf;
    const ok = await apagarArquivo(ctx, { caminho: pdf }, {
      db,
      dataDir: deps.dataDir,
      naMesmaTransacao: async (tx) =>
        (
          await tx
            .update(examSubmissions)
            .set({ arquivoPath: null, updatedAt: new Date() })
            .where(and(eq(examSubmissions.id, envioId), eq(examSubmissions.arquivoPath, pdf), notInArray(examSubmissions.status, ['processando', 'recebido'])))
            .returning({ id: examSubmissions.id })
        ).length > 0,
    }).catch(falhou);
    if (ok) n++;
  }
  if (codigos.length)
    logger.warn(
      { tenantId: ctx.tenantId, envioId, falhas: codigos.length, codigos: [...new Set(codigos)], motivo: 'arquivo_do_envio' },
      'arquivo do envio não apagado (a varredura tenta de novo)',
    );
  return n;
}
