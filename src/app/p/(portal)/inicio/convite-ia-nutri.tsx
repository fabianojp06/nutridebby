'use client';
import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';
import { CARTAO_IA_NUTRI, dispensado, dispensar } from '@/components/portal/cartoes-dispensados';
import { MSG_IA_NUTRI } from '@/modules/ia/nutri-paciente/constantes';

const semAssinatura = () => () => {};

/** O cartão em si (sem estado): o convite na voz do app, "Ler e decidir" (origem Hoje) e "Agora não". */
export function CartaoConviteIaNutri({ aoDispensar }: { aoDispensar: () => void }) {
  return (
    <section aria-label={MSG_IA_NUTRI.convite} className="space-y-2 rounded-2xl border border-borda bg-cartao p-3">
      {/* RN-194: o autor visível — é um aviso do app, não uma fala da nutricionista */}
      <p className="text-sm font-semibold">{MSG_IA_NUTRI.autorSistema}</p>
      <p>{MSG_IA_NUTRI.convite}</p>
      <p className="flex flex-wrap gap-2">
        <Link href="/p/plano/ia/autorizar?de=hoje" className="inline-flex min-h-11 items-center rounded-full bg-destaque px-4 font-semibold text-white">
          {MSG_IA_NUTRI.lerEDecidir}
        </Link>
        <button type="button" onClick={aoDispensar} className="min-h-11 px-2 text-link underline">
          {MSG_IA_NUTRI.agoraNao}
        </button>
      </p>
    </section>
  );
}

/**
 * Plano 15 (§7.8, US-171): o convite da IA Nutri em Hoje, só com a entrada `decidir` (page.tsx). "Agora não" esconde por 30
 * dias NESTE aparelho, chaveado pelo vínculo (`dono` = patientId: o paciente de dois consultórios decide em cada um), como
 * os cartões do aparelho (molde de cartoes-do-aparelho.tsx); nada é gravado no servidor e recusar não muda nada.
 */
export function ConviteIaNutri({ dono }: { dono: string }) {
  // o localStorage só existe no cliente: no servidor e na hidratação, nenhum cartão
  const noCliente = useSyncExternalStore(semAssinatura, () => true, () => false);
  const [fechado, setFechado] = useState(false);
  if (!noCliente || fechado || dispensado(dono, CARTAO_IA_NUTRI)) return null;
  return (
    <CartaoConviteIaNutri
      aoDispensar={() => {
        dispensar(dono, CARTAO_IA_NUTRI);
        setFechado(true);
        // o botão sai do DOM com o cartão: o foco vai ao próximo ponto estável do mural, nunca ao <body>
        document.getElementById('ver-todo-diario')?.focus();
      }}
    />
  );
}
