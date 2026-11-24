import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getEnv } from '@/env';
import { navegacaoDaPropriaOrigem } from '@/lib/navegacao-propria';
import { requireNutri } from '@/lib/tenant-session';
import { MSG_VISOES } from '@/modules/agenda/constantes';
import { diaCurto } from '@/modules/agenda/fuso';
import { agendaParaImprimir, CAMPOS_DA_IMPRESSAO } from '@/modules/agenda/impressao';
import { hrefDaAgenda, lerFiltros } from '@/modules/agenda/visoes';
import { hojeNoFuso } from '@/modules/pacientes/datas';
import { BotaoImprimir } from './botao-imprimir';

/**
 * Plano 23 (US-406, RN-418, RN-419, AG-D15): a agenda para imprimir ou salvar em PDF pelo navegador, com os mesmos
 * parâmetros da agenda. O render grava o `exportar` na transação da leitura (`agendaParaImprimir`); por isso a página é
 * dinâmica, o link da agenda é `prefetch={false}` e o `next.config.ts` manda `Cache-Control: no-store` para esta rota
 * (AG-D71; um `page.tsx` não define cabeçalho). Só o título, o local, a tabela e o rodapé vão ao papel. Uma tabela só, um
 * `<tbody>` por dia (o dia numa linha `th scope="rowgroup"`), e o rodapé no `<tfoot>`: o navegador repete o `<thead>` e o
 * `<tfoot>` em toda página impressa, dentro do fluxo — um rodapé `position: fixed` cobria a última linha de cada página
 * (revisão da T5). Sem abas (spec §4.1). Pedido de outro site (ou sem como confirmar a origem: molde da RN-493 dos
 * Relatórios) volta para a agenda com os mesmos filtros, sem ler nem gravar nada.
 */
export const dynamic = 'force-dynamic';

const M = MSG_VISOES.impressao;
const CELULA = 'border-b border-borda p-1 text-left align-top';

export default async function ImprimirAgendaPage({ searchParams }: PageProps<'/painel/agenda/imprimir'>) {
  const { ctx, tenant } = await requireNutri('/painel/agenda/imprimir');
  const hoje = hojeNoFuso(tenant.fuso);
  const f = lerFiltros(await searchParams, hoje);
  if (!navegacaoDaPropriaOrigem(await headers(), getEnv().APP_URL)) redirect(hrefDaAgenda(f));
  const a = await agendaParaImprimir(ctx, tenant, f);
  return (
    <main className="mx-auto w-full max-w-4xl space-y-4 p-4 md:p-6 print:max-w-none print:p-0">
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <BotaoImprimir />
        <Link href={hrefDaAgenda(f)} className="inline-flex min-h-11 items-center text-link underline print:hidden">{M.voltar}</Link>
      </div>
      <h1 className="font-titulo text-2xl font-semibold">{a.titulo}</h1>
      <p>{M.local(a.local)}</p>
      {a.dias.length === 0 ? (
        <>
          <p>{MSG_VISOES.semConsultas}</p>
          <p className="border-t border-borda pt-2 text-sm">{M.rodape}</p>
        </>
      ) : (
        // a 360 px a tabela rola dentro da própria região (com foco, para o teclado), nunca a página; no papel, sem rolagem
        <div role="region" aria-labelledby="impressao-caption" tabIndex={0} className="overflow-x-auto focus-visible:outline-offset-[-3px] print:overflow-visible">
        <table className="w-full border-collapse text-sm">
          <caption id="impressao-caption" className="sr-only">{`${a.titulo}. ${M.local(a.local)}`}</caption>
          <thead>
            <tr>
              {CAMPOS_DA_IMPRESSAO.map((k) => <th key={k} scope="col" className={CELULA}>{M.colunas[k]}</th>)}
            </tr>
          </thead>
          {a.dias.map((d) => (
            <tbody key={d.dia}>
              <tr className="print:break-after-avoid">
                <th scope="rowgroup" colSpan={CAMPOS_DA_IMPRESSAO.length} className="pt-3 pb-1 text-left font-semibold">{`${diaCurto(d.dia)}/${d.dia.slice(0, 4)}`}</th>
              </tr>
              {d.linhas.map((l, i) =>
                'bloqueado' in l ? (
                  <tr key={`b-${i}`} className="print:break-inside-avoid">
                    <td className={CELULA}>{l.bloqueado}</td>
                    <td className={CELULA} colSpan={CAMPOS_DA_IMPRESSAO.length - 1}>{M.bloqueado}</td>
                  </tr>
                ) : (
                  <tr key={`c-${i}`} className="print:break-inside-avoid">
                    {CAMPOS_DA_IMPRESSAO.map((k) => <td key={k} className={CELULA}>{l[k]}</td>)}
                  </tr>
                ),
              )}
            </tbody>
          ))}
          <tfoot>
            <tr>
              <td colSpan={CAMPOS_DA_IMPRESSAO.length} className="border-t border-borda pt-2 text-sm">{M.rodape}</td>
            </tr>
          </tfoot>
        </table>
        </div>
      )}
    </main>
  );
}
