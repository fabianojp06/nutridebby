'use client';

import { useEffect, useState } from 'react';
import { ConfirmarBotao } from '@/components/confirmar-botao';
import { classeDoBotao } from '@/components/ui/botao';
import type { SituacaoNaEquipe } from '@/modules/plataforma/equipe';
import { MSG_EQUIPE } from '@/modules/plataforma/equipe-textos';
import { desativarAction, permissaoAction, reativarAction, reenviarAction } from './actions';

const BOTAO = `${classeDoBotao('secundario')} whitespace-nowrap`;

/** O id da linha (o foco volta a ela depois de uma ação da linha, §7.2). */
export const idDaLinha = (id: string) => `membro-${id}`;

export type LinhaDaEquipeProps = {
  id: string;
  nome: string;
  email: string;
  situacao: SituacaoNaEquipe;
  /** "Convite enviado (vale até …)", "Convite vencido", "Ativo" ou "Acesso desativado em …", formatado no servidor (fuso do consultório). */
  textoDaSituacao: string;
  financeiro: boolean;
  /** "Último acesso: … às …" ou "Ainda não entrou". */
  textoDoAcesso: string;
};

/**
 * Plano 26 (US-488, §7.2): uma pessoa da recepção na tabela da Equipe. Cada ação é um formulário com o id da pessoa (o
 * módulo confere o consultório) e um botão com `aria-label` "{ação} {nome}". A caixa do Financeiro fica na coluna dela e
 * pertence ao formulário "Salvar permissão" da coluna Ações (atributo `form`). "Desativar" e "Reativar" pedem a confirmação
 * do navegador com o texto da spec. A linha é focável por script (`tabIndex={-1}`): a página leva o foco a ela na volta.
 */
export function LinhaDaEquipe(p: LinhaDaEquipeProps) {
  const formPermissao = `permissao-${p.id}`;
  const desativada = p.situacao === 'desativado';
  const convitePendente = p.situacao === 'convite_enviado' || p.situacao === 'convite_vencido';
  return (
    <tr id={idDaLinha(p.id)} tabIndex={-1} className="border-t border-linha align-top focus-visible:outline-offset-[-3px]">
      <th scope="row" className="px-2 py-2 text-left font-medium">{p.nome}</th>
      <td className="px-2 py-2 wrap-anywhere">{p.email}</td>
      <td className="px-2 py-2">{p.textoDaSituacao}</td>
      <td className="px-2 py-2">
        {desativada ? (
          <span aria-hidden="true">—</span>
        ) : (
          <input form={formPermissao} name="financeiro" type="checkbox" defaultChecked={p.financeiro} aria-label={MSG_EQUIPE.rotuloDoFinanceiro(p.nome)} className="size-5" />
        )}
      </td>
      <td className="px-2 py-2">{p.textoDoAcesso}</td>
      <td className="px-2 py-2">
        <div className="flex flex-wrap gap-2">
          {!desativada && (
            <form id={formPermissao} action={permissaoAction}>
              <input type="hidden" name="id" value={p.id} />
              <button className={BOTAO} aria-label={MSG_EQUIPE.rotuloDaAcao(MSG_EQUIPE.acoes.salvarPermissao, p.nome)}>{MSG_EQUIPE.acoes.salvarPermissao}</button>
            </form>
          )}
          {convitePendente && (
            <form action={reenviarAction}>
              <input type="hidden" name="id" value={p.id} />
              <button className={BOTAO} aria-label={MSG_EQUIPE.rotuloDaAcao(MSG_EQUIPE.acoes.reenviar, p.nome)}>{MSG_EQUIPE.acoes.reenviar}</button>
            </form>
          )}
          {desativada ? (
            <form action={reativarAction}>
              <input type="hidden" name="id" value={p.id} />
              <ConfirmarBotao mensagem={MSG_EQUIPE.confirmarReativar(p.nome)} rotulo={MSG_EQUIPE.rotuloDaAcao(MSG_EQUIPE.acoes.reativar, p.nome)} className={BOTAO}>
                {MSG_EQUIPE.acoes.reativar}
              </ConfirmarBotao>
            </form>
          ) : (
            <form action={desativarAction}>
              <input type="hidden" name="id" value={p.id} />
              <ConfirmarBotao mensagem={MSG_EQUIPE.confirmarDesativar(p.nome)} rotulo={MSG_EQUIPE.rotuloDaAcao(MSG_EQUIPE.acoes.desativar, p.nome)} className={BOTAO}>
                {MSG_EQUIPE.acoes.desativar}
              </ConfirmarBotao>
            </form>
          )}
        </div>
      </td>
    </tr>
  );
}

/**
 * D26 do Plano 18 (WCAG 4.1.3): a região `role="status"` da Equipe, sempre montada (também vazia). O texto vem do servidor
 * (`?ok=`) e só aparece um instante depois de cada volta, marcada por `marcador` (`?r=`, um por ação): duas ações seguidas
 * com o mesmo texto mudam o DOM e o leitor de tela anuncia de novo. Sem JavaScript, o texto já vem na página.
 */
export function StatusDaEquipe({ texto, marcador }: { texto: string; marcador: string }) {
  const [pronto, setPronto] = useState<string | null>(marcador);
  useEffect(() => {
    const t = window.setTimeout(() => setPronto(marcador), 150);
    return () => window.clearTimeout(t);
  }, [marcador, texto]);
  return (
    <p role="status" className="min-h-6 font-medium">
      {pronto === marcador ? texto : ''}
    </p>
  );
}
