import { and, desc, eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { examInterpretacoes, exams, patients, type FaixaDoConsultorio } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { idValido } from '@/modules/pacientes/base';
import type { ValorExame } from '@/modules/pacientes/exames';
import { auditRead } from '@/modules/plataforma/audit';
import { catalogoParaDetalheNaTransacao, exigirNutri } from './catalogo';
import { classificarLinha, indiceDoCatalogo, type Neutra } from './classificacao';

/**
 * Plano 22 (T5a, US-372, US-373, RN-379 a RN-383, EP-D11 a EP-D19, EP-D62): o detalhe do exame no painel. Fica FORA de
 * `src/modules/pacientes/exames.ts` (que `ia/conferencia.ts` importa): a nota em vigor (`exam_interpretacoes`) nunca fica
 * ao alcance da IA (RN-399). Só a sessão `nutri` (a nota é staff_only: numa sessão de paciente a leitura voltaria vazia em
 * silêncio). A classificação neutra e a categoria do consultório são calculadas aqui, na leitura, com o catálogo
 * **atual** — nada disso é gravado (EP-D11). A categoria lê o sexo e o nascimento de `patients` (nunca a identidade de
 * gênero de `patient_cadastro`, EP-D13). Valores, nomes e a nota nunca vão a log (RNF-370).
 */

export type LinhaNaTela = ValorExame & {
  neutra: Neutra | null;
  categoria: { nome: string; faixa: FaixaDoConsultorio } | null;
  /** As faixas do exame do catálogo que casou (RN-382, REF); `[]` sem casamento único. */
  faixasDoConsultorio: FaixaDoConsultorio[];
  /** A unidade do exame do catálogo que casou (os limites das faixas do REF são nela); `null` sem casamento. */
  unidadeDoCatalogo: string | null;
  /** Os modelos de nota do exame do catálogo que casou (RN-375); `null` sem casamento. */
  modeloNota: { abaixo: string | null; acima: string | null } | null;
};

export type ExameAberto = {
  id: string;
  titulo: string;
  data: string;
  temLaudo: boolean;
  /** O caminho do laudo, só para a página assinar a URL de "Baixar laudo" (`signFileUrl`); nunca vai ao navegador cru. */
  arquivoPath: string | null;
  noAppEm: Date | null;
  /** `patients.user_id` preenchido (T6: "Este paciente ainda não usa o app…"). */
  pacienteUsaApp: boolean;
  /** `updated_at` lido, em `toISOString()` (M3). */
  updatedAt: string;
  linhas: LinhaNaTela[];
  /** A nota em vigor: a de maior versão; `null` sem nota ou quando a última versão é um "Apagar nota". */
  nota: { versao: number; texto: string } | null;
};

/**
 * "Abrir" (US-372, US-373): numa transação, o exame **pelos dois ids** (sem linha → `null`, nenhum `auditRead`: a trilha
 * nunca atribui a leitura ao titular errado, M8), a nota em vigor (`exam_id` e `patient_id`), o catálogo (uma leitura,
 * RNF-371) e o sexo, o nascimento e a conta do paciente; um `auditRead` (entidade `exames`) na mesma transação.
 */
export async function abrirExame(ctx: TenantContext, patientId: string, exameId: string, deps: { db?: Db } = {}): Promise<ExameAberto | null> {
  exigirNutri(ctx);
  if (!idValido(patientId) || !idValido(exameId)) return null;
  const lido = await withTenant(
    ctx,
    async (tx) => {
      const [e] = await tx.select().from(exams).where(and(eq(exams.id, exameId), eq(exams.patientId, patientId)));
      if (!e) return null;
      const [p] = await tx.select({ sexo: patients.sexo, dataNascimento: patients.dataNascimento, userId: patients.userId }).from(patients).where(eq(patients.id, patientId));
      const [nota] = await tx
        .select({ versao: examInterpretacoes.versao, texto: examInterpretacoes.texto })
        .from(examInterpretacoes)
        .where(and(eq(examInterpretacoes.examId, e.id), eq(examInterpretacoes.patientId, patientId)))
        .orderBy(desc(examInterpretacoes.versao))
        .limit(1);
      const catalogo = await catalogoParaDetalheNaTransacao(tx);
      await auditRead(tx, { entidade: 'exames', entidadeId: e.id, patientId });
      return { e, p, nota, catalogo };
    },
    deps.db ?? getDb(),
  );
  if (!lido) return null;
  const { e, p, nota, catalogo } = lido;
  // o índice uma vez por leitura e um casamento por linha, em memória (RNF-371)
  const indice = indiceDoCatalogo(catalogo);
  const paciente = { sexo: p?.sexo ?? null, dataNascimento: p?.dataNascimento ?? null };
  const linhas = e.valores.map((v): LinhaNaTela => {
    const { neutra, categoria, casado: item } = classificarLinha(v, indice, paciente, e.data);
    return {
      ...v,
      neutra,
      categoria,
      faixasDoConsultorio: item?.faixas ?? [],
      unidadeDoCatalogo: item?.unidade ?? null,
      modeloNota: item ? { abaixo: item.modeloNotaAbaixo, acima: item.modeloNotaAcima } : null,
    };
  });
  return {
    id: e.id,
    titulo: e.titulo,
    data: e.data,
    temLaudo: !!e.arquivoPath,
    arquivoPath: e.arquivoPath,
    noAppEm: e.mostrarNoAppEm,
    pacienteUsaApp: !!p?.userId,
    updatedAt: e.updatedAt.toISOString(),
    linhas,
    nota: nota && nota.texto !== null ? { versao: nota.versao, texto: nota.texto } : null,
  };
}
