import Link from 'next/link';
import { MSG_G } from './textos';

/**
 * Plano 16 (§4.2): a barra de ações de Hoje, fixa embaixo. "Foto da refeição" abre o registro do diário com o campo da
 * câmera (Desvio 6); "Enviar exame" só com o recebimento ligado (RN-215); "Agendar" leva a "Minhas consultas" no teto de
 * consultas futuras (a tela já mostra o motivo).
 */
export function BarraDeAcoes({ exames, podeAgendar }: { exames: boolean; podeAgendar: boolean }) {
  const acoes = [
    { href: '/p/diario?foto=1#registrar', rotulo: MSG_G.acoes.foto },
    ...(exames ? [{ href: '/p/exames#enviar', rotulo: MSG_G.acoes.exame }] : []),
    { href: podeAgendar ? '/p/agenda/nova' : '/p/agenda', rotulo: MSG_G.acoes.agendar },
  ];
  return (
    <nav aria-label={MSG_G.navAcoes} data-guia="acoes" className="sticky bottom-0 border-t border-borda bg-cartao">
      <ul className={`grid ${acoes.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {acoes.map((a) => (
          <li key={a.href} className="min-w-0">
            <Link href={a.href} className="flex min-h-11 items-center justify-center px-1 py-2 text-center text-sm font-semibold text-link hyphens-auto wrap-break-word">
              {a.rotulo}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
