import type { TenantContext } from '@/db/tenant';
import { formatarDataHora } from '@/modules/pacientes/datas';
import { ENTIDADE_ROTULO, listAccessHistory, rotuloDaAcao, type AccessHistoryPage } from '../audit';

const PAPEL: Record<string, string> = { nutri: 'nutricionista', paciente: 'paciente', admin: 'administração', recepcao: 'recepção' }; // Plano 26 (RN-516): quem da recepção acessou aparece identificado

// movida para o módulo puro de datas (Plano 18, revisão da P18-09); reexportada aqui para os usos antigos
export { formatarDataHora };

/** Aba "Histórico de acessos" do prontuário (US-007). Montada no prontuário no P03-01. */
export function HistoricoAcessosTabela({ pagina, fuso, baseHref }: { pagina: AccessHistoryPage; fuso: string; baseHref: string }) {
  const href = (n: number) => `${baseHref}${baseHref.includes('?') ? '&' : '?'}pagina=${n}`;
  return (
    <section aria-labelledby="historico-acessos-titulo" className="space-y-3">
      <h2 id="historico-acessos-titulo" className="text-lg font-semibold">Histórico de acessos</h2>
      {pagina.total === 0 ? (
        <p>Nenhum acesso registrado.</p>
      ) : (
        <table className="w-full text-left">
          <caption className="sr-only">Acessos ao prontuário, do mais recente para o mais antigo</caption>
          <thead className="text-sm text-suave">
            <tr>
              <th scope="col">Data e hora</th>
              <th scope="col">Quem</th>
              <th scope="col">Ação</th>
              <th scope="col">Registro</th>
              <th scope="col">IP</th>
            </tr>
          </thead>
          <tbody>
            {pagina.itens.map((i) => (
              <tr key={i.id} className="border-t border-linha">
                <td>{formatarDataHora(i.criadoEm, fuso)}</td>
                <td>{i.ator ? `${i.ator.nome}${PAPEL[i.ator.papel] ? ` (${PAPEL[i.ator.papel]})` : ''}` : 'Sistema'}</td>
                <td>{rotuloDaAcao(i)}</td>
                <td>{ENTIDADE_ROTULO[i.entidade] ?? i.entidade}</td>
                <td>{i.ip ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {pagina.totalPaginas > 1 && (
        <nav aria-label="Páginas do histórico de acessos" className="flex gap-4 text-sm">
          {pagina.pagina > 1 && <a href={href(pagina.pagina - 1)} className="underline">Anterior</a>}
          <span>{`Página ${pagina.pagina} de ${pagina.totalPaginas}`}</span>
          {pagina.pagina < pagina.totalPaginas && <a href={href(pagina.pagina + 1)} className="underline">Próxima</a>}
        </nav>
      )}
    </section>
  );
}

export async function HistoricoAcessos(props: { ctx: TenantContext; patientId: string; pagina: number; fuso: string; baseHref: string }) {
  const pagina = await listAccessHistory(props.ctx, props.patientId, props.pagina);
  return <HistoricoAcessosTabela pagina={pagina} fuso={props.fuso} baseHref={props.baseHref} />;
}
