import { Aviso } from '@/components/ui/aviso';
import { MSG_PARECER, rotuloDoExame } from '@/modules/documentos/parecer';
import type { SituacaoExame } from '@/modules/documentos/parecer-exames';

/**
 * RN-148 v0.5: o aviso (não bloqueio) quando o exame mudou ou foi excluído depois do preparo — abaixo do exame, no cartão
 * do conteúdo; a ação ("Voltar a editar" ou "Retificar") fica no cartão da situação (desvio 4 do plano).
 */
export function AvisoDoExame({ situacao, exame }: { situacao: SituacaoExame | undefined; exame: { titulo: string; data: string } }) {
  if (situacao === 'mudou') return <Aviso tipo="aviso">{MSG_PARECER.valoresMudaram}</Aviso>;
  if (situacao === 'excluido') return <Aviso tipo="aviso">{MSG_PARECER.exameExcluidoDepois(rotuloDoExame(exame))}</Aviso>;
  return null;
}
