import { lerDecimal } from '@/lib/numero';
import { normalizarTexto } from '@/lib/text';
import { dataValida } from './datas';

/** US-012: os 7 tipos de pergunta. Arquivo puro: o editor de modelos e o formulário usam no navegador. */
export const TIPOS_PERGUNTA = [
  { id: 'texto_curto', rotulo: 'Texto curto' },
  { id: 'texto_longo', rotulo: 'Texto longo' },
  { id: 'numero', rotulo: 'Número' },
  { id: 'sim_nao', rotulo: 'Sim/não' },
  { id: 'escolha_unica', rotulo: 'Escolha única' },
  { id: 'multipla_escolha', rotulo: 'Múltipla escolha' },
  { id: 'data', rotulo: 'Data' },
] as const;
export type TipoPergunta = (typeof TIPOS_PERGUNTA)[number]['id'];

export type Pergunta = { id: string; tipo: TipoPergunta; rotulo: string; obrigatoria: boolean; unidade?: string; opcoes?: string[] };
export type ModeloSchema = { perguntas: Pergunta[] };
/** Cópia do modelo no momento do preenchimento (US-012 "Snapshot do modelo"). */
export type SnapshotModelo = { nome: string; perguntas: Pergunta[] };
export type Resposta = string | number | boolean | string[];

export const MSG_ANAMNESE = {
  nomeModelo: 'Informe o nome do modelo',
  semPerguntas: 'Inclua pelo menos uma pergunta',
  rotulo: 'Informe o texto da pergunta',
  opcoes: 'Informe pelo menos 2 opções',
  tipo: 'Escolha o tipo da pergunta',
  muitasPerguntas: 'Use no máximo 100 perguntas',
  muitasOpcoes: 'Use no máximo 30 opções, com até 100 caracteres cada',
  modeloNaoEncontrado: 'Modelo de anamnese não encontrado.',
  responda: (rotulo: string) => `Responda: ${rotulo}`,
  invalida: (rotulo: string) => `Resposta inválida: ${rotulo}`,
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMITE_PERGUNTAS = 100;
const texto = normalizarTexto;
const tipoValido = (t: unknown): t is TipoPergunta => TIPOS_PERGUNTA.some((x) => x.id === t);
const temOpcoes = (t: TipoPergunta) => t === 'escolha_unica' || t === 'multipla_escolha';

/** Modelo digitado no editor → modelo limpo, ou erros por campo (`nome`, `perguntas`, `pergunta_<n>`). */
export function validarModelo(input: { nome: unknown; perguntas: unknown }):
  | { ok: true; nome: string; perguntas: Pergunta[] }
  | { ok: false; erros: Record<string, string> } {
  const erros: Record<string, string> = {};
  const nome = texto(input.nome).slice(0, 80);
  if (!nome) erros.nome = MSG_ANAMNESE.nomeModelo;
  const brutas: (Record<string, unknown> | null)[] = Array.isArray(input.perguntas) ? input.perguntas : [];
  if (!brutas.length) erros.perguntas = MSG_ANAMNESE.semPerguntas;
  // nada é cortado em silêncio: o editor limita nome, rótulo e unidade (maxLength), mas não a lista de opções
  if (brutas.length > LIMITE_PERGUNTAS) return { ok: false, erros: { ...erros, perguntas: MSG_ANAMNESE.muitasPerguntas } };
  const ids = new Set<string>();
  const perguntas: Pergunta[] = [];
  brutas.forEach((item, i) => {
    const b = item ?? {};
    const tipo = b.tipo;
    if (!tipoValido(tipo)) return void (erros[`pergunta_${i}`] = MSG_ANAMNESE.tipo);
    const rotulo = texto(b.rotulo).slice(0, 200);
    if (!rotulo) return void (erros[`pergunta_${i}`] = MSG_ANAMNESE.rotulo);
    let id = typeof b.id === 'string' && UUID.test(b.id) ? b.id.toLowerCase() : crypto.randomUUID();
    if (ids.has(id)) id = crypto.randomUUID();
    ids.add(id);
    const p: Pergunta = { id, tipo, rotulo, obrigatoria: b.obrigatoria === true };
    if (tipo === 'numero') {
      const unidade = texto(b.unidade).slice(0, 20);
      if (unidade) p.unidade = unidade;
    }
    if (temOpcoes(tipo)) {
      const opcoes = [...new Set((Array.isArray(b.opcoes) ? b.opcoes : []).map((o) => texto(o)).filter(Boolean))];
      if (opcoes.length > 30 || opcoes.some((o) => o.length > 100)) return void (erros[`pergunta_${i}`] = MSG_ANAMNESE.muitasOpcoes);
      if (opcoes.length < 2) return void (erros[`pergunta_${i}`] = MSG_ANAMNESE.opcoes);
      p.opcoes = opcoes;
    }
    perguntas.push(p);
  });
  return Object.keys(erros).length ? { ok: false, erros } : { ok: true, nome, perguntas };
}

/** Respostas do formulário → valores tipados. Resposta vazia não é gravada; obrigatória vazia → "Responda: …". */
export function validarRespostas(
  perguntas: Pergunta[],
  bruto: Record<string, unknown>,
): { ok: true; respostas: Record<string, Resposta> } | { ok: false; erros: Record<string, string> } {
  const respostas: Record<string, Resposta> = {};
  const erros: Record<string, string> = {};
  for (const p of perguntas) {
    const v = bruto[p.id];
    const vazio = v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && v.length === 0);
    if (vazio) {
      if (p.obrigatoria) erros[p.id] = MSG_ANAMNESE.responda(p.rotulo);
      continue;
    }
    const r = converter(p, v);
    if (r === undefined) erros[p.id] = MSG_ANAMNESE.invalida(p.rotulo);
    else respostas[p.id] = r;
  }
  return Object.keys(erros).length ? { ok: false, erros } : { ok: true, respostas };
}

function converter(p: Pergunta, v: unknown): Resposta | undefined {
  switch (p.tipo) {
    case 'texto_curto':
    case 'texto_longo': {
      if (typeof v !== 'string') return undefined;
      const limite = p.tipo === 'texto_curto' ? 200 : 5000;
      // PF3: o navegador envia quebra de linha como CRLF (o maxLength do textarea conta 1 por quebra)
      const t = v.replace(/\r\n?/g, '\n').trim();
      return t.length <= limite ? t : undefined;
    }
    case 'numero': {
      const n = lerDecimal(v);
      return typeof n === 'number' && !Number.isNaN(n) ? n : undefined;
    }
    case 'sim_nao':
      return v === 'sim' ? true : v === 'nao' ? false : typeof v === 'boolean' ? v : undefined;
    case 'escolha_unica':
      return typeof v === 'string' && p.opcoes?.includes(v) ? v : undefined;
    case 'multipla_escolha': {
      const l = Array.isArray(v) ? v : [v];
      return l.every((x) => typeof x === 'string' && p.opcoes?.includes(x)) ? [...new Set(l as string[])] : undefined;
    }
    case 'data':
      return typeof v === 'string' && dataValida(v.trim()) ? v.trim() : undefined;
  }
}

/** Campos `r_<id>` do formulário (múltipla escolha: vários valores com o mesmo nome). */
export function respostasDoFormulario(perguntas: Pergunta[], f: FormData): Record<string, string | string[]> {
  return Object.fromEntries(
    perguntas.map((p) => [p.id, p.tipo === 'multipla_escolha' ? f.getAll(`r_${p.id}`).map(String) : String(f.get(`r_${p.id}`) ?? '')]),
  );
}

/** Resposta gravada → valor do campo do formulário (número com vírgula; sim/não como 'sim'/'nao'). */
export function respostaParaCampo(r: Resposta | undefined): string | string[] {
  if (r === undefined) return '';
  if (typeof r === 'number') return String(r).replace('.', ',');
  if (typeof r === 'boolean') return r ? 'sim' : 'nao';
  return r;
}
