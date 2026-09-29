import Link from 'next/link';
import { formatarBytes } from '@/lib/format';
import { requireUser } from '@/lib/session';
import { COTA_BYTES } from '@/modules/plataforma/armazenamento';
import { listarContas, MSG, type ContaResumo } from '@/modules/plataforma/contas';
import { metricasPorTenant } from '@/modules/plataforma/metricas';
import { MSG_CONTA_NAO_ENCONTRADA } from '@/modules/plataforma/tenant-status';
import { reativarAction, reenviarConviteAction, suspenderAction } from './actions';
import { ConfirmarBotao } from './confirmar-botao';
import { CotaForm } from './cota-form';
import { PainelInfra } from './painel-infra';

export const dynamic = 'force-dynamic';

const AVISOS: Record<string, { texto: string; erro?: boolean }> = {
  criada: { texto: 'Conta criada. O convite foi enviado para o e-mail da nutricionista.' },
  reenviado: { texto: 'Convite reenviado.' },
  ja_tem_senha: { texto: MSG.jaTemSenha, erro: true },
  sem_nutri: { texto: MSG.semNutri, erro: true },
  conta_suspensa: { texto: MSG.contaSuspensa, erro: true },
  suspensa: { texto: 'Conta suspensa. A nutricionista e os pacientes veem "Conta temporariamente indisponível".' },
  reativada: { texto: 'Conta reativada.' },
  nao_encontrada: { texto: MSG_CONTA_NAO_ENCONTRADA, erro: true },
};

const data = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);

function Convite({ c }: { c: ContaResumo }) {
  if (c.convite === 'aceito') return <>Aceito</>;
  if (c.convite === 'pendente') return <>{`Pendente (até ${data(c.conviteExpiraEm!)})`}</>;
  if (c.convite === 'expirado') return <>Expirado</>;
  return <>Sem convite</>;
}

export default async function AdminHome({ searchParams }: PageProps<'/admin'>) {
  const { user } = await requireUser(['admin'], '/admin');
  const { aviso } = await searchParams;
  const a = typeof aviso === 'string' ? AVISOS[aviso] : undefined;
  const [contas, metricas] = await Promise.all([listarContas(), metricasPorTenant()]);
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Administração</h1>
          <p className="text-sm">Conectado como {user.email}.</p>
        </div>
        <Link href="/admin/contas/nova" className="rounded bg-emerald-700 px-4 py-2 text-white">Nova conta</Link>
      </header>
      {a && (
        <p role={a.erro ? 'alert' : 'status'} className={a.erro ? 'rounded bg-red-50 p-3 text-red-800' : 'rounded bg-emerald-50 p-3'}>
          {a.texto}
        </p>
      )}
      <PainelInfra />
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Contas de nutricionista</caption>
        <thead>
          <tr>
            <th scope="col">Conta</th>
            <th scope="col">E-mail</th>
            <th scope="col">CRN</th>
            <th scope="col">Situação</th>
            <th scope="col">Convite</th>
            <th scope="col">Pacientes ativos</th>
            <th scope="col">Consultas no mês</th>
            <th scope="col">WhatsApp no mês</th>
            <th scope="col">Cota de WhatsApp</th>
            <th scope="col">Armazenamento</th>
            <th scope="col">Ações</th>
          </tr>
        </thead>
        <tbody>
          {contas.map((c) => {
            const m = metricas.get(c.tenantId);
            return (
            <tr key={c.tenantId} className="border-t">
              <th scope="row" className="font-normal">{c.nomeExibicao} <span className="text-zinc-500">({c.slug})</span></th>
              <td>{c.email ?? '—'}</td>
              <td>{c.crn ?? '—'}</td>
              <td>{c.status === 'ativa' ? 'Ativa' : 'Suspensa'}</td>
              <td><Convite c={c} /></td>
              <td>{m?.pacientesAtivos ?? '—'}</td>
              <td>{m?.consultasMes ?? '—'}</td>
              <td>{m?.mensagensWhatsappMes ?? '—'}</td>
              <td><CotaForm tenantId={c.tenantId} cota={c.waCotaMensal} conta={c.nomeExibicao} /></td>
              <td>{m ? `${formatarBytes(m.armazenamentoBytes)} de ${formatarBytes(COTA_BYTES)} (${m.arquivos} arquivos)` : '—'}</td>
              <td className="space-y-1">
                {c.convite !== 'aceito' && c.email && (
                  <form action={reenviarConviteAction.bind(null, c.tenantId)}>
                    {/* M22: nome acessível diferente por linha (o texto visível continua o mesmo) */}
                    <button className="underline">Reenviar convite<span className="sr-only">{` para ${c.nomeExibicao}`}</span></button>
                  </form>
                )}
                {c.status === 'ativa' ? (
                  <form action={suspenderAction.bind(null, c.tenantId)}>
                    <ConfirmarBotao mensagem={`Suspender a conta ${c.nomeExibicao}? A nutricionista e os pacientes perdem o acesso até a reativação. Nenhum dado é apagado.`}>
                      Suspender<span className="sr-only">{` a conta ${c.nomeExibicao}`}</span>
                    </ConfirmarBotao>
                  </form>
                ) : (
                  <form action={reativarAction.bind(null, c.tenantId)}>
                    <ConfirmarBotao mensagem={`Reativar a conta ${c.nomeExibicao}?`}>
                      Reativar<span className="sr-only">{` a conta ${c.nomeExibicao}`}</span>
                    </ConfirmarBotao>
                  </form>
                )}
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
