import Link from 'next/link';
import { Selo } from '@/components/ui/selo';
import { OpcoesDoFiltroDeLocal } from '@/components/opcoes-de-local';
import { requireNutri } from '@/lib/tenant-session';
import { MSG_FILTRO_LOCAL } from '@/modules/agenda/constantes';
import { localDasOpcoes, locaisParaFiltro } from '@/modules/agenda/locais';
import { situacoesDoAcesso } from '@/modules/pacientes/convite-paciente';
import { formatarDataNoFuso, hojeNoFuso, idadeEm } from '@/modules/pacientes/datas';
import { listarEtiquetas } from '@/modules/pacientes/etiquetas';
import { filtroDaUrl, listarPacientes, type AbaDaLista, type OrdemDaLista, type PacienteNaLista } from '@/modules/pacientes/pacientes';
import { FocoNoTitulo, MenuDaLinha, StatusDaLista } from './menu-da-linha';
import { ID_DO_TITULO, MSG_LISTA } from './textos';
import { rotuloDoAcessoNaLista, urlDaLista } from './valores';

export const dynamic = 'force-dynamic';

const ABAS = Object.entries(MSG_LISTA.abas) as [Exclude<AbaDaLista, 'bloqueados'>, string][];
const ORDENS = Object.entries(MSG_LISTA.ordens) as [OrdemDaLista, string][];
/** Os mesmos selos do cabeçalho da ficha (`seloDoPaciente`), só para as situações que aparecem fora da aba Ativos. */
const SELO: Record<PacienteNaLista['status'], string | null> = { ativo: null, arquivado: 'Arquivado', bloqueado: 'Bloqueado (pedido de exclusão)' };
const CAMPO = 'min-h-11 rounded-xl border border-campo bg-cartao p-2 text-texto';

/**
 * Plano 18 (US-261, §8.1): abas Ativos/Inativos/Todos (`aria-current`) e "Ver bloqueados" (RN-270), "Ordenar por"
 * (RN-271), só o nome exibido (o social, quando há; RN-266), colunas "Acesso ao app" (rótulo curto) e "Desde", o menu
 * "Ações" por linha (RN-273) e a região `role="status"` fixa acima da tabela, sempre montada, com o resultado de arquivar
 * ou reativar (`?ok=`, D26). A lista não lê nada do cadastro além do nome social (RN-272). Plano 23 (US-415, RN-436): o
 * filtro "Local" (`?local=`), derivado das consultas, levado pelas abas e pelo menu da linha.
 */
export default async function PacientesPage({ searchParams }: PageProps<'/painel/pacientes'>) {
  const { ctx, tenant } = await requireNutri('/painel/pacientes');
  const sp = await searchParams;
  // Plano 23 (US-415, AG-D79): o local pedido só vale se for uma das opções (ativo, ou arquivado com consulta)
  const locais = await locaisParaFiltro(ctx, 'pacientes');
  const pedido = filtroDaUrl(sp);
  const filtro = localDasOpcoes(locais, pedido.localId) ? pedido : { ...pedido, localId: undefined };
  const aba = filtro.aba ?? 'ativos';
  const busca = filtro.busca ?? '';
  const etiquetaId = filtro.etiquetaId ?? '';
  const localId = filtro.localId ?? '';
  const ok = sp.ok === 'arquivado' || sp.ok === 'reativado' ? sp.ok : null;
  // D26: o marcador da ação (`r`, gerado pela action) só serve para a região anunciar de novo; fora do formato, vazio
  const marcador = ok && typeof sp.r === 'string' && /^[0-9a-f]{8}$/.test(sp.r) ? sp.r : '';
  const [etiquetas, lista] = await Promise.all([listarEtiquetas(ctx), listarPacientes(ctx, filtro)]);
  const acessos = await situacoesDoAcesso(ctx, lista.filter((p) => p.status === 'ativo'));
  const hoje = hojeNoFuso(tenant.fuso);
  const campos = { aba, busca, etiqueta: etiquetaId, ordem: filtro.ordem ?? 'nome', local: localId };
  const vazio = aba === 'inativos' && !busca.trim() && !etiquetaId && !localId ? MSG_LISTA.vazioInativos : MSG_LISTA.vazio;
  return (
    <>
      <main className="mx-auto w-full max-w-[1360px] space-y-4 p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 id={ID_DO_TITULO} tabIndex={-1} className="font-titulo text-2xl font-semibold">{MSG_LISTA.titulo}</h1>
          <Link data-guia="novo-paciente" href="/painel/pacientes/novo" className="inline-flex min-h-11 items-center justify-center rounded-full bg-destaque px-5 font-semibold text-white hover:brightness-95">Novo paciente</Link>
        </div>
        {ok && <FocoNoTitulo key={`${ok}-${marcador}`} />}
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-borda">
          <nav aria-label={MSG_LISTA.rotuloDasAbas}>
            <ul className="flex">
              {ABAS.map(([valor, rotulo]) => (
                <li key={valor}>
                  <Link
                    href={urlDaLista({ ...filtro, aba: valor })}
                    aria-current={aba === valor ? 'page' : undefined}
                    className={`inline-flex min-h-11 items-center px-3 ${aba === valor ? 'border-b-2 border-marca font-semibold' : 'text-suave'}`}
                  >
                    {rotulo}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <Link href={urlDaLista({ ...filtro, aba: 'bloqueados' })} className="inline-flex min-h-11 items-center text-link underline">{MSG_LISTA.verBloqueados}</Link>
        </div>
        {aba === 'inativos' && <p className="text-suave">{MSG_LISTA.dicaInativos}</p>}
        {aba === 'bloqueados' && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <h2 className="text-lg font-semibold">{MSG_LISTA.tituloBloqueados}</h2>
            <Link href={urlDaLista({ aba: 'ativos' })} className="inline-flex min-h-11 items-center text-link underline">{MSG_LISTA.voltarParaALista}</Link>
          </div>
        )}
        {/* os campos não são controlados: a chave com os filtros ativos remonta o formulário quando a URL muda (navegação do
            cliente pelas abas ou pelo "Voltar para a lista" manteria o que estava escolhido na tela), como nos filtros da agenda */}
        <form key={`busca-${JSON.stringify(campos)}`} method="get" data-guia="busca-pacientes" role="search" className="flex flex-wrap items-end gap-3">
          {aba === 'bloqueados' ? <input type="hidden" name="situacao" value="bloqueados" /> : <input type="hidden" name="aba" value={aba} />}
          <div className="space-y-1">
            <label htmlFor="busca" className="block font-medium">Buscar por nome ou e-mail</label>
            <input id="busca" name="busca" type="search" defaultValue={busca} className={CAMPO} />
          </div>
          <div className="space-y-1">
            <label htmlFor="etiqueta" className="block font-medium">Etiqueta</label>
            <select id="etiqueta" name="etiqueta" defaultValue={etiquetaId} className={CAMPO}>
              <option value="">Todas</option>
              {etiquetas.map((e) => <option key={e.id} value={e.id}>{`${e.nome} (${e.pacientes})`}</option>)}
            </select>
          </div>
          {/* Plano 23 (US-415, RN-436): quem tem consulta no local; combina com a aba, a busca e a etiqueta */}
          <div className="min-w-0 max-w-full space-y-1">
            <label htmlFor="local" className="block font-medium">{MSG_FILTRO_LOCAL.local}</label>
            <select id="local" name="local" defaultValue={localId} className={`${CAMPO} w-full sm:w-auto sm:max-w-xs`}>
              <OpcoesDoFiltroDeLocal opcoes={locais} />
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="ordem" className="block font-medium">{MSG_LISTA.ordenarPor}</label>
            <select id="ordem" name="ordem" defaultValue={filtro.ordem ?? 'nome'} className={CAMPO}>
              {ORDENS.map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}
            </select>
          </div>
          <button className="inline-flex min-h-11 items-center justify-center rounded-full border border-campo bg-cartao px-5 text-texto hover:bg-linha">Filtrar</button>
        </form>
        {/* D26: montada antes do texto aparecer (sempre, também vazia), fora da tabela: a linha arquivada some da aba */}
        <StatusDaLista texto={ok ? MSG_LISTA.ok[ok] : ''} marcador={marcador} />
        {lista.length === 0 ? (
          <p>{vazio}</p>
        ) : (
          // o painel do menu "Ações" é `fixed`: a rolagem horizontal da tabela não o corta (RN-273)
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <caption className="sr-only">{MSG_LISTA.titulo}</caption>
              <thead className="text-sm text-suave">
                <tr>
                  {MSG_LISTA.colunas.slice(0, -1).map((c) => <th key={c} scope="col" className="px-2 py-1">{c}</th>)}
                  <th scope="col" className="px-2 py-1" data-guia="acoes-paciente">{MSG_LISTA.colunas.at(-1)}</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((p) => {
                  const nome = p.nomeSocial ?? p.nome;
                  const selo = SELO[p.status];
                  return (
                    <tr key={p.id} className="border-t border-linha">
                      <td className="px-2 py-1">
                        <Link href={`/painel/pacientes/${p.id}`} className="text-link underline focus-visible:outline-offset-[-3px]">{nome}</Link>
                        {selo && <> <Selo>{selo}</Selo></>}
                      </td>
                      <td className="px-2 py-1 whitespace-nowrap">{p.dataNascimento ? `${idadeEm(p.dataNascimento, hoje)} anos` : 'Completar cadastro'}</td>
                      <td className="px-2 py-1">{p.email}</td>
                      <td className="px-2 py-1">{rotuloDoAcessoNaLista({ ...p, convite: acessos.get(p.id) ?? { estado: 'sem_convite' } })}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{formatarDataNoFuso(p.createdAt, tenant.fuso)}</td>
                      <td className="px-2 py-1">
                        <MenuDaLinha id={p.id} nome={nome} status={p.status} campos={campos} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
