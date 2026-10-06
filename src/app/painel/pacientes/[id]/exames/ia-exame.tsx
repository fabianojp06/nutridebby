import Link from 'next/link';
import { MSG_FALHA, MSG_IA } from '@/modules/ia/constantes';
import type { SituacaoDoExame } from '@/modules/ia/tarefas';
import { EstadoIa } from './estado-ia';
import { PedirLeituraForm } from './pedir-leitura-form';

/**
 * US-110/US-112: o que a IA mostra em cada exame com laudo. `aviso` = o motivo de não poder pedir a IA agora (consultório ou
 * paciente), já com o texto da spec; null = pode pedir. Sugestão pronta e vigente aparece mesmo com aviso (D19, R7).
 */
export function IaDoExame({ patientId, exame, situacao, aviso, agora }: { patientId: string; exame: { id: string; titulo: string }; situacao: SituacaoDoExame | undefined; aviso: string | null; agora: Date }) {
  if (situacao && (situacao.status === 'na_fila' || situacao.status === 'processando')) {
    return (
      <p role="status" className="text-sm">
        {MSG_IA.lendo}
        <EstadoIa tarefaId={situacao.id} />
      </p>
    );
  }
  if (situacao?.status === 'pronta' && situacao.expiraEm && situacao.expiraEm > agora) {
    return (
      <Link href={`/painel/pacientes/${patientId}/exames?conferir=${situacao.id}#conferencia`} className="text-link underline">
        Ver valores encontrados<span className="sr-only">{` no exame ${exame.titulo}`}</span>
      </Link>
    );
  }
  if (aviso) return <p className="text-sm text-suave">{aviso}</p>;
  return (
    <div className="space-y-1">
      {situacao?.status === 'falhou' && situacao.erro && <p className="text-sm">{MSG_FALHA[situacao.erro]}</p>}
      <PedirLeituraForm patientId={patientId} examId={exame.id} titulo={exame.titulo} />
    </div>
  );
}
