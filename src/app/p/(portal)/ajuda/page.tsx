import Link from 'next/link';
import { CabecalhoDetalhe } from '@/components/portal/cabecalho-detalhe';
import { requirePaciente } from '@/lib/paciente-session';
import { AVISO_PORTAL, GUIA_PORTAL } from '@/modules/ajuda/portal';

export const dynamic = 'force-dynamic';

/** Plano 16 (US-199, RN-212): "Como usar o app" — funciona sem JavaScript; "Ver o tour de novo" abre o tour em Hoje. */
export default async function ComoUsarOApp() {
  await requirePaciente('/p/ajuda');
  return (
    <>
      <CabecalhoDetalhe titulo={GUIA_PORTAL.titulo} voltar={{ href: '/p/perfil', secao: 'Eu' }} />
      <main className="space-y-4 p-4">
        <p>{GUIA_PORTAL.ajuda.resumo}</p>
        {GUIA_PORTAL.ajuda.secoes.map((s, i) => (
          <section key={s.titulo} aria-labelledby={`ajuda-${i}`} className="space-y-2 rounded-2xl border border-borda bg-cartao p-4">
            <h2 id={`ajuda-${i}`} className="font-portal-titulo text-lg font-bold">
              {s.titulo}
            </h2>
            <ul className="list-disc space-y-1 pl-5">
              {s.itens.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
        <p>
          <Link href={`/p/inicio?tour=${GUIA_PORTAL.id}`} className="inline-flex min-h-11 items-center font-semibold text-link underline">
            {AVISO_PORTAL.reverTour}
          </Link>
        </p>
      </main>
    </>
  );
}
