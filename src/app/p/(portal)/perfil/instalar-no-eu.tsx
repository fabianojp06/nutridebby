'use client';
import { Instalar } from '../../instalar';

/** Eu › "Instalar o app": a seção só aparece quando dá para instalar (fora do modo instalado, onde o navegador permite). */
export function InstalarNoEu() {
  return (
    <Instalar
      cartao={(conteudo) => (
        <section aria-labelledby="eu-instalar" className="space-y-2 rounded-2xl border border-borda bg-cartao p-4">
          <h2 id="eu-instalar" className="font-portal-titulo text-lg font-bold">Instalar o app</h2>
          {conteudo}
        </section>
      )}
    />
  );
}
