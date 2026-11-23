/**
 * Plano 25 (US-442, RN-453, RN-459, RN-463; CH-D42, CH-D66): a caixa de mensagens, o contador do menu e a lista da "Nova
 * conversa". Só a sessão `nutri`; sem auditRead (devolvem nome, data, tipo, contagem e selo — como a lista de pacientes e a
 * fila de dúvidas, regra 8) e nunca o texto (teste das chaves).
 */
import { sql, type SQL } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { withTenant, type TenantContext } from '@/db/tenant';
import { PACIENTES_POR_PAGINA } from './constantes';
import { exigirNutri } from './sessao';

/** O tipo da última mensagem da conversa (§6.2 "Caixa"): o anexo e o recado antes do autor. */
export type TipoDaUltima = 'paciente' | 'nutri' | 'imagem' | 'pdf' | 'recado';
export type ItemDaCaixa = { patientId: string; nome: string; quando: Date | null; tipo: TipoDaUltima | null; naoLidas: number; riscoNaoLido: boolean };
export const ITENS_DA_CAIXA_POR_PAGINA = 50;

/**
 * O marcador do consultório de cada conversa (`lida.ate`; sem marcador, `-infinity`). O `offset 0` impede o planejador de
 * achatar a subconsulta: achatada, a comparação vira `criada_em > coalesce((subplano), …)`, que a RLS de chat_mensagens
 * (barreira de segurança) não promove a condição do índice, e a contagem lê todas as mensagens da conversa em vez de só as
 * novas. Com a cerca, `criada_em > lida.ate` entra no índice (tenant_id, patient_id, criada_em, id). EXPLAIN no relatório
 * da T3 (revisão, I1).
 */
const MARCADOR_DO_CONSULTORIO = sql`cross join lateral (
            select coalesce((select l.lida_ate from chat_leituras l
                              where l.tenant_id = c.tenant_id and l.patient_id = c.patient_id and l.lado = 'consultorio'),
                            '-infinity'::timestamptz) as ate
            offset 0) lida`;

const paginaValida = (p: unknown) => (typeof p === 'number' && Number.isInteger(p) && p >= 1 ? p : 1);

/**
 * O mesmo critério de busca da lista de pacientes (`listarPacientes`): sem acento, pelo nome, pelo nome social ou pelo
 * e-mail; `%`, `_` e `\` digitados são literais.
 */
function condicaoDaBusca(busca: string | undefined): SQL {
  const b = busca?.trim();
  if (!b) return sql`true`;
  const termo = `%${b.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return sql`(unaccent(p.nome) ilike unaccent(${termo}) or unaccent(pc.nome_social) ilike unaccent(${termo}) or p.email::text ilike ${termo})`;
}

/**
 * US-442: as conversas, em uma consulta — só as liberadas ou com mensagem individual (a que só tem recados se acompanha em
 * "Recados", CH-D42) —, com o nome de registro, o quando e o tipo da última mensagem, as não lidas (mensagens do paciente
 * depois do marcador do consultório) e o selo de risco não lido. Ordem: risco não lido, depois a mais recente. 50 por página.
 */
export async function caixaDeMensagens(
  ctx: TenantContext,
  o: { filtro: 'todas' | 'nao-lidas'; busca?: string; pagina?: number },
  db: Db = getDb(),
): Promise<{ itens: ItemDaCaixa[]; haMais: boolean }> {
  exigirNutri(ctx);
  const pagina = paginaValida(o.pagina);
  const r = await withTenant(
    ctx,
    (tx) =>
      tx.execute<{ patient_id: string; nome: string; quando_ms: number | null; autor: string | null; recado: boolean | null; anexo_tipo: string | null; nao_lidas: number; risco: boolean }>(sql`
        select c.patient_id, p.nome, (extract(epoch from u.criada_em) * 1000)::float8 as quando_ms, u.autor, u.recado, u.anexo_tipo,
               nl.n as nao_lidas, nl.risco
          from chat_conversas c
          join patients p on p.tenant_id = c.tenant_id and p.id = c.patient_id
          left join patient_cadastro pc on pc.tenant_id = p.tenant_id and pc.patient_id = p.id
          ${MARCADOR_DO_CONSULTORIO}
          -- a última mensagem e as não lidas por conversa, pelo índice (tenant_id, patient_id, criada_em, id): nada varre o
          -- histórico do consultório (revisão da T3, I1)
          left join lateral (
            select m.criada_em, m.autor, m.recado_id is not null as recado, m.anexo_tipo
              from chat_mensagens m
             where m.tenant_id = c.tenant_id and m.patient_id = c.patient_id
             order by m.criada_em desc, m.id desc
             limit 1) u on true
          cross join lateral (
            select count(*)::int as n, coalesce(bool_or(m.risco is not null), false) as risco
              from chat_mensagens m
             where m.tenant_id = c.tenant_id and m.patient_id = c.patient_id and m.autor = 'paciente'
               and m.criada_em > lida.ate) nl
         where c.tenant_id = app_current_tenant()
           and (c.liberada_em is not null
                or exists (select 1 from chat_mensagens i where i.tenant_id = c.tenant_id and i.patient_id = c.patient_id and i.recado_id is null))
           and ${condicaoDaBusca(o.busca)}
           and ${o.filtro === 'nao-lidas' ? sql`nl.n > 0` : sql`true`}
         order by nl.risco desc, u.criada_em desc nulls last, c.patient_id
         limit ${ITENS_DA_CAIXA_POR_PAGINA + 1} offset ${(pagina - 1) * ITENS_DA_CAIXA_POR_PAGINA}`),
    db,
  );
  const linhas = r.rows;
  return {
    haMais: linhas.length > ITENS_DA_CAIXA_POR_PAGINA,
    itens: linhas.slice(0, ITENS_DA_CAIXA_POR_PAGINA).map((l) => ({
      patientId: l.patient_id,
      nome: l.nome,
      // só para mostrar ("há 5 min"); nunca volta como filtro de criada_em (CH-D40)
      quando: l.quando_ms === null ? null : new Date(l.quando_ms),
      tipo: l.autor === null ? null : l.recado ? 'recado' : l.anexo_tipo === 'pdf' ? 'pdf' : l.anexo_tipo === 'imagem' ? 'imagem' : (l.autor as 'nutri' | 'paciente'),
      naoLidas: l.nao_lidas,
      riscoNaoLido: l.risco,
    })),
  };
}

/**
 * RN-459: conversas com mensagem do paciente não lida (o menu soma `contadorDeDuvidas`, T6). Parte de chat_conversas e procura
 * uma mensagem depois do marcador pelo índice da conversa (revisão da T3, I1). Sem auditRead.
 */
export async function contadorDeMensagens(ctx: TenantContext, db: Db = getDb()): Promise<number> {
  exigirNutri(ctx);
  const r = await withTenant(
    ctx,
    (tx) =>
      tx.execute<{ n: number }>(sql`
        select count(*)::int as n
          from chat_conversas c
          ${MARCADOR_DO_CONSULTORIO}
         where c.tenant_id = app_current_tenant()
           and exists (select 1 from chat_mensagens m
                        where m.tenant_id = c.tenant_id and m.patient_id = c.patient_id and m.autor = 'paciente'
                          and m.criada_em > lida.ate)`),
    db,
  );
  return r.rows[0].n;
}

/**
 * CH-D66 ("Nova conversa"): titulares `ativo` não anonimizados, com ou sem conversa, em ordem alfabética do nome de registro
 * (sem acento, empate pelo id), com a busca da lista de pacientes, 50 por página. Só id, nome e se tem conta. Sem auditRead.
 */
export async function pacientesParaNovaConversa(
  ctx: TenantContext,
  o: { busca?: string; pagina?: number },
  db: Db = getDb(),
): Promise<{ itens: { id: string; nome: string; temConta: boolean }[]; haMais: boolean }> {
  exigirNutri(ctx);
  const pagina = paginaValida(o.pagina);
  const r = await withTenant(
    ctx,
    (tx) =>
      tx.execute<{ id: string; nome: string; tem_conta: boolean }>(sql`
        select p.id, p.nome, p.user_id is not null as tem_conta
          from patients p
          left join patient_cadastro pc on pc.tenant_id = p.tenant_id and pc.patient_id = p.id
         where p.tenant_id = app_current_tenant() and p.status = 'ativo' and p.anonimizado_em is null and ${condicaoDaBusca(o.busca)}
         order by unaccent(lower(p.nome)), p.id
         limit ${PACIENTES_POR_PAGINA + 1} offset ${(pagina - 1) * PACIENTES_POR_PAGINA}`),
    db,
  );
  return {
    haMais: r.rows.length > PACIENTES_POR_PAGINA,
    itens: r.rows.slice(0, PACIENTES_POR_PAGINA).map((x) => ({ id: x.id, nome: x.nome, temConta: x.tem_conta })),
  };
}
