import Link from 'next/link';
import { BotaoSair } from '@/components/botao-sair';
import { DetalhesDaConta } from './detalhes-da-conta';
import { iniciais } from './navegacao';

const ITEM = 'flex min-h-11 w-full items-center rounded-xl px-3 text-left hover:bg-linha';

/**
 * D20: menu da conta (disclosure com <details>, funciona sem JavaScript; com JavaScript, fecha ao navegar, com Esc e com
 * clique fora — DetalhesDaConta). O "Sair" mantém o data-sair (editor do plano).
 */
export function MenuConta({ nome, email }: { nome: string; email: string }) {
  return (
    <DetalhesDaConta>
      <summary aria-label={`Conta de ${nome}`} className="grid size-11 cursor-pointer list-none place-items-center rounded-full bg-[#f3b660] font-semibold text-[#3a2508] [&::-webkit-details-marker]:hidden">
        {iniciais(nome)}
      </summary>
      <div className="absolute right-0 z-30 mt-2 w-72 rounded-2xl border border-borda bg-cartao p-2 text-texto shadow-lg">
        <p className="px-3 py-2 text-sm text-suave">{`Conectado como ${email}.`}</p>
        <ul>
          <li><Link href="/painel/configuracoes/perfil" className={ITEM}>Perfil e marca</Link></li>
          <li><Link href="/conta/seguranca" className={ITEM}>Segurança</Link></li>
          <li><Link href="/painel/ajuda" className={ITEM}>Manual</Link></li>
          <li><Link href="/painel?tour=boas-vindas" className={ITEM}>Rever o tour de boas-vindas</Link></li>
          <li><BotaoSair className={ITEM} /></li>
        </ul>
      </div>
    </DetalhesDaConta>
  );
}
