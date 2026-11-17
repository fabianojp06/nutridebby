'use client';
import { useId, useSyncExternalStore } from 'react';
import { DIA_CURTO, type DiaDaSemana } from '@/modules/plano-alimentar/dias';
import { rotuloDaRefeicao } from '@/modules/portal/diario-constantes';
import type { PerfilDoPaciente, RefeicaoDoPaciente } from '@/modules/portal/plano';
import { agoraNoFuso, MSG_PLANO_DIAS, perfilDoDia, proximaRefeicao, umPerfilSo, type AgoraNoFuso } from '@/modules/portal/plano-regras';
import { RefeicaoDetalhe } from './refeicao-detalhe';

/** O relógio muda de minuto (e de dia) com a página aberta; a volta ao app (aba visível) também confere. */
function assinarRelogio(avisar: () => void): () => void {
  const t = setInterval(avisar, 60_000);
  document.addEventListener('visibilitychange', avisar);
  return () => {
    clearInterval(t);
    document.removeEventListener('visibilitychange', avisar);
  };
}
const chave = (a: AgoraNoFuso) => `${a.dia}:${a.minutos}`;
const lerChave = (c: string): AgoraNoFuso => {
  const [dia, minutos] = c.split(':').map(Number);
  return { dia: dia as DiaDaSemana, minutos };
};

type Props = {
  refeicoes: RefeicaoDoPaciente[];
  perfis: PerfilDoPaciente[];
  fuso: string;
  /** O "agora" da leitura no servidor: o HTML do servidor (e a hidratação) usam este; depois, o relógio do aparelho. */
  agoraDoServidor: AgoraNoFuso;
  perguntarSobre: boolean;
};

/**
 * Plano 19 (RN-247 c, US-236): a página Plano com os dias. O servidor entrega as refeições e os perfis de dia (os 7 dias);
 * este componente marca "Hoje ({dia})" e abre o dia certo pelo RELÓGIO DO APARELHO no fuso do consultório — a cópia
 * offline (RN-208) aberta no dia seguinte não fica presa no "hoje" de quando foi guardada. Os outros perfis ficam em "Ver
 * outros dias", cada um com o título por extenso e o total do dia (nunca a soma de todas as refeições). Com um perfil só
 * (todas as refeições nos 7 dias), nada muda na tela. A refeição que não vale hoje abre só para leitura (`valeHoje`).
 * A próxima refeição (RN-247 d) também é decidida aqui, com o mesmo relógio.
 */
export function DiaDeHoje({ refeicoes, perfis, fuso, agoraDoServidor, perguntarSobre }: Props) {
  const agora = lerChave(useSyncExternalStore(assinarRelogio, () => chave(agoraNoFuso(new Date(), fuso)), () => chave(agoraDoServidor)));
  const idHoje = useId();
  const proxima = proximaRefeicao(refeicoes, agora);
  const porId = new Map(refeicoes.map((r) => [r.id, r]));
  const doPerfil = (p: PerfilDoPaciente) => p.refeicaoIds.flatMap((id) => porId.get(id) ?? []);
  // a mesma refeição pode estar em vários perfis: o id da âncora (`ref-<id>`, AbrirRefeicaoDaUrl) e o destaque da próxima
  // ficam só na primeira vez que ela aparece (hoje antes de "Ver outros dias")
  const vistas = new Set<string>();

  const lista = (rs: RefeicaoDoPaciente[]) => (
    <ol className="space-y-3">
      {rs.map((r) => {
        const primeira = !vistas.has(r.id);
        vistas.add(r.id);
        const destaque = primeira && r.id === proxima?.id;
        return (
          <li key={r.id}>
            <details id={primeira ? `ref-${r.id}` : undefined} open={destaque} className={destaque ? 'rounded-2xl border-2 border-p-marco bg-cartao ring-2 ring-p-marco-texto' : 'rounded-2xl border border-borda bg-cartao'}>
              {/* sem flex/grid no summary: ele perde o display: list-item e o marcador ▶/▼ que diz que a refeição abre (molde ajuda-seguranca.tsx); o título direto no summary (o modelo de conteúdo admite um título) */}
              <summary className="min-h-11 cursor-pointer p-3">
                <h3 className="inline font-portal-titulo text-lg font-bold">{rotuloDaRefeicao(r.nome, r.horario)}</h3>
                {destaque && proxima && <span className="ml-3 inline-block rounded-full bg-p-marco px-2 text-sm font-semibold text-p-marco-texto">{proxima.texto}</span>}
              </summary>
              <div className="px-3 pb-3">
                <RefeicaoDetalhe refeicao={r} respondida={false} perguntarSobre={perguntarSobre} valeHoje={r.dias.includes(agora.dia)} />
              </div>
            </details>
          </li>
        );
      })}
    </ol>
  );
  const total = (p: PerfilDoPaciente) => p.totalKcal && <p>{`Total do dia: ${p.totalKcal}`}</p>;

  if (umPerfilSo(perfis))
    return (
      <>
        {total(perfis[0])}
        {lista(doPerfil(perfis[0]))}
      </>
    );

  const deHoje = perfilDoDia(perfis, agora.dia);
  const outros = perfis.filter((p) => p !== deHoje);
  // RN-247 (d): depois da última refeição de hoje (ou num dia sem refeição), a próxima pode estar só num perfil de "Ver
  // outros dias" — o <details> de fora abre junto, senão o destaque e o texto da próxima ficam escondidos (também do leitor)
  const proximaEmOutroDia = proxima !== null && !deHoje?.refeicaoIds.includes(proxima.id) && outros.some((p) => p.refeicaoIds.includes(proxima.id));
  return (
    <>
      <section aria-labelledby={idHoje} className="space-y-3">
        <h2 id={idHoje} className="font-portal-titulo text-lg font-bold">{MSG_PLANO_DIAS.hoje(DIA_CURTO[agora.dia])}</h2>
        {deHoje ? (
          <>
            {total(deHoje)}
            {lista(doPerfil(deHoje))}
          </>
        ) : (
          <p>{MSG_PLANO_DIAS.semRefeicaoHoje}</p>
        )}
      </section>
      {outros.length > 0 && (
        <details open={proximaEmOutroDia} className="rounded-2xl border border-borda bg-cartao p-3">
          <summary className="min-h-11 cursor-pointer font-semibold">{MSG_PLANO_DIAS.verOutrosDias}</summary>
          <div className="mt-3 space-y-6">
            {outros.map((p) => (
              <section key={p.dias.join('')} aria-labelledby={`${idHoje}-${p.dias.join('')}`} className="space-y-3">
                <h2 id={`${idHoje}-${p.dias.join('')}`} className="font-portal-titulo text-lg font-bold">{p.titulo}</h2>
                {total(p)}
                {lista(doPerfil(p))}
              </section>
            ))}
          </div>
        </details>
      )}
    </>
  );
}
