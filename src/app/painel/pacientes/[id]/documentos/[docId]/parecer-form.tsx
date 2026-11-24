'use client';

import Link from 'next/link';
import { useActionState, useState, type ReactNode } from 'react';
import { Botao } from '@/components/ui/botao';
import { semResetAutomatico } from '@/lib/form-sem-reset';
import { AVALIACAO_MAX, CONDUTA_MAX, ENCAMINHAMENTOS_MAX, MSG_PARECER, PARECER_MAX_EXAMES, type ConteudoParecer } from '@/modules/documentos/parecer';
import { prepararParecerAction, salvarParecerAction, type EstadoForm } from '../actions';
import { MotivoRetificacao } from './motivo-retificacao';
import { Preparar } from './preparar';

/**
 * Um exame da lista do prontuário (listarExames, com auditRead), já com o rótulo "Hemograma — 01/09/2026" e as linhas
 * dos valores (linhaDoValor) — US-141, "Valores atualizados no rascunho": o editor mostra os valores de cada exame marcado.
 */
export type ExameParaEscolher = { id: string; rotulo: string; semValores: boolean; linhas: string[] };
type Estado = EstadoForm & { intencao?: 'salvar' | 'preparar' };
type Texto = { id: 'avaliacao' | 'conduta' | 'encaminhamentos'; rotulo: string; max: number };
const TEXTOS: Texto[] = [
  { id: 'avaliacao', rotulo: 'Avaliação nutricional', max: AVALIACAO_MAX },
  { id: 'conduta', rotulo: 'Conduta e orientações (opcional)', max: CONDUTA_MAX },
  { id: 'encaminhamentos', rotulo: 'Encaminhamentos (opcional)', max: ENCAMINHAMENTOS_MAX },
];
/** As chaves de erro que um campo do editor mostra; as que sobrarem vão para o aviso geral (nenhum erro some em silêncio). */
const CAMPOS = new Set(['geral', 'motivoRetificacao', 'exames', 'avaliacao', 'conduta', 'encaminhamentos', 'declaracao']);

/**
 * US-141 + US-143: o editor e o preparo do parecer são UM formulário, como o da receita (revisão da T6 do 10A). Tudo
 * controlado, com o reset automático do React 19 cancelado (`semResetAutomatico`, SUS-108: o reset desmarcava as caixas
 * dos exames escolhidos depois da action, e a tela mostrava outra seleção que a do JSON). A seleção vem da lista do prontuário; um
 * exame da cópia que não está mais nela (excluído) sai da seleção com o aviso proposto da spec v0.5 (desvio 10).
 */
export function ParecerForm({ patientId, docId, conteudo, exames, declaracao, motivo = null }: { patientId: string; docId: string; conteudo: ConteudoParecer; exames: ExameParaEscolher[]; declaracao: string; motivo?: string | null }) {
  const [s, action, pendente] = useActionState<Estado, FormData>(async (prev, f) => {
    // o botão que enviou vem no FormData (submitter); Enter num campo envia pelo primeiro, "Salvar rascunho"
    const intencao = f.get('intencao') === 'preparar' ? 'preparar' : 'salvar';
    return { ...(await (intencao === 'preparar' ? prepararParecerAction : salvarParecerAction)(patientId, docId, prev, f)), intencao };
  }, {});
  const existentes = new Set(exames.map((x) => x.id));
  const [selecionados, setSelecionados] = useState<string[]>(() => conteudo.exames.map((x) => x.id).filter((id) => existentes.has(id)));
  const [textos, setTextos] = useState({ avaliacao: conteudo.avaliacao, conduta: conteudo.conduta, encaminhamentos: conteudo.encaminhamentos });
  const [declarada, setDeclarada] = useState(false);
  // Q13-1 ★: null = não é retificação (o campo não aparece nem vai no formulário)
  const [motivoRet, setMotivoRet] = useState(motivo ?? '');
  const excluidoNaCopia = conteudo.exames.some((x) => !existentes.has(x.id));
  const e = s.erros ?? {};
  /** RNF-10: o controle com erro leva aria-invalid e aponta para a mensagem (`<id>-erro`). */
  const aria = (k: string) => ({ 'aria-invalid': e[k] ? (true as const) : undefined, 'aria-describedby': e[k] ? `${k}-erro` : undefined });
  const msg = (k: string) => e[k] && <p id={`${k}-erro`} role="alert" className="text-sm text-erro">{e[k]}</p>;
  // a ordem da lista do prontuário (mais recente primeiro) é a do parecer
  const exameIds = exames.map((x) => x.id).filter((id) => selecionados.includes(id));
  const sobras = [...new Set(Object.keys(e).filter((k) => !CAMPOS.has(k)).map((k) => e[k]))];
  const aviso: ReactNode = (e.geral || sobras.length > 0) && (
    <div role="alert" className="space-y-1 text-erro">
      {e.geral && (
        <p>
          {e.geral} {s.perfilIncompleto && <Link href="/painel/configuracoes/perfil#documentos" className="underline">Completar perfil</Link>}
        </p>
      )}
      {sobras.map((m) => <p key={m}>{m}</p>)}
    </div>
  );
  return (
    <form action={action} ref={semResetAutomatico} className="space-y-6" data-guia="editor-parecer">
      <input type="hidden" name="conteudo" value={JSON.stringify({ exameIds, ...textos })} />
      {motivo !== null && <MotivoRetificacao valor={motivoRet} aoMudar={setMotivoRet} erro={e.motivoRetificacao} />}
      {/* só aria-describedby: aria-invalid não vale num grupo (fieldset) */}
      <fieldset className="space-y-2" aria-describedby={e.exames ? 'exames-erro' : undefined}>
        <legend className="font-semibold">Exames considerados</legend>
        {excluidoNaCopia && <p role="note" className="text-sm text-erro">{MSG_PARECER.exameExcluido}</p>}
        {exames.length === 0 ? (
          <p>
            Nenhum exame lançado. Lance os exames na aba <Link href={`/painel/pacientes/${patientId}/exames`} className="text-link underline">Exames</Link>.
          </p>
        ) : (
          exames.map((x) => {
            const marcado = selecionados.includes(x.id);
            // os valores do exame marcado, como o prontuário os tem agora (os que o rascunho copia ao salvar)
            const valores = marcado && x.linhas.length > 0 ? `exame-${x.id}-valores` : undefined;
            return (
              <div key={x.id}>
                <div className="flex min-h-11 items-center gap-2">
                  <input
                    id={`exame-${x.id}`}
                    type="checkbox"
                    checked={marcado}
                    disabled={!marcado && selecionados.length >= PARECER_MAX_EXAMES}
                    onChange={(ev) => setSelecionados((xs) => (ev.target.checked ? [...xs, x.id] : xs.filter((id) => id !== x.id)))}
                    aria-describedby={valores}
                    className="size-5"
                  />
                  <label htmlFor={`exame-${x.id}`}>{x.semValores ? `${x.rotulo} (${MSG_PARECER.semValores})` : x.rotulo}</label>
                </div>
                {valores && (
                  <ul id={valores} className="ml-7 text-sm">
                    {x.linhas.map((l, i) => <li key={i}>{l}</li>)}
                  </ul>
                )}
              </div>
            );
          })
        )}
        {msg('exames')}
      </fieldset>
      {TEXTOS.map((t) => (
        <div key={t.id} className="space-y-1">
          <label htmlFor={t.id} className="block font-medium">{t.rotulo}</label>
          <textarea id={t.id} maxLength={t.max} rows={t.id === 'avaliacao' ? 8 : 4} value={textos[t.id]} onChange={(ev) => setTextos((x) => ({ ...x, [t.id]: ev.target.value }))} {...aria(t.id)} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto" />
          {msg(t.id)}
        </div>
      ))}
      {s.intencao !== 'preparar' && aviso}
      {s.ok && s.intencao === 'salvar' && <p role="status">Rascunho salvo.</p>}
      <Botao disabled={pendente}>Salvar rascunho</Botao>
      <Preparar declaracao={declaracao} marcada={declarada} aoMarcar={setDeclarada} erro={e.declaracao} aviso={s.intencao === 'preparar' ? aviso : null} pendente={pendente} />
    </form>
  );
}
