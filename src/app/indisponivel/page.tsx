import type { Metadata } from 'next';
import { BotaoSair } from '@/components/botao-sair';

export const metadata: Metadata = { title: 'Conta temporariamente indisponível' };

export default function IndisponivelPage() {
  return (
    <main className="mx-auto max-w-lg space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Conta temporariamente indisponível</h1>
      <p><a href="/entrar" className="underline">Voltar para o login</a></p>
      <BotaoSair />
    </main>
  );
}
