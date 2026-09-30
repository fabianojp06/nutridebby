'use client';

import { useActionState, useState } from 'react';
import { Campo } from '@/components/campo';
import type { PacienteState } from './actions';
import type { ValoresPaciente } from './valores';

type Props = {
  acao: (prev: PacienteState, formData: FormData) => Promise<PacienteState>;
  inicial: ValoresPaciente;
  botao: string;
  /** O paciente já ativou o acesso: o e-mail é o login dele. */
  emailBloqueado?: boolean;
  somenteLeitura?: boolean;
};

export function PacienteForm({ acao, inicial, botao, emailBloqueado, somenteLeitura }: Props) {
  const [state, action, pendente] = useActionState<PacienteState, FormData>(acao, {});
  const v = state.valores ?? inicial;
  const e = state.erros ?? {};
  const [telefone, setTelefone] = useState(v.telefone);
  return (
    <form action={action} className="space-y-4">
      <fieldset disabled={somenteLeitura} className="space-y-4">
        <Campo id="nome" rotulo="Nome" required defaultValue={v.nome} erro={e.nome} autoComplete="off" />
        <Campo id="dataNascimento" rotulo="Data de nascimento" type="date" required defaultValue={v.dataNascimento} erro={e.dataNascimento} />
        <fieldset className="space-y-1" aria-invalid={e.sexo ? true : undefined} aria-describedby={e.sexo ? 'sexo-erro' : undefined}>
          <legend className="font-medium">Sexo biológico (usado nas fórmulas)</legend>
          {[
            ['F', 'Feminino'],
            ['M', 'Masculino'],
          ].map(([valor, rotulo]) => (
            <div key={valor} className="flex items-center gap-2">
              <input id={`sexo-${valor}`} name="sexo" type="radio" value={valor} defaultChecked={v.sexo === valor} />
              <label htmlFor={`sexo-${valor}`}>{rotulo}</label>
            </div>
          ))}
          {e.sexo && <p id="sexo-erro" role="alert" className="text-sm text-red-700">{e.sexo}</p>}
        </fieldset>
        <Campo
          id="email"
          rotulo="E-mail"
          type="email"
          required
          defaultValue={v.email}
          erro={e.email}
          readOnly={emailBloqueado}
          dica={emailBloqueado ? 'O paciente já ativou o acesso; o e-mail não pode ser alterado.' : undefined}
        />
        <Campo id="telefone" rotulo="Telefone (opcional)" type="tel" value={telefone} onChange={(ev) => setTelefone(ev.target.value)} erro={e.telefone} dica="Ex.: (11) 91234-5678" />
        <div className="flex items-start gap-2">
          <input
            id="whatsappAutorizado"
            name="whatsappAutorizado"
            type="checkbox"
            className="mt-1"
            defaultChecked={v.whatsappAutorizado}
            disabled={!telefone.trim()}
            aria-invalid={e.whatsappAutorizado ? true : undefined}
            aria-describedby={e.whatsappAutorizado ? 'whatsappAutorizado-erro' : undefined}
          />
          <label htmlFor="whatsappAutorizado">Paciente autorizou receber mensagens por WhatsApp</label>
        </div>
        {e.whatsappAutorizado && <p id="whatsappAutorizado-erro" role="alert" className="text-sm text-red-700">{e.whatsappAutorizado}</p>}
      </fieldset>
      {e.geral && <p role="alert" className="text-red-700">{e.geral}</p>}
      {state.ok && <p role="status">Cadastro salvo.</p>}
      {!somenteLeitura && <button disabled={pendente} className="rounded bg-emerald-700 px-4 py-2 text-white">{botao}</button>}
    </form>
  );
}
