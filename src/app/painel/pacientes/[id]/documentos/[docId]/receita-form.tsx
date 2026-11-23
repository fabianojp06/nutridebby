'use client';

import Link from 'next/link';
import { useActionState, useState, type ReactNode } from 'react';
import { RetornoDaTela } from '@/app/painel/exames/retorno';
import { Botao } from '@/components/ui/botao';
import { semResetAutomatico } from '@/lib/form-sem-reset';
import { declaracaoDoDocumento } from '@/modules/documentos/constantes';
import { TIPOS_ITEM, type ConteudoReceita } from '@/modules/documentos/prescricao';
import { carregarModeloAction, prepararAction, salvarComoModeloAction, salvarItemAction, salvarRascunhoAction, type EstadoForm } from '../actions';
import { CamposDoItem, chavesDoItem, doItem, novoItem, type ItemNoFormulario } from './campos-do-item';
import { AdicionarItemSalvo, CarregarModelo, SalvarComoModelo, SalvarItem, type ItemSalvoDaReceita, type ModeloDaReceita } from './dialogos-da-receita';
import { MotivoRetificacao } from './motivo-retificacao';
import { OrientacoesCampo } from './orientacoes-campo';
import { marcarDeclaracao, Preparar, seguirDeclaracao, type EstadoDaDeclaracao } from './preparar';

type Estado = EstadoForm & { intencao?: 'salvar' | 'preparar' };
type Props = {
  patientId: string;
  docId: string;
  conteudo: ConteudoReceita;
  justificativa: string;
  habilitada: boolean;
  motivo?: string | null;
  /** Plano 22 (T10b, US-379): os itens salvos ("Adicionar item salvo") e os modelos ("Carregar modelo") do consultório. */
  itensSalvos?: ItemSalvoDaReceita[];
  modelos?: ModeloDaReceita[];
};
const ID_DOS_ITENS = 'itens-da-receita';

/**
 * Plano 22 (T10b, RN-394, EP-D30): "Carregar modelo" grava no servidor e devolve o conteúdo gravado; o editor guarda itens
 * e orientações em `useState` iniciado uma vez (um revalidate não o atualiza), então ele é **remontado** (`key`) com o
 * retorno — e com a justificativa e o motivo que estavam digitados (o modelo não os traz; a justificativa foi gravada
 * junto). Depois, "Rascunho salvo." na região de status e o foco no título "Itens da receita".
 */
export function ReceitaForm(props: Props) {
  const [base, setBase] = useState({ versao: 0, conteudo: props.conteudo, justificativa: props.justificativa, motivo: props.motivo ?? null });
  return (
    <EditorDaReceita
      key={base.versao}
      {...props}
      conteudo={base.conteudo}
      justificativa={base.justificativa}
      motivo={base.motivo}
      carregado={base.versao}
      aoCarregado={(conteudo, justificativa, motivo) => setBase((b) => ({ versao: b.versao + 1, conteudo, justificativa, motivo }))}
    />
  );
}

/**
 * US-142 + US-143: o editor e o preparo são UM formulário (revisão da T6). "Preparar para assinatura" manda o que está na
 * tela (a ação grava e prepara), e os erros dos dois botões voltam aos campos. Tudo controlado (o estado é a fonte, e o
 * JSON escondido sai dele) e o reset automático do React 19 cancelado (`semResetAutomatico`, SUS-108): o `form.reset()`
 * depois de cada action levava os <select> à primeira opção e as caixas ao estado da montagem — a tela mostrava outra
 * coisa que o JSON que se salva.
 * Plano 22 (T9): os campos de cada item por `CamposDoItem` (o seletor do tipo de cada item, a fórmula fitoterápica);
 * as orientações por `OrientacoesCampo` (marcação mínima, RN-395); a declaração mostrada é a do conteúdo da tela
 * (`declaracaoDoDocumento`, EP-D56: com a fórmula, a frase do art. 9º, II), a mesma que o preparo grava.
 * Plano 22 (T10b, US-379): "Salvar item" por item, "Adicionar item salvo", "Salvar como modelo" e "Carregar modelo" —
 * cada um com o seu `Dialogo` (e, nos que pedem o nome, o seu `<form>`) fora do `<form>` da receita (portal,
 * `dialogos-da-receita.tsx`). "Salvar item" e "Salvar como modelo" não salvam o rascunho; "Adicionar item salvo" copia
 * no cliente; a região `<p role="status">` (sempre montada) anuncia "Item salvo.", "Modelo salvo." e, depois de
 * "Carregar modelo", "Rascunho salvo.".
 */
function EditorDaReceita({
  patientId,
  docId,
  conteudo,
  justificativa: justificativaSalva,
  habilitada,
  motivo = null,
  itensSalvos = [],
  modelos = [],
  carregado,
  aoCarregado,
}: Props & { carregado: number; aoCarregado: (conteudo: ConteudoReceita, justificativa: string, motivo: string | null) => void }) {
  const [s, action, pendente] = useActionState<Estado, FormData>(async (prev, f) => {
    // o botão que enviou vem no FormData (submitter); Enter num campo envia pelo primeiro, "Salvar rascunho"
    const intencao = f.get('intencao') === 'preparar' ? 'preparar' : 'salvar';
    return { ...(await (intencao === 'preparar' ? prepararAction : salvarRascunhoAction)(patientId, docId, prev, f)), intencao };
  }, {});
  const [itens, setItens] = useState<ItemNoFormulario[]>(() => conteudo.itens.map(doItem));
  const [orientacoes, setOrientacoes] = useState(conteudo.orientacoes);
  const [justificativa, setJustificativa] = useState(justificativaSalva);
  // revisão da P22-09: a confirmação é do texto que estava na tela; a declaração muda com a fórmula e a caixa volta desmarcada
  const declaracao = declaracaoDoDocumento({ ...conteudo, itens: itens as unknown as ConteudoReceita['itens'], orientacoes });
  const [estadoDecl, setEstadoDecl] = useState<EstadoDaDeclaracao>({ vista: declaracao, marcada: false, mudou: false });
  // ajuste do estado durante a renderização (o padrão do React para "informação da renderização anterior"), sem efeito
  const decl = seguirDeclaracao(estadoDecl, declaracao);
  if (decl !== estadoDecl) setEstadoDecl(decl);
  // Q13-1 ★: null = não é retificação (o campo não aparece nem vai no formulário)
  const [motivoRet, setMotivoRet] = useState(motivo ?? '');
  // T10b: o retorno das bibliotecas na região de status; depois de "Carregar modelo" (remontado), "Rascunho salvo." e o foco nos itens
  const [retorno, setRetorno] = useState(carregado ? { texto: 'Rascunho salvo.', marcador: `c${carregado}`, focar: true } : { texto: '', marcador: '', focar: false });
  const anunciar = (texto: string) => setRetorno({ texto, marcador: String(Date.now()), focar: false });
  const focoNosItens = () => document.getElementById(ID_DOS_ITENS);
  const carregar = (modeloId: string, modo: 'acrescentar' | 'substituir') => {
    const f = new FormData();
    f.set('conteudo', JSON.stringify({ itens, orientacoes }));
    f.set('justificativa', justificativa);
    f.set('modeloId', modeloId);
    f.set('modo', modo);
    return carregarModeloAction(patientId, docId, f);
  };
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
      <h3 id={ID_DOS_ITENS} tabIndex={-1} className="font-semibold">Itens da receita</h3>
      <RetornoDaTela texto={retorno.texto} marcador={retorno.marcador} focarTitulo={retorno.focar ? ID_DOS_ITENS : undefined} />
      {/* T10b (RN-394): o modelo entra pelo caminho do "Salvar rascunho"; "Salvar como modelo" leva os itens e as orientações da tela */}
      <div className="flex flex-wrap gap-3">
        <CarregarModelo
          modelos={modelos}
          quantos={itens.length}
          carregar={carregar}
          aoCarregado={(c) => aoCarregado(c, justificativa, motivo !== null ? motivoRet : null)}
          focoAoFechar={focoNosItens}
        />
        <SalvarComoModelo conteudo={{ itens, orientacoes }} acao={salvarComoModeloAction.bind(null, patientId, docId)} aoSalvo={anunciar} />
      </div>
      {msg('itens', 'text-erro')}
      {itens.map((it, i) => (
        <fieldset key={i} className="space-y-3 rounded-2xl border border-borda p-4">
          <legend className="px-1 font-semibold">{`Item ${i + 1}: ${TIPOS_ITEM[it.tipo]}`}</legend>
          <CamposDoItem item={it} indice={i} habilitada={habilitada} erros={e} aoMudar={(novo) => setItens((xs) => xs.map((x, j) => (j === i ? novo : x)))} />
          <div className="flex flex-wrap items-center gap-3">
            <SalvarItem numero={i + 1} item={it} acao={salvarItemAction.bind(null, patientId, docId)} aoSalvo={anunciar} />
            <button type="button" className="min-h-11 underline" onClick={() => setItens((xs) => xs.filter((_, j) => j !== i))}>{`Remover item ${i + 1}`}</button>
          </div>
        </fieldset>
      ))}
      {/* o tipo é escolhido no seletor de cada item (CamposDoItem); o item novo nasce suplemento, como o seletor de antes */}
      {itens.length < 20 && (
        <div className="flex flex-wrap gap-3">
          <Botao type="button" variante="secundario" onClick={() => setItens((xs) => [...xs, novoItem('suplemento')])}>Adicionar item</Botao>
          {/* RN-393: copia o item salvo para o rascunho, no cliente, sem gravar */}
          <AdicionarItemSalvo itens={itensSalvos} habilitada={habilitada} aoAdicionar={(item) => setItens((xs) => (xs.length < 20 ? [...xs, doItem(item)] : xs))} focoAoFechar={focoNosItens} />
        </div>
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
      <Preparar declaracao={declaracao} marcada={decl.marcada} aoMarcar={(v) => setEstadoDecl((d) => marcarDeclaracao(seguirDeclaracao(d, declaracao), v))} mudou={decl.mudou} erro={erroDeclaracao} aviso={s.intencao === 'preparar' ? aviso : null} pendente={pendente} />
    </form>
  );
}
