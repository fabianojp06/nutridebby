'use client';
import { useActionState } from 'react';
import { exclusaoAction, meusDadosAction, type PerfilState } from './actions';

const CONFIRMAR_EXCLUSAO = 'Pedir a exclusão? Sua nutricionista tem até 15 dias para responder. O prontuário clínico é guardado pelo prazo legal.';

/**
 * RNF-10: a região `role="status"` existe desde o início (vazia) e só o texto muda — região viva inserida já com o texto
 * muitas vezes não é anunciada (VoiceOver, NVDA com Chrome). O `role="alert"` é anunciado ao entrar.
 */
const Retorno = ({ s }: { s: PerfilState }) => (
  <>
    <p role="status">{s.ok}</p>
    {s.erro && <p role="alert" className="text-erro">{s.erro}</p>}
  </>
);

/** US-046: "Baixar meus dados" e "Pedir exclusão dos meus dados" (com confirmação). */
export function Privacidade() {
  const [dados, pedirDados, pedindo] = useActionState<PerfilState>(meusDadosAction, {});
  const [exc, pedirExc, excluindo] = useActionState<PerfilState>(exclusaoAction, {});
  return (
    <div className="space-y-4">
      <form action={pedirDados}>
        <button disabled={pedindo} className="min-h-11 rounded-xl border border-borda bg-cartao px-4">
          Baixar meus dados
        </button>
      </form>
      <Retorno s={dados} />
      <form
        action={pedirExc}
        onSubmit={(e) => {
          if (!window.confirm(CONFIRMAR_EXCLUSAO)) e.preventDefault();
        }}
      >
        <button disabled={excluindo} className="min-h-11 rounded-xl border border-erro bg-cartao px-4 text-erro">
          Pedir exclusão dos meus dados
        </button>
      </form>
      <Retorno s={exc} />
    </div>
  );
}
