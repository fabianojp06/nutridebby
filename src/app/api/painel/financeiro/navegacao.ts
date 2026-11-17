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

/** RN-321: o arquivo como anexo, sem cache. `nome` é montado pela rota com datas e ano já validados. */
export const arquivoCsv = (conteudo: string, nome: string) =>
  new Response(conteudo, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${nome}"`,
      'cache-control': 'no-store',
    },
  });
