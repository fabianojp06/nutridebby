import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Aviso } from '@/components/ui/aviso';
import { MSG_EXAMES } from '@/modules/exames/constantes';
import { exameParaEditar } from '@/modules/exames/edicao';
import { marcasDeIa } from '@/modules/ia/tarefas';
import { MSG_BLOQUEADO } from '@/modules/pacientes/base';
import { formatarData, formatarDataNoFuso, hojeNoFuso } from '@/modules/pacientes/datas';
import { carregarProntuario } from '../../../prontuario';
import { EditarForm } from './editar-form';

export const dynamic = 'force-dynamic';

/**
 * Plano 22 (T4, US-371, RN-378): "Editar exame". Lê **só** por `exameParaEditar` (o exame pelos dois ids, o catálogo e o
 * `auditRead`, numa transação); exame de outro paciente → 404. Paciente bloqueado: o prontuário é só de leitura.
 */
export default async function EditarExamePage({ params }: PageProps<'/painel/pacientes/[id]/exames/[exameId]/editar'>) {
  const { id, exameId } = await params;
  const { ctx, tenant, paciente } = await carregarProntuario(id);
  const exame = await exameParaEditar(ctx, paciente.id, exameId);
  if (!exame) notFound();
  // "IA · conferido em {data}" na linha que veio da IA, como na lista (D8: vale mesmo com a IA desligada depois)
  const marcas = exame.valores.some((v) => v.iaTarefaId) ? await marcasDeIa(ctx, paciente.id) : new Map<string, Date>();
  const doExame = new Set(exame.valores.map((v) => v.iaTarefaId).filter(Boolean));
  const conferidoEm = Object.fromEntries([...marcas].filter(([tarefa]) => doExame.has(tarefa)).map(([tarefa, em]) => [tarefa, formatarDataNoFuso(em, tenant.fuso)]));
  const base = `/painel/pacientes/${paciente.id}/exames`;
  return (
    <section aria-labelledby="editar-exame" className="max-w-6xl space-y-4">
      <p>
        <Link href={base} className="inline-flex min-h-11 items-center text-link underline">
          {MSG_EXAMES.comparativo.voltar}
        </Link>
      </p>
      <h2 id="editar-exame" tabIndex={-1} className="text-lg font-semibold">
        {MSG_EXAMES.exame.editarExame}
      </h2>
      <p className="text-suave">{`${exame.titulo} · ${formatarData(exame.data)}`}</p>
      {exame.noAppEm && <Aviso tipo="aviso" papel="nenhum">{MSG_EXAMES.exame.avisoEditarNoApp}</Aviso>}
      {paciente.status === 'bloqueado' ? (
        <Aviso tipo="aviso" papel="nenhum">{MSG_BLOQUEADO}</Aviso>
      ) : (
        <EditarForm
          patientId={paciente.id}
          exameId={exame.id}
          exame={{ titulo: exame.titulo, data: exame.data, valores: exame.valores, updatedAt: exame.updatedAt }}
          conferidoEm={conferidoEm}
          hoje={hojeNoFuso(tenant.fuso)}
          catalogo={exame.catalogo.map(({ nome, unidade, sinonimos, componentes, faixas }) => ({ nome, unidade, sinonimos, componentes, faixas }))}
        />
      )}
      <p>
        <Link href={`${base}/${exame.id}/versoes`} className="inline-flex min-h-11 items-center text-link underline">
          {MSG_EXAMES.exame.versoes}
        </Link>
      </p>
    </section>
  );
}
