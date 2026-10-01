import { signFileUrl } from '@/lib/signed-url';
import type { PlanoCompleto } from '@/modules/plano-alimentar/tipos';
import { BotaoAcao } from '../botao-acao';
import { pedirNovoPdfAction } from '../actions';
import { AtualizarEnquanto } from './atualizar-enquanto';

/** US-026: download imediato quando pronto; "Seu PDF está sendo preparado" enquanto o worker gera. */
export function PdfDoPlano({ plano, patientId }: { plano: PlanoCompleto; patientId: string }) {
  if (plano.pdfStatus === 'pronto' && plano.pdfPath)
    return <a href={signFileUrl(plano.pdfPath)} className="rounded border px-4 py-2">Baixar PDF</a>;
  if (plano.pdfStatus === 'falhou')
    return (
      <div className="space-y-1">
        <p role="alert" className="text-red-700">Não foi possível gerar o PDF. Tente de novo.</p>
        <BotaoAcao acao={pedirNovoPdfAction.bind(null, patientId, plano.id)} rotulo="Gerar o PDF de novo" principal={false} />
      </div>
    );
  if (plano.pdfStatus === 'pendente')
    return (
      <p role="status" className="text-zinc-700">
        Seu PDF está sendo preparado
        <AtualizarEnquanto />
      </p>
    );
  return null;
}
