import type { EstadoGuia, ProgressoGuia } from '@/modules/plataforma/preferencias-tipos';

/**
 * true = ainda não está em nenhum dos `estados` na versão atual. P08-13: num módulo à parte (reexportado por `conteudo.ts`),
 * para o portal não levar ao navegador os textos dos guias do painel (GUIAS).
 */
export function precisaDoGuia(p: ProgressoGuia, g: { id: string; versao: number }, estados: EstadoGuia[]): boolean {
  const r = p[g.id];
  return !r || r.v < g.versao || !estados.includes(r.estado);
}
