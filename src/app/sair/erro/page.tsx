import type { Metadata } from 'next';
import Link from 'next/link';
import { BotaoSair } from '@/components/botao-sair';

export const metadata: Metadata = { title: 'Não foi possível sair' };

/**
 * Para onde o POST /sair manda quando não conseguiu apagar a sessão no banco (o cookie ficou, a usuária continua
 * logada). Página pública, sem consulta de sessão: o botão tenta sair de novo.
 */
export default function SairErroPage() {
  return (
    <main className="mx-auto max-w-lg space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Não foi possível sair agora. Tente de novo.</h1>
      <BotaoSair />
      <p><Link href="/" className="underline">Voltar ao início</Link></p>
    </main>
  );
}
