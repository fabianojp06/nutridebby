import Link from 'next/link';
import { semInvalidosNoBanco } from '@/lib/texto-seguro';
import { Selo } from '@/components/ui/selo';
import type { ItemDaCaixa, TipoDaUltima } from '@/modules/mensagens/caixa';
import { MSG_MENSAGENS, rotuloDoQuando } from '@/modules/mensagens/constantes';

const C = MSG_MENSAGENS.caixa;
const TIPO: Record<TipoDaUltima, string> = {
  paciente: C.tipos.mensagemDoPaciente,
  nutri: C.tipos.voceEnviou,
  imagem: C.tipos.imagem,
  pdf: C.tipos.pdf,
  recado: C.tipos.recado,
};

/** `?pagina=` da caixa e da nova conversa: inteiro de 1 a 1.000; fora disso, a primeira. */
export function paginaDaUrl(v: unknown): number {
  const n = typeof v === 'string' && /^\d{1,4}$/.test(v) ? Number(v) : 1;
  return n >= 1 && n <= 1000 ? n : 1;
}

/** `?busca=`: texto, sem espaços nas pontas, até 100 caracteres. */
/** A busca vira parâmetro de SQL: sem NUL nem surrogate sem par (SUS-109; o 22021 levaria o termo ao log). */
export const buscaDaUrl = (v: unknown): string => (typeof v === 'string' ? semInvalidosNoBanco(v).trim().slice(0, 100) : '');

/** O endereço com os parâmetros que valem (sem os padrões: filtro "todas", busca vazia, página 1). */
export function comParametros(base: string, p: { filtro?: string; busca?: string; pagina?: number }): string {
  const q = new URLSearchParams();
  if (p.filtro) q.set('filtro', p.filtro);
  if (p.busca) q.set('busca', p.busca);
  if (p.pagina && p.pagina > 1) q.set('pagina', String(p.pagina));
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

/**
 * §7.1 (US-442): a lista da caixa — cada conversa é um link de bloco (alvo de 44 px) com o nome (em negrito quando há não
 * lidas), o tipo e o "quando" da última mensagem em texto suave, "{n} não lidas" em selo com texto e "Sinal de risco" no
 * selo de alerta. Nunca o texto das mensagens (a caixa só recebe nome, data, tipo, contagem e selo). Sem prefetch: abrir a
 * conversa grava auditRead e avança o "lido" (RN-473).
 */
export function ListaDaCaixa({ itens, agora, fuso }: { itens: ItemDaCaixa[]; agora: Date; fuso: string }) {
  return (
    <ul data-guia="mensagens-caixa" className="divide-y divide-linha overflow-hidden rounded-3xl border border-borda bg-cartao">
      {itens.map((i) => {
        const detalhe = [i.tipo ? TIPO[i.tipo] : null, i.quando ? rotuloDoQuando(i.quando, agora, fuso) : null].filter(Boolean).join(' · ');
        return (
          <li key={i.patientId}>
            <Link
              href={`/painel/mensagens/${i.patientId}`}
              prefetch={false}
              className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-linha focus-visible:outline-offset-[-3px]"
            >
              <span className={i.naoLidas > 0 ? 'font-semibold' : undefined}>{i.nome}</span>
              {detalhe && <span className="text-sm text-suave">{detalhe}</span>}
              {i.naoLidas > 0 && <Selo>{C.naoLidas(i.naoLidas)}</Selo>}
              {i.riscoNaoLido && <Selo variante="alerta">{C.seloRisco}</Selo>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
