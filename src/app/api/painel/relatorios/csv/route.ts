import { ACESSO_DA_NUTRI, BASE, filtroDaUrl, navegacaoDaPropriaOrigem, ROTA_DA_SECAO, secaoDaUrl, urlDaSecao } from '@/app/painel/relatorios/url';
import { getEnv } from '@/env';
import { logger, nomeDoErro } from '@/lib/logger';
import { DPA_PATH, requireApiNutri } from '@/lib/tenant-session';
import { podeVerSecao } from '@/modules/relatorios/acesso';
import { linhasCsv, montarCsv, nomeDoArquivo } from '@/modules/relatorios/csv';
import { lerSecao } from '@/modules/relatorios/leitura';
import { exportacaoNaLeitura } from '@/modules/relatorios/registro';
import { arquivoCsv, irPara, semHead } from '../../financeiro/navegacao';

export const dynamic = 'force-dynamic';

/**
 * Plano 26, T3 (US-487, RN-493, RN-494): `GET ?secao=…&de=AAAA-MM&ate=AAAA-MM[&por=consultas|receita]`. O download é
 * navegação (o link "Baixar CSV"), nunca `fetch`: sem sessão → login com a volta para a seção; DPA pendente → /painel/dpa;
 * papel errado (paciente, admin) → o 403 JSON de sempre (`acesso-negado.test.ts`). Pedido de outro site, ou sem como
 * confirmar a origem → 303 para a seção, sem ler nem gravar (o `exportar` sai em nome da nutricionista). Seção
 * desconhecida → os Relatórios; não permitida (RN-480) → 403 por enquanto (a T6 troca pelo 303 a "Sem permissão");
 * período inválido → a seção com `?erro=periodo`. A leitura, o `exportar` (agregado: um sem paciente; Ranking: um por
 * paciente da lista) e a montagem do arquivo ficam na mesma transação: se a montagem falhar, o registro volta junto. O
 * erro vai ao log só com o código, a seção e o nome do erro (RN-497, RNF-482).
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const secao = secaoDaUrl(sp.get('secao'));
  const voltaDaSecao = secao ? ROTA_DA_SECAO[secao] : BASE;
  const acesso = await requireApiNutri(req);
  if (!acesso.ok) {
    if (acesso.motivo === 'sem_sessao') return irPara(`/entrar?volta=${encodeURIComponent(voltaDaSecao)}`);
    if (acesso.motivo === 'dpa_pendente') return irPara(DPA_PATH);
    return acesso.response;
  }
  if (!navegacaoDaPropriaOrigem(req.headers, getEnv().APP_URL)) return irPara(voltaDaSecao);
  if (!secao) return irPara(BASE);
  if (!podeVerSecao(ACESSO_DA_NUTRI, secao)) return Response.json({ erro: 'Acesso negado' }, { status: 403, headers: { 'cache-control': 'no-store' } });
  const filtro = filtroDaUrl(sp, new Date(), acesso.tenant.fuso);
  if (filtro.erro) return irPara(urlDaSecao(secao, { erro: 'periodo' }));
  if (!filtro.porValido) return irPara(voltaDaSecao);
  const { periodo, por } = filtro;
  const registrar = exportacaoNaLeitura(secao, periodo, null);
  let arquivo = '';
  try {
    await lerSecao(
      secao,
      acesso.ctx,
      acesso.tenant,
      periodo,
      { acesso: ACESSO_DA_NUTRI, localId: null, por },
      {
        naMesmaTransacao: async (tx, dados) => {
          await registrar(tx, dados);
          arquivo = montarCsv(linhasCsv(secao, dados));
        },
      },
    );
  } catch (e) {
    logger.error({ codigo: 'relatorios_csv_falhou', secao, motivo: nomeDoErro(e) }, 'relatórios: o CSV falhou');
    return new Response(null, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
  return arquivoCsv(arquivo, nomeDoArquivo(secao, periodo, por));
}

export async function HEAD() {
  return semHead();
}
