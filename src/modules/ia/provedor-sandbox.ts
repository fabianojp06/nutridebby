import { createHash } from 'node:crypto';
import type { PedidoLeitura, ProvedorIA, RespostaLeitura } from './provedor';

/**
 * RNF-107: respostas fixas, sem rede e sem custo real, para dev, CI e o E2E (US-111: série existente, ambíguo, não
 * numérico, milhar e decimal, data da coleta). Os nomes são de laudo fictício; nada vem do arquivo.
 */
export const RESPOSTA_SANDBOX = {
  documento_reconhecido: true,
  data_coleta: '2026-08-28',
  marcadores: [
    { nome_no_laudo: 'Glicose de jejum', valor_texto: '92', unidade: 'mg/dL', referencia: '70 a 99', pagina: 1 },
    { nome_no_laudo: 'Colesterol total', valor_texto: '190', unidade: 'mg/dL', referencia: 'Desejável: < 190', pagina: 1 },
    { nome_no_laudo: 'Plaquetas', valor_texto: '250.000', unidade: '/mm³', referencia: '150.000 a 450.000', pagina: 1 },
    { nome_no_laudo: 'Ferritina', valor_texto: '1.234,5', unidade: 'ng/mL', referencia: '30 a 400', pagina: 1 },
    { nome_no_laudo: 'Creatinina', valor_texto: '0,85', unidade: 'mg/dL', referencia: '0,6 a 1,1', pagina: 1 },
    { nome_no_laudo: 'HBsAg', valor_texto: 'Não reagente', unidade: null, referencia: 'Não reagente', pagina: 1 },
  ],
} as const;

export function provedorSandbox(): ProvedorIA {
  return {
    nome: 'sandbox',
    async lerDocumento(p: PedidoLeitura): Promise<RespostaLeitura> {
      const id = createHash('sha256').update(p.arquivo.base64).digest('hex').slice(0, 12);
      return { tipo: 'ok', texto: JSON.stringify(RESPOSTA_SANDBOX), uso: { entrada: 8000, cacheLeitura: 0, cacheGravacao: 0, saida: 900, geo: p.geo }, requestId: `sandbox-${id}` };
    },
  };
}
