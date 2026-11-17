'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ROTULO_TIPO_CONTEUDO } from '@/modules/conteudo/constantes';
import { formatarDataNoFuso } from '@/modules/pacientes/datas';
import { MAX_CONTEUDOS_PLANO, MAX_LISTAS_PLANO, MSG_LIGADOS, type ConteudoParaLigar, type ListaDaBiblioteca } from '@/modules/plano-alimentar/biblioteca-constantes';
import { quantidadeDoItem } from '@/modules/plano-alimentar/calculo';
import { MSG_TEXTO_LIVRE } from '@/modules/plano-alimentar/constantes';
import type { ConteudoLigado, ListaLigada } from '@/modules/plano-alimentar/tipos';
import { atualizarDaBibliotecaAction, desligarConteudoAction, ligarConteudoAction, ligarListaAction, removerListaAction, type ResultadoLigado } from './ligados-actions';

const BOTAO = 'inline-flex min-h-11 items-center justify-center rounded-full border border-campo bg-cartao px-5 text-texto hover:bg-linha disabled:opacity-50';
const LINK = 'inline-flex min-h-11 items-center text-sm underline disabled:opacity-50';
const ERRO_DE_REDE = 'Não foi possível salvar agora. Tente de novo.';

type Props = {
  planId: string;
  /** Nulo = modelo. */
  patientId: string | null;
  listas: ListaLigada[];
  conteudos: ConteudoLigado[];
  /** Data da cópia ("Cópia de {data}") no fuso do consultório. */
  fuso: string;
  /** Rascunho editável: com a biblioteca do consultório para ligar; sem ela (publicado, arquivado, bloqueado), só leitura. */
  biblioteca?: { listas: ListaDaBiblioteca[]; conteudos: ConteudoParaLigar[] };
};

/**
 * US-239 (RN-252, RN-253): a seção "Ligado ao plano" do editor. A lista entra como cópia ("Cópia de {data}. Mudanças na
 * biblioteca não alteram este plano.", com "Atualizar da biblioteca" enquanto a lista de origem existe e "Remover"); a
 * receita ou o material, com o tipo e a situação ("Publicado" / "Não publicado — o paciente não vê" / "{título}
 * (excluído)"). Cada ação grava na hora (fora do salvamento automático); o erro fica ao lado do bloco, em `role="alert"`.
 * O sucesso é lido pela região `role="status"` sempre montada, e o foco vai ao título do item ligado ou atualizado (o
 * painel de "Ligar" se esconde, e o próprio seletor some quando acaba o que ligar) ou, depois de "Remover", ao da seção.
 */
export function LigadoAoPlano({ planId, patientId, listas: listasIniciais, conteudos: conteudosIniciais, fuso, biblioteca }: Props) {
  const id = useId();
  const dono = { planId, patientId };
  const editavel = biblioteca !== undefined;
  const [listas, setListas] = useState(listasIniciais);
  const [conteudos, setConteudos] = useState(conteudosIniciais);
  const [erroListas, setErroListas] = useState('');
  const [erroConteudos, setErroConteudos] = useState('');
  const [pendente, setPendente] = useState(false);
  const titulo = useRef<HTMLHeadingElement>(null);
  const [aviso, setAviso] = useState('');
  // título do item que recebe o foco depois de ligar ou atualizar: só existe depois do commit (item novo), então o foco
  // vai no efeito, não no clique; objeto novo a cada vez para repetir o foco no mesmo item
  const [foco, setFoco] = useState<{ alvo: string } | null>(null);
  useEffect(() => {
    if (foco) document.getElementById(foco.alvo)?.focus();
  }, [foco]);
  const idDaLista = (listaId: string) => `${id}-lista-${listaId}`;
  const idDoConteudo = (ligacaoId: string) => `${id}-conteudo-${ligacaoId}`;

  /** Roda a ação; devolve o valor ou põe o erro no bloco certo. */
  async function rodar<T>(acao: () => Promise<ResultadoLigado<T>>, setErro: (m: string) => void): Promise<{ ok: true; valor: T } | { ok: false }> {
    setPendente(true);
    setErro('');
    setAviso(''); // a mesma frase de novo (duas listas ligadas seguidas) volta a ser lida
    try {
      const r = await acao();
      if (r.erro !== undefined) {
        setErro(r.erro);
        return { ok: false };
      }
      return { ok: true, valor: r.valor as T };
    } catch {
      setErro(ERRO_DE_REDE);
      return { ok: false };
    } finally {
      setPendente(false);
    }
  }
  const trocarLista = (l: ListaLigada) => setListas((ls) => (ls.some((x) => x.id === l.id) ? ls.map((x) => (x.id === l.id ? l : x)) : [...ls, l]));
  const trocarConteudo = (c: ConteudoLigado) => setConteudos((cs) => (cs.some((x) => x.id === c.id) ? cs.map((x) => (x.id === c.id ? c : x)) : [...cs, c]));
  // depois de "Remover", o item some: o foco vai ao título da seção (não se perde no fim da página)
  const focarTitulo = () => requestAnimationFrame(() => titulo.current?.focus());

  const naBiblioteca = new Set(biblioteca?.listas.map((l) => l.id));
  const ligaveisListas = (biblioteca?.listas ?? []).filter((l) => !listas.some((x) => x.listaOrigemId === l.id));
  const ligaveisConteudos = (biblioteca?.conteudos ?? []).filter((c) => !conteudos.some((x) => x.contentId === c.id));
  const vazio = !listas.length && !conteudos.length;

  return (
    <section aria-labelledby={`${id}-titulo`} className="space-y-4 rounded-2xl border border-borda bg-cartao p-3">
      <h2 id={`${id}-titulo`} ref={titulo} tabIndex={-1} className="font-titulo text-lg font-semibold">{MSG_LIGADOS.titulo}</h2>
      <p role="status" className="sr-only">{aviso}</p>
      {vazio && <p className="text-suave">{MSG_LIGADOS.vazio}</p>}

      {listas.length > 0 && (
        <ul className="space-y-3">
          {listas.map((l) => (
            <li key={l.id} className="space-y-1 rounded-xl border border-borda p-3">
              <h3 id={idDaLista(l.id)} tabIndex={-1} className="font-medium">{l.nome}</h3>
              <p className="text-sm text-suave">{MSG_LIGADOS.copia(formatarDataNoFuso(l.copiadaEm, fuso))}</p>
              {l.orientacao && (
                <>
                  <p className="wrap-break-word whitespace-pre-line text-sm">{l.orientacao}</p>
                  <p className="text-sm text-suave">{MSG_TEXTO_LIVRE.apareceNoApp}</p>
                </>
              )}
              <details>
                <summary className="min-h-11 cursor-pointer py-2 text-sm">
                  {MSG_LIGADOS.contagem(l.grupos.length, l.grupos.reduce((n, g) => n + g.itens.length, 0))}
                </summary>
                {l.grupos.map((g, k) => (
                  <div key={k} className="mt-2">
                    <h4 className="text-sm font-semibold">{g.nome}</h4>
                    <ul className="ml-5 list-disc text-sm">
                      {g.itens.map((i, n) => <li key={n}>{`${i.nome} — ${quantidadeDoItem(i)}`}</li>)}
                    </ul>
                  </div>
                ))}
              </details>
              {editavel && (
                <div className="flex flex-wrap gap-x-4">
                  {l.listaOrigemId && naBiblioteca.has(l.listaOrigemId) && (
                    <button
                      type="button"
                      disabled={pendente}
                      className={LINK}
                      onClick={async () => {
                        const r = await rodar(() => atualizarDaBibliotecaAction(dono, l.id), setErroListas);
                        if (!r.ok) return;
                        trocarLista(r.valor);
                        setAviso(MSG_LIGADOS.listaAtualizada);
                        setFoco({ alvo: idDaLista(r.valor.id) });
                      }}
                    >
                      {MSG_LIGADOS.atualizar}<span className="sr-only">: {l.nome}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={pendente}
                    className={LINK}
                    onClick={async () => {
                      const r = await rodar(() => removerListaAction(dono, l.id), setErroListas);
                      if (!r.ok) return;
                      setListas((ls) => ls.filter((x) => x.id !== l.id));
                      focarTitulo();
                    }}
                  >
                    {MSG_LIGADOS.remover}<span className="sr-only">: {l.nome}</span>
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editavel && (
        <Ligar
          rotulo={MSG_LIGADOS.ligarLista}
          campo={MSG_LIGADOS.lista}
          opcoes={ligaveisListas.map((l) => ({ id: l.id, texto: `${l.nome} — ${MSG_LIGADOS.contagem(l.grupos, l.itens)}` }))}
          cheio={listas.length >= MAX_LISTAS_PLANO}
          pendente={pendente}
          erro={erroListas}
          aoLigar={async (listaId) => {
            const r = await rodar(() => ligarListaAction(dono, listaId), setErroListas);
            if (!r.ok) return false;
            trocarLista(r.valor);
            setAviso(MSG_LIGADOS.listaLigada);
            setFoco({ alvo: idDaLista(r.valor.id) });
            return true;
          }}
        />
      )}

      {conteudos.length > 0 && (
        <ul className="space-y-2">
          {conteudos.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-borda p-3">
              <div>
                <p id={idDoConteudo(c.id)} tabIndex={-1} className="font-medium">{c.situacao === 'excluido' ? MSG_LIGADOS.excluido(c.titulo) : c.titulo}</p>
                {c.situacao !== 'excluido' && (
                  <p className={`text-sm ${c.situacao === 'publicado' ? 'text-suave' : 'font-semibold text-aviso'}`}>
                    {[c.tipo ? ROTULO_TIPO_CONTEUDO[c.tipo] : null, c.situacao === 'publicado' ? MSG_LIGADOS.publicado : MSG_LIGADOS.naoPublicado].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
              {editavel && (
                <button
                  type="button"
                  disabled={pendente}
                  className={LINK}
                  onClick={async () => {
                    const r = await rodar(() => desligarConteudoAction(dono, c.id), setErroConteudos);
                    if (!r.ok) return;
                    setConteudos((cs) => cs.filter((x) => x.id !== c.id));
                    focarTitulo();
                  }}
                >
                  {MSG_LIGADOS.remover}<span className="sr-only">: {c.titulo}</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editavel && (
        <Ligar
          rotulo={MSG_LIGADOS.ligarConteudo}
          campo={MSG_LIGADOS.conteudo}
          opcoes={ligaveisConteudos.map((c) => ({ id: c.id, texto: `${c.titulo} — ${ROTULO_TIPO_CONTEUDO[c.tipo]}${c.publicado ? '' : ` · ${MSG_LIGADOS.naoPublicado}`}` }))}
          cheio={conteudos.length >= MAX_CONTEUDOS_PLANO}
          pendente={pendente}
          erro={erroConteudos}
          aoLigar={async (contentId) => {
            const r = await rodar(() => ligarConteudoAction(dono, contentId), setErroConteudos);
            if (!r.ok) return false;
            trocarConteudo(r.valor);
            setAviso(MSG_LIGADOS.conteudoLigado);
            setFoco({ alvo: idDoConteudo(r.valor.id) });
            return true;
          }}
        />
      )}
    </section>
  );
}

/**
 * "Ligar lista de substituição" / "Ligar receita ou material": o botão abre o seletor com o que ainda não está no plano.
 * No limite, o botão fica desabilitado com o motivo; sem nada a ligar, o botão não aparece. O erro da ação fica logo
 * abaixo, ligado ao seletor por `aria-describedby`.
 */
function Ligar({ rotulo, campo, opcoes, cheio, pendente, erro, aoLigar }: {
  rotulo: string;
  campo: string;
  opcoes: { id: string; texto: string }[];
  cheio: boolean;
  pendente: boolean;
  erro: string;
  aoLigar: (id: string) => Promise<boolean>;
}) {
  const id = useId();
  const [aberto, setAberto] = useState(false);
  const [escolhida, setEscolhida] = useState('');
  const valor = opcoes.some((o) => o.id === escolhida) ? escolhida : (opcoes[0]?.id ?? '');
  if (!opcoes.length && !erro) return null;
  return (
    <div className="space-y-1">
      {opcoes.length > 0 && (
        <button
          type="button"
          disabled={cheio}
          aria-expanded={aberto && !cheio}
          aria-controls={`${id}-painel`}
          aria-describedby={cheio ? `${id}-limite` : undefined}
          onClick={() => setAberto((a) => !a)}
          className={BOTAO}
        >
          {rotulo}
        </button>
      )}
      {cheio && <p id={`${id}-limite`} className="text-sm text-suave">{MSG_LIGADOS.limite}</p>}
      <div id={`${id}-painel`} hidden={!aberto || cheio || !opcoes.length} className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label htmlFor={`${id}-opcao`} className="block text-sm">{campo}</label>
          <select
            id={`${id}-opcao`}
            value={valor}
            onChange={(e) => setEscolhida(e.target.value)}
            aria-invalid={erro ? true : undefined}
            aria-describedby={erro ? `${id}-erro` : undefined}
            className="max-w-full rounded-xl border border-campo bg-cartao p-2 text-texto"
          >
            {opcoes.map((o) => <option key={o.id} value={o.id}>{o.texto}</option>)}
          </select>
        </div>
        <button
          type="button"
          disabled={pendente || !valor}
          onClick={async () => {
            // o painel se esconde com o foco aqui (e o seletor some quando era a última opção): quem chama leva o
            // foco ao título do item ligado
            if (await aoLigar(valor)) setAberto(false);
          }}
          className={BOTAO}
        >
          {MSG_LIGADOS.ligar}
        </button>
      </div>
      {erro && <p id={`${id}-erro`} role="alert" className="text-sm text-erro">{erro}</p>}
    </div>
  );
}
