import Link from 'next/link';
import { caminhoNaFicha } from '@/modules/ficha/adicionar';
import type { SecaoNoInicio } from '@/modules/ficha/inicio';
import { MSG_FICHA } from '@/modules/ficha/textos';
import { formatarData } from '@/modules/pacientes/datas';

/**
 * Plano 18 (RN-277, RN-278, spec §8.3): uma seção do Início num `<details>` — aberto quando há registro —, com o `<h3>`
 * "{Título} ({n})" no `<summary>` (block, sem flex: o leitor de tela lê o título como cabeçalho e como o botão) e, no corpo,
 * os 3 últimos (rótulo genérico, data e situação) e o "Ver todos". Os links não pré-carregam: as páginas de destino gravam
 * auditRead (como ia-nutri/page.tsx).
 */
export function Secao({ secao, patientId }: { secao: SecaoNoInicio; patientId: string }) {
  const { total, ultimos } = secao.resumo;
  return (
    <details open={total > 0} className="group border-t border-linha first-of-type:border-t-0">
      <summary className="block min-h-11 cursor-pointer py-2">
        {/* seta em SVG, não em texto: um "▸" girado (inline-block com transform) é texto de 1 caractere que o axe deixa em
            "incomplete" no color-contrast (E2E acessibilidade-painel); o SVG não entra no contraste de texto */}
        <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2 inline-block align-[-0.125em] transition-transform group-open:rotate-90">
          <path d="M6 3l5 5-5 5" />
        </svg>
        <h3 className="inline font-semibold">{MSG_FICHA.secao(secao.titulo, total)}</h3>
      </summary>
      <div className="space-y-1 pb-3 pl-6">
        {total === 0 ? (
          <p className="text-sm text-suave">{MSG_FICHA.vazio}</p>
        ) : (
          <>
            <ul className="space-y-1">
              {ultimos.map((i) => (
                <li key={i.id}>
                  <Link href={caminhoNaFicha(patientId, i.href)} prefetch={false} className="inline-flex min-h-11 items-center text-link underline">
                    {[i.rotulo, formatarData(i.data), i.situacao].filter(Boolean).join(' · ')}
                  </Link>
                </li>
              ))}
            </ul>
            <Link href={secao.verTodos} prefetch={false} aria-label={MSG_FICHA.verTodosDe(secao.titulo)} className="inline-flex min-h-11 items-center text-link underline">
              {MSG_FICHA.verTodos}
            </Link>
          </>
        )}
      </div>
    </details>
  );
}
