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
        with conv as (
          select c.patient_id, p.nome
            from chat_conversas c
            join patients p on p.tenant_id = c.tenant_id and p.id = c.patient_id
            left join patient_cadastro pc on pc.tenant_id = p.tenant_id and pc.patient_id = p.id
           where c.tenant_id = app_current_tenant()
             and (c.liberada_em is not null
                  or exists (select 1 from chat_mensagens i where i.tenant_id = c.tenant_id and i.patient_id = c.patient_id and i.recado_id is null))
             and ${condicaoDaBusca(o.busca)}
        ), ultima as (
          select distinct on (m.patient_id) m.patient_id, m.criada_em, m.autor, m.recado_id is not null as recado, m.anexo_tipo
            from chat_mensagens m join conv on conv.patient_id = m.patient_id
           where m.tenant_id = app_current_tenant()
           order by m.patient_id, m.criada_em desc, m.id desc
        ), nao_lidas as (
          select m.patient_id, count(*)::int as n, bool_or(m.risco is not null) as risco
            from chat_mensagens m
            join conv on conv.patient_id = m.patient_id
            left join chat_leituras l on l.tenant_id = m.tenant_id and l.patient_id = m.patient_id and l.lado = 'consultorio'
           where m.tenant_id = app_current_tenant() and m.autor = 'paciente' and m.criada_em > coalesce(l.lida_ate, '-infinity')
           group by m.patient_id
        )
        select conv.patient_id, conv.nome, (extract(epoch from u.criada_em) * 1000)::float8 as quando_ms, u.autor, u.recado, u.anexo_tipo,
               coalesce(nl.n, 0) as nao_lidas, coalesce(nl.risco, false) as risco
          from conv
          left join ultima u on u.patient_id = conv.patient_id
          left join nao_lidas nl on nl.patient_id = conv.patient_id
         where ${o.filtro === 'nao-lidas' ? sql`coalesce(nl.n, 0) > 0` : sql`true`}
         order by coalesce(nl.risco, false) desc, u.criada_em desc nulls last, conv.patient_id
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

/** RN-459: conversas com mensagem do paciente não lida (o menu soma `contadorDeDuvidas`, T6). Sem auditRead. */
export async function contadorDeMensagens(ctx: TenantContext, db: Db = getDb()): Promise<number> {
  exigirNutri(ctx);
  const r = await withTenant(
    ctx,
    (tx) =>
      tx.execute<{ n: number }>(sql`
        select count(distinct m.patient_id)::int as n
          from chat_mensagens m
          left join chat_leituras l on l.tenant_id = m.tenant_id and l.patient_id = m.patient_id and l.lado = 'consultorio'
         where m.tenant_id = app_current_tenant() and m.autor = 'paciente' and m.criada_em > coalesce(l.lida_ate, '-infinity')`),
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
