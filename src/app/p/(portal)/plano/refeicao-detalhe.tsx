import Link from 'next/link';
import { ComiAssim } from '@/components/portal/comi-assim';
import { LinkDeResposta } from '@/components/portal/link-de-resposta';
import { ROTULO_RESPOSTA } from '@/modules/portal/diario-constantes';
import { MSG_IA_NUTRI } from '@/modules/ia/nutri-paciente/constantes';
import type { RefeicaoDoPaciente } from '@/modules/portal/plano';

const minuscula = (s: string) => s.charAt(0).toLocaleLowerCase('pt-BR') + s.slice(1);
const BOTAO = 'inline-flex min-h-11 items-center rounded-full border-2 border-marca bg-cartao px-4 font-semibold text-texto';

/**
 * Plano 16 (US-193, RN-213, molde GV-Almoço): o que planoDoPaciente já devolve — itens com a quantidade à direita, as trocas
 * ("ou {nome}, {quantidade}"), a observação dela (a voz dela, RN-194), a receita sugerida (?de=plano) e as três respostas.
 * Usado na refeição aberta e dentro da sanfona do Plano (a cópia offline tem tudo, §4.8). Plano 15 (§7.8): "Perguntar sobre
 * esta refeição" leva à conversa com `?sobre=<id>` (só o id; o nome é resolvido no servidor) quando a página mãe diz que a
 * entrada da IA Nutri existe (`perguntarSobre`).
 */
export function RefeicaoDetalhe({ refeicao, respondida, perguntarSobre }: { refeicao: RefeicaoDoPaciente; respondida: boolean; perguntarSobre: boolean }) {
  return (
    <div className="space-y-3">
      {refeicao.kcal && <p className="text-sm text-suave">{`Cerca de ${refeicao.kcal}`}</p>}
      <ul className="divide-y divide-borda">
        {refeicao.itens.map((i) => (
          <li key={i.id} className="py-2">
            <p className="flex justify-between gap-3">
              <span>{i.nome}</span>
              <span className="text-right font-semibold">{`${i.quantidade}${i.kcal ? ` · ${i.kcal}` : ''}`}</span>
            </p>
            {i.substituicoes.length > 0 && <p className="text-sm text-suave">{i.substituicoes.map((s) => `ou ${minuscula(s.nome)}, ${s.quantidade}`).join(' · ')}</p>}
          </li>
        ))}
      </ul>
      {refeicao.observacao && (
        <div className="rounded-2xl bg-p-clara p-3">
          <p className="text-sm font-semibold">Observação da sua nutricionista</p>
          <p className="whitespace-pre-line wrap-break-word">{refeicao.observacao}</p>
        </div>
      )}
      {refeicao.receita && (
        <p className="text-sm">
          <span className="font-semibold">Sugestão de receita: </span>
          {/* ?de=plano: a receita fora da audiência só abre por aqui (RN-12, exceção — D2 do Plano 07) */}
          <Link href={`/p/conteudos/${refeicao.receita.id}?de=plano`} className="text-link underline">{refeicao.receita.titulo}</Link>
        </p>
      )}
      <div className="flex flex-wrap items-start gap-2">
        <LinkDeResposta href={`/p/diario?refeicao=${refeicao.id}&foto=1#registrar`} className={BOTAO}>Mandar foto do prato</LinkDeResposta>
        {respondida ? <p className="inline-flex min-h-11 items-center text-sm">No diário</p> : <ComiAssim refeicaoId={refeicao.id} />}
        <LinkDeResposta href={`/p/diario?refeicao=${refeicao.id}&resposta=outra_coisa#registrar`} className={BOTAO}>{ROTULO_RESPOSTA.outra_coisa}</LinkDeResposta>
      </div>
      {perguntarSobre && (
        <p>
          <Link href={`/p/plano/ia?sobre=${refeicao.id}`} className="inline-flex min-h-11 items-center font-semibold text-link underline">
            {MSG_IA_NUTRI.linkRefeicao}
          </Link>
        </p>
      )}
    </div>
  );
}
