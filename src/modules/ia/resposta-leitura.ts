import { z } from 'zod';
import { dataValida } from '@/modules/pacientes/datas';
import { MAX_LINHAS_SUGESTAO } from './constantes';
import type { LinhaSugerida, ResultadoLeitura } from './tipos';

/**
 * RN-111: o JSON Schema enviado em output_config.format. A API não aceita limites (maxLength, maximum, maxItems): eles
 * ficam no Zod abaixo. Sem dado do paciente (o provedor guarda o schema compilado por até 24 h).
 */
const textoOuNulo = { anyOf: [{ type: 'string' }, { type: 'null' }] };
export const SCHEMA_LEITURA = {
  type: 'object',
  additionalProperties: false,
  required: ['documento_reconhecido', 'data_coleta', 'marcadores'],
  properties: {
    documento_reconhecido: { type: 'boolean' },
    data_coleta: textoOuNulo,
    marcadores: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['nome_no_laudo', 'valor_texto', 'unidade', 'referencia', 'pagina'],
        properties: { nome_no_laudo: { type: 'string' }, valor_texto: { type: 'string' }, unidade: textoOuNulo, referencia: textoOuNulo, pagina: { type: 'integer' } },
      },
    },
  },
} as const satisfies Record<string, unknown>;

const linhaSchema = z
  .object({ nome_no_laudo: z.string(), valor_texto: z.string(), unidade: z.string().nullable(), referencia: z.string().nullable(), pagina: z.number().int() })
  .strict();
const respostaSchema = z.object({ documento_reconhecido: z.boolean(), data_coleta: z.string().nullable(), marcadores: z.array(linhaSchema) }).strict();

// Link de qualquer esquema (http, ftp, hxxp…) ou www.; colado a uma palavra ("Glicosehttps://…"), a palavra sai junto
// (o campo pode ficar vazio e a linha é descartada).
const LINK = /(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S+/gi;
// Controle C0/C1 (\p{Cc}): vira espaço (não some), "70\na 99" fica "70 a 99", não "70a 99".
const CONTROLE = /\p{Cc}/gu;
// Formatação invisível (\p{Cf}: marcas de direção, largura zero, hífen suave, caracteres de "tag" U+E0000…) e surrogate
// solto (\p{Cs}, que o jsonb recusa): não aparecem num laudo e servem para esconder texto ou partir um link
// ("ht\u200btps://…"). Somem antes da busca de links.
const INVISIVEL = /[\p{Cf}\p{Cs}]/gu;
/** Texto da IA → texto puro de uma linha (spec §5.8, 3 e 4): sem link, sem controle nem invisível, espaços colapsados. */
function limpar(s: string): string {
  return s.normalize('NFC').replace(INVISIVEL, '').replace(CONTROLE, ' ').replace(LINK, '').replace(/\s+/g, ' ').trim();
}
const LIMITES = { nome: 80, valor: 40, unidade: 20, referencia: 80 } as const;

export type ValidacaoLeitura = { tipo: 'ok'; resultado: ResultadoLeitura } | { tipo: 'nao_reconhecido' } | { tipo: 'vazio' } | { tipo: 'invalida' };

/** Valida a resposta (texto do provedor) contra o formato e as regras do domínio. Nunca lança. */
export function validarRespostaLeitura(texto: string, paginas: number): ValidacaoLeitura {
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch {
    return { tipo: 'invalida' };
  }
  const r = respostaSchema.safeParse(bruto);
  if (!r.success || r.data.marcadores.length > MAX_LINHAS_SUGESTAO) return { tipo: 'invalida' };
  if (!r.data.documento_reconhecido) return { tipo: 'nao_reconhecido' };
  const linhas: LinhaSugerida[] = [];
  let descartadas = 0;
  for (const m of r.data.marcadores) {
    const nome = limpar(m.nome_no_laudo);
    const valorTexto = limpar(m.valor_texto);
    const unidade = m.unidade === null ? null : limpar(m.unidade) || null;
    const referencia = m.referencia === null ? null : limpar(m.referencia) || null;
    const foraDoFormato =
      !nome || !valorTexto || nome.length > LIMITES.nome || valorTexto.length > LIMITES.valor || (unidade?.length ?? 0) > LIMITES.unidade || (referencia?.length ?? 0) > LIMITES.referencia;
    if (foraDoFormato) {
      descartadas++;
      continue;
    }
    linhas.push({ nome, valorTexto, unidade, referencia, pagina: m.pagina >= 1 && m.pagina <= paginas ? m.pagina : null });
  }
  if (!linhas.length) return { tipo: 'vazio' };
  const data = r.data.data_coleta && dataValida(r.data.data_coleta) ? r.data.data_coleta : null;
  return { tipo: 'ok', resultado: { versao: 1, dataColeta: data, linhas, descartadas } };
}
