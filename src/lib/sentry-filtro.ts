/**
 * RNF-11 / CLAUDE.md regra 3: todo evento do Sentry (app e worker) passa por aqui — `beforeSend`,
 * `beforeSendTransaction` (o tracing fica desligado, mas o filtro vale se alguém ligar) e `beforeBreadcrumb`.
 * Regra: o que não está na lista do que pode sair, sai. Puro, sem o SDK: testável com fixtures.
 */

export type Frame = {
  filename?: string; function?: string; module?: string; lineno?: number; colno?: number; in_app?: boolean; abs_path?: string;
  vars?: unknown; context_line?: string; pre_context?: string[]; post_context?: string[];
};
export type Breadcrumb = { category?: string; type?: string; level?: string; message?: string; timestamp?: number; data?: Record<string, unknown> };
export type EventoSentry = {
  message?: unknown;
  logentry?: unknown;
  request?: Record<string, unknown>;
  user?: Record<string, unknown>;
  exception?: { values?: { type?: string; value?: string; mechanism?: unknown; stacktrace?: { frames?: Frame[] } }[] };
  breadcrumbs?: Breadcrumb[];
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  transaction?: string;
  [k: string]: unknown;
};

/** Classes do próprio código cuja mensagem é um texto fixo, sem dado do usuário. */
const MENSAGEM_SEGURA = new Set(['TenantContextError', 'CorpoGrandeError', 'CorpoLentoError']);
/** Mensagens de `captureMessage` que o próprio código manda (texto fixo). */
export const MENSAGENS_FIXAS: ReadonlySet<string> = new Set(['erro no navegador']);
export const TAGS_PERMITIDAS: ReadonlySet<string> = new Set(['request_id', 'tenant_id', 'papel', 'rota', 'tipo_rota', 'fila', 'motivo', 'digest', 'nome_erro']);
const CONTEXTOS_PERMITIDOS = new Set(['runtime', 'os', 'trace']);
const NOME_DE_CLASSE = /^[A-Za-z][A-Za-z0-9_]{0,59}$/;
/** Parênteses: o `routePath` do onRequestError traz os grupos de rota (`/p/(portal)/plano/page`). Sem espaço, sem `?`/`=`/`@`. */
const VALOR_DE_TAG = /^[\w:./[\]()-]{1,100}$/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const TOKEN = /^[A-Za-z0-9_-]{20,}$/;
const REMOVIDO = '[removido]';

/** Só o caminho, sem query nem fragmento; UUID → `:id`; segmento longo sem cara de palavra → `:token`; convites e links de consulta e de documento → `:token`. */
export function caminhoSeguro(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  let caminho: string;
  try {
    caminho = new URL(url, 'http://local.invalid').pathname;
  } catch {
    return REMOVIDO;
  }
  return caminho
    .split('/')
    .map((s) => s.replace(UUID, ':id'))
    .map((s) => (s !== ':id' && TOKEN.test(s) ? ':token' : s))
    .join('/')
    .replace(/^\/(convite(?:\/paciente)?|consulta|documento|api\/documento)\/[^/]+/, '/$1/:token');
}

function origemSegura(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/** `GET /painel/pacientes/<uuid>` → `GET /painel/pacientes/:id`. */
function transacaoSegura(t: string): string {
  const m = /^([A-Z]+) (.*)$/.exec(t);
  return m ? `${m[1]} ${caminhoSeguro(m[2])}` : (caminhoSeguro(t) ?? REMOVIDO);
}

export function filtrarBreadcrumb(b: Breadcrumb): Breadcrumb | null {
  if (b.category !== 'http' && b.category !== 'fetch') return null;
  const d = b.data ?? {};
  const data: Record<string, unknown> = {};
  if (typeof d.method === 'string') data.method = d.method;
  if (typeof d.status_code === 'number') data.status_code = d.status_code;
  const origem = origemSegura(d.url);
  if (origem) data.url = origem;
  const out: Breadcrumb = { category: b.category, data };
  if (b.type) out.type = b.type;
  if (b.level) out.level = b.level;
  if (b.timestamp) out.timestamp = b.timestamp;
  return out;
}

function textoDaMensagem(m: unknown): string | null {
  if (typeof m === 'string') return m;
  if (m && typeof m === 'object') {
    const o = m as { formatted?: unknown; message?: unknown };
    if (typeof o.formatted === 'string') return o.formatted;
    if (typeof o.message === 'string') return o.message;
  }
  return null;
}

export function filtrarEvento<E extends EventoSentry>(e: E): E {
  const out: EventoSentry = { ...e };
  delete out.extra;
  delete out.logentry;
  if (out.message !== undefined) {
    const t = textoDaMensagem(out.message);
    out.message = t !== null && MENSAGENS_FIXAS.has(t) ? t : REMOVIDO;
  }
  if (out.request) {
    const r = out.request;
    out.request = {
      ...(typeof r.method === 'string' ? { method: r.method } : {}),
      ...(typeof r.url === 'string' ? { url: caminhoSeguro(r.url) } : {}),
    };
  }
  if (out.user) {
    const id = out.user.id;
    if (typeof id === 'string' || typeof id === 'number') out.user = { id: String(id) };
    else delete out.user;
  }
  if (out.exception?.values) {
    out.exception = {
      ...out.exception,
      values: out.exception.values.map((v) => {
        const tipo = v.type && NOME_DE_CLASSE.test(v.type) ? v.type : 'Error';
        const valor = MENSAGEM_SEGURA.has(tipo) && typeof v.value === 'string' ? v.value.slice(0, 200) : REMOVIDO;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const frames = v.stacktrace?.frames?.map(({ vars: _v, context_line: _c, pre_context: _a, post_context: _p, ...f }) => f);
        return { ...v, type: tipo, value: valor, ...(frames ? { stacktrace: { frames } } : {}) };
      }),
    };
  }
  if (out.breadcrumbs) out.breadcrumbs = out.breadcrumbs.map(filtrarBreadcrumb).filter((b): b is Breadcrumb => b !== null);
  if (out.tags) {
    out.tags = Object.fromEntries(Object.entries(out.tags).filter(([k, v]) => TAGS_PERMITIDAS.has(k) && typeof v === 'string' && VALOR_DE_TAG.test(v)));
  }
  if (out.contexts) out.contexts = Object.fromEntries(Object.entries(out.contexts).filter(([k]) => CONTEXTOS_PERMITIDOS.has(k)));
  if (typeof out.transaction === 'string') out.transaction = transacaoSegura(out.transaction);
  return out as E;
}
