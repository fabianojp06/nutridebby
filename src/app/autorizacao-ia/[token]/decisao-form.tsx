'use client';

import { useState } from 'react';
import { TurnstileWidget } from '@/components/turnstile-widget';
import { Botao } from '@/components/ui/botao';
import { MSG_AUTORIZACAO } from '@/modules/ia/constantes';

/**
 * US-107 / US-109: Turnstile e os botões da decisão (sem <form>: nada vai à URL; o POST é por fetch, como o link de
 * documentos). "Agora não" não grava nada (decisão da spec, §18.2): só o retorno. A região role="status" existe desde o
 * início (RNF-10) e recebe "Autorização registrada…", "Tudo bem…" ou "Autorização retirada."; o erro vai em role="alert".
 */
export function DecisaoForm({ token, siteKey, modo }: { token: string; siteKey: string; modo: 'decidir' | 'retirar' }) {
  const [turnstile, setTurnstile] = useState<string | null>(null);
  const [widget, setWidget] = useState(0);
  const [retorno, setRetorno] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [encerrado, setEncerrado] = useState(false);

  async function enviar(acao: 'autorizar' | 'retirar') {
    if (acao === 'retirar' && !window.confirm(MSG_AUTORIZACAO.confirmarRetirada)) return;
    setEnviando(true);
    setErro('');
    try {
      const res = await fetch(`/api/autorizacao-ia/${token}/${acao}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ turnstile }) });
      const r = (await res.json().catch(() => ({}))) as { erro?: string };
      if (res.ok) {
        setEncerrado(true);
        setRetorno(acao === 'autorizar' ? MSG_AUTORIZACAO.registradaLink : MSG_AUTORIZACAO.retirada);
      } else {
        setErro(r.erro ?? MSG_AUTORIZACAO.turnstileFora);
      }
    } catch {
      setErro(MSG_AUTORIZACAO.turnstileFora);
    }
    // o token do Turnstile é de uso único: um widget novo gera outro
    setTurnstile(null);
    setWidget((w) => w + 1);
    setEnviando(false);
  }

  return (
    <div className="space-y-3">
      {!encerrado && (
        <>
          <TurnstileWidget key={widget} siteKey={siteKey} onToken={setTurnstile} onIndisponivel={() => setErro(MSG_AUTORIZACAO.turnstileFora)} />
          <div className="flex flex-wrap gap-3">
            {modo === 'decidir' ? (
              <>
                <Botao type="button" onClick={() => enviar('autorizar')} disabled={enviando || !turnstile}>
                  {MSG_AUTORIZACAO.autorizo}
                </Botao>
                <Botao type="button" variante="secundario" disabled={enviando} onClick={() => { setEncerrado(true); setRetorno(MSG_AUTORIZACAO.tudoBem); }}>
                  {MSG_AUTORIZACAO.agoraNao}
                </Botao>
              </>
            ) : (
              <Botao type="button" onClick={() => enviar('retirar')} disabled={enviando || !turnstile}>
                {MSG_AUTORIZACAO.retirarAutorizacao}
              </Botao>
            )}
          </div>
        </>
      )}
      <p role="status">{retorno}</p>
      {erro && (
        <p role="alert" className="text-erro">
          {erro}
        </p>
      )}
    </div>
  );
}
