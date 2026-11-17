'use client';
import { startTransition, useOptimistic, useState, useTransition } from 'react';
import type { LembreteDoPaciente } from '@/modules/lembretes/paciente';
import { desligarLembreteAction, pausarLembretesAction, type LembreteDoPacienteState } from './actions';

const FALHOU = 'Não foi possível salvar. Verifique a conexão e tente de novo.';
const PAUSADOS = 'Lembretes pausados. Você não vai receber avisos até retomar.';
const CARTAO = 'space-y-2 rounded-2xl border border-borda bg-cartao p-4';

/** A ação com o alerta: `erro` da ação (lembrete que não é mais do paciente) ou a falha de rede/servidor (exceção). */
async function chamar(acao: () => Promise<LembreteDoPacienteState>): Promise<LembreteDoPacienteState> {
  try {
    return await acao();
  } catch {
    return { erro: FALHOU };
  }
}

/**
 * O interruptor de um lembrete: estado otimista que volta ao valor salvo se a ação falhar (o `useOptimistic` termina com a
 * transição e as props não mudaram), com o alerta. Trilho e marcador só com tokens, ≥ 3:1 nos dois modos (WCAG 1.4.11):
 * ligado = trilho na cor do consultório do modo (`bg-marca`/`border-marca`, ≥ 4,5 contra o cartão por `corNoEscuro`) e
 * marcador no cartão; desligado = contorno e marcador em `campo` (4,1:1 no claro, 4,6:1 no escuro). O texto ao lado diz o
 * estado (a cor não é o único sinal, WCAG 1.4.1).
 */
function Interruptor({ l, anunciar }: { l: LembreteDoPaciente; anunciar: (texto: string) => void }) {
  const [desligado, setDesligado] = useOptimistic(l.desligado);
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string>();
  const ligado = !desligado;
  return (
    <div className="space-y-1">
      <div className="flex min-h-11 items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={ligado}
          aria-labelledby={`lembrete-${l.id}-resumo`}
          aria-describedby={erro ? `lembrete-${l.id}-erro` : undefined}
          // aria-disabled, não disabled: o botão desabilitado perde o foco (que cairia no <body>)
          aria-disabled={pendente || undefined}
          onClick={() =>
            !pendente &&
            iniciar(async () => {
              setDesligado(!l.desligado);
              const r = await chamar(() => desligarLembreteAction(l.id, !l.desligado));
              startTransition(() => {
                setErro(r.erro);
                if (r.ok) anunciar(r.ok);
              });
            })
          }
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full aria-disabled:opacity-60"
        >
          <span aria-hidden="true" className={`flex h-7 w-12 items-center rounded-full border-2 p-0.5 motion-safe:transition-colors ${ligado ? 'border-marca bg-marca' : 'border-campo bg-cartao'}`}>
            <span className={`size-5 rounded-full motion-safe:transition-transform ${ligado ? 'translate-x-5 bg-cartao' : 'bg-campo'}`} />
          </span>
        </button>
        <span>{ligado ? 'Ligado' : 'Desligado'}</span>
      </div>
      {erro && (
        <p id={`lembrete-${l.id}-erro`} role="alert" className="text-sm text-erro">
          {erro}
        </p>
      )}
    </div>
  );
}

/**
 * Plano 17 (Tarefa 6, §5.3): os lembretes do paciente em Eu › Lembretes — o aviso da pausa no topo, "Pausar todos os
 * lembretes"/"Retomar os lembretes" (o mesmo botão com o rótulo trocado: o foco fica nele), cada lembrete com o resumo, o
 * texto da nutricionista e o interruptor (usáveis também com a pausa ativa). A região `role="status"` fica sempre montada
 * (o `revalidatePath` só troca as props) e só o texto muda.
 */
export function LembretesDoPaciente({ lembretes, pausado: pausadoSalvo }: { lembretes: LembreteDoPaciente[]; pausado: boolean }) {
  const [pausado, setPausado] = useOptimistic(pausadoSalvo);
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string>();
  const [aviso, setAviso] = useState({ texto: '', n: 0 });
  const anunciar = (texto: string) => setAviso((a) => ({ texto, n: a.n + 1 }));
  return (
    <div className="space-y-4">
      {pausado && <p className="rounded-2xl border border-aviso bg-aviso-fundo p-3 font-semibold text-aviso">{PAUSADOS}</p>}
      <div className="space-y-1">
        <button
          type="button"
          aria-disabled={pendente || undefined}
          aria-describedby={erro ? 'lembretes-pausa-erro' : undefined}
          onClick={() =>
            !pendente &&
            iniciar(async () => {
              setPausado(!pausadoSalvo);
              const r = await chamar(() => pausarLembretesAction(!pausadoSalvo));
              startTransition(() => {
                setErro(r.erro);
                if (r.ok) anunciar(r.ok);
              });
            })
          }
          className="min-h-11 rounded-xl border border-borda bg-cartao px-4 font-semibold aria-disabled:opacity-60"
        >
          {pausado ? 'Retomar os lembretes' : 'Pausar todos os lembretes'}
        </button>
        {erro && (
          <p id="lembretes-pausa-erro" role="alert" className="text-sm text-erro">
            {erro}
          </p>
        )}
      </div>
      <ul className="space-y-3">
        {lembretes.map((l) => (
          <li key={l.id} className={CARTAO}>
            <p id={`lembrete-${l.id}-resumo`} className="font-semibold wrap-break-word">
              {l.resumo}
            </p>
            {l.textoDaNutri && <p className="wrap-break-word">{`Sua nutricionista: ${l.textoDaNutri}`}</p>}
            <Interruptor l={l} anunciar={anunciar} />
          </li>
        ))}
      </ul>
      <p role="status" className="text-sm">
        {aviso.texto && <span key={aviso.n}>{aviso.texto}</span>}
      </p>
    </div>
  );
}
