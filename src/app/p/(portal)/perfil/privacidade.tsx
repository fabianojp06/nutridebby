'use client';
import Link from 'next/link';
import { useActionState, useEffect, useRef } from 'react';
import { ConfirmarBotao } from '@/components/confirmar-botao';
import { MSG_FINANCEIRO } from '@/modules/financeiro/constantes';
import { MSG_AUTORIZACAO } from '@/modules/ia/constantes';
import { MSG_IA_NUTRI, NOME_IA_NUTRI } from '@/modules/ia/nutri-paciente/constantes';
import type { BlocoIaNutriApp } from '@/modules/ia/nutri-paciente/estado';
import { desativarIaNutriAction, exclusaoAction, meusDadosAction, retirarIaAction, type PerfilState } from './actions';

/** Plano 20 (US-307, spec §6.2): também os registros de pagamento das consultas ficam pelo prazo legal. */
export const CONFIRMAR_EXCLUSAO = MSG_FINANCEIRO.lgpd.confirmarExclusaoPortal;

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
/** Plano 15 (§7.8, RN-182): o bloco da IA Nutri, como blocoIaNutriDoApp o devolve (situação já com a data no fuso). */
export type BlocoIaNutriNaTela = BlocoIaNutriApp;

const BOTAO_COM_BORDA = 'min-h-11 rounded-xl border border-borda bg-cartao px-4';
const LINK_DO_BLOCO = 'inline-flex min-h-11 items-center font-semibold text-link underline';

/**
 * US-046: "Baixar meus dados" e "Pedir exclusão dos meus dados" (com confirmação); antes, o texto da RN-214 (Plano 16) e
 * (Plano 14A, US-106/US-109) o bloco "Uso de inteligência artificial (IA)" — só quando há algo a mostrar (`ia` não nulo) — e,
 * ao lado, (Plano 15, §7.8, US-177) o bloco "{NOME}" (`iaNutri` não nulo): dois pedidos separados, dois botões diferentes.
 */
export function Privacidade({ ia, iaNutri }: { ia: BlocoIaNaTela | null; iaNutri: BlocoIaNutriNaTela | null }) {
  const [dados, pedirDados, pedindo] = useActionState<PerfilState>(meusDadosAction, {});
  const [exc, pedirExc, excluindo] = useActionState<PerfilState>(exclusaoAction, {});
  const [ret, retirar, retirando] = useActionState<PerfilState>(retirarIaAction, {});
  const [retNutri, desativarNutri] = useActionState<PerfilState>(desativarIaNutriAction, {});
  // US-106/US-109: o retorno do bloco de IA (o do ?ia= ao voltar de /p/perfil/ia, ou o da retirada). A região nasce já com o
  // texto quando se volta da página da autorização (página montada de novo) e não seria anunciada: o foco vai para ela, como
  // no ConfirmarNoMural — o leitor de tela a lê e o navegador a traz para a vista (revisão da T8)
  const retornoIa = ret.ok ?? ia?.retorno ?? '';
  const avisoIa = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (retornoIa) avisoIa.current?.focus();
  }, [retornoIa]);
  // Review Focus 5: a confirmação da IA Nutri fica FORA do bloco (sempre montada) — se o bloco sumir por qualquer motivo
  // depois de desativar, "IA Nutri desativada." continua na tela, é anunciada e recebe o foco (o botão que saiu)
  const avisoIaNutri = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (retNutri.ok) avisoIaNutri.current?.focus();
  }, [retNutri]);
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
              <button disabled={retirando} className={BOTAO_COM_BORDA}>
                {MSG_AUTORIZACAO.retirarAutorizacao}
              </button>
            </form>
          )}
          {/* RNF-10: a região existe desde o início; o retorno da retirada ou o do ?ia= (autorizou / agora-nao) */}
          <p ref={avisoIa} tabIndex={-1} role="status">{retornoIa}</p>
        </section>
      )}
      {iaNutri && (
        <section aria-labelledby="eu-ia-nutri" className="space-y-2 rounded-xl border border-borda p-3">
          <h3 id="eu-ia-nutri" className="font-semibold">{NOME_IA_NUTRI}</h3>
          <p>{iaNutri.situacao}</p>
          {iaNutri.podeDecidir && (
            <p>
              <Link href="/p/plano/ia/autorizar?de=eu" className={LINK_DO_BLOCO}>
                {MSG_IA_NUTRI.lerEDecidir}
              </Link>
            </p>
          )}
          {iaNutri.temConversa && (
            <p>
              <Link href="/p/plano/ia?ler=1" className={LINK_DO_BLOCO}>
                {MSG_IA_NUTRI.lerConversas}
              </Link>
            </p>
          )}
          {iaNutri.podeDesativar && (
            <form action={desativarNutri}>
              {/* o mesmo visual do "Retirar autorização" ao lado (nunca o padrão de link do componente) */}
              <ConfirmarBotao mensagem={MSG_IA_NUTRI.confirmarDesativar} className={BOTAO_COM_BORDA}>
                {MSG_IA_NUTRI.desativar}
              </ConfirmarBotao>
            </form>
          )}
        </section>
      )}
      {/* RNF-10: a região existe desde o início, fora do bloco condicional (Review Focus 5) */}
      <p ref={avisoIaNutri} tabIndex={-1} role="status">{retNutri.ok ?? ''}</p>
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
