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
  /** US-010: a opção "Enviar convite por WhatsApp" (só no cadastro), com o aviso de quando ela não teria como sair agora. */
  conviteWhatsapp?: { aviso: string | null };
};

export function PacienteForm({ acao, inicial, botao, emailBloqueado, somenteLeitura, conviteWhatsapp }: Props) {
  const [state, action, pendente] = useActionState<PacienteState, FormData>(acao, {});
  const v = state.valores ?? inicial;
  const e = state.erros ?? {};
  const [telefone, setTelefone] = useState(v.telefone);
  // US-010 "WhatsApp sem autorização": o convite por WhatsApp só fica habilitado com a autorização marcada. A caixa da
  // autorização continua não controlada — depois de cada envio o React volta o formulário para `v` (o que foi enviado,
  // ou o que ficou salvo) —, e este estado acompanha o que ela mostra: muda com o clique e volta junto quando `v` muda
  const [autorizado, setAutorizado] = useState(v.whatsappAutorizado);
  const [valoresVistos, setValoresVistos] = useState(v);
  if (valoresVistos !== v) {
    setValoresVistos(v);
    setAutorizado(v.whatsappAutorizado);
  }
  const conviteDesabilitado = !autorizado || !telefone.trim();
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
          {e.sexo && <p id="sexo-erro" role="alert" className="text-sm text-erro">{e.sexo}</p>}
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
            onChange={(ev) => setAutorizado(ev.target.checked)}
            disabled={!telefone.trim()}
            aria-invalid={e.whatsappAutorizado ? true : undefined}
            aria-describedby={e.whatsappAutorizado ? 'whatsappAutorizado-erro' : undefined}
          />
          <label htmlFor="whatsappAutorizado">Paciente autorizou receber mensagens por WhatsApp</label>
        </div>
        {e.whatsappAutorizado && <p id="whatsappAutorizado-erro" role="alert" className="text-sm text-erro">{e.whatsappAutorizado}</p>}
        {conviteWhatsapp && (
          <div className="space-y-1">
            <div className="flex items-start gap-2">
              <input
                id="enviarConviteWhatsapp"
                name="enviarConviteWhatsapp"
                type="checkbox"
                className="mt-1"
                defaultChecked={v.enviarConviteWhatsapp}
                disabled={conviteDesabilitado}
                aria-invalid={e.enviarConviteWhatsapp ? true : undefined}
                aria-describedby={
                  [conviteDesabilitado ? 'enviarConviteWhatsapp-dica' : null, conviteWhatsapp.aviso ? 'enviarConviteWhatsapp-aviso' : null, e.enviarConviteWhatsapp ? 'enviarConviteWhatsapp-erro' : null]
                    .filter(Boolean)
                    .join(' ') || undefined
                }
              />
              <label htmlFor="enviarConviteWhatsapp">Enviar convite por WhatsApp</label>
            </div>
            {conviteDesabilitado && (
              <p id="enviarConviteWhatsapp-dica" className="text-sm text-suave">Para enviar o convite por WhatsApp, informe o telefone e marque a autorização.</p>
            )}
            {conviteWhatsapp.aviso && <p id="enviarConviteWhatsapp-aviso" className="text-sm text-suave">{conviteWhatsapp.aviso}</p>}
          </div>
        )}
        {e.enviarConviteWhatsapp && <p id="enviarConviteWhatsapp-erro" role="alert" className="text-sm text-erro">{e.enviarConviteWhatsapp}</p>}
      </fieldset>
      {e.geral && <p role="alert" className="text-erro">{e.geral}</p>}
      {state.ok && <p role="status">Cadastro salvo.</p>}
      {!somenteLeitura && <button disabled={pendente} className="inline-flex min-h-11 items-center justify-center rounded-full bg-destaque px-5 font-semibold text-white hover:brightness-110">{botao}</button>}
    </form>
  );
}
