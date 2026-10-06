import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Botao } from '@/components/ui/botao';
import { normalizarCodigo } from '@/modules/documentos/codigo';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Verificar documento', robots: { index: false, follow: false }, referrer: 'no-referrer' };

/** US-147: digitar o código impresso na receita. Formulário GET, sem JavaScript; a consulta (e o limite) fica em /v/[codigo]. */
export default async function VerificarDocumento({ searchParams }: PageProps<'/v'>) {
  const bruto = (await searchParams).codigo;
  const codigo = Array.isArray(bruto) ? bruto[0] : bruto;
  if (codigo?.trim()) redirect(`/v/${normalizarCodigo(codigo) ?? encodeURIComponent(codigo.slice(0, 20))}`);
  return (
    <main className="mx-auto min-h-dvh max-w-lg space-y-4 bg-fundo p-6 font-sans text-texto">
      <h1 className="font-titulo text-2xl font-semibold">Verificar documento</h1>
      <form action="/v" method="get" className="max-w-sm space-y-3">
        <div className="space-y-1">
          <label htmlFor="codigo" className="block font-medium">
            Código de verificação (12 caracteres)
          </label>
          <input id="codigo" name="codigo" autoComplete="off" required maxLength={40} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto" />
        </div>
        <Botao type="submit">Verificar</Botao>
      </form>
    </main>
  );
}
