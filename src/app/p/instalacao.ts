export type EstadoInstalacao = 'instalado' | 'android' | 'ios' | 'nada';

/** O iPadOS se apresenta como Mac ("MacIntel"); a tela de toque o denuncia. */
export function ehIos(ua: string, plataforma: string, toques: number): boolean {
  return /iPhone|iPad|iPod/.test(ua) || (plataforma === 'MacIntel' && toques > 1);
}

/**
 * US-040: no Chrome (Android), o botão "Instalar app" chama o prompt nativo (`beforeinstallprompt`); no Safari do iOS,
 * que não tem prompt, o tutorial "Compartilhar → Adicionar à Tela de Início". Instalado (standalone) → nada.
 */
export function estadoDeInstalacao(o: { ua: string; standalone: boolean; temPrompt: boolean; toques: number; plataforma: string }): EstadoInstalacao {
  if (o.standalone) return 'instalado';
  if (o.temPrompt) return 'android';
  if (ehIos(o.ua, o.plataforma, o.toques)) return 'ios';
  return 'nada';
}
