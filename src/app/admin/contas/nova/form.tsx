'use client';

import { useActionState } from 'react';
import { Campo } from '@/components/campo';
import { criarContaAction, type CriarContaState } from '../../actions';

/** `linkPublicoBase`: APP_URL + `/n/`, para a dica mostrar o link completo da página pública. */
export function NovaContaForm({ linkPublicoBase }: { linkPublicoBase: string }) {
  const [state, action, pendente] = useActionState<CriarContaState, FormData>(criarContaAction, {});
  const e = state.erros ?? {};
  const v = state.valores ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      <Campo id="nomeExibicao" rotulo="Nome de exibição" required defaultValue={v.nomeExibicao} erro={e.nomeExibicao} />
      <Campo id="email" rotulo="E-mail" type="email" autoComplete="off" required defaultValue={v.email} erro={e.email} />
      <Campo id="crn" rotulo="CRN" required defaultValue={v.crn} erro={e.crn} dica="Ex.: CRN-3 12345" />
      <Campo id="slug" rotulo="Endereço da página" required defaultValue={v.slug} erro={e.slug}
        dica={`Link da página pública de agendamento: ${linkPublicoBase}seu-endereco. Use de 3 a 40 letras minúsculas, números ou hífen (não é o endereço do consultório).`} />
      {e.geral && <p role="alert" className="text-red-700">{e.geral}</p>}
      <button disabled={pendente} className="rounded bg-emerald-700 px-4 py-2 text-white">Criar conta</button>
    </form>
  );
}
