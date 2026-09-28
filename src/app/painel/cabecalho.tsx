import Link from 'next/link';
import type { TenantRow } from '@/db/schema';
import { getTenantBrand } from '@/modules/plataforma/marca';

/** Cabeçalho do painel com a marca da nutricionista (US-005 "Marca aplicada"). */
export function Cabecalho({ tenant }: { tenant: TenantRow }) {
  const marca = getTenantBrand(tenant);
  return (
    <header className="flex items-center justify-between px-6 py-3 text-white" style={{ backgroundColor: marca.cor }}>
      <div className="flex items-center gap-3">
        {marca.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- URL assinada de 5 min, fora do otimizador de imagens
          <img src={marca.logoUrl} alt={`Logo de ${marca.nome}`} className="h-10 w-auto rounded bg-white p-1" />
        )}
        <p className="text-lg font-semibold">{marca.nome}</p>
      </div>
      <nav aria-label="Menu do painel" className="flex gap-4 text-sm">
        <Link href="/painel">Início</Link>
        <Link href="/painel/configuracoes">Perfil e marca</Link>
        <Link href="/conta/seguranca">Segurança</Link>
      </nav>
    </header>
  );
}
