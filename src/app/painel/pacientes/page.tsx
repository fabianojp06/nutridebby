import Link from 'next/link';
import { requireNutri } from '@/lib/tenant-session';
import { hojeNoFuso, idadeEm } from '@/modules/pacientes/datas';
import { listarEtiquetas } from '@/modules/pacientes/etiquetas';
import { listarPacientes, type StatusPaciente } from '@/modules/pacientes/pacientes';

export const dynamic = 'force-dynamic';

const SITUACOES: Record<StatusPaciente, string> = { ativo: 'Ativos', arquivado: 'Arquivados', bloqueado: 'Bloqueados' };
const texto = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');

export default async function PacientesPage({ searchParams }: PageProps<'/painel/pacientes'>) {
  const { ctx, tenant } = await requireNutri('/painel/pacientes');
  const sp = await searchParams;
  const busca = texto(sp.busca);
  const status: StatusPaciente = Object.hasOwn(SITUACOES, texto(sp.status)) ? (texto(sp.status) as StatusPaciente) : 'ativo';
  const etiquetaId = texto(sp.etiqueta);
  const etiquetas = await listarEtiquetas(ctx);
  const lista = await listarPacientes(ctx, { busca, status, etiquetaId: etiquetaId || undefined });
  const hoje = hojeNoFuso(tenant.fuso);
  return (
    <>
      <main className="space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Pacientes</h1>
          <Link href="/painel/pacientes/novo" className="rounded bg-emerald-700 px-4 py-2 text-white">Novo paciente</Link>
        </div>
        <form role="search" className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label htmlFor="busca" className="block font-medium">Buscar por nome ou e-mail</label>
            <input id="busca" name="busca" type="search" defaultValue={busca} className="rounded border p-2" />
          </div>
          <div className="space-y-1">
            <label htmlFor="status" className="block font-medium">Situação</label>
            <select id="status" name="status" defaultValue={status} className="rounded border p-2">
              {Object.entries(SITUACOES).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="etiqueta" className="block font-medium">Etiqueta</label>
            <select id="etiqueta" name="etiqueta" defaultValue={etiquetaId} className="rounded border p-2">
              <option value="">Todas</option>
              {etiquetas.map((e) => <option key={e.id} value={e.id}>{`${e.nome} (${e.pacientes})`}</option>)}
            </select>
          </div>
          <button className="rounded border px-4 py-2">Filtrar</button>
        </form>
        {lista.length === 0 ? (
          <p>Nenhum paciente encontrado.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Pacientes</caption>
            <thead>
              <tr>
                <th scope="col">Nome</th>
                <th scope="col">Idade</th>
                <th scope="col">E-mail</th>
                <th scope="col">Acesso ao portal</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((p) => (
                <tr key={p.id} className="border-t">
                  <td><Link href={`/painel/pacientes/${p.id}`} className="underline">{p.nome}</Link></td>
                  <td>{p.dataNascimento ? `${idadeEm(p.dataNascimento, hoje)} anos` : 'Completar cadastro'}</td>
                  <td>{p.email}</td>
                  <td>{p.userId ? 'Ativo' : 'Pendente'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </>
  );
}
