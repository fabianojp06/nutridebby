'use client';
import type { FormEvent } from 'react';
import { esquecerPlanoGuardado } from '../sw-regras';

/**
 * D6 / Review Focus 4: antes de sair, apaga o plano guardado (o Clear-Site-Data da resposta faz o mesmo, mas o
 * Safari não o aplica a tudo). Falhar aqui não impede de sair.
 */
export async function limparAparelho(): Promise<void> {
  await esquecerPlanoGuardado();
}

/** "Sair" do portal: o mesmo POST /sair do BotaoSair, depois de limpar o aparelho. */
export function SairPortal() {
  const sair = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    try {
      await limparAparelho();
    } finally {
      form.submit(); // submit() não dispara onSubmit de novo
    }
  };
  return (
    <form method="post" action="/sair" onSubmit={sair}>
      <button type="submit" data-sair className="min-h-11 cursor-pointer rounded border border-current px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2">
        Sair
      </button>
    </form>
  );
}
