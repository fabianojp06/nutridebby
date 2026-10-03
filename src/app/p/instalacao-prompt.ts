/**
 * US-040 (Android): o `beforeinstallprompt` dispara uma vez por carga de página, quando o Chrome decide — muitas vezes
 * antes de o Início montar (o login chega a /p/inicio pela navegação do roteador). O ouvinte fica neste módulo, carregado
 * pelo layout do portal (sw-provider.tsx), e guarda o evento; o botão "Instalar app" só lê o que ficou guardado.
 */
export type PromptDeInstalacao = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

type EstadoDoPrompt = { prompt: PromptDeInstalacao | null; instalado: boolean };
/** Objeto trocado a cada mudança (snapshot do useSyncExternalStore: a mesma referência enquanto nada muda). */
let estado: EstadoDoPrompt = { prompt: null, instalado: false };
const ouvintes = new Set<() => void>();
const mudar = (novo: EstadoDoPrompt) => {
  estado = novo;
  ouvintes.forEach((f) => f());
};

/** Registra os ouvintes na janela (uma vez, na carga do módulo; exportado para o teste). */
export function ouvirInstalacao(alvo: EventTarget): void {
  alvo.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // guarda o evento: o prompt só abre no clique do botão
    mudar({ ...estado, prompt: e as PromptDeInstalacao });
  });
  alvo.addEventListener('appinstalled', () => mudar({ prompt: null, instalado: true }));
}

if (typeof window !== 'undefined') ouvirInstalacao(window);

export function estadoDoPrompt(): EstadoDoPrompt {
  return estado;
}

/** O prompt nativo só pode ser usado uma vez: depois do clique, some. */
export function promptUsado(): void {
  mudar({ ...estado, prompt: null });
}

export function assinarInstalacao(cb: () => void): () => void {
  ouvintes.add(cb);
  return () => void ouvintes.delete(cb);
}
