import { and, asc, eq, inArray } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { exams } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { idValido } from '@/modules/pacientes/base';
import { agruparMarcadores, chaveDoMarcador } from '@/modules/pacientes/exames';
import { auditRead } from '@/modules/plataforma/audit';
import { exigirNutri } from './catalogo';
import { classificarNeutra, type Neutra } from './classificacao';
import { COMPARAR_MAX, COMPARAR_MIN } from './constantes';

/**
 * Plano 22 (T5b, US-374, RN-384, EP-D20): o comparativo entre datas — de 2 a 6 exames **do paciente** (ids de outro
 * paciente, repetidos ou malformados não contam; o filtro é pelo `patient_id` na própria consulta), a data mais antiga à
 * esquerda (empate pela criação), as linhas por `agruparMarcadores` (nome normalizado + unidade: unidades diferentes em
 * linhas separadas), a célula com o valor, a unidade e a classificação neutra da linha daquele exame. **Sem** categoria do
 * consultório e **sem** nota de interpretação (RN-383: a nota nunca vai ao comparativo). Um `auditRead` (entidade
 * `exames`) por exame mostrado, na mesma transação; fora dos limites, nada é devolvido nem registrado. Só a sessão `nutri`.
 */

export type CelulaDoComparativo = { valor: number; unidade: string | null; neutra: Neutra | null };
export type Comparativo = {
  exames: { id: string; titulo: string; data: string }[];
  linhas: { marcador: string; unidade: string | null; celulas: (CelulaDoComparativo | null)[] }[];
  /** Algum marcador aparece com unidades diferentes (a tela mostra a nota da §6.2). */
  unidadesSeparadas: boolean;
};

/** Mais ids do que isto na URL nem vai ao banco (depois do filtro sobraria mais de 6 do paciente ou é lixo). */
const IDS_MAX_NA_URL = 30;

export async function comparativo(ctx: TenantContext, patientId: string, ids: string[], deps: { db?: Db } = {}): Promise<Comparativo | { erro: 'quantidade' }> {
  exigirNutri(ctx);
  const unicos = [...new Set(ids.filter((id) => typeof id === 'string' && idValido(id)))];
  if (!idValido(patientId) || unicos.length < COMPARAR_MIN || unicos.length > IDS_MAX_NA_URL) return { erro: 'quantidade' };
  const lidos = await withTenant(
    ctx,
    async (tx) => {
      const r = await tx
        .select({ id: exams.id, titulo: exams.titulo, data: exams.data, valores: exams.valores })
        .from(exams)
        .where(and(eq(exams.patientId, patientId), inArray(exams.id, unicos)))
        .orderBy(asc(exams.data), asc(exams.createdAt), asc(exams.id));
      if (r.length < COMPARAR_MIN || r.length > COMPARAR_MAX) return null;
      await auditRead(
        tx,
        r.map((e) => ({ entidade: 'exames', entidadeId: e.id, patientId })),
      );
      return r;
    },
    deps.db ?? getDb(),
  );
  if (!lidos) return { erro: 'quantidade' };

  // a ordem e o nome de cada linha são os de agruparMarcadores (o nome da primeira data); a célula é a linha do exame
  const series = agruparMarcadores(lidos);
  const porExame = lidos.map((e) => {
    const m = new Map<string, (typeof e.valores)[number]>();
    for (const v of e.valores) {
      const chave = chaveDoMarcador(v.nome, v.unidade);
      if (!m.has(chave)) m.set(chave, v);
    }
    return m;
  });
  const linhas = series.map((s) => {
    const chave = chaveDoMarcador(s.nome, s.unidade);
    return {
      marcador: s.nome,
      unidade: s.unidade,
      celulas: porExame.map((m): CelulaDoComparativo | null => {
        const v = m.get(chave);
        return v ? { valor: v.valor, unidade: v.unidade, neutra: classificarNeutra(v.valor, v.refMin, v.refMax) } : null;
      }),
    };
  });
  const nomes = new Map<string, Set<string>>();
  for (const l of linhas) {
    const [nome, unidade] = chaveDoMarcador(l.marcador, l.unidade).split('\u0000');
    nomes.set(nome, (nomes.get(nome) ?? new Set()).add(unidade));
  }
  return {
    exames: lidos.map((e) => ({ id: e.id, titulo: e.titulo, data: e.data })),
    linhas,
    unidadesSeparadas: [...nomes.values()].some((u) => u.size > 1),
  };
}

/** Os ids da URL (`?ids=a&ids=b` do formulário, ou `?ids=a,b`), sem vazios. */
export function idsDaBusca(valor: string | string[] | undefined): string[] {
  const lista = Array.isArray(valor) ? valor : valor === undefined ? [] : [valor];
  return lista.flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean);
}
