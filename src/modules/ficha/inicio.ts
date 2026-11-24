import { getDb, type Db } from '@/db/client';
import { TenantContextError, withTenant, type TenantContext } from '@/db/tenant';
import { idValido } from '@/modules/pacientes/base';
import { auditRead } from '@/modules/plataforma/audit';
import { SECOES_DA_FICHA } from './secoes';
import { LIMITE_DA_SECAO } from './secoes/comum';
import type { ItemDaSecao, PacienteDaSecao, ResumoDaSecao, SecaoDaFicha, TenantDaSecao } from './tipos';

export type SecaoNoInicio = {
  id: string;
  titulo: string;
  aba: string;
  verTodos: string /* já resolvido */;
  resumo: ResumoDaSecao;
  podeAdicionar: boolean;
  /** Plano 25: o rótulo do total já resolvido (`SecaoDaFicha.rotuloDoTotal`). */
  rotuloDoTotal?: string;
};

/** Só as chaves do contrato (RN-277): uma seção não passa adiante coluna que não devia. */
const comoItem = (i: Omit<ItemDaSecao, 'noApp'>): ItemDaSecao => ({
  id: i.id,
  rotulo: i.rotulo,
  data: i.data,
  ...(i.situacao === undefined ? {} : { situacao: i.situacao }),
  noApp: false,
  href: i.href,
});

/** "Ver todos": o `verTodos` da seção (absoluto, fora da ficha) ou a aba dela na ficha ('' = Início). */
const verTodosDa = (s: SecaoDaFicha, patientId: string): string => {
  if (s.verTodos) return s.verTodos(patientId);
  const base = `/painel/pacientes/${patientId}`;
  return s.aba ? `${base}/${s.aba}` : base;
};

/**
 * Plano 18 (D14, RN-277): as seções do Início da ficha, todas numa transação da sessão `nutri`, uma consulta por seção.
 * Só contador e rótulos genéricos; os arquivos das seções nunca gravam leitura. A seção que declara `leitura` (nenhuma das
 * 8 do Plano 18; o Financeiro do Plano 20) ganha aqui UM auditRead da entidade, na mesma transação, só quando devolve itens.
 * Seção indisponível nem com algum registro (documentos desligados) não é consultada. Aqui todo item sai com
 * `noApp: false`: o selo é decidido no contexto do paciente (`noAppDoPaciente`, RN-279), e a página Início o aplica.
 */
export async function secoesDoInicio(
  ctx: TenantContext,
  tenant: TenantDaSecao,
  paciente: PacienteDaSecao,
  deps: { db?: Db; secoes?: readonly SecaoDaFicha[] /* só para teste */ } = {},
): Promise<SecaoNoInicio[]> {
  if (ctx.role !== 'nutri') throw new TenantContextError('o Início da ficha é só da sessão da nutricionista');
  if (!idValido(paciente.id)) return [];
  const secoes = deps.secoes ?? SECOES_DA_FICHA;
  return withTenant(
    ctx,
    async (tx) => {
      const lista: SecaoNoInicio[] = [];
      for (const s of secoes) {
        // `disponivel` só cresce com o total (RN-192): se nem com registros a seção aparece, nem consulta
        if (!s.disponivel(tenant, paciente, Number.POSITIVE_INFINITY)) continue;
        const r = await s.resumo(tx, paciente.id, tenant.fuso);
        if (!s.disponivel(tenant, paciente, r.total)) continue;
        if (s.leitura && r.ultimos.length > 0) await auditRead(tx, { entidade: s.leitura.entidade, entidadeId: null, patientId: paciente.id });
        lista.push({
          id: s.id,
          titulo: s.titulo,
          aba: s.aba,
          verTodos: verTodosDa(s, paciente.id),
          resumo: { total: r.total, ultimos: r.ultimos.slice(0, LIMITE_DA_SECAO).map(comoItem) },
          podeAdicionar: r.podeAdicionar !== false,
          ...(s.rotuloDoTotal ? { rotuloDoTotal: s.rotuloDoTotal(r.total) } : {}),
        });
      }
      return lista;
    },
    deps.db ?? getDb(),
  );
}
