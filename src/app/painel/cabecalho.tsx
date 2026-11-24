import Link from 'next/link';
import { Suspense } from 'react';
import { BotaoSair } from '@/components/botao-sair';
import type { PapelDoGuia } from '@/modules/ajuda/conteudo';
import type { MarcaTenant } from '@/modules/plataforma/marca';
import type { ProgressoGuia, Tema } from '@/modules/plataforma/preferencias-tipos';
import { AlternarTema } from './alternar-tema';
import { GuiaDoPainel } from './guia/guia-do-painel';
import { MenuConta } from './menu-conta';
import { MenuPainel, type ItemComContador } from './menu-painel';
import { iniciais } from './navegacao';

/**
 * D19/D20: marca do consultório à esquerda (US-005), menu de 6 itens (+ "Exames recebidos", Plano 12, D11, e "Dúvidas dos
 * pacientes", Plano 15, US-175), tema e conta à direita. Com `completo = false`, só a marca, o tema e o "Sair": o DPA
 * pendente (a nutricionista só pode aceitar o contrato ou sair; a recepção espera em "Contrato pendente"). O botão "Ajuda", a gaveta e o tour (D26) só com o DPA
 * em dia; o Suspense é do useSearchParams do GuiaDoPainel (?tour=).
 *
 * Plano 26 (T8, RN-514): `papel` decide o menu (`itensDoMenu`, com `financeiro` na recepção), o menu da conta e o manual
 * guiado (RE-D42). Com o DPA em dia, a recepção tem o cabeçalho completo dela; com o DPA pendente, o mínimo.
 */
export function CabecalhoPainel({ marca, nome, email, tema, completo, progresso, exames, duvidas, papel = 'nutri', financeiro = false }: { marca: MarcaTenant; nome: string; email: string; tema: Tema; completo: boolean; progresso: ProgressoGuia | null; exames: ItemComContador; duvidas?: ItemComContador; papel?: PapelDoGuia; financeiro?: boolean }) {
  return (
    <header className="border-b border-borda bg-cartao print:hidden">
      <div className="mx-auto flex max-w-[1360px] flex-wrap items-center gap-3 px-4 py-3 md:px-6">
        <Link href="/painel" className="flex min-h-11 items-center gap-3 rounded-xl">
          {marca.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- URL assinada de 5 min, fora do otimizador de imagens
            <img src={marca.logoUrl} alt="" className="h-10 w-auto rounded bg-white p-1" />
          ) : (
            <span aria-hidden="true" className="grid size-10 place-items-center rounded-full bg-destaque font-titulo font-extrabold text-white">{iniciais(marca.nome)}</span>
          )}
          <span className="font-titulo text-lg font-semibold">{marca.nome}</span>
        </Link>
        {completo && <MenuPainel exames={exames} duvidas={duvidas} papel={papel} financeiro={financeiro} />}
        <div className="ml-auto flex items-center gap-2">
          {completo && progresso && (
            <Suspense fallback={null}>
              <GuiaDoPainel progresso={progresso} papel={papel} />
            </Suspense>
          )}
          <AlternarTema tema={tema} />
          {completo ? <MenuConta nome={nome} email={email} papel={papel} /> : <BotaoSair className="inline-flex min-h-11 items-center rounded-full border border-campo px-4" />}
        </div>
      </div>
    </header>
  );
}
