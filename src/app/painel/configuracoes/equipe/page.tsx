import { notFound } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { formatarDataHora, formatarDataNoFuso } from '@/modules/pacientes/datas';
import { listarEquipe, type MembroNaLista } from '@/modules/plataforma/equipe';
import { EQUIPE_LIGADA, MSG_EQUIPE } from '@/modules/plataforma/equipe-textos';
import { FocoNoAviso } from '../../relatorios/foco';
import { ConvidarForm } from './convidar-form';
import { idDaLinha, LinhaDaEquipe, StatusDaEquipe } from './linha';

export const dynamic = 'force-dynamic';

const ID_TITULO = 'titulo-equipe';
const ID_LIMITE = 'limite-equipe';
const ID_ERRO = 'erro-equipe';
const OKS = ['convidada', 'reenviado', 'permissao', 'desativada', 'reativada'] as const;
/** Os erros das ações da linha que voltam pela URL (lista fechada; o resto é recusado no formulário ou dá 404). */
const ERROS = { ja_tem_senha: MSG_EQUIPE.erros.jaTemSenha, conta_suspensa: MSG_EQUIPE.erros.contaSuspensa, limite: MSG_EQUIPE.erros.limite } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 'dd/mm/aaaa' e 'hh:mm' no fuso do consultório (RN-06). */
function dataEHora(d: Date, fuso: string): [string, string] {
  const [data, hora] = formatarDataHora(d, fuso).split(', ');
  return [data, hora];
}

function textoDaSituacao(m: MembroNaLista, fuso: string): string {
  if (m.situacao === 'desativado' && m.desativadaEm) return MSG_EQUIPE.situacao.desativado(formatarDataNoFuso(m.desativadaEm, fuso));
  if (m.situacao === 'convite_enviado' && m.conviteValeAte) return MSG_EQUIPE.situacao.conviteEnviado(...dataEHora(m.conviteValeAte, fuso));
  if (m.situacao === 'ativo') return MSG_EQUIPE.situacao.ativo;
  return MSG_EQUIPE.situacao.conviteVencido;
}

/**
 * Plano 26 (US-488, RN-499, RN-502, RN-503, RN-516; §7.2): a Equipe do consultório, só da nutricionista (`requireNutri`).
 * Nasce desligada (RE-D52): com `EQUIPE_LIGADA = false`, 404 depois da sessão. A explicação do topo diz o que a recepção vê;
 * "Convidar recepcionista" some no limite de 3 ativas, e o aviso do limite aparece. As confirmações chegam por `?ok=` com o
 * marcador `r` numa região `role="status"` sempre montada; o foco vai para a linha da pessoa (`m`) depois de uma ação da
 * linha, para o aviso do limite quando o convite o atingiu, para o erro (`?erro=`) ou para o título.
 */
export default async function EquipePage({ searchParams }: PageProps<'/painel/configuracoes/equipe'>) {
  const { ctx, tenant } = await requireNutri('/painel/configuracoes/equipe');
  if (!EQUIPE_LIGADA) notFound();
  const sp = await searchParams;
  const ok = OKS.find((o) => o === sp.ok) ?? null;
  const erro = typeof sp.erro === 'string' && sp.erro in ERROS ? (sp.erro as keyof typeof ERROS) : null;
  const marcador = (ok || erro) && typeof sp.r === 'string' && /^[0-9a-f]{8}$/.test(sp.r) ? sp.r : '';
  const { membros, limiteAtingido } = await listarEquipe(ctx);
  const daLinha = typeof sp.m === 'string' && UUID.test(sp.m) && membros.some((m) => m.id === sp.m) ? sp.m : null;
  const foco = erro ? ID_ERRO : ok && ok !== 'convidada' && daLinha ? idDaLinha(daLinha) : ok === 'convidada' && limiteAtingido ? ID_LIMITE : ok ? ID_TITULO : null;
  return (
    <main className="mx-auto w-full max-w-[1360px] space-y-6 p-4 md:p-6">
      <h1 id={ID_TITULO} tabIndex={-1} className="font-titulo text-2xl font-semibold">{MSG_EQUIPE.titulo}</h1>
      <p className="max-w-3xl">{MSG_EQUIPE.explicacao}</p>
      <StatusDaEquipe texto={ok ? MSG_EQUIPE.ok[ok] : ''} marcador={marcador} />
      {erro && (
        <p id={ID_ERRO} tabIndex={-1} className="rounded-2xl bg-erro-fundo p-3 font-medium text-erro">
          {ERROS[erro]}
        </p>
      )}
      {foco && <FocoNoAviso key={`${foco}-${marcador}`} id={foco} />}
      <div data-guia="convidar">
        {limiteAtingido ? (
          <p id={ID_LIMITE} tabIndex={-1} className="max-w-xl rounded-2xl border border-borda bg-cartao p-4 font-medium">
            {MSG_EQUIPE.limite}
          </p>
        ) : (
          <ConvidarForm />
        )}
      </div>
      {membros.length > 0 && (
        // §7.2: 6 colunas e os botões de cada linha — a tabela rola dentro da região focável (como a lista de pacientes)
        <div role="region" aria-labelledby={ID_TITULO} tabIndex={0} className="overflow-x-auto p-1 focus-visible:outline-offset-[-3px]">
          <table className="w-full text-left">
            <caption className="sr-only">{MSG_EQUIPE.titulo}</caption>
            <thead className="text-sm text-suave">
              <tr>
                {MSG_EQUIPE.colunas.slice(0, 3).map((c) => <th key={c} scope="col" className="px-2 py-1">{c}</th>)}
                <th scope="col" className="px-2 py-1" data-guia="permissao-financeiro">{MSG_EQUIPE.colunas[3]}</th>
                {MSG_EQUIPE.colunas.slice(4).map((c) => <th key={c} scope="col" className="px-2 py-1">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {membros.map((m) => (
                <LinhaDaEquipe
                  key={m.id}
                  id={m.id}
                  nome={m.nome}
                  email={m.email}
                  situacao={m.situacao}
                  textoDaSituacao={textoDaSituacao(m, tenant.fuso)}
                  financeiro={m.financeiro}
                  textoDoAcesso={m.ultimoAcessoEm ? MSG_EQUIPE.ultimoAcesso(...dataEHora(m.ultimoAcessoEm, tenant.fuso)) : MSG_EQUIPE.aindaNaoEntrou}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
