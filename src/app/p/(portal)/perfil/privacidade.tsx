'use client';
import Link from 'next/link';
import { useActionState } from 'react';
import { MSG_AUTORIZACAO } from '@/modules/ia/constantes';
import { exclusaoAction, meusDadosAction, retirarIaAction, type PerfilState } from './actions';

const CONFIRMAR_EXCLUSAO = 'Pedir a exclusão? Sua nutricionista tem até 15 dias para responder. O prontuário clínico é guardado pelo prazo legal.';

/**
 * RNF-10: a região `role="status"` existe desde o início (vazia) e só o texto muda — região viva inserida já com o texto
 * muitas vezes não é anunciada (VoiceOver, NVDA com Chrome). O `role="alert"` é anunciado ao entrar.
 */
const Retorno = ({ s }: { s: PerfilState }) => (
  <>
    <p role="status">{s.ok}</p>
    {s.erro && <p role="alert" className="text-erro">{s.erro}</p>}
  </>
);

/** US-106 / US-109: o que o bloco de IA mostra, montado no servidor (page.tsx). */
export type BlocoIaNaTela = { situacao: string; lerEDecidir: boolean; retirar: boolean; retorno: string };

/**
 * US-046: "Baixar meus dados" e "Pedir exclusão dos meus dados" (com confirmação); antes, o texto da RN-214 (Plano 16) e
 * (Plano 14A, US-106/US-109) o bloco "Uso de inteligência artificial (IA)" — só quando há algo a mostrar (`ia` não nulo).
 */
export function Privacidade({ ia }: { ia: BlocoIaNaTela | null }) {
  const [dados, pedirDados, pedindo] = useActionState<PerfilState>(meusDadosAction, {});
  const [exc, pedirExc, excluindo] = useActionState<PerfilState>(exclusaoAction, {});
  const [ret, retirar, retirando] = useActionState<PerfilState>(retirarIaAction, {});
  return (
    <div className="space-y-4">
      {/* RN-214 (Plano 16): transparência sem estigma — nunca diz ao paciente que o peso dele está oculto; e não promete
          "todas" na cópia (notas privadas, rascunho do plano e anotações da nutricionista não saem — exportacao-job.ts) */}
      <p className="text-sm">Algumas informações do acompanhamento podem não aparecer no app, a critério da sua nutricionista. Suas medidas, registros e documentos estão na cópia dos seus dados (Baixar meus dados).</p>
      {ia && (
        <section aria-labelledby="eu-ia" className="space-y-2 rounded-xl border border-borda p-3">
          <h3 id="eu-ia" className="font-semibold">{MSG_AUTORIZACAO.blocoTitulo}</h3>
          <p>{ia.situacao}</p>
          {ia.lerEDecidir && (
            <Link href="/p/perfil/ia" className="inline-flex min-h-11 items-center font-semibold text-link underline">
              {MSG_AUTORIZACAO.lerEDecidir}
            </Link>
          )}
          {ia.retirar && (
            <form
              action={retirar}
              onSubmit={(e) => {
                if (!window.confirm(MSG_AUTORIZACAO.confirmarRetirada)) e.preventDefault();
              }}
            >
              <button disabled={retirando} className="min-h-11 rounded-xl border border-borda bg-cartao px-4">
                {MSG_AUTORIZACAO.retirarAutorizacao}
              </button>
            </form>
          )}
          {/* RNF-10: a região existe desde o início; o retorno da retirada ou o do ?ia= (autorizou / agora-nao) */}
          <p role="status">{ret.ok ?? ia.retorno}</p>
        </section>
      )}
      <form action={pedirDados}>
        <button disabled={pedindo} className="min-h-11 rounded-xl border border-borda bg-cartao px-4">
          Baixar meus dados
        </button>
      </form>
      <Retorno s={dados} />
      <form
        action={pedirExc}
        onSubmit={(e) => {
          if (!window.confirm(CONFIRMAR_EXCLUSAO)) e.preventDefault();
        }}
      >
        <button disabled={excluindo} className="min-h-11 rounded-xl border border-erro bg-cartao px-4 text-erro">
          Pedir exclusão dos meus dados
        </button>
      </form>
      <Retorno s={exc} />
    </div>
  );
}
