'use client';

import { useActionState, useRef, useState } from 'react';
import { MAX_TEXTO, MSG_TEXTO_LIVRE } from '@/modules/plano-alimentar/constantes';
import { MSG_MINHAS_REFEICOES, NOME_MINHA_REFEICAO_MAX, type MinhaRefeicaoEnviada } from '@/modules/plano-alimentar/biblioteca-constantes';
import { kcalTexto, totalDosItens } from '@/modules/plano-alimentar/calculo';
import type { MinhaRefeicao } from '@/modules/plano-alimentar/refeicoes-modelo';
import { TIPOS_DE_REFEICAO } from '@/modules/plano-alimentar/tipos-de-refeicao';
import { gramasDoItem, itemEstadoDe, itemParaEnvio, type ItemEstado } from '../editor/estado';
import { useFocoNoPrimeiroErro } from '../foco-no-erro';
import { ItemDaBiblioteca } from '../item-da-biblioteca';
import type { MinhaRefeicaoState } from './actions';

type Acao = (s: MinhaRefeicaoState, fd: FormData) => Promise<MinhaRefeicaoState>;
const CAMPO = 'w-full rounded-xl border border-campo bg-cartao p-2 text-texto';
const descritoPor = (...ids: (string | false | undefined)[]) => ids.filter(Boolean).join(' ') || undefined;

/**
 * US-237 "Tela de cadastro": nome, tipo, horário, observação e, conforme o modo, os itens (quantidade, medida,
 * remover; alimento novo entra pelo editor do plano: carregar, mudar e salvar de novo) ou o texto livre. Os erros ficam
 * ao lado do campo (`role="alert"`, `aria-describedby`) e, a cada resposta com erro, o foco vai ao primeiro campo
 * inválido (com até 40 itens, o botão "Salvar refeição" fica longe do topo); o que foi digitado fica no estado da tela.
 */
export function RefeicaoForm({ acao, refeicao }: { acao: Acao; refeicao: MinhaRefeicao }) {
  const [state, action, pendente] = useActionState(acao, {});
  const [nome, setNome] = useState(refeicao.nome);
  const [tipo, setTipo] = useState<string>(refeicao.tipo);
  const [horario, setHorario] = useState(refeicao.horario);
  const [observacao, setObservacao] = useState(refeicao.observacao);
  const [descricao, setDescricao] = useState(refeicao.descricaoLivre ?? '');
  const [itens, setItens] = useState<ItemEstado[]>(() => refeicao.itens.map(itemEstadoDe));
  const raiz = useRef<HTMLFormElement>(null);
  useFocoNoPrimeiroErro(raiz, state.erros);
  const e = state.erros ?? {};
  const erro = (k: string) => e[k];
  const livre = refeicao.modo === 'livre';
  const dados: MinhaRefeicaoEnviada = { nome, tipo, horario, observacao, modo: refeicao.modo, descricaoLivre: livre ? descricao : null, itens: livre ? [] : itens.map(itemParaEnvio) };
  const total = totalDosItens(itens.map((i) => ({ id: i.id, quantidadeG: gramasDoItem(i), porCem: i.porCem, substituiItemId: i.substituiItemId })));
  const erroCampo = (k: string, id: string) => e[k] && <p id={`${id}-erro`} role="alert" className="text-sm text-erro">{e[k]}</p>;
  return (
    <form ref={raiz} action={action} className="space-y-4" noValidate>
      <input type="hidden" name="dados" value={JSON.stringify(dados)} />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <label htmlFor="nome" className="block font-medium">Nome</label>
          <input id="nome" value={nome} maxLength={NOME_MINHA_REFEICAO_MAX} onChange={(ev) => setNome(ev.target.value)} aria-invalid={e.nome ? true : undefined} aria-describedby={e.nome ? 'nome-erro' : undefined} className={CAMPO} />
          {erroCampo('nome', 'nome')}
        </div>
        <div className="space-y-1">
          <label htmlFor="tipo" className="block font-medium">Tipo</label>
          <select id="tipo" value={tipo} onChange={(ev) => setTipo(ev.target.value)} aria-invalid={e.tipo ? true : undefined} aria-describedby={e.tipo ? 'tipo-erro' : undefined} className={CAMPO}>
            {TIPOS_DE_REFEICAO.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          {erroCampo('tipo', 'tipo')}
        </div>
        <div className="space-y-1">
          <label htmlFor="horario" className="block font-medium">Horário</label>
          <input id="horario" type="time" value={horario} onChange={(ev) => setHorario(ev.target.value)} aria-invalid={e.horario ? true : undefined} aria-describedby={e.horario ? 'horario-erro' : undefined} className={CAMPO} />
          {erroCampo('horario', 'horario')}
        </div>
      </div>

      {livre ? (
        <div className="space-y-1">
          <label htmlFor="descricao" className="block font-medium">O que comer</label>
          <p id="descricao-dica" className="text-sm text-suave">{MSG_TEXTO_LIVRE.apareceNoApp}</p>
          <textarea id="descricao" rows={4} maxLength={MAX_TEXTO} value={descricao} onChange={(ev) => setDescricao(ev.target.value)} aria-invalid={e.descricaoLivre ? true : undefined} aria-describedby={descritoPor('descricao-dica', e.descricaoLivre && 'descricao-erro')} className={CAMPO} />
          {erroCampo('descricaoLivre', 'descricao')}
        </div>
      ) : (
        <section aria-labelledby="itens-titulo" className="space-y-2">
          <h2 id="itens-titulo" className="font-medium">Alimentos</h2>
          <ul className="space-y-2">
            {itens.map((i) => (
              <ItemDaBiblioteca
                key={i.id}
                i={i}
                onde={nome || refeicao.nome}
                substituicao={i.substituiItemId !== null}
                alterar={(novo) => setItens(itens.map((x) => (x.id === i.id ? novo : x)))}
                remover={() => setItens(itens.filter((x) => x.id !== i.id && x.substituiItemId !== i.id))}
                erro={erro}
              />
            ))}
          </ul>
          <p className="text-sm">{MSG_MINHAS_REFEICOES.kcal(kcalTexto(total.kcal))}</p>
        </section>
      )}

      <div className="space-y-1">
        <label htmlFor="observacao" className="block font-medium">Observação</label>
        <p id="observacao-dica" className="text-sm text-suave">{MSG_TEXTO_LIVRE.apareceNoApp}</p>
        <textarea id="observacao" rows={2} maxLength={MAX_TEXTO} value={observacao} onChange={(ev) => setObservacao(ev.target.value)} aria-invalid={e.observacao ? true : undefined} aria-describedby={descritoPor('observacao-dica', e.observacao && 'observacao-erro')} className={CAMPO} />
        {erroCampo('observacao', 'observacao')}
      </div>
      {e.geral && <p role="alert" className="text-erro">{e.geral}</p>}
      {state.ok && <p role="status" className="text-ok">{state.ok}</p>}
      <button disabled={pendente} className="inline-flex min-h-11 items-center justify-center rounded-full bg-destaque px-5 font-semibold text-white hover:brightness-95">Salvar refeição</button>
    </form>
  );
}

/** Excluir com a confirmação (as cópias carregadas nos planos não mudam). */
export function ExcluirRefeicao({ acao }: { acao: (s: MinhaRefeicaoState) => Promise<MinhaRefeicaoState> }) {
  const [state, action, pendente] = useActionState(acao, {});
  return (
    <form action={action} onSubmit={(ev) => { if (!window.confirm(MSG_MINHAS_REFEICOES.excluir)) ev.preventDefault(); }}>
      <button disabled={pendente} className="inline-flex min-h-11 items-center text-link underline">Excluir</button>
      {state.erros?.geral && <p role="alert" className="text-sm text-erro">{state.erros.geral}</p>}
    </form>
  );
}
