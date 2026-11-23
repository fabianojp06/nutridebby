'use client';
import { useActionState, useState } from 'react';
import { Botao } from '@/components/ui/botao';
import { FIM_DO_DIA_MIN, MAX_FAIXAS_POR_DIA, MSG_MENSAGENS, PASSO_FAIXA_MIN } from '@/modules/mensagens/constantes';
import type { ConfiguracaoDasMensagens } from '@/modules/mensagens/horario';
import { salvarHorarioAction, type EstadoDoHorario } from './actions';

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

/** O formulário remontado a cada resposta (`marca`): começa com a configuração devolvida (ou a gravada) e o erro. */
function Campos({ config, erro }: { config: ConfiguracaoDasMensagens; erro: EstadoDoHorario['erro'] | null }) {
  const [dias, setDias] = useState<Dias>(() => paraDias(config));
  const mudar = (dia: number, i: number, campo: 'inicioMin' | 'fimMin', valor: number) =>
    setDias((d) => d.map((fs, j) => (j === dia ? fs.map((f, k) => (k === i ? { ...f, [campo]: valor } : f)) : fs)));
  const acrescentar = (dia: number) => setDias((d) => d.map((fs, j) => (j === dia ? [...fs, { chave: proxima++, ...NOVA }] : fs)));
  const remover = (dia: number, i: number) => setDias((d) => d.map((fs, j) => (j === dia ? fs.filter((_, k) => k !== i) : fs)));
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
                  <div data-guia="mensagens-24h" className="flex flex-wrap items-end gap-3">
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
              <Botao type="button" variante="secundario" onClick={() => acrescentar(dia)}>
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
  const [estado, acao, salvando] = useActionState<EstadoDoHorario | null, FormData>(salvarHorarioAction, estadoInicial);
  return (
    <form action={acao} className="space-y-4" aria-busy={salvando || undefined}>
      <Campos key={estado?.marca ?? 'inicio'} config={estado?.config ?? inicial} erro={estado?.erro ?? null} />
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
