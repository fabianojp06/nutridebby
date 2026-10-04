import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { signFileUrl } from '@/lib/signed-url';
import { quandoComFuso } from '@/modules/agenda/fuso';
import { MSG_DIARIO } from '@/modules/portal/diario-constantes';
import { MSG_BLOQUEADO } from '@/modules/pacientes/base';
import { abrirRegistro } from '@/modules/portal/diario-nutri';
import { ComentarioForm } from '../comentario-form';

export const dynamic = 'force-dynamic';

export default async function RegistroDoDiarioPage({ params }: PageProps<'/painel/diarios/[id]'>) {
  const { id } = await params;
  const { ctx, tenant } = await requireNutri(`/painel/diarios/${id}`);
  const r = await abrirRegistro(ctx, id);
  if (!r) notFound();
  return (
    <>
      <main className="max-w-2xl space-y-4 p-6">
        <p><Link href="/painel/diarios" className="underline">Diários</Link></p>
        <h1 className="text-2xl font-semibold">{`${r.paciente} — ${r.refeicao}`}</h1>
        <p>{quandoComFuso(r.dataHora, tenant.fuso)}</p>
        <p><Link href={`/painel/pacientes/${r.patientId}`} className="underline">Abrir prontuário</Link></p>
        {r.texto && <p className="whitespace-pre-line">{r.texto}</p>}
        {r.foto.estado === 'pronta' && (
          // eslint-disable-next-line @next/next/no-img-element -- URL assinada de 5 min
          <img src={signFileUrl(r.foto.caminho)} alt={`Foto do registro de ${r.refeicao}`} className="max-h-96 rounded" />
        )}
        {r.foto.estado === 'processando' && <p role="status">{MSG_DIARIO.processando}</p>}
        {r.foto.estado === 'falhou' && <p>{MSG_DIARIO.fotoFalhou}</p>}
        {r.somenteLeitura ? (
          <>
            {r.comentario && <p className="whitespace-pre-line">{`Comentário da nutricionista: ${r.comentario}`}</p>}
            <p role="status">{MSG_BLOQUEADO}</p>
          </>
        ) : (
          <ComentarioForm id={r.id} atual={r.comentario} />
        )}
      </main>
    </>
  );
}
