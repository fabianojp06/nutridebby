'use client';

import { useActionState, useState } from 'react';
import { aceitarConviteAction, type AceiteState } from './actions';

const ERRO_ID = 'erro-convite';

/**
 * `rotulo` e `versao` vêm da página (servidor): o módulo do DPA importa o banco e não entra no bundle do navegador.
 * Plano 26 (RN-500, US-489): `aceite` = a caixa do texto aceito — `dpa` (convite da nutricionista) ou `sigilo` (o Termo de
 * confidencialidade da equipe, convite da recepção); o tipo do convite decide na página, e a action confere de novo.
 */
export function ConviteForm({ token, rotulo, versao, aceite = 'dpa' }: { token: string; rotulo: string; versao: string; aceite?: 'dpa' | 'sigilo' }) {
  const [state, action, pendente] = useActionState<AceiteState, FormData>(aceitarConviteAction.bind(null, token), {});
  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  // T6-R2: "As senhas não conferem" afeta os dois campos; senha fraca afeta só a senha.
  const senhaInvalida = state.campo === 'senha' || state.campo === 'confirmacao';
  const confirmacaoInvalida = state.campo === 'confirmacao';
  const aceiteInvalido = state.campo === aceite;
  return (
    <form action={action} className="space-y-3">
      {/* P08-06: a versão que a pessoa leu; a action recusa se a versão em vigor mudou com a página aberta */}
      <input type="hidden" name="versao" value={versao} />
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
          id={aceite}
          name={aceite}
          type="checkbox"
          className="mt-1"
          aria-invalid={aceiteInvalido ? true : undefined}
          aria-describedby={aceiteInvalido ? ERRO_ID : undefined}
        />
        <label htmlFor={aceite}>{rotulo}</label>
      </div>
      {state.erro && (
        <p id={ERRO_ID} role="alert" className="text-erro">
          {state.erro}
        </p>
      )}
      <button disabled={pendente} className="w-full rounded bg-emerald-700 px-4 py-2 text-white">Criar senha e entrar</button>
    </form>
  );
}
