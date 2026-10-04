'use client';
import { useActionState } from 'react';
import { exclusaoAction, meusDadosAction, type PerfilState } from './actions';

const CONFIRMAR_EXCLUSAO = 'Pedir a exclusão? Sua nutricionista tem até 15 dias para responder. O prontuário clínico é guardado pelo prazo legal.';

/** T-6: sem região `role="status"` vazia (duas delas na tela eram ruído para o leitor de tela). */
const Retorno = ({ s }: { s: PerfilState }) => (
  <>
    {s.ok && <p role="status">{s.ok}</p>}
    {s.erro && <p role="alert" className="text-red-700">{s.erro}</p>}
  </>
);

/** US-046: "Baixar meus dados" e "Pedir exclusão dos meus dados" (com confirmação). */
export function Privacidade() {
  const [dados, pedirDados, pedindo] = useActionState<PerfilState>(meusDadosAction, {});
  const [exc, pedirExc, excluindo] = useActionState<PerfilState>(exclusaoAction, {});
  return (
    <div className="space-y-4">
      <form action={pedirDados}>
        <button disabled={pedindo} className="min-h-11 rounded border px-4">
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
        <button disabled={excluindo} className="min-h-11 rounded border border-red-700 px-4 text-red-800">
          Pedir exclusão dos meus dados
        </button>
      </form>
      <Retorno s={exc} />
    </div>
  );
}
