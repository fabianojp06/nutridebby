'use client';

import { useActionState, useState } from 'react';
import { Campo } from '@/components/campo';
import { DURACOES } from '@/modules/agenda/constantes';
import type { ConsultaState } from './actions';

type Props = {
  acao: (prev: ConsultaState, fd: FormData) => Promise<ConsultaState>;
  inicial: Record<string, string>;
  pacientes?: { id: string; nome: string; email: string }[];
  linkPadrao: string | null;
  botao: string;
};

export function ConsultaForm({ acao, inicial, pacientes, linkPadrao, botao }: Props) {
  const [state, action, pendente] = useActionState<ConsultaState, FormData>(acao, {});
  const v = state.valores ?? inicial;
  const e = state.erros ?? {};
  // `modalidade` só decide se o campo do link aparece; quem marca o rádio é o `defaultChecked` (o reset automático do formulário, depois de um erro, volta ao último valor enviado)
  const [modalidade, setModalidade] = useState(v.modalidade || 'presencial');
  const aria = (k: string) => (e[k] ? { 'aria-invalid': true as const, 'aria-describedby': `${k}-erro` } : {});
  const erro = (k: string) => e[k] && <p id={`${k}-erro`} role="alert" className="text-sm text-erro">{e[k]}</p>;
  return (
    <form action={action} className="max-w-xl space-y-4">
      {pacientes && (
        <div className="space-y-1">
          <label htmlFor="patientId" className="block font-medium">Paciente</label>
          {/* key (aqui e na duração): o React não re-sincroniza o defaultValue de um <select>, e o reset automático do formulário voltaria à opção inicial */}
          <select key={v.patientId} id="patientId" name="patientId" defaultValue={v.patientId ?? ''} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto" {...aria('patientId')}>
            <option value="" disabled>Selecione o paciente</option>
            {pacientes.map((p) => <option key={p.id} value={p.id}>{`${p.nome} (${p.email})`}</option>)}
          </select>
          {erro('patientId')}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Campo id="data" rotulo="Data" type="date" required defaultValue={v.data} erro={e.data} />
        <Campo id="hora" rotulo="Hora" type="time" required defaultValue={v.hora} erro={e.hora} />
        <div className="space-y-1">
          <label htmlFor="duracaoMin" className="block font-medium">Duração</label>
          <select key={v.duracaoMin} id="duracaoMin" name="duracaoMin" defaultValue={v.duracaoMin || '60'} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto" {...aria('duracaoMin')}>
            {DURACOES.map((d) => <option key={d} value={d}>{`${d} min`}</option>)}
          </select>
          {erro('duracaoMin')}
        </div>
      </div>
      <fieldset className="space-y-1" {...aria('modalidade')}>
        <legend className="font-medium">Modalidade</legend>
        {[['presencial', 'Presencial'], ['online', 'Online']].map(([valor, rotulo]) => (
          <div key={valor} className="flex items-center gap-2">
            <input id={`modalidade-${valor}`} name="modalidade" type="radio" value={valor} defaultChecked={(v.modalidade || 'presencial') === valor} onChange={() => setModalidade(valor)} />
            <label htmlFor={`modalidade-${valor}`}>{rotulo}</label>
          </div>
        ))}
        {erro('modalidade')}
      </fieldset>
      {modalidade === 'online' && (
        <Campo id="linkOnline" rotulo="Link da chamada" type="url" defaultValue={v.linkOnline} erro={e.linkOnline} placeholder={linkPadrao ?? 'https://…'} dica={linkPadrao ? 'Vazio = o link padrão do seu perfil.' : undefined} />
      )}
      {erro('geral')}
      <button disabled={pendente} className="inline-flex min-h-11 items-center justify-center rounded-full bg-destaque px-5 font-semibold text-white hover:brightness-110">{botao}</button>
    </form>
  );
}
