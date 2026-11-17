'use client';

import { useActionState } from 'react';
import { useStatusSalvamento } from '@/app/painel/planos/editor/salvamento-contexto';
import { MSG_DIAS } from '@/modules/plano-alimentar/constantes';
import type { PublicarState } from './actions';
import { idDoCampo } from './campo-do-erro';

const CONFIRMAR = 'Publicar esta versão para o paciente? A versão publicada hoje será arquivada.';
const PRINCIPAL = 'inline-flex min-h-11 items-center justify-center rounded-full bg-destaque px-5 font-semibold text-white hover:brightness-95 disabled:opacity-50';
const SECUNDARIO = 'inline-flex min-h-11 items-center justify-center rounded-full border border-campo bg-cartao px-5 text-texto hover:bg-linha disabled:opacity-50';

/**
 * US-025 "Publicar" com os avisos em dois passos (D31, Plano 19). O primeiro toque pede a confirmação de sempre; se a
 * publicação devolve avisos (sem VET no modo livre, dia sem refeição), eles aparecem em `role="alert"` junto do botão
 * com "Publicar mesmo assim", que publica sem perguntar de novo, mandando os avisos que mostrou (um aviso novo, de uma
 * edição feita depois, volta a aparecer). Como o `BotaoAcao`, espera o salvamento automático terminar (`exigirSalvo`).
 * O erro de um campo é link que leva o foco ao campo do editor.
 */
export function BotaoPublicar({ acao }: { acao: (s: PublicarState, fd: FormData) => Promise<PublicarState> }) {
  const [state, action, pendente] = useActionState(acao, {});
  const salvamento = useStatusSalvamento();
  const aguardando = salvamento !== 'salvo';
  const alvo = state.campo ? idDoCampo(state.campo) : null;
  return (
    <div className="space-y-1">
      <form action={action} onSubmit={(e) => { if (!window.confirm(CONFIRMAR)) e.preventDefault(); }}>
        <button disabled={pendente || aguardando} className={PRINCIPAL}>Publicar</button>
      </form>
      {aguardando && salvamento !== 'salvando' && <p className="text-sm text-suave">Só dá para continuar com as alterações salvas.</p>}
      {state.erro && (
        <p role="alert" className="text-sm text-erro">
          {alvo ? (
            <a
              href={`#${alvo}`}
              className="underline"
              onClick={(e) => {
                const campo = document.getElementById(alvo);
                if (!campo) return; // sem o campo na tela, a âncora faz o de sempre
                e.preventDefault();
                campo.scrollIntoView({ block: 'center' });
                campo.focus();
              }}
            >
              {state.erro}
            </a>
          ) : (
            state.erro
          )}
        </p>
      )}
      {state.avisos && state.avisos.length > 0 && (
        <>
          {/* a região viva só com os avisos (sem o botão dentro): lida inteira ao aparecer */}
          <div role="alert" className="rounded-2xl border border-aviso bg-aviso-fundo p-3 text-sm text-aviso">
            <ul className="space-y-1">
              {state.avisos.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
          <form action={action}>
            {state.avisos.map((a) => (
              <input key={a} type="hidden" name="confirmarAvisos" value={a} />
            ))}
            <button disabled={pendente || aguardando} className={SECUNDARIO}>{MSG_DIAS.publicarMesmoAssim}</button>
          </form>
        </>
      )}
    </div>
  );
}
