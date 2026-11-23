import { getEnv } from '@/env';
import { DPA_PATH, type ApiNutri } from '@/lib/tenant-session';

/**
 * Os downloads do CSV (US-306, §4.1) são navegação (link e formulário GET de Relatórios), não `fetch`: a nutricionista
 * nunca vê JSON. Sem sessão → login com a volta para Relatórios; DPA pendente → /painel/dpa (o destino de requireNutri).
 * Papel errado (paciente, admin) fica no 403 JSON de sempre (guarda `acesso-negado.test.ts`). A decisão vem do `motivo`
 * de `requireApiNutri`, nunca do corpo da resposta.
 */
export const RELATORIOS = '/painel/financeiro/relatorios';

/** Os dois downloads de Relatórios: cada um leva o erro de origem para junto do próprio controle (o formulário ou o link). */
export type CsvDeRelatorios = 'lancamentos' | 'fluxo';
/** `?erro=origem` na volta: sem `csv`, o do formulário dos lançamentos; `csv=fluxo`, o do link do fluxo de caixa. */
export const ERRO_DE_ORIGEM: Record<CsvDeRelatorios, string> = {
  lancamentos: `${RELATORIOS}?erro=origem`,
  fluxo: `${RELATORIOS}?erro=origem&csv=fluxo`,
};

export const irPara = (destino: string) => new Response(null, { status: 303, headers: { location: destino, 'cache-control': 'no-store' } });

export function recusaNaNavegacao(acesso: Extract<ApiNutri, { ok: false }>): Response {
  switch (acesso.motivo) {
    case 'sem_sessao':
      return irPara(`/entrar?volta=${encodeURIComponent(RELATORIOS)}`);
    case 'dpa_pendente':
      return irPara(DPA_PATH);
    case 'papel':
      return acesso.response;
  }
}

/** A origem da aplicação (APP_URL, o mesmo critério de `src/app/sair/route.ts`) é a de `valor`? URL inválida → não. */
function mesmaOrigem(valor: string): boolean {
  if (!URL.canParse(valor)) return false;
  return new URL(valor).origin === new URL(getEnv().APP_URL).origin;
}

/**
 * RN-321 / DPA cl. 6 e 12: o download grava `exportar` em nome da nutricionista, e o cookie da sessão (SameSite=Lax) vai
 * junto numa navegação de primeiro nível vinda de outro site. Só segue o pedido feito na própria origem (o link e o
 * formulário de Relatórios: `same-origin`) ou digitado na barra de endereço (`none`). Outro site ou um subdomínio
 * (`same-site`) → 303 para Relatórios. Sem o cabeçalho (Safari antes do 16.4, proxies que o tiram): segue só se `Origin`
 * — ou, sem ele, `Referer` (a política padrão manda a URL inteira na mesma origem) — for a origem do APP_URL; senão, 303
 * para Relatórios com `?erro=origem` (`ERRO_DE_ORIGEM[csv]`: a página diz o que fazer junto do botão ou do link que a
 * nutricionista usou e leva o foco a ele, em vez de falhar calada). Nos dois 303 nada é lido nem
 * gravado. Devolve `null` quando o pedido segue. A rota chama depois da guarda de papel (o 403 JSON de
 * `acesso-negado.test.ts`) e antes do módulo.
 */
export function recusaDeOrigem(req: Request, csv: CsvDeRelatorios): Response | null {
  const site = req.headers.get('sec-fetch-site');
  if (site === 'same-origin' || site === 'none') return null;
  if (site !== null) return irPara(RELATORIOS);
  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');
  const confirmada = origin !== null ? mesmaOrigem(origin) : referer !== null && mesmaOrigem(referer);
  return confirmada ? null : irPara(ERRO_DE_ORIGEM[csv]);
}

/**
 * O HEAD que o Next monta sozinho chama o GET (gravaria `exportar` e montaria o arquivo sem download): as rotas dos CSV
 * exportam HEAD com 405, sem tocar o banco.
 */
export const semHead = () => new Response(null, { status: 405, headers: { allow: 'GET', 'cache-control': 'no-store' } });

/** RN-321: o arquivo como anexo, sem cache. `nome` é montado pela rota com datas e ano já validados. */
export const arquivoCsv = (conteudo: string, nome: string) =>
  new Response(conteudo, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${nome}"`,
      'cache-control': 'no-store',
    },
  });
