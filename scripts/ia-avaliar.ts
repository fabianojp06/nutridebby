import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { avaliar } from '@/modules/ia/avaliacao/avaliar';
import { MODELOS_IA, type ModeloIA } from '@/modules/ia/constantes';
import { provedorAnthropic } from '@/modules/ia/provedor-anthropic';

/**
 * `pnpm ia:avaliar` — A-D2 / RN-127. ÚNICO lugar fora do worker que chama a API real, e só à mão: exige IA_AVALIACAO=1 e
 * a chave do workspace de DEV (A-D16) em ANTHROPIC_API_KEY; recusa produção, pasta dentro do repositório e teto acima de
 * US$ 10. Só laudos fictícios (pnpm ia:laudos). Nunca roda no CI (não está em pnpm test).
 */
const falhar = (msg: string): never => {
  console.error(msg);
  process.exit(1);
};
if (process.env.IA_AVALIACAO !== '1') falhar('Defina IA_AVALIACAO=1 para rodar a avaliação (ela chama a API e tem custo).');
if (process.env.NODE_ENV === 'production') falhar('A avaliação não roda em produção.');
const chave = process.env.ANTHROPIC_API_KEY ?? '';
if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(chave)) falhar('ANTHROPIC_API_KEY ausente ou em formato inválido (use a chave do workspace de dev).');
const dir = path.resolve(process.env.IA_AVALIACAO_DIR ?? '../nutridebby-avaliacao-ia');
const raiz = path.resolve('.');
if (dir === raiz || dir.startsWith(raiz + path.sep)) falhar('IA_AVALIACAO_DIR precisa ficar fora do repositório.');
const modelos = (process.env.IA_AVALIACAO_MODELOS ?? MODELOS_IA.join(',')).split(',').map((m) => m.trim()) as ModeloIA[];
if (!modelos.length || modelos.some((m) => !(MODELOS_IA as readonly string[]).includes(m))) falhar(`IA_AVALIACAO_MODELOS: só ${MODELOS_IA.join(', ')}.`);
const tetoUsd = Number(process.env.IA_AVALIACAO_TETO_USD ?? '10');
if (!Number.isFinite(tetoUsd) || tetoUsd <= 0 || tetoUsd > 10) falhar('IA_AVALIACAO_TETO_USD deve ser maior que 0 e no máximo 10 (A-D2).');
const esforco = process.env.IA_AVALIACAO_ESFORCO === 'medium' ? 'medium' : 'low';

const r = await avaliar({ dir, modelos, tetoMicroUsd: Math.round(tetoUsd * 1_000_000), esforco, geo: 'us', provedor: provedorAnthropic({ apiKey: chave }) });
const arquivo = path.join(dir, `relatorio-${r.geradoEm.replace(/[:.]/g, '-')}.json`);
await writeFile(arquivo, JSON.stringify(r, null, 2));
const usd = (micro: number) => `US$ ${(micro / 1_000_000).toFixed(4)}`;
console.table(
  r.porModelo.map((m) => ({
    modelo: m.modelo, laudos: m.laudos, precisao: `${(m.precisao * 100).toFixed(1)}%`, inventados: m.inventados, documentosErrados: m.documentosErrados,
    injecaoVazou: m.injecaoVazou, rn123: m.violacoesRn123, recusas: JSON.stringify(m.recusas), invalidas: m.invalidas, erros: JSON.stringify(m.errosDoProvedor),
    custoMedio: usd(m.custoMedioMicroUsd), custoMaximo: usd(m.custoMaximoMicroUsd), reservaPdf: usd(m.reservaPdfMicroUsd), tempoMedio: `${m.tempoMedioMs} ms`, tempoMaximo: `${m.tempoMaximoMs} ms`,
  })),
);
console.info(`Gasto real: ${usd(r.gastoRealMicroUsd)} (máximo reservado ${usd(r.gastoMaximoMicroUsd)} de ${usd(r.tetoMicroUsd)})${r.parouPeloTeto ? ' — PAROU PELO TETO' : ''}. Relatório: ${arquivo}`);
