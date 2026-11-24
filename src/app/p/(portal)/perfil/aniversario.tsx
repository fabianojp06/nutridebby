'use client';
import { useActionState } from 'react';
import { MSG_ANIVERSARIO } from '@/modules/agenda/constantes';
import { autorizarAniversarioAction, retirarAniversarioAction, type PerfilState } from './actions';

const M = MSG_ANIVERSARIO.portal;
const BOTAO = 'min-h-11 rounded-xl border border-borda bg-cartao px-4 disabled:opacity-60';

/** O que o bloco mostra, montado no servidor (page.tsx): a situação e a data já no fuso do consultório. */
export type AniversarioNaTela = { situacao: 'autorizado' | 'nao_autorizado' | 'menor'; autorizadoEm: string | null };

/**
 * Plano 23 (US-414, §6.2 "Portal: Perfil", C-410): o ponto de coleta da autorização de mensagens de aniversário — o h2,
 * a ajuda fixa (canal, dados, frequência e como retirar; LGPD arts. 8º e 9º), a situação e um botão explícito ("Autorizar"
 * ou "Retirar autorização"; nada marcado por padrão). Menor de 18: "Autorizar" desabilitado, com "Menor de idade". A
 * falha volta como "Não foi possível salvar. Tente de novo." (região de alerta); o sucesso recarrega Eu (a situação muda).
 */
export function Aniversario({ estado }: { estado: AniversarioNaTela }) {
  const [aut, autorizar, autorizando] = useActionState<PerfilState, FormData>(autorizarAniversarioAction, {});
  const [ret, retirar, retirando] = useActionState<PerfilState, FormData>(retirarAniversarioAction, {});
  const erro = aut.erro ?? ret.erro;
  const situacao = estado.situacao === 'autorizado' ? M.autorizadoEm(estado.autorizadoEm ?? '') : estado.situacao === 'menor' ? M.menor : M.naoAutorizado;
  return (
    <section aria-labelledby="eu-aniversario" className="space-y-2 rounded-2xl border border-borda bg-cartao p-4">
      <h2 id="eu-aniversario" className="font-portal-titulo text-lg font-bold">{M.titulo}</h2>
      <p className="text-sm">{M.ajuda}</p>
      <p id="eu-aniversario-situacao" className="font-semibold">{situacao}</p>
      {estado.situacao === 'autorizado' ? (
        <form action={retirar}>
          <button type="submit" disabled={retirando} className={BOTAO}>{M.retirar}</button>
        </form>
      ) : (
        <form action={autorizar}>
          {/* menor de 18: desabilitado, e a situação ao lado diz "Menor de idade" (RN-431) */}
          <button type="submit" disabled={autorizando || estado.situacao === 'menor'} aria-describedby="eu-aniversario-situacao" className={BOTAO}>{M.autorizar}</button>
        </form>
      )}
      {erro && <p role="alert" className="text-erro">{erro}</p>}
    </section>
  );
}
