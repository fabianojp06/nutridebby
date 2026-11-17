import Link from 'next/link';
import { notFound } from 'next/navigation';
import { casasDecimais, formatarDecimal } from '@/lib/numero';
import { MSG_EXAMES } from '@/modules/exames/constantes';
import { versoesDoExame } from '@/modules/exames/edicao';
import { formatarData, formatarDataNoFuso } from '@/modules/pacientes/datas';
import { carregarProntuario } from '../../../prontuario';

export const dynamic = 'force-dynamic';

const X = MSG_EXAMES.exame;

/**
 * Plano 22 (T4, US-371, RN-378): "Versões anteriores" — o estado do exame antes de cada edição (título, data e linhas), a
 * justificativa, quem e quando. Lê só por `versoesDoExame` (pelos dois ids; `auditRead` de `exames_versoes` quando há
 * versão); exame de outro paciente → 404.
 */
export default async function VersoesDoExamePage({ params }: PageProps<'/painel/pacientes/[id]/exames/[exameId]/versoes'>) {
  const { id, exameId } = await params;
  const { ctx, tenant, paciente } = await carregarProntuario(id);
  const r = await versoesDoExame(ctx, paciente.id, exameId);
  if (!r) notFound();
  const base = `/painel/pacientes/${paciente.id}/exames`;
  return (
    <section aria-labelledby="versoes-exame" className="max-w-4xl space-y-4">
      <p>
        <Link href={base} className="inline-flex min-h-11 items-center text-link underline">
          {MSG_EXAMES.comparativo.voltar}
        </Link>
      </p>
      <h2 id="versoes-exame" tabIndex={-1} className="text-lg font-semibold">
        {X.versoes}
      </h2>
      <p className="text-suave">{`${r.exame.titulo} · ${formatarData(r.exame.data)}`}</p>
      {r.versoes.length === 0 && <p>{X.semVersoes}</p>}
      {r.versoes.map((v) => (
        <article key={v.versao} aria-labelledby={`versao-${v.versao}`} className="space-y-2 rounded-2xl border border-borda bg-cartao p-3">
          <h3 id={`versao-${v.versao}`} className="font-semibold">
            {X.versao(v.versao, formatarDataNoFuso(v.em, tenant.fuso), v.por)}
          </h3>
          <p className="wrap-break-word">{`${v.titulo} · ${formatarData(v.data)}`}</p>
          <p className="wrap-break-word text-sm">{v.justificativa ? X.justificativaDe(v.justificativa) : X.semJustificativa}</p>
          {v.valores.length > 0 && (
            <div role="region" aria-labelledby={`versao-${v.versao}-legenda`} tabIndex={0} className="overflow-x-auto focus-visible:outline-offset-[-3px]">
              <table className="w-full text-left">
                <caption id={`versao-${v.versao}-legenda`} className="sr-only">
                  {X.valoresDaVersao(v.versao)}
                </caption>
                <thead className="text-sm text-suave">
                  <tr>
                    <th scope="col">Marcador</th>
                    <th scope="col">Valor</th>
                    <th scope="col">Referência do laudo</th>
                  </tr>
                </thead>
                <tbody>
                  {v.valores.map((l, i) => (
                    <tr key={`${i}-${l.nome}`} className="border-t border-linha">
                      <td>{l.nome}</td>
                      <td>{`${formatarDecimal(l.valor, casasDecimais(l.valor))}${l.unidade ? ` ${l.unidade}` : ''}`}</td>
                      <td>{l.referencia ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      ))}
    </section>
  );
}
