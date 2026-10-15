'use client';

import { useActionState, useState } from 'react';
import { aceitarConviteAction, type AceiteState } from './actions';

const ERRO_ID = 'erro-convite';

/** `rotuloDpa` vem da página (servidor): o módulo do DPA importa o banco e não entra no bundle do navegador. */
export function ConviteForm({ token, rotuloDpa }: { token: string; rotuloDpa: string }) {
  const [state, action, pendente] = useActionState<AceiteState, FormData>(aceitarConviteAction.bind(null, token), {});
  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  // T6-R2: "As senhas não conferem" afeta os dois campos; senha fraca afeta só a senha.
  const senhaInvalida = state.campo === 'senha' || state.campo === 'confirmacao';
  const confirmacaoInvalida = state.campo === 'confirmacao';
  const dpaInvalido = state.campo === 'dpa';
  return (
    <form action={action} className="space-y-3">
      <p className="text-sm" id="regra-senha">Mínimo de 10 caracteres, com pelo menos 1 letra e 1 número.</p>
      <label htmlFor="senha" className="block">Nova senha</label>
      <input
        id="senha"
        name="senha"
        type="password"
        autoComplete="new-password"
        required
        aria-invalid={senhaInvalida ? true : undefined}
        aria-describedby={senhaInvalida ? `regra-senha ${ERRO_ID}` : 'regra-senha'}
        value={senha}
        onChange={(e) => setSenha(e.target.value)}
        className="w-full rounded border p-2"
      />
      <label htmlFor="confirmacao" className="block">Repita a senha</label>
      <input
        id="confirmacao"
        name="confirmacao"
        type="password"
        autoComplete="new-password"
        required
        aria-invalid={confirmacaoInvalida ? true : undefined}
        aria-describedby={confirmacaoInvalida ? ERRO_ID : undefined}
        value={confirmacao}
        onChange={(e) => setConfirmacao(e.target.value)}
        className="w-full rounded border p-2"
      />
      <div className="flex items-start gap-2">
        <input
          id="dpa"
          name="dpa"
          type="checkbox"
          className="mt-1"
          aria-invalid={dpaInvalido ? true : undefined}
          aria-describedby={dpaInvalido ? ERRO_ID : undefined}
        />
        <label htmlFor="dpa">{rotuloDpa}</label>
      </div>
      {state.erro && (
        <p id={ERRO_ID} role="alert" className="text-red-700">
          {state.erro}
        </p>
      )}
      <button disabled={pendente} className="w-full rounded bg-emerald-700 px-4 py-2 text-white">Criar senha e entrar</button>
    </form>
  );
}
