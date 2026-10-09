import Anthropic from '@anthropic-ai/sdk';
import { ErroProvedor, type PedidoLeitura, type ProvedorIA, type RespostaLeitura, type UsoTokens } from './provedor';

/**
 * INT-07 (spec v0.3): o ÚNICO arquivo que importa o SDK (RNF-103; guarda em guardas.test.ts). Só o worker o alcança.
 * Só messages.create, com o laudo inline em base64 (elegível à ZDR, §5.2) — sem count_tokens (o laudo sairia duas vezes).
 * logLevel 'off', baseURL explícito e authToken null: ANTHROPIC_LOG/ANTHROPIC_BASE_URL/ANTHROPIC_AUTH_TOKEN do ambiente não
 * mudam o comportamento. maxRetries 0: as novas tentativas são do pg-boss, pela RN-105 — o SDK repetiria um tempo
 * esgotado e cobraria de novo sem aparecer na reserva. O timeout do SDK TypeScript é em MILISSEGUNDOS. Nenhum erro sai daqui com o texto do provedor (que pode ecoar
 * o pedido): só ErroProvedor { tipo, status, requestId }.
 */
export const TIMEOUT_MS = 120_000;
const BASE_URL = 'https://api.anthropic.com';
/** D4 / R-116: a API direta aceita pedido de até 32 MB (base64 do arquivo + instruções). */
export const LIMITE_PEDIDO_ANTHROPIC_BYTES = 32 * 1024 * 1024;
/** Códigos do Node em que a requisição nem saiu (RN-105: dá para repetir). */
const ANTES_DO_ENVIO = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);

function conteudo(p: PedidoLeitura): Anthropic.MessageParam[] {
  const bloco: Anthropic.ContentBlockParam =
    p.arquivo.tipo === 'pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: p.arquivo.base64 } }
      : { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: p.arquivo.base64 } };
  return [{ role: 'user', content: [bloco, { type: 'text', text: p.instrucao }] }];
}

function codigoDaCausa(err: unknown): string | undefined {
  let c: unknown = err;
  for (let i = 0; i < 4 && c; i++) {
    const codigo = (c as { code?: unknown }).code;
    if (typeof codigo === 'string') return codigo;
    c = (c as { cause?: unknown }).cause;
  }
  return undefined;
}

/** RN-105 / D4: o que o worker faz com cada erro. Exportada para o teste. */
export function classificarErro(err: unknown): ErroProvedor {
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new ErroProvedor('incerto', null, null);
  if (err instanceof Anthropic.APIConnectionError) {
    const codigo = codigoDaCausa(err);
    return new ErroProvedor(codigo && ANTES_DO_ENVIO.has(codigo) ? 'nao_enviado' : 'incerto', null, null);
  }
  if (err instanceof Anthropic.APIError) {
    const status = typeof err.status === 'number' ? err.status : null;
    const requestId = err.requestID ?? null;
    const corpo = err.error as { error?: { message?: unknown; details?: { error_code?: unknown } } } | undefined;
    const codigo = corpo?.error?.details?.error_code;
    const mensagem = typeof corpo?.error?.message === 'string' ? corpo.error.message : '';
    if (status === 429 && codigo === 'enforced_spend_limit_reached') return new ErroProvedor('limite_de_gasto', status, requestId);
    // limite de gasto definido pelo dono no Console (A-D16): a API devolve 400 com esta frase (documentação de erros, 06/10/2026)
    if (status === 400 && /reached your specified (workspace )?API usage limits/i.test(mensagem)) return new ErroProvedor('limite_de_gasto', status, requestId);
    if (status === 401 || status === 402 || status === 403) return new ErroProvedor('credencial', status, requestId);
    if (status === 413) return new ErroProvedor('grande_demais', status, requestId);
    if (status === 429 || status === 500 || status === 529) return new ErroProvedor('repetir', status, requestId);
    if (status !== null && status >= 400 && status < 500) return new ErroProvedor('pedido_invalido', status, requestId);
    return new ErroProvedor('incerto', status, requestId); // 504 e outros 5xx: pode ter sido processado
  }
  return new ErroProvedor('incerto', null, null);
}

function usoDe(u: Anthropic.Usage): UsoTokens {
  const geo = (u as { inference_geo?: unknown }).inference_geo;
  return {
    entrada: u.input_tokens,
    cacheLeitura: u.cache_read_input_tokens ?? 0,
    cacheGravacao: u.cache_creation_input_tokens ?? 0,
    saida: u.output_tokens,
    geo: typeof geo === 'string' ? geo : null,
  };
}

export function provedorAnthropic(o: { apiKey: string; fetch?: typeof fetch; baseURL?: string; timeoutMs?: number }): ProvedorIA {
  const cliente = new Anthropic({ apiKey: o.apiKey, authToken: null, maxRetries: 0, timeout: o.timeoutMs ?? TIMEOUT_MS, logLevel: 'off', baseURL: o.baseURL ?? BASE_URL, ...(o.fetch ? { fetch: o.fetch } : {}) });
  return {
    nome: 'anthropic',
    destino: 'anthropic-us',
    limitePedidoBytes: LIMITE_PEDIDO_ANTHROPIC_BYTES,
    async lerDocumento(p): Promise<RespostaLeitura> {
      // D5: a região `eu` é do Bedrock; a API direta só tem `us`/`global` — nada sai com outra
      if (p.geo === 'eu') throw new ErroProvedor('pedido_invalido', null, null);
      // o SDK devolve a mensagem com o `_request_id` (WithRequestID<Message>, não exportado pelo índice do SDK)
      let r: Anthropic.Message & { _request_id?: string | null };
      try {
        r = await cliente.messages.create({
          model: p.modelo,
          max_tokens: p.maxTokens,
          system: p.sistema,
          messages: conteudo(p),
          inference_geo: p.geo,
          output_config: { effort: p.esforco, format: { type: 'json_schema', schema: p.schema } },
        });
      } catch (err) {
        throw classificarErro(err);
      }
      const uso = usoDe(r.usage);
      const requestId = r._request_id ?? null;
      if (r.stop_reason === 'refusal') return { tipo: 'recusa', categoria: r.stop_details?.category ?? null, uso, requestId };
      if (r.stop_reason !== 'end_turn') return { tipo: 'cortada', uso, requestId };
      const texto = r.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
      return { tipo: 'ok', texto, uso, requestId };
    },
  };
}
