import { requirePaciente } from '@/lib/paciente-session';
import { signFileUrl } from '@/lib/signed-url';
import { quandoComFuso } from '@/modules/agenda/fuso';
import { idValido } from '@/modules/pacientes/base';
import { diarioDoPaciente } from '@/modules/portal/diario';
import { MSG_DIARIO, ROTULO_RESPOSTA, rotuloDaRefeicao } from '@/modules/portal/diario-constantes';
import { planoDoPaciente } from '@/modules/portal/plano';
import { CabecalhoDetalhe } from '@/components/portal/cabecalho-detalhe';
import { DiarioForm } from './diario-form';

export const dynamic = 'force-dynamic';

export default async function Diario({ searchParams }: PageProps<'/p/diario'>) {
  const { ctx, tenant } = await requirePaciente('/p/diario');
  // Plano 16 (US-192): a refeição pedida pelo link ("Comi outra coisa", "Mandar foto do prato", "Foto da refeição")
  const q = await searchParams;
  const pedida = typeof q.refeicao === 'string' && idValido(q.refeicao) ? q.refeicao : null;
  // só uma refeição do plano publicado dele (planoDoPaciente, auditado); um id qualquer cai no formulário comum
  const doPlano = pedida ? ((await planoDoPaciente(ctx, tenant.fuso))?.refeicoes.find((r) => r.id === pedida) ?? null) : null;
  const registros = await diarioDoPaciente(ctx);
  return (
    <>
      <CabecalhoDetalhe titulo="Diário" voltar={{ href: '/p/inicio', secao: 'Hoje' }} />
      <main className="space-y-6 p-6">
        <section aria-labelledby="registrar" className="space-y-3">
          <h2 id="registrar" className="text-lg font-semibold">Registrar refeição</h2>
          <DiarioForm
            refeicaoDoPlano={doPlano ? { id: doPlano.id, rotulo: rotuloDaRefeicao(doPlano.nome, doPlano.horario) } : null}
            resposta={q.resposta === 'outra_coisa' ? 'outra_coisa' : null}
            foto={q.foto === '1'}
          />
        </section>
        {registros.length === 0 ? (
          <p>{MSG_DIARIO.nenhum}</p>
        ) : (
          <ol className="space-y-4">
            {registros.map((r) => (
              <li key={r.id} className="space-y-2 rounded-xl border border-borda bg-cartao p-3">
                <p className="font-medium">{`${r.refeicaoDoPlano ?? r.refeicao} · ${quandoComFuso(r.dataHora, tenant.fuso)}`}</p>
                {r.resposta && <p className="text-sm font-medium">{ROTULO_RESPOSTA[r.resposta]}</p>}
                {r.texto && <p className="whitespace-pre-line wrap-break-word">{r.texto}</p>}
                {r.foto.estado === 'pronta' && (
                  // Só foto_path (o JPEG convertido, sem EXIF); o original nunca é assinado
                  // eslint-disable-next-line @next/next/no-img-element -- URL assinada de 5 min (CLAUDE.md regra 9)
                  <img src={signFileUrl(r.foto.caminho)} alt={`Foto do registro de ${r.refeicao}`} className="max-h-80 rounded" />
                )}
                {/* sem role="status": uma região viva por registro seria anunciada inteira a cada router.refresh() (RNF-10) */}
                {r.foto.estado === 'processando' && <p className="text-sm">{MSG_DIARIO.processando}</p>}
                {r.foto.estado === 'falhou' && <p className="text-sm text-erro">{MSG_DIARIO.fotoFalhou}</p>}
                {r.comentario && (
                  <div className="rounded bg-ok-fundo p-2">
                    <p className="text-sm font-medium">Comentário da nutricionista</p>
                    <p className="whitespace-pre-line wrap-break-word">{r.comentario}</p>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </main>
    </>
  );
}
