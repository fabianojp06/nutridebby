import { requirePaciente } from '@/lib/paciente-session';
import { signFileUrl } from '@/lib/signed-url';
import { quandoComFuso } from '@/modules/agenda/fuso';
import { diarioDoPaciente } from '@/modules/portal/diario';
import { MSG_DIARIO } from '@/modules/portal/diario-constantes';
import { DiarioForm } from './diario-form';

export const dynamic = 'force-dynamic';

export default async function Diario() {
  const { ctx, tenant } = await requirePaciente('/p/diario');
  const registros = await diarioDoPaciente(ctx);
  return (
    <main className="space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Diário</h1>
      <section aria-labelledby="registrar" className="space-y-3">
        <h2 id="registrar" className="text-lg font-semibold">Registrar refeição</h2>
        <DiarioForm />
      </section>
      {registros.length === 0 ? (
        <p>{MSG_DIARIO.nenhum}</p>
      ) : (
        <ol className="space-y-4">
          {registros.map((r) => (
            <li key={r.id} className="space-y-2 rounded border p-3">
              <p className="font-medium">{`${r.refeicao} · ${quandoComFuso(r.dataHora, tenant.fuso)}`}</p>
              {r.texto && <p className="whitespace-pre-line">{r.texto}</p>}
              {r.foto.estado === 'pronta' && (
                // Só foto_path (o JPEG convertido, sem EXIF); o original nunca é assinado
                // eslint-disable-next-line @next/next/no-img-element -- URL assinada de 5 min (CLAUDE.md regra 9)
                <img src={signFileUrl(r.foto.caminho)} alt={`Foto do registro de ${r.refeicao}`} className="max-h-80 rounded" />
              )}
              {/* sem role="status": uma região viva por registro seria anunciada inteira a cada router.refresh() (RNF-10) */}
              {r.foto.estado === 'processando' && <p className="text-sm">{MSG_DIARIO.processando}</p>}
              {r.foto.estado === 'falhou' && <p className="text-sm text-red-700">{MSG_DIARIO.fotoFalhou}</p>}
              {r.comentario && (
                <div className="rounded bg-emerald-50 p-2">
                  <p className="text-sm font-medium">Comentário da nutricionista</p>
                  <p className="whitespace-pre-line">{r.comentario}</p>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
