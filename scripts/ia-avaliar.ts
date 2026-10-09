import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { avaliar } from '@/modules/ia/avaliacao/avaliar';
import { MODELOS_BEDROCK_EU, MODELOS_IA, REGIOES_BEDROCK_EU, type ModeloIA, type RegiaoBedrock } from '@/modules/ia/constantes';
import type { ProvedorIA } from '@/modules/ia/provedor';
import { provedorAnthropic } from '@/modules/ia/provedor-anthropic';
import { provedorBedrock } from '@/modules/ia/provedor-bedrock';

/**
 * `pnpm ia:avaliar` — A-D2 / RN-127. ÚNICO lugar fora do worker que chama a API real, e só à mão: exige IA_AVALIACAO=1 e
 * a chave do workspace de DEV (A-D16) em ANTHROPIC_API_KEY; recusa produção, pasta dentro do repositório e teto acima de
 * US$ 10. Só laudos fictícios (pnpm ia:laudos). Nunca roda no CI (não está em pnpm test). Plano 14A (RN-127, INT-08):
 * IA_AVALIACAO_PROVEDOR=bedrock-eu avalia o perfil eu. do Bedrock, com as chaves de um usuário IAM de DEV.
 */
const falhar = (msg: string): never => {
  console.error(msg);
  process.exit(1);
};
if (process.env.IA_AVALIACAO !== '1') falhar('Defina IA_AVALIACAO=1 para rodar a avaliação (ela chama a API e tem custo).');
if (process.env.NODE_ENV === 'production') falhar('A avaliação não roda em produção.');
const dir = path.resolve(process.env.IA_AVALIACAO_DIR ?? '../nutridebby-avaliacao-ia');
const raiz = path.resolve('.');
if (dir === raiz || dir.startsWith(raiz + path.sep)) falhar('IA_AVALIACAO_DIR precisa ficar fora do repositório.');
const tetoUsd = Number(process.env.IA_AVALIACAO_TETO_USD ?? '10');
if (!Number.isFinite(tetoUsd) || tetoUsd <= 0 || tetoUsd > 10) falhar('IA_AVALIACAO_TETO_USD deve ser maior que 0 e no máximo 10 (A-D2).');
const esforco = process.env.IA_AVALIACAO_ESFORCO === 'medium' ? 'medium' : 'low';
const qual = process.env.IA_AVALIACAO_PROVEDOR ?? 'anthropic';
if (qual !== 'anthropic' && qual !== 'bedrock-eu') falhar('IA_AVALIACAO_PROVEDOR: anthropic ou bedrock-eu.');
let provedor: ProvedorIA;
let geo: 'us' | 'eu';
let permitidos: readonly ModeloIA[];
if (qual === 'bedrock-eu') {
  // Plano 14A (RN-127, INT-08): a leitura de novo com o perfil eu. — chaves de um usuário IAM de DEV (o script não distingue
  // de produção: conferir no console da AWS antes de rodar, como a chave da Anthropic); só a região da UE da lista
  const ak = process.env.AWS_ACCESS_KEY_ID ?? '';
  const sk = process.env.AWS_SECRET_ACCESS_KEY ?? '';
  const regiao = process.env.IA_BEDROCK_REGIAO ?? '';
  if (!/^AKIA[A-Z0-9]{16}$/.test(ak) || !/^[A-Za-z0-9/+=]{40}$/.test(sk)) falhar('AWS_ACCESS_KEY_ID e AWS_SECRET_ACCESS_KEY ausentes ou em formato inválido (use o usuário IAM de dev).');
  if (!(REGIOES_BEDROCK_EU as readonly string[]).includes(regiao)) falhar(`IA_BEDROCK_REGIAO: ${REGIOES_BEDROCK_EU.join(', ')}.`);
  for (const v of ['AWS_BEARER_TOKEN_BEDROCK', 'AWS_SESSION_TOKEN', 'AWS_PROFILE', 'ANTHROPIC_BEDROCK_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS']) if (process.env[v]) falhar(`${v} não pode estar definida (RNF-103).`);
  provedor = provedorBedrock({ regiao: regiao as RegiaoBedrock, accessKeyId: ak, secretAccessKey: sk });
  geo = 'eu';
  permitidos = MODELOS_BEDROCK_EU;
} else {
  const chave = process.env.ANTHROPIC_API_KEY ?? '';
  if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(chave)) falhar('ANTHROPIC_API_KEY ausente ou em formato inválido (use a chave do workspace de dev).');
  provedor = provedorAnthropic({ apiKey: chave });
  geo = 'us';
  permitidos = MODELOS_IA;
}
const modelos = (process.env.IA_AVALIACAO_MODELOS ?? permitidos.join(',')).split(',').map((m) => m.trim()) as ModeloIA[];
if (!modelos.length || modelos.some((m) => !permitidos.includes(m))) falhar(`IA_AVALIACAO_MODELOS: só ${permitidos.join(', ')}.`);

const r = await avaliar({ dir, modelos, tetoMicroUsd: Math.round(tetoUsd * 1_000_000), esforco, geo, provedor });
const arquivo = path.join(dir, `relatorio-${r.geradoEm.replace(/[:.]/g, '-')}.json`);
await writeFile(arquivo, JSON.stringify(r, null, 2));
const usd = (micro: number) => `US$ ${(micro / 1_000_000).toFixed(4)}`;
console.table(
  r.porModelo.map((m) => ({
    modelo: m.modelo, laudos: m.laudos, precisao: `${(m.precisao * 100).toFixed(1)}%`, inventados: m.inventados, documentosErrados: m.documentosErrados,
    injecaoVazou: m.injecaoVazou, rn123: m.violacoesRn123, recusas: JSON.stringify(m.recusas), invalidas: m.invalidas, erros: JSON.stringify(m.errosDoProvedor),
    custoMedio: usd(m.custoMedioMicroUsd), custoMaximo: usd(m.custoMaximoMicroUsd), acimaDoTeto: m.acimaDoTetoDasPaginas, custoSobreTeto: m.maiorRazaoCustoTeto,
    entradaPorPagina: m.maiorEntradaPorPaginaPdf, entradaImagem: m.maiorEntradaPorImagem, entradaAcima: m.entradaAcimaDaEstimativa, entradaSobreEstimativa: m.maiorRazaoEntradaEstimativa,
    reservaPdf: usd(m.reservaPdfMicroUsd), reservaImagem: usd(m.reservaImagemMicroUsd), tempoMedio: `${m.tempoMedioMs} ms`, tempoMaximo: `${m.tempoMaximoMs} ms`,
  })),
);
console.info(
  `Estimativa sem count_tokens (D2): ${r.estimativa.tokensPorPagina} tokens/página de PDF, ${r.estimativa.tokensPorImagem} por imagem, ${r.estimativa.tokensInstrucoes} de instruções. ` +
    'acimaDoTeto/custoSobreTeto > 1 ou entradaAcima > 0: a estimativa não segurou — rever TOKENS_POR_PAGINA_TETO antes de liberar.',
);
console.info(`Gasto real: ${usd(r.gastoRealMicroUsd)} (máximo reservado ${usd(r.gastoMaximoMicroUsd)} de ${usd(r.tetoMicroUsd)})${r.parouPeloTeto ? ' — PAROU PELO TETO' : ''}. Relatório: ${arquivo}`);
