'use client';

import { useActionState, useEffect, useRef } from 'react';
import { Campo } from '@/components/campo';
import { ConfirmarBotao } from '@/components/confirmar-botao';
import { Botao } from '@/components/ui/botao';
import { declararFitoterapiaAction, retirarFitoterapiaAction, type DadosDocState } from './actions';

/**
 * D6 da spec: autodeclaração com registro e termo. O rótulo e o termo vêm do módulo (texto exato da US-140).
 * Cada aviso de sucesso fica no ramo que a ação mostra depois do `revalidatePath`: "registrada" no da habilitação
 * (US-140: "Então vejo 'Habilitação em Fitoterapia registrada no perfil.'") e "retirada" no formulário de declarar.
 * Na troca de ramo, o botão que tinha o foco sai do DOM: o foco vai ao aviso (RNF-10), que o leitor de tela lê.
 */
export function FitoterapiaForm({ registro, declaradaEm, rotulo, termo }: { registro: string | null; declaradaEm: string | null; rotulo: string; termo: string }) {
  const [s, action, pendente] = useActionState<DadosDocState, FormData>(declararFitoterapiaAction, {});
  const [r, retirar] = useActionState<DadosDocState, FormData>(retirarFitoterapiaAction, {});
  const e = s.erros ?? {};
  const aviso = useRef<HTMLParagraphElement>(null);
  const habilitada = !!registro;
  const anterior = useRef(habilitada);
  useEffect(() => {
    if (anterior.current === habilitada) return;
    anterior.current = habilitada;
    aviso.current?.focus();
  }, [habilitada]);

  if (registro)
    return (
      <div className="space-y-2">
        {s.ok && (
          <p ref={aviso} tabIndex={-1} role="status">
            Habilitação em Fitoterapia registrada no perfil.
          </p>
        )}
        <p>{`Habilitação em Fitoterapia: ${registro} (declarada em ${declaradaEm}).`}</p>
        <form action={retirar}>
          <ConfirmarBotao mensagem="Retirar a habilitação em Fitoterapia do perfil? Os fitoterápicos formulados deixam de poder ser prescritos.">Retirar habilitação</ConfirmarBotao>
        </form>
      </div>
    );
  return (
    <form action={action} className="space-y-3">
      {/* depois de uma tentativa com erro, o aviso velho da retirada some (o erro é o resultado mais recente) */}
      {r.retirada && !s.erros && (
        <p ref={aviso} tabIndex={-1} role="status">
          Habilitação em Fitoterapia retirada do perfil.
        </p>
      )}
      <fieldset className="space-y-3">
        <legend className="font-medium">{rotulo}</legend>
        <Campo id="registro" rotulo="Registro da habilitação no CRN" maxLength={60} defaultValue={s.valores?.registro ?? ''} erro={e.registro} dica='Ex.: "CRN-3 nº 1234/2024"' />
        <div className="flex items-start gap-2">
          <input id="confirmo" name="confirmo" type="checkbox" aria-invalid={e.confirmo ? true : undefined} aria-describedby={e.confirmo ? 'confirmo-erro' : undefined} className="mt-1 size-5" />
          <label htmlFor="confirmo">{termo}</label>
        </div>
        {e.confirmo && <p id="confirmo-erro" role="alert" className="text-sm text-erro">{e.confirmo}</p>}
      </fieldset>
      <Botao disabled={pendente}>Registrar habilitação</Botao>
    </form>
  );
}
