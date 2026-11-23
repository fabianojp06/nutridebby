import Link from 'next/link';
import { ConfirmarBotao } from '@/components/confirmar-botao';
import type { TipoDeLocal } from '@/db/schema';
import { requireNutri } from '@/lib/tenant-session';
import { MSG_LOCAIS, ROTULO_TIPO_LOCAL } from '@/modules/agenda/constantes';
import { listarLocais, type LocalNaTela } from '@/modules/agenda/locais';
import { AbasDaAgenda } from '../abas';
import { arquivarLocalAction, definirPrincipalAction, excluirLocalAction, reativarLocalAction, salvarLocalAction } from './actions';
import { LocalForm } from './local-form';
import { ERRO_LOCAIS, lerRetorno, OK_LOCAIS } from './retornos';

export const dynamic = 'force-dynamic';

const CAMINHO = '/painel/agenda/locais';
const BOTAO = 'inline-flex min-h-11 items-center text-link underline';

/** US-400 (RN-401 a RN-405): "Locais de atendimento". Lista em cartões (também a 360 px); o formulário abre por `?novo=1` ou `?editar=<id>`. */
export default async function LocaisPage({ searchParams }: PageProps<'/painel/agenda/locais'>) {
  const { ctx } = await requireNutri(CAMINHO);
  const sp = await searchParams;
  const arquivados = sp.arquivados === '1';
  const { locais, avisoLinkDivergente } = await listarLocais(ctx, { arquivados });
  const ok = lerRetorno(OK_LOCAIS, sp.ok);
  const erro = lerRetorno(ERRO_LOCAIS, sp.erro);
  const editando = !arquivados && typeof sp.editar === 'string' ? locais.find((l) => l.id === sp.editar) : undefined;
  const novo = !arquivados && !editando && sp.novo === '1';
  return (
    <main className="mx-auto w-full max-w-[1360px] space-y-6 p-4 md:p-6">
      <h1 className="font-titulo text-2xl font-semibold">Locais de atendimento</h1>
      <AbasDaAgenda atual="locais" />
      {/* região fixa, fora da lista: a volta das ações (lista fechada; outro valor não mostra nada) */}
      <p role="status" className="text-ok">{ok ? OK_LOCAIS[ok] : ''}</p>
      {erro && <p role="alert" className="text-erro">{ERRO_LOCAIS[erro]}</p>}
      <div className="flex flex-wrap items-center gap-4">
        <Link href={`${CAMINHO}?novo=1`} className="inline-flex min-h-11 items-center justify-center rounded-full bg-destaque px-5 font-semibold text-white hover:brightness-95">Novo local</Link>
        {arquivados ? <Link href={CAMINHO} className={BOTAO}>Ver ativos</Link> : <Link href={`${CAMINHO}?arquivados=1`} className={BOTAO}>Ver arquivados</Link>}
      </div>
      {(novo || editando) && (
        <section aria-labelledby="titulo-form-local" className="max-w-lg space-y-3 rounded-3xl border border-borda bg-cartao p-5">
          <h2 id="titulo-form-local" className="text-lg font-semibold">{editando ? `Editar ${editando.nome}` : 'Novo local'}</h2>
          <LocalForm key={editando?.id ?? 'novo'} acao={salvarLocalAction.bind(null, editando?.id ?? null)} local={editando} />
        </section>
      )}
      <section aria-labelledby="titulo-lista-locais" className="space-y-3">
        <h2 id="titulo-lista-locais" className="text-lg font-semibold">{arquivados ? 'Locais arquivados' : 'Locais ativos'}</h2>
        {locais.length === 0 ? (
          <p>{arquivados ? 'Nenhum local arquivado.' : MSG_LOCAIS.vazio}</p>
        ) : (
          <ul className="grid gap-3">
            {locais.map((l) => <ItemLocal key={l.id} l={l} arquivados={arquivados} avisoLink={avisoLinkDivergente && l.tipo === 'online' && l.nome === 'Videoconferência'} />)}
          </ul>
        )}
      </section>
    </main>
  );
}

function ItemLocal({ l, arquivados, avisoLink }: { l: LocalNaTela; arquivados: boolean; avisoLink: boolean }) {
  const onde = l.tipo === 'presencial' ? [l.endereco, l.cidade].filter(Boolean).join(' · ') : l.linkSala ? 'Com sala fixa' : 'Sem sala fixa';
  return (
    <li className="space-y-2 rounded-3xl border border-borda bg-cartao p-4 md:flex md:items-start md:justify-between md:gap-6 md:space-y-0">
      <div className="min-w-0 space-y-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-semibold break-words">{l.nome}</span>
          {l.principal && <span className="rounded-full bg-linha px-2 py-0.5 text-sm font-medium">Principal</span>}
        </p>
        <p className="text-sm text-suave">{`${ROTULO_TIPO_LOCAL[l.tipo as TipoDeLocal]}${onde ? ` · ${onde}` : ''}`}</p>
        <p className="text-sm">{l.agendamentoOnline ? 'Aceita agendamento pelo paciente' : 'Sem agendamento pelo paciente'}</p>
        {avisoLink && <p className="text-sm text-aviso">{MSG_LOCAIS.linkDivergente}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-x-4">
        {arquivados ? (
          <form action={reativarLocalAction.bind(null, l.id)}>
            <button className={BOTAO} aria-label={`Reativar ${l.nome}`}>Reativar</button>
          </form>
        ) : (
          <>
            <Link href={`${CAMINHO}?editar=${l.id}`} className={BOTAO} aria-label={`Editar ${l.nome}`}>Editar</Link>
            {!l.principal && (
              <form action={definirPrincipalAction.bind(null, l.id)}>
                <button className={BOTAO} aria-label={`Definir ${l.nome} como principal`}>Definir como principal</button>
              </form>
            )}
            <form action={arquivarLocalAction.bind(null, l.id)}>
              <button className={BOTAO} aria-label={`Arquivar ${l.nome}`}>Arquivar</button>
            </form>
          </>
        )}
        {/* RN-403: o local em uso não se exclui (arquiva-se); o principal também não */}
        {l.emUso ? (
          !arquivados && !l.principal && <span className="inline-flex min-h-11 items-center text-sm text-suave">Em uso: arquive</span>
        ) : (
          !l.principal && (
            <form action={excluirLocalAction.bind(null, l.id, arquivados)}>
              <ConfirmarBotao mensagem="Excluir este local?" rotulo={`Excluir ${l.nome}`} className={BOTAO}>Excluir</ConfirmarBotao>
            </form>
          )
        )}
      </div>
    </li>
  );
}
