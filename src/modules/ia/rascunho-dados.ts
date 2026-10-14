import { desc, eq } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { anamneses, type AnamneseRow, type PatientRow } from '@/db/schema';
import { lerDecimal } from '@/lib/numero';
import { normalizarTexto } from '@/lib/text';
import { hojeNoFuso, idadeEm } from '@/modules/pacientes/datas';
import { MAX_REFEICOES, META_MAX, META_MIN, MSG_PLANO } from '@/modules/plano-alimentar/constantes';
import type { Categoria } from './campos-enviados';
import { MSG_RASCUNHO_IA } from './constantes';
import { respostasMascaradas, textoLivre, type AlvoDaMascara } from './pseudonimizar';

export const MAX_RESTRICOES = 500;
export type MetasDoRascunho = {
  metaKcal: number;
  proteinaPct: number;
  carboidratoPct: number;
  lipidioPct: number;
  refeicoes: { nome: string; horario: string }[];
  restricoes: string;
  considerarAnamnese: boolean;
};
export type PedidoDoRascunho = { dados: Partial<Record<Categoria, unknown>>; bytes: number };
const HORARIO = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Plano 14B (US-121): o formulário do rascunho → metas limpas, ou erros por campo (`metaKcal`, `macros`, `refeicoes`,
 * `refeicao:<n>:nome`, `refeicao:<n>:horario`, `restricoes`). Números pelo `lerDecimal` do editor ("1800" e "1800,0";
 * "1.800" é 1,8 e cai na faixa da meta). As porcentagens não têm padrão (a spec não define; R10).
 */
export function validarMetas(bruto: unknown): { ok: true; metas: MetasDoRascunho } | { ok: false; erros: Record<string, string> } {
  const o = (bruto !== null && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>;
  const erros: Record<string, string> = {};
  const meta = lerDecimal(o.metaKcal);
  if (meta === null || Number.isNaN(meta) || meta < META_MIN || meta > META_MAX) erros.metaKcal = MSG_RASCUNHO_IA.meta;
  const pct = (v: unknown) => {
    const x = lerDecimal(v);
    return x === null || Number.isNaN(x) || x < 0 || x > 100 ? null : x;
  };
  const [pr, ca, li] = [pct(o.proteinaPct), pct(o.carboidratoPct), pct(o.lipidioPct)];
  if (pr === null || ca === null || li === null || Math.abs(pr + ca + li - 100) > 0.01) erros.macros = MSG_RASCUNHO_IA.soma;
  const rs = Array.isArray(o.refeicoes) ? (o.refeicoes as unknown[]) : [];
  if (!rs.length) erros.refeicoes = MSG_RASCUNHO_IA.semRefeicao;
  if (rs.length > MAX_REFEICOES) erros.refeicoes = MSG_PLANO.limite;
  const refeicoes = rs.slice(0, MAX_REFEICOES).map((bruta, i) => {
    const r = (bruta !== null && typeof bruta === 'object' ? bruta : {}) as Record<string, unknown>;
    const nome = normalizarTexto(r.nome);
    const horario = typeof r.horario === 'string' ? r.horario.trim() : '';
    if (!nome || nome.length > 60) erros[`refeicao:${i}:nome`] = MSG_PLANO.refeicaoNome;
    if (!HORARIO.test(horario)) erros[`refeicao:${i}:horario`] = MSG_PLANO.horario;
    return { nome, horario };
  });
  const restricoes = typeof o.restricoes === 'string' ? o.restricoes.replace(/\r\n?/g, '\n').trim() : '';
  if (restricoes.length > MAX_RESTRICOES) erros.restricoes = MSG_RASCUNHO_IA.restricoes;
  if (Object.keys(erros).length) return { ok: false, erros };
  return {
    ok: true,
    metas: {
      metaKcal: Math.round(meta!),
      proteinaPct: pr!,
      carboidratoPct: ca!,
      lipidioPct: li!,
      refeicoes,
      restricoes,
      considerarAnamnese: o.considerarAnamnese === true || o.considerarAnamnese === 'on',
    },
  };
}

/**
 * Plano 14B (RN-121, §5.4, D8): o que sai no rascunho — só as categorias de CATEGORIAS_POR_USO.rascunho_plano (o teste
 * campos-enviados.test.ts confere): idade, sexo, as metas (números e nomes das refeições, mascarados), as restrições
 * mascaradas e, só com "Considerar a anamnese", a anamnese mais recente mascarada. Sem id do banco, sem campo do cadastro.
 * Lê dentro do withTenant de quem chama (app no pedido, worker no portão); não devolve nada à tela (sem auditRead).
 */
export async function montarPedidoDoRascunho(tx: Tx, p: PatientRow, metas: MetasDoRascunho, o: { agora: Date; fuso: string }): Promise<PedidoDoRascunho> {
  const [ana] = metas.considerarAnamnese
    ? await tx.select().from(anamneses).where(eq(anamneses.patientId, p.id)).orderBy(desc(anamneses.data), desc(anamneses.createdAt)).limit(1)
    : [];
  const base = { idade: p.dataNascimento ? idadeEm(p.dataNascimento, hojeNoFuso(o.fuso, o.agora)) : null, sexo: p.sexo ?? null };
  return pedidoDoRascunho(base, { nome: p.nome, email: p.email, telefone: p.telefoneE164 }, metas, ana ?? null);
}

/**
 * A montagem sem banco: a mesma de `montarPedidoDoRascunho`, com a idade já calculada e a anamnese mais recente já lida
 * (`null` sem ela; ignorada sem "Considerar a anamnese"). A avaliação manual (RN-127, `avaliar-assistente.ts`) monta o
 * pedido dos prontuários fictícios por aqui — o que ela mede é o que o worker envia.
 */
export function pedidoDoRascunho(
  base: { idade: number | null; sexo: string | null },
  alvo: AlvoDaMascara,
  metas: MetasDoRascunho,
  ana: Pick<AnamneseRow, 'data' | 'templateSnapshot' | 'respostas'> | null,
): PedidoDoRascunho {
  const dados: Partial<Record<Categoria, unknown>> = {
    idade: base.idade,
    sexo: base.sexo,
    metas: {
      meta_kcal: metas.metaKcal,
      proteina_pct: metas.proteinaPct,
      carboidrato_pct: metas.carboidratoPct,
      lipidio_pct: metas.lipidioPct,
      refeicoes: metas.refeicoes.map((r) => ({ nome: textoLivre(r.nome, alvo), horario: r.horario })),
      restricoes: textoLivre(metas.restricoes, alvo),
    },
  };
  if (metas.considerarAnamnese && ana) dados.anamnese = { data: ana.data, respostas: respostasMascaradas(ana, alvo) };
  return { dados, bytes: Buffer.byteLength(JSON.stringify(dados), 'utf8') };
}
