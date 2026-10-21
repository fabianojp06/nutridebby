'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Tour } from '@/components/guia/tour';
import { precisaDoGuia } from '@/modules/ajuda/precisa-do-guia';
import { AVISO_PORTAL, avisoDoGuia, GUIA_PORTAL } from '@/modules/ajuda/portal';
import { aplicarMarca, type EstadoGuia, type ProgressoGuia } from '@/modules/plataforma/preferencias-tipos';
import { marcarGuiaPortalAction } from '../ajuda/actions';

/**
 * Plano 16 (US-199, RN-212): só o aviso abre sozinho, uma vez por conta (grava "visto" ao aparecer) — "O app mudou…" para
 * quem já usava o app, as boas-vindas para quem entra pela primeira vez (G-D17 = a, `jaUsava`); o tour (<dialog> modal do
 * painel, "{i} de {n}", Voltar/Próximo/Concluir/Pular o tour) abre pelo botão ou por ?tour=portal-novidades (o "Ver o tour
 * de novo" de /p/ajuda). O progresso fica na conta (vale para todos os aparelhos e consultórios, RN-210). Plano 15 (§7.8):
 * quem já viu uma versão anterior do guia recebe "O manual do app foi atualizado…" (`avisoDoGuia`), nunca "O app mudou" de novo.
 */
export function GuiaDoPortal({ progresso: inicial, abrir, jaUsava }: { progresso: ProgressoGuia; abrir: boolean; jaUsava: boolean }) {
  const router = useRouter();
  const [progresso, setProgresso] = useState(inicial);
  const [aberto, setAberto] = useState(abrir);
  const [avisoFechado, setAvisoFechado] = useState(false);
  const marcar = (estado: EstadoGuia) => {
    setProgresso((p) => aplicarMarca(p, GUIA_PORTAL.id, GUIA_PORTAL.versao, estado));
    marcarGuiaPortalAction(GUIA_PORTAL.versao, estado).catch(() => {});
  };
  const mostrarAviso = !aberto && !avisoFechado && precisaDoGuia(progresso, GUIA_PORTAL, ['concluido', 'dispensado', 'visto']);
  useEffect(() => {
    // uma vez: grava "visto" no servidor sem tirar o aviso desta visita
    if (mostrarAviso) marcarGuiaPortalAction(GUIA_PORTAL.versao, 'visto').catch(() => {});
  }, [mostrarAviso]);
  return (
    <>
      {aberto && (
        <Tour
          guia={GUIA_PORTAL}
          aberto
          focoAoFechar='[data-guia="secao-eu"]'
          folhaEvitaAlvo
          aoMarcar={marcar}
          aoFechar={() => {
            setAberto(false);
            if (abrir) router.replace('/p/inicio');
          }}
        />
      )}
      {mostrarAviso && (
        <aside aria-label="Novidade" className="space-y-2 rounded-2xl border border-borda bg-cartao p-3">
          <p>{avisoDoGuia(progresso, jaUsava)}</p>
          <p className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setAvisoFechado(true);
                setAberto(true);
              }}
              className="min-h-11 rounded-full bg-destaque px-4 font-semibold text-white"
            >
              {AVISO_PORTAL.ver}
            </button>
            <button
              type="button"
              onClick={() => {
                setAvisoFechado(true);
                marcar('dispensado');
              }}
              className="min-h-11 px-2 text-link underline"
            >
              {AVISO_PORTAL.agoraNao}
            </button>
          </p>
        </aside>
      )}
    </>
  );
}
