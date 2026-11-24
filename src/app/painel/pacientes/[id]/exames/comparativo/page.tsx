import Link from 'next/link';
import { Aviso } from '@/components/ui/aviso';
import { comparativo, idsDaBusca } from '@/modules/exames/comparativo';
import { MSG_EXAMES } from '@/modules/exames/constantes';
import { carregarProntuario } from '../../prontuario';
import { TabelaComparativa } from '../tabela-classificada';

export const dynamic = 'force-dynamic';

/**
 * Plano 22 (T5b, US-374, RN-384, spec §7 "Comparativo"): a tabela marcador × datas de 2 a 6 exames do paciente
 * (`?ids=a&ids=b`, do formulário da aba Exames; `?ids=a,b` também vale). Ids de outro paciente são ignorados pelo módulo;
 * fora dos limites, a frase de apoio da aba, sem tabela nem leitura registrada. O título do prontuário (h1) é o nome do
 * paciente; o desta tela é o h2 (como o detalhe do exame e "Versões anteriores").
 */
export default async function ComparativoPage({ params, searchParams }: PageProps<'/painel/pacientes/[id]/exames/comparativo'>) {
  const { id } = await params;
  const { ctx, paciente } = await carregarProntuario(id);
  const busca = await searchParams;
  const r = await comparativo(ctx, paciente.id, idsDaBusca(busca.ids));
  return (
    <section aria-labelledby="comparativo-titulo" className="max-w-6xl space-y-4">
      <p>
        <Link href={`/painel/pacientes/${paciente.id}/exames`} className="inline-flex min-h-11 items-center text-link underline">
          {MSG_EXAMES.comparativo.voltar}
        </Link>
      </p>
      <h2 id="comparativo-titulo" tabIndex={-1} className="text-lg font-semibold">
        {MSG_EXAMES.comparativo.titulo}
      </h2>
      {'erro' in r ? (
        <Aviso tipo="aviso" papel="nenhum">
          {MSG_EXAMES.exame.apoioComparar}
        </Aviso>
      ) : (
        <TabelaComparativa id="comparativo" comparativo={r} />
      )}
    </section>
  );
}
