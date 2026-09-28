import Link from 'next/link';
import { requireUser } from '@/lib/session';
import { listarContas, MSG, type ContaResumo } from '@/modules/plataforma/contas';
import { reenviarConviteAction } from './actions';

export const dynamic = 'force-dynamic';

const AVISOS: Record<string, { texto: string; erro?: boolean }> = {
  criada: { texto: 'Conta criada. O convite foi enviado para o e-mail da nutricionista.' },
  reenviado: { texto: 'Convite reenviado.' },
  ja_tem_senha: { texto: MSG.jaTemSenha, erro: true },
  sem_nutri: { texto: MSG.semNutri, erro: true },
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
  const contas = await listarContas();
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
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Contas de nutricionista</caption>
        <thead>
          <tr>
            <th scope="col">Conta</th>
            <th scope="col">E-mail</th>
            <th scope="col">CRN</th>
            <th scope="col">Situação</th>
            <th scope="col">Convite</th>
            <th scope="col">Ações</th>
          </tr>
        </thead>
        <tbody>
          {contas.map((c) => (
            <tr key={c.tenantId} className="border-t">
              <th scope="row" className="font-normal">{c.nomeExibicao} <span className="text-zinc-500">({c.slug})</span></th>
              <td>{c.email ?? '—'}</td>
              <td>{c.crn ?? '—'}</td>
              <td>{c.status === 'ativa' ? 'Ativa' : 'Suspensa'}</td>
              <td><Convite c={c} /></td>
              <td>
                {c.convite !== 'aceito' && c.email && (
                  <form action={reenviarConviteAction.bind(null, c.tenantId)}>
                    <button className="underline">Reenviar convite</button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
