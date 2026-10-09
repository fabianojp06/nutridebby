import type { ContaResumo } from '@/modules/plataforma/contas';

const data = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);

/** Situação do convite da nutricionista (US-001), na lista e na página da conta. */
export function Convite({ c }: { c: ContaResumo }) {
  if (c.convite === 'aceito') return <>Aceito</>;
  if (c.convite === 'pendente') return <>{`Pendente (até ${data(c.conviteExpiraEm!)})`}</>;
  if (c.convite === 'expirado') return <>Expirado</>;
  return <>Sem convite</>;
}
