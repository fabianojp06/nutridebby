'use client';
import { useActionState, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { seguraFalhaDeRede } from '@/components/mensagens/rede';
import { Botao } from '@/components/ui/botao';
import { FIM_DO_DIA_MIN, MAX_FAIXAS_POR_DIA, MSG_MENSAGENS, PASSO_FAIXA_MIN } from '@/modules/mensagens/constantes';
import type { ConfiguracaoDasMensagens } from '@/modules/mensagens/horario';
import { salvarHorarioAction } from './actions';
import { estadoDeFalha, type EstadoDoHorario } from './formulario';

const C = MSG_MENSAGENS.configuracao;
const CAMPO = 'min-h-11 rounded-xl border border-campo bg-cartao p-2 text-texto';
const p2 = (n: number) => String(n).padStart(2, '0');
/** §7.5: de 15 em 15 min, com "24:00" no fim (o `input type="time"` não respeita o passo no iOS e não tem 24:00). */
const OPCOES = Array.from({ length: FIM_DO_DIA_MIN / PASSO_FAIXA_MIN + 1 }, (_, i) => {
  const min = i * PASSO_FAIXA_MIN;
  return { valor: String(min), rotulo: `${p2(Math.floor(min / 60))}:${p2(min % 60)}` };
});
/** Uma faixa nova: 8h às 12h (a nutricionista ajusta). */
const NOVA = { inicioMin: 8 * 60, fimMin: 12 * 60 };

type FaixaNaTela = { chave: number; inicioMin: number; fimMin: number };
type Dias = FaixaNaTela[][];
let proxima = 0;
const paraDias = (c: ConfiguracaoDasMensagens): Dias =>
  C.dias.map((_, dia) => c.faixas.filter((x) => x.diaSemana === dia).map((x) => ({ chave: proxima++, inicioMin: x.inicioMin, fimMin: x.fimMin })));

const nada = () => () => undefined;
/** Verdadeiro só depois da hidratação (sem JS, o formulário é a própria Server Action). */
const useComJs = () => useSyncExternalStore(nada, () => true, () => false);

/**
 * O formulário remontado a cada resposta (`marca`): começa com a configuração devolvida (ou a gravada) e o erro. Rodada da
 * T6c: com erro de faixa, o foco vai ao "Das" dela, rolada ao centro (I1); ao acrescentar, ao "Das" da nova; ao remover, à
 * faixa vizinha ou, sem nenhuma, ao "Acrescentar faixa" do dia (I2) — nunca o `body`.
 */
function Campos({ config, erro }: { config: ConfiguracaoDasMensagens; erro: EstadoDoHorario['erro'] }) {
  const [dias, setDias] = useState<Dias>(() => paraDias(config));
  /** O `id` que recebe o foco depois do próximo render (acrescentar ou remover). */
  const focarDepois = useRef<string | null>(null);
  useEffect(() => {
    if (!erro) return;
    const alvo = document.getElementById(`faixa-${erro.dia}-${erro.k}-das`);
    alvo?.focus({ preventScroll: true });
    alvo?.scrollIntoView({ block: 'center' });
  }, [erro]);
  useEffect(() => {
    if (focarDepois.current === null) return;
    document.getElementById(focarDepois.current)?.focus();
    focarDepois.current = null;
  }, [dias]);
  const mudar = (dia: number, i: number, campo: 'inicioMin' | 'fimMin', valor: number) =>
    setDias((d) => d.map((fs, j) => (j === dia ? fs.map((f, k) => (k === i ? { ...f, [campo]: valor } : f)) : fs)));
  const acrescentar = (dia: number) => {
    focarDepois.current = `faixa-${dia}-${dias[dia].length + 1}-das`;
    setDias((d) => d.map((fs, j) => (j === dia ? [...fs, { chave: proxima++, ...NOVA }] : fs)));
  };
  const remover = (dia: number, i: number) => {
    const restantes = dias[dia].length - 1;
    // a faixa que ocupa o lugar (a seguinte sobe) ou a anterior; sem nenhuma, o "Acrescentar faixa" do dia
    focarDepois.current = restantes === 0 ? `acrescentar-${dia}` : `faixa-${dia}-${Math.min(i + 1, restantes)}-das`;
    setDias((d) => d.map((fs, j) => (j === dia ? fs.filter((_, k) => k !== i) : fs)));
  };
  return (
    <>
      <div data-guia="mensagens-horario" className="flex items-start gap-3">
        <input id="horario-ativo" type="checkbox" name="horario" value="sim" defaultChecked={config.horarioAtivo} className="mt-1 size-5 shrink-0" />
        <label htmlFor="horario-ativo" className="font-medium">
          {C.mostrarHorario}
        </label>
      </div>
      <div data-guia="mensagens-aviso-email" className="space-y-1">
        <div className="flex items-start gap-3">
          <input id="aviso-email" type="checkbox" name="aviso" value="sim" defaultChecked={config.avisoEmail} aria-describedby="ajuda-aviso-email" className="mt-1 size-5 shrink-0" />
          <label htmlFor="aviso-email" className="font-medium">
            {C.avisoEmail}
          </label>
        </div>
        <p id="ajuda-aviso-email" className="pl-8 text-sm text-suave">
          {C.ajudaAviso}
        </p>
      </div>
      <div data-guia="mensagens-faixas" className="space-y-3">
        {C.dias.map((nomeDoDia, dia) => (
          <fieldset key={nomeDoDia} className="space-y-2 rounded-2xl border border-borda p-4">
            <legend className="px-1 font-semibold">{nomeDoDia}</legend>
            {dias[dia].map((f, i) => {
              const k = i + 1;
              const comErro = erro && erro.dia === dia && erro.k === k;
              const idErro = comErro ? `erro-faixa-${dia}-${k}` : undefined;
              const id = `faixa-${dia}-${k}`;
              return (
                <div key={f.chave} className="space-y-1">
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="space-y-1">
                      <label htmlFor={`${id}-das`} className="block text-sm">
                        {C.das}
                      </label>
                      <select
                        id={`${id}-das`}
                        name={`inicio-${dia}`}
                        aria-label={C.rotuloDas(nomeDoDia, k)}
                        aria-describedby={idErro}
                        aria-invalid={comErro ? true : undefined}
                        value={String(f.inicioMin)}
                        onChange={(e) => mudar(dia, i, 'inicioMin', Number(e.target.value))}
                        className={CAMPO}
                      >
                        {OPCOES.map((o) => (
                          <option key={o.valor} value={o.valor}>
                            {o.rotulo}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label htmlFor={`${id}-as`} className="block text-sm">
                        {C.as}
                      </label>
                      <select
                        id={`${id}-as`}
                        name={`fim-${dia}`}
                        aria-label={C.rotuloAs(nomeDoDia, k)}
                        aria-describedby={idErro}
                        aria-invalid={comErro ? true : undefined}
                        value={String(f.fimMin)}
                        onChange={(e) => mudar(dia, i, 'fimMin', Number(e.target.value))}
                        className={CAMPO}
                      >
                        {OPCOES.map((o) => (
                          <option key={o.valor} value={o.valor}>
                            {o.rotulo}
                          </option>
                        ))}
                      </select>
                    </div>
                    <Botao type="button" variante="secundario" aria-label={C.rotuloRemover(k, nomeDoDia)} onClick={() => remover(dia, i)}>
                      {C.removerFaixa}
                    </Botao>
                  </div>
                  {comErro && (
                    <p id={idErro} role="alert" className="text-erro">
                      {erro.mensagem}
                    </p>
                  )}
                </div>
              );
            })}
            {/* o limite é conferido no servidor ("No máximo 3 faixas por dia."); aqui o botão só some no 3º */}
            {dias[dia].length < MAX_FAIXAS_POR_DIA && (
              <Botao id={`acrescentar-${dia}`} type="button" variante="secundario" onClick={() => acrescentar(dia)}>
                {C.acrescentarFaixa}
              </Botao>
            )}
          </fieldset>
        ))}
      </div>
    </>
  );
}

/**
 * US-446 (§6.2 "Configuração", §7.5): o horário de atendimento por mensagens — a chave do horário e a do aviso por e-mail
 * no topo e os 7 dias, cada um num `<fieldset>` com `<legend>`, as faixas ("Das"/"Às" em `<select>` de 15 em 15 min, com
 * nome acessível completo "{dia}, faixa {k}, das") e "Acrescentar faixa"/"Remover faixa". Erro junto à faixa, com a
 * configuração enviada de volta. Gravar volta com "Configuração salva." na região de status da página.
 */
export function FormularioDoHorario({ inicial, estadoInicial = null }: { inicial: ConfiguracaoDasMensagens; estadoInicial?: EstadoDoHorario | null }) {
  const [estadoSemJs, acaoSemJs] = useActionState<EstadoDoHorario | null, FormData>(salvarHorarioAction, estadoInicial);
  // rodada da T6c (I4): com JS, a rede caída devolve a configuração enviada com "Não foi possível salvar. Tente de novo."
  const [estadoComJs, acaoComJs, salvando] = useActionState<EstadoDoHorario | null, FormData>(
    seguraFalhaDeRede(salvarHorarioAction, (dados) => estadoDeFalha(dados, inicial)),
    null,
  );
  const comJs = useComJs();
  const estado = estadoComJs ?? estadoSemJs;
  return (
    <form action={comJs ? acaoComJs : acaoSemJs} className="space-y-4" aria-busy={salvando || undefined}>
      <Campos key={estado?.marca ?? 'inicio'} config={estado?.config ?? inicial} erro={estado?.erro ?? null} />
      {estado?.erroGeral && (
        <p key={estado.marca} role="alert" className="text-erro">
          {estado.erroGeral}
        </p>
      )}
      <Botao
        type="submit"
        aria-disabled={salvando || undefined}
        onClick={(e) => {
          if (salvando) e.preventDefault();
        }}
        className="aria-disabled:opacity-60"
      >
        {C.salvar}
      </Botao>
    </form>
  );
}

/**
 * Rodada da T6c (I3): "Configuração salva." numa região `role="status"` sempre montada (nunca remontada por `key`), que
 * recebe o foco (sem rolar) a cada gravação — o marcador `r` muda —, no molde da região viva da conversa.
 */
export function AvisoDeSalvo({ texto, marcador }: { texto: string; marcador: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (marcador) ref.current?.focus({ preventScroll: true });
  }, [marcador]);
  return (
    // re-revisão da T7: vazia, a região fica montada (região viva) sem ocupar espaço — a margem só com o aviso
    <p ref={ref} role="status" tabIndex={-1} className="mt-2 empty:mt-0 focus-visible:outline-offset-2">
      {texto}
    </p>
  );
}
