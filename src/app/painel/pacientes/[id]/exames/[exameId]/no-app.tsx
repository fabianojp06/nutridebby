'use client';

import { useId, useRef, useState, useTransition } from 'react';
import { DialogoConfirmar } from '@/components/dialogo';
import { classeDoBotao } from '@/components/ui/botao';
import { Selo } from '@/components/ui/selo';
import { MSG_EXAMES } from '@/modules/exames/constantes';
import { mostrarNoAppAction, retirarDoAppAction, type NoAppState } from './actions';

const A = MSG_EXAMES.app;

/** A mensagem da região de status depois da action (RN-385): a de liberar ganha a frase do paciente sem app. */
function mensagemDoNoApp(liberar: boolean, r: NoAppState): string {
  if (!r.ok) return '';
  if (!liberar) return A.retirado;
  return r.pacienteUsaApp === false ? `${A.mostrado} ${A.pacienteSemApp}` : A.mostrado;
}

/**
 * Plano 22 (T6, US-375, RN-385, spec §7 "Detalhe do exame"): "Mostrar no app do paciente" — um botão (não `role=switch`)
 * que abre a confirmação no `DialogoConfirmar` ("Mostrar no app"/"Cancelar"); liberado, o selo "No app" e "Retirar do
 * app" (imediato, sem confirmação, reversível). A região `<p role="status">` fica sempre montada, fora do bloco trocado;
 * o erro sai num `role="alert"` ligado ao botão (`aria-describedby`). O botão é o mesmo elemento nos dois estados (só o
 * texto muda): o foco fica nele depois da troca, e o diálogo devolve o foco a ele ao fechar. Enquanto a action corre, o
 * botão fica `aria-disabled` (o clique não faz nada) e o diálogo, `ocupado`.
 */
export function NoAppDoExame({ patientId, exameId, noApp }: { patientId: string; exameId: string; noApp: boolean }) {
  const [aberto, setAberto] = useState(false);
  const [pendente, iniciar] = useTransition();
  const [status, setStatus] = useState('');
  const [erro, setErro] = useState('');
  const botao = useRef<HTMLButtonElement>(null);
  const idErro = useId();

  const executar = (liberar: boolean) =>
    iniciar(async () => {
      const r = liberar ? await mostrarNoAppAction(patientId, exameId, {}, new FormData()) : await retirarDoAppAction(patientId, exameId, {}, new FormData());
      setAberto(false);
      setErro(r.erro ?? '');
      setStatus(mensagemDoNoApp(liberar, r));
      botao.current?.focus();
    });

  return (
    <div className="space-y-2">
      <p role="status" className="min-h-6 font-medium">
        {status}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {noApp && <Selo>{A.selo}</Selo>}
        <button
          ref={botao}
          type="button"
          className={classeDoBotao('secundario')}
          aria-disabled={pendente || undefined}
          aria-describedby={erro ? idErro : undefined}
          onClick={() => {
            if (pendente) return;
            if (noApp) executar(false);
            else setAberto(true);
          }}
        >
          {noApp ? A.retirar : A.mostrar}
        </button>
      </div>
      {erro && (
        <p id={idErro} role="alert" className="text-erro">
          {erro}
        </p>
      )}
      <DialogoConfirmar
        aberto={aberto}
        titulo={A.mostrar}
        texto={A.confirmar}
        confirmar={A.confirmarSim}
        cancelar={A.cancelar}
        ocupado={pendente}
        aoFechar={() => setAberto(false)}
        aoConfirmar={() => executar(true)}
        focoAoFechar={() => botao.current}
      />
    </div>
  );
}
