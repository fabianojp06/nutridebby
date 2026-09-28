import Link from 'next/link';
import type { TenantRow } from '@/db/schema';

/** Cabeçalho do painel (a Tarefa 10 aplica logo e cor da marca). */
export function Cabecalho({ tenant }: { tenant: TenantRow }) {
  return (
    <header className="flex items-center justify-between bg-emerald-700 px-6 py-3 text-white">
      <p className="text-lg font-semibold">{tenant.nomeExibicao}</p>
      <nav aria-label="Menu do painel" className="flex gap-4 text-sm">
        <Link href="/painel">Início</Link>
        <Link href="/conta/seguranca">Segurança</Link>
      </nav>
    </header>
  );
}
