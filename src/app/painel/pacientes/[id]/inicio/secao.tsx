import Link from 'next/link';
import { Selo } from '@/components/ui/selo';
import { caminhoNaFicha } from '@/modules/ficha/adicionar';
import type { SecaoNoInicio } from '@/modules/ficha/inicio';
import { MSG_FICHA } from '@/modules/ficha/textos';
import { formatarData } from '@/modules/pacientes/datas';

/**
 * Plano 18 (RN-277, RN-278, spec §8.3): uma seção do Início num `<details>` — aberto quando há registro —, com o `<h3>`
 * "{Título} ({n})" no `<summary>` (block, sem flex: o leitor de tela lê o título como cabeçalho e como o botão) e, no corpo,
 * os 3 últimos (rótulo genérico, data e situação) e o "Ver todos". Os links não pré-carregam: as páginas de destino gravam
 * auditRead (como ia-nutri/page.tsx). Tarefa 9 (RN-279): o selo "No app" no item que o paciente vê (decidido no contexto
 * de paciente, `noAppDoPaciente`) e a `nota` da seção (Antropometria com o peso oculto: "Peso e IMC ocultos no app.").
 */
export function Secao({ secao, patientId, nota }: { secao: SecaoNoInicio; patientId: string; nota?: string }) {
  const { total, ultimos } = secao.resumo;
  // Plano 25: a seção "Mensagens" conta as não lidas (`rotuloDoTotal`); com 0 não lidas, os últimos itens continuam
  const temItens = ultimos.length > 0;
  return (
    <details open={temItens} className="group border-t border-linha first-of-type:border-t-0">
      <summary className="block min-h-11 cursor-pointer py-2">
        {/* seta em SVG, não em texto: um "▸" girado (inline-block com transform) é texto de 1 caractere que o axe deixa em
            "incomplete" no color-contrast (E2E acessibilidade-painel); o SVG não entra no contraste de texto */}
        <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2 inline-block align-[-0.125em] transition-transform group-open:rotate-90">
          <path d="M6 3l5 5-5 5" />
        </svg>
        <h3 className="inline font-semibold">{secao.rotuloDoTotal === undefined ? MSG_FICHA.secao(secao.titulo, total) : `${secao.titulo} (${secao.rotuloDoTotal})`}</h3>
      </summary>
      <div className="space-y-1 pb-3 pl-6">
        {nota && <p className="text-sm text-suave">{nota}</p>}
        {!temItens ? (
          <p className="text-sm text-suave">{MSG_FICHA.vazio}</p>
        ) : (
          <>
            <ul className="space-y-1">
              {ultimos.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-x-2">
                  <Link href={caminhoNaFicha(patientId, i.href)} prefetch={false} className="inline-flex min-h-11 items-center text-link underline">
                    {[i.rotulo, formatarData(i.data), i.situacao].filter(Boolean).join(' · ')}
                  </Link>
                  {i.noApp && <Selo>{MSG_FICHA.seloNoApp}</Selo>}
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
