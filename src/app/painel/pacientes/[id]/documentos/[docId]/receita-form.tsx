'use client';

import Link from 'next/link';
import { useActionState, useState, type ReactNode } from 'react';
import { Botao } from '@/components/ui/botao';
import { semResetAutomatico } from '@/lib/form-sem-reset';
import { declaracaoDoDocumento } from '@/modules/documentos/constantes';
import { TIPOS_ITEM, type ConteudoReceita } from '@/modules/documentos/prescricao';
import { prepararAction, salvarRascunhoAction, type EstadoForm } from '../actions';
import { CamposDoItem, chavesDoItem, doItem, novoItem, type ItemNoFormulario } from './campos-do-item';
import { MotivoRetificacao } from './motivo-retificacao';
import { OrientacoesCampo } from './orientacoes-campo';
import { Preparar } from './preparar';

type Estado = EstadoForm & { intencao?: 'salvar' | 'preparar' };

/**
 * US-142 + US-143: o editor e o preparo são UM formulário (revisão da T6). "Preparar para assinatura" manda o que está na
 * tela (a ação grava e prepara), e os erros dos dois botões voltam aos campos. Tudo controlado (o estado é a fonte, e o
 * JSON escondido sai dele) e o reset automático do React 19 cancelado (`semResetAutomatico`, SUS-108): o `form.reset()`
 * depois de cada action levava os <select> à primeira opção e as caixas ao estado da montagem — a tela mostrava outra
 * coisa que o JSON que se salva.
 * Plano 22 (T9): os campos de cada item por `CamposDoItem` (o seletor do tipo de cada item, a fórmula fitoterápica);
 * as orientações por `OrientacoesCampo` (marcação mínima, RN-395); a declaração mostrada é a do conteúdo da tela
 * (`declaracaoDoDocumento`, EP-D56: com a fórmula, a frase do art. 9º, II), a mesma que o preparo grava.
 */
export function ReceitaForm({ patientId, docId, conteudo, justificativa: justificativaSalva, habilitada, motivo = null }: { patientId: string; docId: string; conteudo: ConteudoReceita; justificativa: string; habilitada: boolean; motivo?: string | null }) {
  const [s, action, pendente] = useActionState<Estado, FormData>(async (prev, f) => {
    // o botão que enviou vem no FormData (submitter); Enter num campo envia pelo primeiro, "Salvar rascunho"
    const intencao = f.get('intencao') === 'preparar' ? 'preparar' : 'salvar';
    return { ...(await (intencao === 'preparar' ? prepararAction : salvarRascunhoAction)(patientId, docId, prev, f)), intencao };
  }, {});
  const [itens, setItens] = useState<ItemNoFormulario[]>(() => conteudo.itens.map(doItem));
  const [orientacoes, setOrientacoes] = useState(conteudo.orientacoes);
  const [justificativa, setJustificativa] = useState(justificativaSalva);
  const [declarada, setDeclarada] = useState(false);
  // Q13-1 ★: null = não é retificação (o campo não aparece nem vai no formulário)
  const [motivoRet, setMotivoRet] = useState(motivo ?? '');
  const e = s.erros ?? {};
  /** Cada chave de erro que um campo mostra; as que sobrarem vão para o aviso geral (nenhum erro some em silêncio). */
  const mostradas = new Set<string>(['geral', 'itens', 'orientacoes', 'justificativa', 'declaracao', ...(motivo !== null ? ['motivoRetificacao'] : [])]);
  itens.forEach((it, i) => chavesDoItem(it, `itens.${i}`).forEach((k) => mostradas.add(k)));
  /** RNF-10: o controle com erro leva aria-invalid e aponta para a mensagem (`<id>-erro`). */
  const aria = (k: string, dica?: string) => {
    const descr = [dica, e[k] ? `${k}-erro` : undefined].filter(Boolean).join(' ');
    return { 'aria-invalid': e[k] ? (true as const) : undefined, 'aria-describedby': descr || undefined };
  };
  const msg = (k: string, className = 'text-sm text-erro') => e[k] && <p id={`${k}-erro`} role="alert" className={className}>{e[k]}</p>;
  const editor = (
    <>
      {motivo !== null && <MotivoRetificacao valor={motivoRet} aoMudar={setMotivoRet} erro={e.motivoRetificacao} />}
      <h3 className="font-semibold">Itens da receita</h3>
      {msg('itens', 'text-erro')}
      {itens.map((it, i) => (
        <fieldset key={i} className="space-y-3 rounded-2xl border border-borda p-4">
          <legend className="px-1 font-semibold">{`Item ${i + 1}: ${TIPOS_ITEM[it.tipo]}`}</legend>
          <CamposDoItem item={it} indice={i} habilitada={habilitada} erros={e} aoMudar={(novo) => setItens((xs) => xs.map((x, j) => (j === i ? novo : x)))} />
          <button type="button" className="min-h-11 underline" onClick={() => setItens((xs) => xs.filter((_, j) => j !== i))}>{`Remover item ${i + 1}`}</button>
        </fieldset>
      ))}
      {/* o tipo é escolhido no seletor de cada item (CamposDoItem); o item novo nasce suplemento, como o seletor de antes */}
      {itens.length < 20 && (
        <Botao type="button" variante="secundario" onClick={() => setItens((xs) => [...xs, novoItem('suplemento')])}>Adicionar item</Botao>
      )}
      <OrientacoesCampo id="orientacoes" rotulo="Orientações gerais (opcional)" max={2000} valor={orientacoes} aoMudar={setOrientacoes} erro={e.orientacoes} />
      <div className="space-y-1">
        <label htmlFor="justificativa" className="block font-medium">Justificativa de uso</label>
        <textarea id="justificativa" name="justificativa" maxLength={2000} value={justificativa} onChange={(ev) => setJustificativa(ev.target.value)} {...aria('justificativa', 'justificativa-dica')} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto" />
        <p id="justificativa-dica" className="text-sm text-suave">Fica no prontuário, não vai na receita.</p>
        {msg('justificativa')}
      </div>
    </>
  );
  const declaracao = declaracaoDoDocumento({ ...conteudo, itens: itens as unknown as ConteudoReceita['itens'], orientacoes });
  const erroDeclaracao = e.declaracao;
  const sobras = [...new Set(Object.keys(e).filter((k) => !mostradas.has(k)).map((k) => e[k]))];
  // o aviso geral (e as chaves sem campo) aparece junto do botão que foi usado
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
    <form action={action} ref={semResetAutomatico} className="space-y-6" data-guia="editor-receita">
      <input type="hidden" name="conteudo" value={JSON.stringify({ itens, orientacoes })} />
      {editor}
      {s.intencao !== 'preparar' && aviso}
      {s.ok && s.intencao === 'salvar' && <p role="status">Rascunho salvo.</p>}
      <Botao disabled={pendente}>Salvar rascunho</Botao>
      <Preparar declaracao={declaracao} marcada={declarada} aoMarcar={setDeclarada} erro={erroDeclaracao} aviso={s.intencao === 'preparar' ? aviso : null} pendente={pendente} />
    </form>
  );
}
