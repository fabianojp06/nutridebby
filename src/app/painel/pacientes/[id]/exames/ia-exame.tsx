import Link from 'next/link';
import { MSG_FALHA, MSG_IA, type MotivoFalha } from '@/modules/ia/constantes';
import type { SituacaoCotaIa } from '@/modules/ia/cota';
import type { EstadoIaTenant } from '@/modules/ia/modo';
import type { SituacaoDoExame } from '@/modules/ia/tarefas';
import { EstadoIa } from './estado-ia';
import { PedirLeituraForm } from './pedir-leitura-form';

/** O que a IA pode fazer em cada exame: pedir a leitura, ou não, com o aviso (texto da spec) ou sem nada. */
export type IaNoExame = { podePedir: true; aviso: null } | { podePedir: false; aviso: string | null };

/**
 * O motivo de não poder pedir a IA agora (consultório ou paciente). US-101: antes de ativar, os botões não aparecem e
 * nenhum aviso sai nos exames (revisão da T13: o "indisponível" é só do IA_DESLIGADA, §5.9). `nao_liberada` mantém o
 * aviso da R7 (decisão pendente do dono).
 */
export function iaNoExame(p: { estadoIa: EstadoIaTenant; motivo: MotivoFalha | null; recusou: boolean; cota: SituacaoCotaIa | null }): IaNoExame {
  if (p.estadoIa === 'nao_ativada') return { podePedir: false, aviso: null };
  const aviso =
    p.estadoIa === 'emergencia' ? MSG_IA.indisponivel
    : p.estadoIa === 'nao_liberada' ? MSG_IA.naoLiberada
    : p.estadoIa === 'aditivo_desatualizado' ? MSG_IA.aditivoDesatualizado
    : p.motivo === 'paciente_nao_informado' ? MSG_IA.semCiencia
    : p.motivo ? (p.recusou ? MSG_IA.recusou : MSG_FALHA.paciente_indisponivel)
    : p.cota?.nivel === 'esgotada' ? MSG_IA.cotaAcabou
    : null;
  return aviso === null ? { podePedir: true, aviso: null } : { podePedir: false, aviso };
}

type Props = { patientId: string; exame: { id: string; titulo: string }; situacao: SituacaoDoExame | undefined; ia: IaNoExame; agora: Date };

/**
 * US-110/US-112: o que a IA mostra em cada exame com laudo. Sugestão pronta e vigente aparece mesmo sem poder pedir (D19,
 * R7). Tudo dentro de uma região viva que fica na tela: quando o EstadoIa recarrega a página, o fim da leitura (link) ou a
 * falha troca o conteúdo DENTRO dela e é anunciado ao leitor de tela (revisão da T13).
 */
export function IaDoExame(p: Props) {
  return (
    <div aria-live="polite">
      <ConteudoDaIa {...p} />
    </div>
  );
}

function ConteudoDaIa({ patientId, exame, situacao, ia, agora }: Props) {
  if (situacao && (situacao.status === 'na_fila' || situacao.status === 'processando')) {
    return (
      <p className="text-sm">
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
  if (!ia.podePedir) return ia.aviso ? <p className="text-sm text-suave">{ia.aviso}</p> : null;
  return (
    <div className="space-y-1">
      {situacao?.status === 'falhou' && situacao.erro && <p className="text-sm">{MSG_FALHA[situacao.erro]}</p>}
      <PedirLeituraForm patientId={patientId} examId={exame.id} titulo={exame.titulo} />
    </div>
  );
}
