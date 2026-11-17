'use client';

import Link from 'next/link';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ConfirmarBotao } from '@/components/confirmar-botao';
import { classeDoBotao } from '@/components/ui/botao';
import { arquivarDaListaAction, reativarDaListaAction } from './actions';
import type { PacienteNaLista } from '@/modules/pacientes/pacientes';
import { ID_DO_TITULO, MSG_LISTA, type CamposDaLista } from './textos';

const ITEM = 'inline-flex min-h-11 w-full items-center whitespace-nowrap rounded-xl px-3 text-left text-link underline hover:bg-linha';
const MARGEM = 8;

/**
 * Plano 18 (RN-273, D26): o menu "Ações de {nome}" de cada linha da lista, um disclosure (`aria-expanded`, `aria-controls`).
 * Esc e clique fora fecham, e escolher um item também; ao fechar por Esc ou pelo próprio botão, o foco volta ao botão.
 * O painel fica sempre montado (só `hidden`): o `<form>` de Arquivar/Reativar não desmonta antes do POST. Ele é `fixed`,
 * posicionado pelo botão ao abrir, para nenhum contêiner com rolagem cortá-lo; rolar ou redimensionar a janela fecha.
 * Arquivar e Reativar pedem a confirmação do navegador (`ConfirmarBotao`); a volta da action traz `ok` e a região de
 * status da lista anuncia o resultado, com o foco no título (a linha pode sumir da aba).
 */
export function MenuDaLinha({ id, nome, status, campos }: { id: string; nome: string; status: PacienteNaLista['status']; campos: CamposDaLista }) {
  const [aberto, setAberto] = useState(false);
  const painelId = useId();
  const raiz = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const painel = useRef<HTMLDivElement>(null);

  const fechar = (devolverFoco: boolean) => {
    setAberto(false);
    if (devolverFoco) botao.current?.focus();
  };

  // posição do painel: abaixo do botão, alinhado à direita dele; sem espaço embaixo, acima; sempre dentro da janela
  useLayoutEffect(() => {
    const b = botao.current;
    const p = painel.current;
    if (!aberto || !b || !p) return;
    const r = b.getBoundingClientRect();
    const largura = p.offsetWidth;
    const altura = p.offsetHeight;
    const esquerda = Math.max(MARGEM, Math.min(r.right - largura, window.innerWidth - largura - MARGEM));
    const embaixo = r.bottom + 4;
    const topo = embaixo + altura > window.innerHeight - MARGEM && r.top - 4 - altura >= MARGEM ? r.top - 4 - altura : embaixo;
    p.style.left = `${esquerda}px`;
    p.style.top = `${topo}px`;
  }, [aberto]);

  useEffect(() => {
    if (!aberto) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setAberto(false);
        botao.current?.focus();
      }
    };
    const aoClicar = (e: PointerEvent) => {
      if (raiz.current?.contains(e.target as Node)) return;
      setAberto(false);
      // o clique fora num lugar sem foco (o fundo da página) devolve o foco ao botão; num controle, o foco fica nele
      requestAnimationFrame(() => {
        const ativo = document.activeElement;
        if (!ativo || ativo === document.body || raiz.current?.contains(ativo)) botao.current?.focus();
      });
    };
    const aoMover = () => setAberto(false);
    document.addEventListener('keydown', aoTeclar);
    document.addEventListener('pointerdown', aoClicar);
    window.addEventListener('resize', aoMover);
    window.addEventListener('scroll', aoMover, true);
    return () => {
      document.removeEventListener('keydown', aoTeclar);
      document.removeEventListener('pointerdown', aoClicar);
      window.removeEventListener('resize', aoMover);
      window.removeEventListener('scroll', aoMover, true);
    };
  }, [aberto]);

  const base = `/painel/pacientes/${id}`;
  // RN-273: ativo e arquivado têm o menu inteiro; bloqueado (e qualquer outra situação), só "Abrir ficha"
  const editavel = status === 'ativo' || status === 'arquivado';
  const link = (href: string, rotulo: string) => (
    <li>
      <Link href={href} prefetch={false} onClick={() => setAberto(false)} className={ITEM}>{rotulo}</Link>
    </li>
  );
  // o menu fecha no envio, mas o formulário continua montado (o painel só fica `hidden`); o foco vai ao título da lista
  const aoEnviar = () => {
    setAberto(false);
    document.getElementById(ID_DO_TITULO)?.focus();
  };
  const formulario = (acao: (f: FormData) => Promise<void>, mensagem: string, rotulo: string) => (
    <li>
      <form action={acao} onSubmit={aoEnviar}>
        <input type="hidden" name="id" value={id} />
        {(Object.keys(campos) as (keyof CamposDaLista)[]).map((k) => <input key={k} type="hidden" name={k} value={campos[k]} />)}
        <ConfirmarBotao mensagem={mensagem} className={ITEM}>{rotulo}</ConfirmarBotao>
      </form>
    </li>
  );

  return (
    <div ref={raiz}>
      <button
        ref={botao}
        type="button"
        aria-expanded={aberto}
        aria-controls={painelId}
        aria-label={MSG_LISTA.acoesDe(nome)}
        onClick={() => (aberto ? fechar(true) : setAberto(true))}
        className={classeDoBotao('secundario')}
      >
        {MSG_LISTA.acoes} <span aria-hidden="true">▾</span>
      </button>
      <div ref={painel} id={painelId} hidden={!aberto} className="fixed z-30 w-max min-w-48 rounded-2xl border border-borda bg-cartao p-2 text-texto shadow-xl">
        <ul className="space-y-1">
          {link(base, MSG_LISTA.itens.abrir)}
          {editavel && link(`${base}/perfil`, MSG_LISTA.itens.editar)}
          {status === 'ativo' && formulario(arquivarDaListaAction, MSG_LISTA.confirmarArquivar(nome), MSG_LISTA.itens.arquivar)}
          {status === 'arquivado' && formulario(reativarDaListaAction, MSG_LISTA.confirmarReativar(nome), MSG_LISTA.itens.reativar)}
          {editavel && link(`${base}/privacidade#exclusao`, MSG_LISTA.itens.exclusao)}
        </ul>
      </div>
    </div>
  );
}

/**
 * D26: com `?ok=` na volta da action, o foco vai ao título da lista (a linha do paciente pode ter sumido da aba, e o foco
 * cairia no `<body>`). A página só monta este componente quando há resultado a anunciar.
 */
export function FocoNoTitulo() {
  useEffect(() => {
    document.getElementById(ID_DO_TITULO)?.focus();
  }, []);
  return null;
}
