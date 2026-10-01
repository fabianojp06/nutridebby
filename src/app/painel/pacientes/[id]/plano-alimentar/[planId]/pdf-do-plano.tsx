import { signFileUrl } from '@/lib/signed-url';
import type { PlanoCompleto } from '@/modules/plano-alimentar/tipos';
import { BotaoAcao } from '../botao-acao';
import { pedirNovoPdfAction } from '../actions';
import { AtualizarEnquanto } from './atualizar-enquanto';

/**
 * US-026: download imediato quando pronto; "Seu PDF está sendo preparado" enquanto o worker gera. Paciente bloqueado
 * (US-018): o PDF que existe continua para consulta, mas não se gera outro.
 */
export function PdfDoPlano({ plano, patientId, bloqueado }: { plano: PlanoCompleto; patientId: string; bloqueado: boolean }) {
  if (plano.pdfStatus === 'pronto' && plano.pdfPath)
    return <a href={signFileUrl(plano.pdfPath)} className="rounded border px-4 py-2">Baixar PDF</a>;
  if (plano.pdfStatus === 'falhou' && bloqueado) return <p className="text-zinc-700">Não foi possível gerar o PDF.</p>;
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
        <AtualizarEnquanto planId={plano.id} patientId={patientId} />
      </p>
    );
  return null;
}
