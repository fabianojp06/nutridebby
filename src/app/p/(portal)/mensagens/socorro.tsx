import type { RiscoChat } from '@/db/schema/mensagens';
import { SOCORRO_DO_RISCO } from '@/modules/mensagens/constantes';
import { ComTelefones } from '../plano/ia/texto-fixo';

/**
 * RN-449 (§6.2 "Portal: socorro", §7.3): o aviso do app logo abaixo da mensagem do paciente com sinal de risco — pelo `risco`
 * GRAVADO na mensagem (sintoma agudo ≠ emergência), num cartão de alerta. Não é mensagem da nutricionista. O 188 e o 192
 * viram links `tel:` (o mesmo ComTelefones da IA Nutri). Recebe o foco depois do envio com risco (`tabIndex=-1`).
 */
export function Socorro({ risco }: { risco: RiscoChat }) {
  return (
    <div data-socorro="" tabIndex={-1} className="w-full max-w-[85%] scroll-mb-64 rounded-2xl border-2 border-erro bg-erro-fundo p-3 text-texto">
      <p className="wrap-break-word">
        <ComTelefones texto={SOCORRO_DO_RISCO[risco]} />
      </p>
    </div>
  );
}
