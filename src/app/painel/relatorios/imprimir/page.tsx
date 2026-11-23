import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { BotaoLink } from '@/components/ui/botao';
import { getEnv } from '@/env';
import { requireNutri } from '@/lib/tenant-session';
import { partesNoFuso } from '@/modules/agenda/fuso';
import { formatarData } from '@/modules/pacientes/datas';
import { podeVerSecao } from '@/modules/relatorios/acesso';
import { MSG_RELATORIOS } from '@/modules/relatorios/constantes';
import { lerSecao } from '@/modules/relatorios/leitura';
import { mesNumerico } from '@/modules/relatorios/periodo';
import { exportacaoNaLeitura } from '@/modules/relatorios/registro';
import { ConteudoDaSecao, semDados } from '../secoes';
import { ACESSO_DA_NUTRI, BASE, filtroDaUrl, navegacaoDaPropriaOrigem, paraBusca, secaoDaUrl, urlDaSecao } from '../url';
import { BotaoImprimir } from './imprimir';

export const dynamic = 'force-dynamic';

const M = MSG_RELATORIOS;
const ROTA = '/painel/relatorios/imprimir';

/** RN-495: o `<title>` (nome sugerido do PDF) "Relatório de {seção} — {consultório}", sem dado de paciente. */
export async function generateMetadata({ searchParams }: PageProps<'/painel/relatorios/imprimir'>): Promise<Metadata> {
  const { tenant } = await requireNutri(ROTA);
  const sp = await searchParams;
  const secao = secaoDaUrl(typeof sp.secao === 'string' ? sp.secao : null);
  return { title: secao ? M.impressao.tituloDaAba(M.titulosDaSecao[secao], tenant.nomeExibicao) : M.titulo };
}

/**
 * Plano 26, T3 (US-487, RN-493, RN-495): a versão para imprimir de uma seção — o cabeçalho (consultório, "Relatório de
 * {seção}", período, local, "Gerado em"), as mesmas tabelas da tela sem as barras e o rodapé da §6.2; "Imprimir ou salvar
 * em PDF" e "Voltar aos relatórios" ficam fora do papel (o menu do painel já é `print:hidden`). O render grava o
 * `exportar` (entidade `relatorios`) **na transação da leitura** (`exportacaoNaLeitura`: no Ranking, um por paciente da
 * lista). Por isso o link é `prefetch={false}`, e um pedido de outro site (ou sem como confirmar a origem) volta para a
 * seção sem ler nem gravar nada; período inválido volta com `?erro=periodo`. Sem `auditRead`. `Cache-Control: no-store`
 * em `next.config.ts`.
 */
export default async function ImprimirRelatorio({ searchParams }: PageProps<'/painel/relatorios/imprimir'>) {
  const { ctx, tenant } = await requireNutri(ROTA);
  const sp = paraBusca(await searchParams);
  const secao = secaoDaUrl(sp.get('secao'));
  if (!secao) redirect(BASE);
  // RN-480: a T6 troca por "Sem permissão"; no PR 1 a nutricionista vê todas as seções
  if (!podeVerSecao(ACESSO_DA_NUTRI, secao)) notFound();
  if (!navegacaoDaPropriaOrigem(await headers(), getEnv().APP_URL)) redirect(urlDaSecao(secao));
  const agora = new Date();
  const filtro = filtroDaUrl(sp, agora, tenant.fuso);
  if (filtro.erro) redirect(urlDaSecao(secao, { erro: 'periodo' }));
  if (!filtro.porValido) redirect(urlDaSecao(secao));
  const { periodo, por } = filtro;
  const dados = await lerSecao(secao, ctx, tenant, periodo, { acesso: ACESSO_DA_NUTRI, localId: null, por }, { naMesmaTransacao: exportacaoNaLeitura(secao, periodo, null) });
  const gerado = partesNoFuso(agora, tenant.fuso);
  const I = M.impressao;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 print:hidden">
        <BotaoImprimir />
        <BotaoLink variante="secundario" href={urlDaSecao(secao, { de: periodo.de, ate: periodo.ate, por: por === 'receita' ? por : undefined })}>
          {I.voltar}
        </BotaoLink>
      </div>
      <header className="space-y-1">
        <p className="font-semibold">{tenant.nomeExibicao}</p>
        <h1 className="font-titulo text-2xl font-semibold">{I.titulo(M.titulosDaSecao[secao])}</h1>
        <p>{I.periodo(mesNumerico(periodo.de), mesNumerico(periodo.ate))}</p>
        <p>{I.localTodos}</p>
        <p>{I.geradoEm(formatarData(gerado.data), gerado.hora)}</p>
      </header>
      {semDados(secao, dados) ? <p>{M.vazio}</p> : <ConteudoDaSecao secao={secao} dados={dados} impressao />}
      <footer className="border-t border-linha pt-3 text-sm">
        <p>{I.rodape}</p>
      </footer>
    </div>
  );
}
