import Link from 'next/link';
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
 * (AG-D71; um `page.tsx` não define cabeçalho). Só o título, o local, as tabelas e o rodapé vão ao papel; o rodapé repete
 * em cada página (`print:fixed`). Sem abas (spec §4.1).
 */
export const dynamic = 'force-dynamic';

const M = MSG_VISOES.impressao;
const CELULA = 'border-b border-borda p-1 text-left align-top';

export default async function ImprimirAgendaPage({ searchParams }: PageProps<'/painel/agenda/imprimir'>) {
  const { ctx, tenant } = await requireNutri('/painel/agenda/imprimir');
  const hoje = hojeNoFuso(tenant.fuso);
  const f = lerFiltros(await searchParams, hoje);
  const a = await agendaParaImprimir(ctx, tenant, f);
  return (
    <main className="mx-auto w-full max-w-4xl space-y-4 p-4 md:p-6 print:max-w-none print:p-0 print:pb-12">
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <BotaoImprimir />
        <Link href={hrefDaAgenda(f)} className="inline-flex min-h-11 items-center text-link underline print:hidden">{M.voltar}</Link>
      </div>
      <h1 className="font-titulo text-2xl font-semibold">{a.titulo}</h1>
      <p>{M.local(a.local)}</p>
      {a.dias.length === 0 ? (
        <p>{MSG_VISOES.semConsultas}</p>
      ) : (
        a.dias.map((d) => (
          <table key={d.dia} className="w-full border-collapse text-sm print:break-inside-avoid">
            <caption className="py-1 text-left font-semibold">{`${diaCurto(d.dia)}/${d.dia.slice(0, 4)}`}</caption>
            <thead>
              <tr>
                {CAMPOS_DA_IMPRESSAO.map((k) => <th key={k} scope="col" className={CELULA}>{M.colunas[k]}</th>)}
              </tr>
            </thead>
            <tbody>
              {d.linhas.map((l, i) =>
                'bloqueado' in l ? (
                  <tr key={`b-${i}`}>
                    <td className={CELULA}>{l.bloqueado}</td>
                    <td className={CELULA} colSpan={CAMPOS_DA_IMPRESSAO.length - 1}>{M.bloqueado}</td>
                  </tr>
                ) : (
                  <tr key={`c-${i}`}>
                    {CAMPOS_DA_IMPRESSAO.map((k) => <td key={k} className={CELULA}>{l[k]}</td>)}
                  </tr>
                ),
              )}
            </tbody>
          </table>
        ))
      )}
      <footer className="border-t border-borda pt-2 text-sm print:fixed print:inset-x-0 print:bottom-0 print:bg-cartao print:px-0">{M.rodape}</footer>
    </main>
  );
}
