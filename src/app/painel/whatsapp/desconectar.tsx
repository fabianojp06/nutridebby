'use client';

import { useActionState } from 'react';
import { ConfirmarBotao } from '@/components/confirmar-botao';
import { desconectarAction, type DesconectarState } from './actions';

/** "Desconectar WhatsApp" com confirmação; se o serviço de WhatsApp não responder, o erro aparece aqui (revisão da T9 c). */
export function DesconectarWhatsapp() {
  const [state, action] = useActionState<DesconectarState>(desconectarAction, {});
  return (
    <form action={action} className="space-y-2">
      <ConfirmarBotao mensagem="Desconectar o WhatsApp? Os lembretes passam a sair só por e-mail e notificação no app.">Desconectar WhatsApp</ConfirmarBotao>
      {state.erro && <p role="alert" className="text-erro">{state.erro}</p>}
    </form>
  );
}
