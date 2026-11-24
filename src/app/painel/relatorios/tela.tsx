import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { JSX } from 'react';
import { classeDoBotao } from '@/components/ui/botao';
import type { TenantContext } from '@/db/tenant';
import { partesNoFuso } from '@/modules/agenda/fuso';
import { podeVerSecao, secoesPermitidas } from '@/modules/relatorios/acesso';
import { MSG_RELATORIOS, type Secao } from '@/modules/relatorios/constantes';
import { lerSecao } from '@/modules/relatorios/leitura';
import { opcoesDeMes } from '@/modules/relatorios/periodo';
import { AbasDosRelatorios, CriterioDoRanking } from './abas';
import { FiltrosDoPeriodo } from './filtros';
import { ConteudoDaSecao, semDados } from './secoes';
import { ACESSO_DA_NUTRI, filtroDaUrl, paraBusca, urlDaImpressao, urlDoCsv, type ParametrosDaUrl } from './url';

const M = MSG_RELATORIOS;
export const ID_TITULO = 'titulo-relatorios';

/** O consultório como a página o recebe de `requireNutri` (`createdAt`: o primeiro cadastro, RE-D48). */
export type TenantDaTela = { fuso: string; createdAt?: Date | null };

/**
 * Plano 26, T3 (§4.1, §7.1): a tela de uma seção dos Relatórios — h1 "Relatórios", as abas, o período, o h2 da seção com
 * "Baixar CSV" e "Ver versão para imprimir" (o link da impressão com `prefetch={false}`: o render dela grava o `exportar`,
 * RN-493) e o conteúdo. Uma transação de leitura (a da seção); nenhum `auditRead` (agregado; o Ranking é lista nominal
 * como a de pacientes, RN-493). Função assíncrona que devolve JSX (não componente assíncrono): cada `page.tsx` chama
 * `requireNutri` e passa a sessão (RE-D51).
 */
export async function telaDosRelatorios(secao: Secao, s: { ctx: TenantContext; tenant: TenantDaTela }, parametros: ParametrosDaUrl): Promise<JSX.Element> {
  const acesso = ACESSO_DA_NUTRI;
  // RN-480: a T6 troca por "Sem permissão"; no PR 1 a nutricionista vê todas as seções
  if (!podeVerSecao(acesso, secao)) notFound();
  const agora = new Date();
  const filtro = filtroDaUrl(paraBusca(parametros), agora, s.tenant.fuso);
  const { periodo, por } = filtro;
  const dados = await lerSecao(secao, s.ctx, s.tenant, periodo, { acesso, localId: null, por });
  const primeiroCadastro = s.tenant.createdAt instanceof Date ? partesNoFuso(s.tenant.createdAt, s.tenant.fuso).data : null;
  const opcoes = opcoesDeMes(primeiroCadastro, partesNoFuso(agora, s.tenant.fuso).data);
  const tituloId = 'secao-titulo';
  return (
    <>
      <h1 id={ID_TITULO} className="font-titulo text-2xl font-semibold">
        {M.titulo}
      </h1>
      <AbasDosRelatorios atual={secao} secoes={secoesPermitidas(acesso)} periodo={filtro.doLink} />
      <FiltrosDoPeriodo secao={secao} opcoes={opcoes} periodo={periodo} escolhido={filtro.escolhido} erro={filtro.erro} por={por} />
      <section aria-labelledby={tituloId} className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id={tituloId} className="font-titulo text-xl font-semibold">
            {M.titulosDaSecao[secao]}
          </h2>
          <div className="flex flex-wrap gap-2" data-guia="exportar">
            {/* navegação comum (o navegador baixa o anexo e a página fica): nunca fetch, nunca prefetch */}
            <a href={urlDoCsv(secao, periodo, por)} className={classeDoBotao('secundario')}>
              {M.filtros.baixarCsv}
            </a>
            <Link href={urlDaImpressao(secao, periodo, por)} prefetch={false} className={classeDoBotao('secundario')}>
              {M.filtros.verImpressao}
            </Link>
          </div>
        </div>
        {secao === 'ranking' && (
          <>
            <p className="max-w-3xl text-sm text-suave">{M.ranking.aviso}</p>
            <CriterioDoRanking por={por} periodo={filtro.doLink} />
          </>
        )}
        {semDados(secao, dados) ? <p>{M.vazio}</p> : <ConteudoDaSecao secao={secao} dados={dados} />}
      </section>
    </>
  );
}
