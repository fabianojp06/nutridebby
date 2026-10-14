'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { Botao, classeDoBotao } from '@/components/ui/botao';
import { MSG_RASCUNHO_IA } from '@/modules/ia/constantes';
import type { UsarState } from './actions';

type Acao = (s: UsarState, fd: FormData) => Promise<UsarState>;

/**
 * US-121 "Usar como rascunho" e "Já existe rascunho" (A-D12 = (a)): com rascunho, a pergunta aparece (`role="alert"`,
 * com o foco nela) com "Substituir" (reenvia com `substituir=1`) e "Cancelar" (volta ao botão). "Esta sugestão não está
 * mais disponível." (RN-108) também volta por aqui.
 */
export function UsarForm({ acao }: { acao: Acao }) {
  const [s, enviar, enviando] = useActionState<UsarState, FormData>(acao, {});
  // "Cancelar" esconde a pergunta DESTA resposta; um novo envio traz outra (e a pergunta volta, se for o caso)
  const [cancelada, setCancelada] = useState<UsarState | null>(null);
  const perguntando = !!s.confirmar && cancelada !== s;
  const pergunta = useRef<HTMLParagraphElement>(null);
  const usar = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (perguntando) pergunta.current?.focus();
  }, [perguntando]);
  if (perguntando) {
    return (
      <div className="space-y-2">
        <p ref={pergunta} tabIndex={-1} role="alert" className="font-semibold">{MSG_RASCUNHO_IA.jaExiste}</p>
        <div className="flex flex-wrap gap-3">
          <form action={enviar}>
            <input type="hidden" name="substituir" value="1" />
            <Botao disabled={enviando}>{MSG_RASCUNHO_IA.substituir}</Botao>
          </form>
          <Botao
            type="button"
            variante="secundario"
            onClick={() => {
              setCancelada(s);
              requestAnimationFrame(() => usar.current?.focus());
            }}
          >
            {MSG_RASCUNHO_IA.cancelar}
          </Botao>
        </div>
      </div>
    );
  }
  return (
    <form action={enviar} className="space-y-2">
      <button ref={usar} disabled={enviando} aria-describedby={s.erro ? 'usar-erro' : undefined} className={classeDoBotao()}>{MSG_RASCUNHO_IA.usar}</button>
      {s.erro && <p id="usar-erro" role="alert" className="text-sm text-erro">{s.erro}</p>}
    </form>
  );
}
