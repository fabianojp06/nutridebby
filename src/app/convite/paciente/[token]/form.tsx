'use client';

import { useActionState, useState } from 'react';
import { TERMO_PACIENTE_ROTULO, TERMO_PACIENTE_VERSAO } from '@/modules/pacientes/termo-paciente';
import type { AceitePacienteState } from './actions';

const ERRO_ID = 'erro-aceite';

type Props = {
  acao: (prev: AceitePacienteState, formData: FormData) => Promise<AceitePacienteState>;
  /** Conta nova pede senha; quem já tem conta só confirma o termo e o WhatsApp. */
  pedeSenha: boolean;
  temTelefone: boolean;
  whatsappMarcado: boolean;
};

export function AceiteForm({ acao, pedeSenha, temTelefone, whatsappMarcado }: Props) {
  const [state, action, pendente] = useActionState<AceitePacienteState, FormData>(acao, {});
  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [termo, setTermo] = useState(false);
  // o React 19 reseta o formulário depois de cada action, e um opt-in desmarcado voltaria marcado após um erro de senha
  // (consentimento sem intenção). SUS-108: as caixas vão com `defaultChecked` do estado (o React o atualiza a cada
  // renderização, e o reset o mantém); `checked` controlado voltava ao da montagem.
  const [whatsapp, setWhatsapp] = useState(whatsappMarcado);
  const senhaInvalida = state.campo === 'senha' || state.campo === 'confirmacao';
  return (
    <form action={action} className="space-y-3">
      {/* P08-06: a versão que a pessoa leu; a action recusa se a versão em vigor mudou com a página aberta */}
      <input type="hidden" name="versao" value={TERMO_PACIENTE_VERSAO} />
      {pedeSenha && (
        <>
          <p className="text-sm" id="regra-senha">Mínimo de 10 caracteres, com pelo menos 1 letra e 1 número.</p>
          <label htmlFor="senha" className="block">Nova senha</label>
          <input id="senha" name="senha" type="password" autoComplete="new-password" required value={senha} onChange={(e) => setSenha(e.target.value)}
            aria-invalid={senhaInvalida ? true : undefined} aria-describedby={senhaInvalida ? `regra-senha ${ERRO_ID}` : 'regra-senha'} className="w-full rounded border p-2" />
          <label htmlFor="confirmacao" className="block">Repita a senha</label>
          <input id="confirmacao" name="confirmacao" type="password" autoComplete="new-password" required value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)}
            aria-invalid={state.campo === 'confirmacao' ? true : undefined} aria-describedby={state.campo === 'confirmacao' ? ERRO_ID : undefined} className="w-full rounded border p-2" />
        </>
      )}
      <div className="flex items-start gap-2">
        <input id="termo" name="termo" type="checkbox" className="mt-1" defaultChecked={termo} onChange={(e) => setTermo(e.target.checked)}
          aria-invalid={state.campo === 'termo' ? true : undefined} aria-describedby={state.campo === 'termo' ? ERRO_ID : undefined} />
        <label htmlFor="termo">{TERMO_PACIENTE_ROTULO}</label>
      </div>
      {temTelefone && (
        <div className="flex items-start gap-2">
          <input id="whatsapp" name="whatsapp" type="checkbox" className="mt-1" defaultChecked={whatsapp} onChange={(e) => setWhatsapp(e.target.checked)} />
          <label htmlFor="whatsapp">Quero receber lembretes por WhatsApp</label>
        </div>
      )}
      {state.erro && (
        <p id={ERRO_ID} role="alert" className="text-red-700">
          {state.erro}
        </p>
      )}
      {/* US-011 "Consentimento obrigatório": sem o termo, o botão fica desabilitado */}
      <button disabled={pendente || !termo} className="w-full rounded bg-emerald-700 px-4 py-2 text-white disabled:opacity-50">Continuar</button>
    </form>
  );
}
