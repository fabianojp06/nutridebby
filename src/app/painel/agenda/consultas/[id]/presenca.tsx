'use client';

import { useActionState } from 'react';
import type { ConsultaState } from '../../actions';

/** US-037: dois botões, cada um com a sua ação ligada no servidor (consulta e situação). */
export function PresencaForm({ realizada, faltou }: { realizada: () => Promise<ConsultaState>; faltou: () => Promise<ConsultaState> }) {
  const [sr, acaoRealizada, pr] = useActionState<ConsultaState>(realizada, {});
  const [sf, acaoFaltou, pf] = useActionState<ConsultaState>(faltou, {});
  const erro = sr.erros?.geral ?? sf.erros?.geral;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <form action={acaoRealizada}><button disabled={pr || pf} className="rounded border px-3 py-1.5">Realizada</button></form>
      <form action={acaoFaltou}><button disabled={pr || pf} className="rounded border px-3 py-1.5">Faltou</button></form>
      {erro && <p role="alert" className="text-red-700">{erro}</p>}
    </div>
  );
}
