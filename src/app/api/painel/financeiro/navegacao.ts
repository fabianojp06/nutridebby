import { DPA_PATH, type ApiNutri } from '@/lib/tenant-session';

/**
 * Os downloads do CSV (US-306, §4.1) são navegação (link e formulário GET de Relatórios), não `fetch`: a nutricionista
 * nunca vê JSON. Sem sessão → login com a volta para Relatórios; DPA pendente → /painel/dpa (o destino de requireNutri).
 * Papel errado (paciente, admin) fica no 403 JSON de sempre (guarda `acesso-negado.test.ts`). A decisão vem do `motivo`
 * de `requireApiNutri`, nunca do corpo da resposta.
 */
export const RELATORIOS = '/painel/financeiro/relatorios';

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

/**
 * RN-321 / DPA cl. 6 e 12: o download grava `exportar` em nome da nutricionista, e o cookie da sessão (SameSite=Lax) vai
 * junto numa navegação de primeiro nível vinda de outro site. Só segue o pedido feito na própria origem (o link e o
 * formulário de Relatórios: `same-origin`) ou digitado na barra de endereço (`none`). Outro site, um subdomínio
 * (`same-site`) ou cabeçalho ausente (o mesmo critério estrito de `src/app/sair/route.ts`) → 303 para Relatórios, sem ler
 * nem gravar nada. A rota chama depois da guarda de papel (o 403 JSON de `acesso-negado.test.ts`) e antes do módulo.
 */
export function downloadDoMesmoSite(req: Request): boolean {
  const site = req.headers.get('sec-fetch-site');
  return site === 'same-origin' || site === 'none';
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
