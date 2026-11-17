'use client';

import { useId, useLayoutEffect, useRef, useState } from 'react';
import { MSG_MINHAS_REFEICOES, NOME_MINHA_REFEICAO_MAX, type MinhaRefeicaoDaLista, type MinhaRefeicaoEnviada } from '@/modules/plano-alimentar/biblioteca-constantes';
import { kcalTexto } from '@/modules/plano-alimentar/calculo';
import { MSG_PLANO } from '@/modules/plano-alimentar/constantes';
import { TIPOS_DE_REFEICAO, type TipoDeRefeicao } from '@/modules/plano-alimentar/tipos-de-refeicao';
import type { ModoPlano, RefeicaoPlano } from '@/modules/plano-alimentar/tipos';
import { carregarMinhaRefeicaoAction, salvarComoMinhaRefeicaoAction } from '../refeicoes/actions';
import { itemParaEnvio, type RefeicaoEstado } from './estado';

const CAMPO = 'w-full rounded-xl border border-campo bg-cartao p-2 text-texto';
const BOTAO = 'inline-flex min-h-11 items-center justify-center rounded-full border border-campo bg-cartao px-5 text-texto hover:bg-linha disabled:opacity-50';
const LINK = 'inline-flex min-h-11 items-center text-sm underline disabled:opacity-50';

/** US-237: o tipo sugerido no diálogo é o do nome da refeição ("Almoço" → "Almoço"); outro nome → "Outra". */
const tipoDoNome = (nome: string): TipoDeRefeicao => TIPOS_DE_REFEICAO.find((t) => t.toLowerCase() === nome.trim().toLowerCase()) ?? 'Outra';

/**
 * US-237 "Salvar do editor": o botão do cartão da refeição abre o diálogo "Salvar refeição" (nome e tipo sugeridos,
 * "Incluir a observação" desmarcada, o aviso de dados do paciente). Grava a refeição como está na tela (sem esperar o
 * salvamento automático) e, ao salvar, fecha com "Refeição salva em Minhas refeições." no cartão.
 */
export function SalvarComoMinhaRefeicao({ refeicao, nome, modo, aoSalvar }: { refeicao: RefeicaoEstado; nome: string; modo: ModoPlano; aoSalvar: (r: MinhaRefeicaoDaLista) => void }) {
  const [aberto, setAberto] = useState(false);
  const [aviso, setAviso] = useState('');
  const botao = useRef<HTMLButtonElement>(null);
  return (
    <div className="space-y-1">
      <button
        ref={botao}
        type="button"
        onClick={() => {
          setAviso('');
          setAberto(true);
        }}
        className={LINK}
      >
        {MSG_MINHAS_REFEICOES.salvar}<span className="sr-only">: {nome}</span>
      </button>
      <p role="status" className="text-sm text-ok">{aviso}</p>
      {aberto && (
        <DialogoSalvar
          refeicao={refeicao}
          modo={modo}
          aoFechar={(salva) => {
            setAberto(false);
            if (salva) {
              aoSalvar(salva);
              setAviso(MSG_MINHAS_REFEICOES.salva);
            }
            botao.current?.focus();
          }}
        />
      )}
    </div>
  );
}

/** Exportado para o teste da montagem (`componentes.test.ts`); o editor usa `SalvarComoMinhaRefeicao`. */
export function DialogoSalvar({ refeicao, modo, aoFechar }: { refeicao: RefeicaoEstado; modo: ModoPlano; aoFechar: (salva: MinhaRefeicaoDaLista | null) => void }) {
  const id = useId();
  const dialogo = useRef<HTMLDialogElement>(null);
  const salva = useRef<MinhaRefeicaoDaLista | null>(null);
  const [nome, setNome] = useState(refeicao.nome.trim());
  const [tipo, setTipo] = useState<string>(tipoDoNome(refeicao.nome));
  const [incluir, setIncluir] = useState(false);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [pendente, setPendente] = useState(false);
  useLayoutEffect(() => {
    const d = dialogo.current;
    if (d && !d.open) d.showModal();
  }, []);

  const salvar = async () => {
    setPendente(true);
    const entrada: MinhaRefeicaoEnviada & { incluirObservacao: boolean } = {
      nome, tipo, horario: refeicao.horario, observacao: refeicao.observacao, modo, incluirObservacao: incluir,
      descricaoLivre: modo === 'livre' ? refeicao.descricao : null,
      itens: modo === 'livre' ? [] : refeicao.itens.map(itemParaEnvio),
    };
    try {
      const r = await salvarComoMinhaRefeicaoAction(entrada);
      if (r.refeicao) {
        salva.current = r.refeicao;
        dialogo.current?.close();
        return;
      }
      setErros(r.erros ?? { geral: MSG_PLANO.invalido });
    } catch {
      setErros({ geral: 'Não foi possível salvar agora. Tente de novo.' });
    } finally {
      setPendente(false);
    }
  };
  // erros que não são do nome nem do tipo (a refeição vazia, o limite, um item da refeição): juntos, no fim do diálogo
  const outros = [...new Set(Object.entries(erros).filter(([k]) => k !== 'nome' && k !== 'tipo').map(([, m]) => m))];

  return (
    <dialog
      ref={dialogo}
      aria-labelledby={`${id}-titulo`}
      aria-describedby={`${id}-aviso`}
      onClose={() => aoFechar(salva.current)}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-borda bg-cartao p-4 text-texto backdrop:bg-[rgb(0_0_0/0.5)]"
    >
      <h2 id={`${id}-titulo`} className="font-titulo text-xl font-semibold">{MSG_MINHAS_REFEICOES.dialogo}</h2>
      <p id={`${id}-aviso`} className="mt-2 text-sm font-semibold text-aviso">{MSG_MINHAS_REFEICOES.aviso}</p>
      <div className="mt-3 space-y-3">
        <div className="space-y-1">
          <label htmlFor={`${id}-nome`} className="block font-medium">Nome</label>
          <input id={`${id}-nome`} value={nome} maxLength={NOME_MINHA_REFEICAO_MAX} onChange={(e) => setNome(e.target.value)} aria-invalid={erros.nome ? true : undefined} aria-describedby={erros.nome ? `${id}-nome-erro` : undefined} className={CAMPO} />
          {erros.nome && <p id={`${id}-nome-erro`} role="alert" className="text-sm text-erro">{erros.nome}</p>}
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-tipo`} className="block font-medium">Tipo</label>
          <select id={`${id}-tipo`} value={tipo} onChange={(e) => setTipo(e.target.value)} aria-invalid={erros.tipo ? true : undefined} aria-describedby={erros.tipo ? `${id}-tipo-erro` : undefined} className={CAMPO}>
            {TIPOS_DE_REFEICAO.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          {erros.tipo && <p id={`${id}-tipo-erro`} role="alert" className="text-sm text-erro">{erros.tipo}</p>}
        </div>
        {/* LGPD, art. 6º, III (RN-250): a observação fica fora, a não ser que a nutricionista marque */}
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={incluir} onChange={(e) => setIncluir(e.target.checked)} aria-describedby={incluir ? `${id}-obs-aviso` : undefined} />
          {MSG_MINHAS_REFEICOES.incluirObservacao}
        </label>
        {/* o contêiner role="status" fica montado e só o texto entra ao marcar: um status que nasce junto com o texto não é lido */}
        <p id={`${id}-obs-aviso`} role="status" className="text-sm font-semibold text-aviso">{incluir ? MSG_MINHAS_REFEICOES.avisoObservacao : ''}</p>
        {outros.map((m) => <p key={m} role="alert" className="text-sm text-erro">{m}</p>)}
        <div className="flex flex-wrap gap-3">
          <button type="button" disabled={pendente} onClick={salvar} className="inline-flex min-h-11 items-center justify-center rounded-full bg-destaque px-5 font-semibold text-white hover:brightness-95 disabled:opacity-50">Salvar</button>
          <button type="button" onClick={() => dialogo.current?.close()} className={BOTAO}>Cancelar</button>
        </div>
      </div>
    </dialog>
  );
}

/**
 * US-237 "Carregar": escolhe uma das minhas refeições e a põe no fim do plano (ids novos, os 7 dias, o horário salvo e
 * os valores de hoje; no texto livre, os alimentos como texto). Num plano com alimentos só aparecem as refeições com
 * alimentos (a de texto livre não vira alimentos). `cabe`: a refeição e os itens dela cabem no plano (RN-249).
 */
export function CarregarMinhaRefeicao({ minhas, modo, cabe, aoCarregar }: {
  minhas: MinhaRefeicaoDaLista[];
  modo: ModoPlano;
  cabe: (itens: number) => boolean;
  aoCarregar: (r: RefeicaoPlano) => void;
}) {
  const id = useId();
  const [aberto, setAberto] = useState(false);
  const opcoes = minhas.filter((m) => modo === 'livre' || m.modo === 'calculado');
  const [escolhida, setEscolhida] = useState('');
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [pendente, setPendente] = useState(false);
  if (!opcoes.length) return null;
  const valor = opcoes.some((o) => o.id === escolhida) ? escolhida : opcoes[0].id;

  const carregar = async () => {
    setPendente(true);
    setErro('');
    setAviso('');
    try {
      const r = await carregarMinhaRefeicaoAction(valor, modo);
      if (!r.refeicao) setErro(r.erro ?? MSG_PLANO.invalido);
      else if (!cabe(r.refeicao.itens.length)) setErro(MSG_PLANO.limite);
      else {
        aoCarregar(r.refeicao);
        setAviso(MSG_MINHAS_REFEICOES.carregada(r.refeicao.nome));
        setAberto(false);
      }
    } catch {
      setErro('Não foi possível carregar agora. Tente de novo.');
    } finally {
      setPendente(false);
    }
  };

  return (
    <div className="space-y-1">
      <button type="button" aria-expanded={aberto} aria-controls={`${id}-painel`} onClick={() => setAberto((a) => !a)} className={BOTAO}>
        {MSG_MINHAS_REFEICOES.carregar}
      </button>
      <div id={`${id}-painel`} hidden={!aberto} className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label htmlFor={`${id}-refeicao`} className="block text-sm">Minha refeição</label>
          <select id={`${id}-refeicao`} value={valor} onChange={(e) => setEscolhida(e.target.value)} className="rounded-xl border border-campo bg-cartao p-2 text-texto">
            {opcoes.map((o) => (
              <option key={o.id} value={o.id}>{`${o.nome} — ${o.tipo}${o.kcal === null ? '' : ` · ${MSG_MINHAS_REFEICOES.kcal(kcalTexto(o.kcal))}`}`}</option>
            ))}
          </select>
        </div>
        <button type="button" disabled={pendente} onClick={carregar} className={BOTAO}>Carregar</button>
      </div>
      {erro && <p role="alert" className="text-sm text-erro">{erro}</p>}
      <p role="status" className="text-sm text-ok">{aviso}</p>
    </div>
  );
}
