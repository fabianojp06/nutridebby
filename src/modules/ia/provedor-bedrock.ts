import { AnthropicBedrock } from '@anthropic-ai/bedrock-sdk';
// a raiz do SDK do Bedrock 0.34.4 não reexporta as classes de erro; o `core/error` dele reexporta as do @anthropic-ai/sdk
// (versão única no lockfile: o `instanceof` vale para o erro que o cliente lança)
import { APIConnectionError, APIConnectionTimeoutError, APIError } from '@anthropic-ai/bedrock-sdk/core/error';
import type { ModeloIA, RegiaoBedrock, RegiaoIA } from './constantes';
import { ErroProvedor, type PedidoGeracao, type PedidoLeitura, type ProvedorIA, type RespostaGeracao, type RespostaLeitura, type TurnoIA, type UsoTokens } from './provedor';

/**
 * INT-08 (Plano 14A, A-D26): o ÚNICO arquivo que importa o SDK do Bedrock (RNF-103; guarda em guardas.test.ts). Só o worker
 * o alcança. Cliente `AnthropicBedrock` (InvokeModel, D1) com o perfil de inferência geográfico `eu.`: o pedido é atendido só
 * em regiões da UE (destinos conferidos por GetInferenceProfile no runbook). Tudo explícito no construtor (D2): região,
 * baseURL, as duas chaves, `awsSessionToken: null` e `apiKey: null` — sem isso, AWS_BEARER_TOKEN_BEDROCK do ambiente venceria
 * as chaves e AWS_REGION/ANTHROPIC_BEDROCK_BASE_URL mudariam o destino; com as chaves explícitas, a cadeia de credenciais
 * da AWS (AWS_PROFILE, SSO, IMDS) nunca é consultada. `maxRetries: 0`: as novas tentativas são do pg-boss (RN-105).
 * Só messages.create, com PDF/imagem inline em base64 — sem Batch (CreateModelInvocationJob), S3, URL, count_tokens nem
 * `inference_geo` (não existe no Bedrock: a região vem do perfil). Nenhum erro sai com o texto do provedor: só
 * ErroProvedor { tipo, status, requestId }. Plano 14B (D1): `gerar` usa o mesmo InvokeModel, com ferramentas só do
 * cliente (`strict`, escolha `auto`), sem streaming e sem `thinking` explícito.
 */
export const TIMEOUT_MS = 120_000;
/** INT-08 / R-116: o Bedrock aceita pedido de até 20 MB (base64 do arquivo + instruções). */
export const LIMITE_PEDIDO_BEDROCK_BYTES = 20 * 1024 * 1024;
/** D3: o modelo do código → o perfil de inferência `eu.` (ID conferido no runbook, página "inference-profiles-support"). */
export const PERFIL_BEDROCK_EU: Partial<Record<ModeloIA, string>> = { 'claude-sonnet-5-5': 'eu.anthropic.claude-sonnet-5-5' };
/** Códigos do Node em que a requisição nem saiu (RN-105: dá para repetir). */
const ANTES_DO_ENVIO = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);

function codigoDaCausa(err: unknown): string | undefined {
  let c: unknown = err;
  for (let i = 0; i < 4 && c; i++) {
    const codigo = (c as { code?: unknown }).code;
    if (typeof codigo === 'string') return codigo;
    c = (c as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * RN-105 no Bedrock (INT-08): 401/403 (AccessDenied, UnrecognizedClient, modelo sem acesso) → credencial; 413 → grande
 * demais; 429 (Throttling), 500 (InternalServer) e 503 (ServiceUnavailable) → repetir; 408 (ModelTimeout), 424 (ModelError)
 * e 504 → incerto (o modelo pode ter processado e cobrado); outros 4xx (Validation, ResourceNotFound) → pedido inválido.
 * A AWS não tem o "limite de gasto" da Anthropic: o teto é o AWS Budgets (alerta) e o teto da plataforma. Exportada para o teste.
 */
export function classificarErroBedrock(err: unknown): ErroProvedor {
  if (err instanceof APIConnectionTimeoutError) return new ErroProvedor('incerto', null, null);
  if (err instanceof APIConnectionError) {
    const codigo = codigoDaCausa(err);
    return new ErroProvedor(codigo && ANTES_DO_ENVIO.has(codigo) ? 'nao_enviado' : 'incerto', null, null);
  }
  if (err instanceof APIError) {
    const status = typeof err.status === 'number' ? err.status : null;
    const requestId = err.headers?.get('x-amzn-requestid') ?? err.requestID ?? null;
    if (status === 401 || status === 403) return new ErroProvedor('credencial', status, requestId);
    if (status === 413) return new ErroProvedor('grande_demais', status, requestId);
    if (status === 429 || status === 500 || status === 503) return new ErroProvedor('repetir', status, requestId);
    if (status === 408 || status === 424 || status === 504) return new ErroProvedor('incerto', status, requestId);
    if (status !== null && status >= 400 && status < 500) return new ErroProvedor('pedido_invalido', status, requestId);
    return new ErroProvedor('incerto', status, requestId);
  }
  return new ErroProvedor('incerto', null, null);
}

function usoDe(u: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }): UsoTokens {
  return { entrada: u.input_tokens, cacheLeitura: u.cache_read_input_tokens ?? 0, cacheGravacao: u.cache_creation_input_tokens ?? 0, saida: u.output_tokens, geo: 'eu' };
}

/**
 * Plano 14B (D1): os tipos do corpo e da resposta vêm inferidos do cliente do Bedrock (importar os do @anthropic-ai/sdk
 * quebraria a guarda do RNF-103). A resposta é o membro da união que tem `content` (a mensagem, não o fluxo de eventos).
 */
type MensagemDoPedido = Parameters<AnthropicBedrock['messages']['create']>[0]['messages'][number];
type BlocoDoPedido = Exclude<MensagemDoPedido['content'], string>[number];
type MensagemDaResposta = Extract<Awaited<ReturnType<AnthropicBedrock['messages']['create']>>, { content: unknown }>;

/** Plano 14B (D1): o turno do assistente volta como veio (o bruto, com o raciocínio e a assinatura) — nada é editado. */
function mensagensDe(turnos: readonly TurnoIA[]): MensagemDoPedido[] {
  return turnos.map((t): MensagemDoPedido =>
    t.papel === 'assistente'
      ? { role: 'assistant', content: t.bruto as BlocoDoPedido[] }
      : {
          role: 'user',
          content: t.blocos.map((b): BlocoDoPedido =>
            b.tipo === 'texto' ? { type: 'text', text: b.texto } : { type: 'tool_result', tool_use_id: b.chamadaId, content: b.conteudo, ...(b.erro ? { is_error: true } : {}) },
          ),
        },
  );
}

/** Plano 14B (D1): a resposta de uma volta, como na API direta; o request-id vem do cabeçalho da AWS. */
function respostaDe(r: MensagemDaResposta, requestId: string | null): RespostaGeracao {
  const base = { bruto: r.content as readonly unknown[], uso: usoDe(r.usage), requestId };
  if (r.stop_reason === 'refusal') return { tipo: 'recusa', categoria: r.stop_details?.category ?? null, ...base };
  if (r.stop_reason === 'tool_use') {
    const chamadas = r.content.flatMap((b) => (b.type === 'tool_use' ? [{ id: b.id, nome: b.name, entrada: b.input }] : []));
    return chamadas.length ? { tipo: 'ferramentas', chamadas, ...base } : { tipo: 'cortada', ...base };
  }
  if (r.stop_reason !== 'end_turn') return { tipo: 'cortada', ...base };
  return { tipo: 'final', texto: r.content.map((b) => (b.type === 'text' ? b.text : '')).join(''), ...base };
}

/** D3: só os modelos com perfil `eu.` e só a região `eu` (o job confere antes do portão do envio). */
const aceitaBedrock = (modelo: ModeloIA, geo: RegiaoIA): boolean => Boolean(PERFIL_BEDROCK_EU[modelo]) && geo === 'eu';

export function provedorBedrock(o: { regiao: RegiaoBedrock; accessKeyId: string; secretAccessKey: string; fetch?: typeof fetch; baseURL?: string; timeoutMs?: number }): ProvedorIA {
  const cliente = new AnthropicBedrock({
    awsRegion: o.regiao,
    baseURL: o.baseURL ?? `https://bedrock-runtime.${o.regiao}.amazonaws.com`,
    awsAccessKey: o.accessKeyId,
    awsSecretKey: o.secretAccessKey,
    awsSessionToken: null,
    // D2: `null`, não `undefined` — o padrão do construtor leria AWS_BEARER_TOKEN_BEDROCK, que venceria a assinatura SigV4
    apiKey: null as unknown as undefined,
    maxRetries: 0,
    timeout: o.timeoutMs ?? TIMEOUT_MS,
    logLevel: 'off',
    ...(o.fetch ? { fetch: o.fetch } : {}),
  });
  return {
    nome: 'bedrock-eu',
    destino: 'bedrock-eu',
    limitePedidoBytes: LIMITE_PEDIDO_BEDROCK_BYTES,
    aceita: aceitaBedrock,
    async lerDocumento(p: PedidoLeitura): Promise<RespostaLeitura> {
      const perfil = PERFIL_BEDROCK_EU[p.modelo];
      // D3: nada sai para modelo fora do perfil eu. nem com região que não é a da UE (defesa a mais: o job já conferiu
      // `aceita` antes do portão)
      if (!perfil || !aceitaBedrock(p.modelo, p.geo)) throw new ErroProvedor('pedido_invalido', null, null);
      const bloco =
        p.arquivo.tipo === 'pdf'
          ? ({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: p.arquivo.base64 } } as const)
          : ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: p.arquivo.base64 } } as const);
      // `.then(ok, erro)`: o tipo da mensagem vem inferido do SDK do Bedrock (importar o tipo do @anthropic-ai/sdk quebraria
      // a guarda do RNF-103); o erro do SDK vira ErroProvedor aqui dentro, sem o texto do provedor
      const { data: r, response } = await cliente.messages
        .create({
          model: perfil,
          max_tokens: p.maxTokens,
          system: p.sistema,
          messages: [{ role: 'user', content: [bloco, { type: 'text', text: p.instrucao }] }],
          output_config: { effort: p.esforco, format: { type: 'json_schema', schema: p.schema } },
        })
        .withResponse()
        .then(
          (x) => x,
          (err: unknown) => {
            throw classificarErroBedrock(err);
          },
        );
      const requestId = response.headers.get('x-amzn-requestid');
      const uso = usoDe(r.usage);
      if (r.stop_reason === 'refusal') return { tipo: 'recusa', categoria: r.stop_details?.category ?? null, uso, requestId };
      if (r.stop_reason !== 'end_turn') return { tipo: 'cortada', uso, requestId };
      const texto = r.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
      return { tipo: 'ok', texto, uso, requestId };
    },
    async gerar(p: PedidoGeracao): Promise<RespostaGeracao> {
      const perfil = PERFIL_BEDROCK_EU[p.modelo];
      // D3: como na leitura, nada sai para modelo fora do perfil eu. nem com região que não é a da UE
      if (!perfil || !aceitaBedrock(p.modelo, p.geo)) throw new ErroProvedor('pedido_invalido', null, null);
      const { data: r, response } = await cliente.messages
        .create({
          model: perfil,
          max_tokens: p.maxTokens,
          system: p.sistema,
          messages: mensagensDe(p.turnos),
          output_config: { effort: p.esforco, format: { type: 'json_schema', schema: p.schema } },
          // RNF-105: só ferramentas do cliente, strict, com a escolha automática (forçar dá 400 nos modelos 5.5)
          ...(p.ferramentas.length
            ? { tools: p.ferramentas.map((f) => ({ name: f.nome, description: f.descricao, input_schema: f.schema as { type: 'object' }, strict: true })), tool_choice: { type: 'auto' } as const }
            : {}),
        })
        .withResponse()
        .then(
          (x) => x,
          (err: unknown) => {
            throw classificarErroBedrock(err);
          },
        );
      return respostaDe(r, response.headers.get('x-amzn-requestid'));
    },
  };
}
