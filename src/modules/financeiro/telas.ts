import { getDb, type Db } from '@/db/client';
import type { FinCategoriaRow, TipoLancamento } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { idValido } from '@/modules/pacientes/base';
import { hojeNoFuso } from '@/modules/pacientes/datas';
import { categoriasNaTransacao, configuracaoNaTransacao, type Configuracao } from './configuracoes';
import { exigirNutri } from './erros';
import {
  lancamentoNaTransacao,
  listaNaTransacao,
  pacienteNaTransacao,
  pacientesNaTransacao,
  type ListaDeLancamentos,
  type PacienteDoFinanceiro,
  type PacienteParaLancamento,
} from './lancamentos';
import type { FiltrosLista, LancamentoNaTela } from './tipos';

/**
 * RNF-301: "cada tela em uma transação". As telas dos lançamentos (Plano 20, T6) leem tudo o que mostram num `withTenant`
 * só — uma conexão do pool por requisição, uma fotografia consistente do banco —, com as mesmas consultas e a mesma
 * auditoria (RN-318) das funções avulsas de `lancamentos.ts` e `configuracoes.ts`, que continuam para quem só precisa de uma.
 */
type Deps = { db?: Db; agora?: Date };
type Tenant = { fuso: string };
export type CategoriaDoFormulario = { id: string; nome: string };

export type TelaDeLancamentos =
  | { config: null }
  | { config: Configuracao; lista: ListaDeLancamentos; categorias: FinCategoriaRow[]; paciente: PacienteDoFinanceiro | null };

/**
 * A lista (US-302, RN-306). Sem configuração (RN-301), só a configuração nula — o primeiro acesso não mostra mais nada.
 * Com ela: o paciente do filtro (chip, sem `auditRead`), a lista com o `ler` da RN-318 e as categorias do filtro.
 */
export async function telaDeLancamentos(ctx: TenantContext, tenant: Tenant, filtros: FiltrosLista, deps: Deps = {}): Promise<TelaDeLancamentos> {
  exigirNutri(ctx);
  const hoje = hojeNoFuso(tenant.fuso, deps.agora ?? new Date());
  return withTenant(
    ctx,
    async (tx) => {
      const config = await configuracaoNaTransacao(tx);
      if (!config) return { config: null };
      const paciente = idValido(filtros.pacienteId) ? await pacienteNaTransacao(tx, filtros.pacienteId) : null;
      const lista = await listaNaTransacao(tx, ctx.tenantId, hoje, filtros);
      const categorias = await categoriasNaTransacao(tx);
      return { config, lista, categorias, paciente };
    },
    deps.db ?? getDb(),
  );
}

export type FormularioNovo = {
  config: Configuracao;
  /** As categorias ativas do tipo, na ordem das Configurações. */
  categorias: CategoriaDoFormulario[];
  /** Só na entrada (F-D28): ativos e arquivados, sem bloqueados nem anonimizados. */
  pacientes: PacienteParaLancamento[] | undefined;
  /** O paciente pedido, se puder receber lançamento; senão ''. */
  escolhido: string;
  /** O paciente pedido está bloqueado (o aviso da §6.2). Anonimizado, de outro consultório ou inválido: false. */
  bloqueado: boolean;
};

/**
 * "Nova entrada" / "Nova saída" (US-301, §4.1). Sem configuração (RN-301) → null. `tipo` nulo (fora da lista): só a
 * configuração, para a página decidir entre o aviso e o 404. `pacienteId` só vale na entrada (F-D24); a action confere tudo
 * de novo sob a trava (RN-317).
 */
export async function formularioNovo(
  ctx: TenantContext,
  tipo: TipoLancamento | null,
  pacienteId: string | undefined,
  deps: Deps = {},
): Promise<FormularioNovo | null> {
  exigirNutri(ctx);
  const pedido = tipo === 'entrada' && idValido(pacienteId) ? pacienteId : null;
  return withTenant(
    ctx,
    async (tx) => {
      const config = await configuracaoNaTransacao(tx);
      if (!config) return null;
      if (!tipo) return { config, categorias: [], pacientes: undefined, escolhido: '', bloqueado: false };
      const categorias = (await categoriasNaTransacao(tx)).filter((c) => c.tipo === tipo && c.arquivadaEm === null).map((c) => ({ id: c.id, nome: c.nome }));
      const pacientes = tipo === 'entrada' ? await pacientesNaTransacao(tx) : undefined;
      const escolhido = pedido && pacientes?.some((p) => p.id === pedido) ? pedido : '';
      const bloqueado = !!pedido && !escolhido && !!(await pacienteNaTransacao(tx, pedido))?.bloqueado;
      return { config, categorias, pacientes, escolhido, bloqueado };
    },
    deps.db ?? getDb(),
  );
}

export type TelaDeEdicao = {
  lancamento: LancamentoNaTela;
  /** Do tipo do lançamento, ativas ou a atual (mesmo arquivada); vazia no cancelado e no anonimizado (só leitura). */
  categorias: CategoriaDoFormulario[];
};

/** A edição (US-302): o lançamento, com o `ler` da RN-318, e as categorias do formulário. Inválido ou de fora → null. */
export async function telaDeEdicao(ctx: TenantContext, tenant: Tenant, id: string, deps: Deps = {}): Promise<TelaDeEdicao | null> {
  exigirNutri(ctx);
  if (!idValido(id)) return null;
  const hoje = hojeNoFuso(tenant.fuso, deps.agora ?? new Date());
  return withTenant(
    ctx,
    async (tx) => {
      const l = await lancamentoNaTransacao(tx, id, hoje);
      if (!l) return null;
      if (l.anonimizado || l.situacao === 'cancelado') return { lancamento: l, categorias: [] };
      const categorias = (await categoriasNaTransacao(tx))
        .filter((c) => c.tipo === l.tipo && (c.arquivadaEm === null || c.id === l.categoria.id))
        .map((c) => ({ id: c.id, nome: c.nome }));
      return { lancamento: l, categorias };
    },
    deps.db ?? getDb(),
  );
}
