'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Tour } from '@/components/guia/tour';
import { guiaDaRota, GUIAS, ID_TOUR_DO_INICIO, precisaDoGuia, type Guia, type PapelDoGuia } from '@/modules/ajuda/conteudo';
import { aplicarMarca, type EstadoGuia, type ProgressoGuia } from '@/modules/plataforma/preferencias-tipos';
import { marcarGuiaAction } from '../preferencias/actions';
import { GavetaAjuda } from './gaveta-ajuda';

// Plano 16: a regra mora em preferencias-tipos.ts (o GuiaDoPortal também a usa); reexportada para quem já a importava daqui
export { aplicarMarca };

/** Otimista: se a gravação falhar (sessão vencida, rede), o progresso local vale nesta visita e o servidor pede de novo na próxima. */
function gravar(g: Guia, estado: EstadoGuia) {
  marcarGuiaAction(g.id, g.versao, estado).catch(() => {});
}

/**
 * D26/D27: o botão "Ajuda" do cabeçalho, a gaveta, o tour e o aviso "Primeira vez aqui?". Só o tour de boas-vindas abre
 * sozinho (uma vez, no Início, com o DPA já aceito — o layout só monta isto com o DPA em dia). `?tour=boas-vindas` reabre.
 * O `progresso` do layout é só o valor inicial: o layout NÃO é renderizado de novo na navegação pelo cliente, então o
 * progresso vive em estado local, atualizado de forma otimista a cada marcação — concluir o tour, ir a Pacientes e voltar
 * ao Início pelo menu não o reabre. A gaveta e o tour aberto à mão valem para a tela em que foram abertos: o layout fica
 * montado ao navegar (link do manual, voltar do navegador), e um <dialog> modal aberto cobriria a tela seguinte.
 * Sem efeito que muda estado: o que depende da rota, da busca ou do layout é derivado no render.
 *
 * Plano 26 (RE-D42): por papel. A recepção vê só os guias dela (`guiaDaRota(caminho, papel)`), e o tour que abre sozinho no
 * Início é o `recepcao-inicio`, nunca o `boas-vindas` (`ID_TOUR_DO_INICIO`); o `?tour=` reabre o do papel.
 */
export function GuiaDoPainel({ progresso: inicial, papel }: { progresso: ProgressoGuia; papel: PapelDoGuia }) {
  const caminho = usePathname();
  const busca = useSearchParams().toString();
  const router = useRouter();
  const guia = guiaDaRota(caminho, papel);
  const boasVindas = GUIAS.find((g) => g.id === ID_TOUR_DO_INICIO[papel])!;
  const [progresso, setProgresso] = useState<ProgressoGuia>(inicial);
  const [tourManual, setTourManual] = useState<{ guia: Guia; em: string } | null>(null);
  const [gavetaEm, setGavetaEm] = useState<string | null>(null);
  // um id por aviso dispensado: dispensar numa tela não esconde o aviso das outras
  const [avisosFechados, setAvisosFechados] = useState<ReadonlySet<string>>(() => new Set());
  // fechar o tour do ?tour= marca o progresso antes de o router.replace tirar o parâmetro: sem isto, ele reabriria no
  // meio-tempo. Volta a valer quando a busca muda (o "Rever o tour" de novo depois do replace)
  const [paramFechado, setParamFechado] = useState(false);

  // valores do render anterior (padrão do React para ajustar estado quando uma prop muda, sem efeito)
  const [anterior, setAnterior] = useState({ inicial, guia, busca, caminho });
  if (anterior.inicial !== inicial || anterior.guia !== guia || anterior.busca !== busca || anterior.caminho !== caminho) {
    setAnterior({ inicial, guia, busca, caminho });
    // o tour aberto à mão e a gaveta valem para a visita à tela: saiu (menu, voltar do navegador), fecharam — voltar à
    // mesma tela não os reabre sozinhos (D27)
    if (anterior.caminho !== caminho) {
      setTourManual(null);
      setGavetaEm(null);
    }
    // um render novo do layout (recarregar, ação que revalida) traz o valor do servidor; o local, mais novo, prevalece
    if (anterior.inicial !== inicial) setProgresso((local) => ({ ...inicial, ...local }));
    // ao sair da tela, o "visto" (já gravado no servidor) entra no estado local: voltar a ela pelo menu não mostra o aviso de novo
    const a = anterior.guia;
    if (a !== guia && a && a.id !== boasVindas.id) setProgresso((p) => aplicarMarca(p, a.id, a.versao, 'visto'));
    if (anterior.busca !== busca) setParamFechado(false);
  }

  const noInicio = caminho === '/painel';
  const pedidoNaUrl = noInicio && !paramFechado && new URLSearchParams(busca).get('tour') === boasVindas.id;
  const tour =
    (tourManual?.em === caminho ? tourManual.guia : null) ??
    (pedidoNaUrl || (noInicio && precisaDoGuia(progresso, boasVindas, ['concluido', 'dispensado'])) ? boasVindas : null);

  const marcar = (g: Guia, estado: EstadoGuia) => {
    setProgresso((p) => aplicarMarca(p, g.id, g.versao, estado));
    gravar(g, estado);
  };
  const fecharAviso = (id: string) => setAvisosFechados((f) => new Set(f).add(id));
  const abrirTour = (g: Guia) => setTourManual({ guia: g, em: caminho });

  const mostrarAviso = !!guia && guia.id !== boasVindas.id && !avisosFechados.has(guia.id) && precisaDoGuia(progresso, guia, ['concluido', 'dispensado', 'visto']);
  useEffect(() => {
    // D27: o aviso aparece uma vez. Marca no servidor sem tirar o aviso desta visita (ele some ao dispensar ou ao navegar)
    if (mostrarAviso && guia) gravar(guia, 'visto');
  }, [mostrarAviso, guia]);

  return (
    <>
      <button type="button" data-guia="ajuda" aria-label="Ajuda desta tela" title="Ajuda" onClick={() => setGavetaEm(caminho)} className="grid size-11 place-items-center rounded-full border border-borda bg-cartao font-titulo text-lg font-bold text-texto hover:bg-linha">
        ?
      </button>
      <GavetaAjuda
        guia={guia}
        aberta={gavetaEm === caminho}
        aoFechar={() => setGavetaEm(null)}
        verTour={() => {
          setGavetaEm(null);
          if (guia) abrirTour(guia);
        }}
      />
      {tour && (
        <Tour
          key={tour.id}
          guia={tour}
          aberto
          aoMarcar={(estado) => marcar(tour, estado)}
          aoFechar={() => {
            setTourManual(null);
            if (pedidoNaUrl) {
              setParamFechado(true);
              router.replace(caminho);
            }
          }}
        />
      )}
      {mostrarAviso && guia && !tour && (
        <aside aria-label="Dica" className="fixed right-4 bottom-4 z-20 flex max-w-sm flex-wrap items-center gap-2 rounded-2xl border border-borda bg-cartao p-3 text-texto shadow-lg">
          <span>Primeira vez aqui?</span>
          <button
            type="button"
            onClick={() => {
              fecharAviso(guia.id);
              abrirTour(guia);
            }}
            className="inline-flex min-h-11 items-center rounded-full bg-destaque px-4 font-semibold text-white"
          >
            Ver como funciona
          </button>
          <button type="button" onClick={() => fecharAviso(guia.id)} className="inline-flex min-h-11 items-center px-2 text-link underline">Dispensar</button>
        </aside>
      )}
    </>
  );
}
