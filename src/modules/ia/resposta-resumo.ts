import { z } from 'zod';
import { limparTexto } from './plano-ia';
import { SECOES_RESUMO, type ResultadoResumo, type SecaoResumo } from './tipos';

const MAX_FRASE = 400;
const MAX_FRASES_POR_SECAO = 30;
/** A-D17 / D13: interpretação de exame — a frase da seção "exames" com um destes termos sai (sem acento e sem maiúsculas). */
const INTERPRETACAO =
  /\b(alt[oa]s?|baix[oa]s?|normal|normais|alterad[oa]s?|elevad[oa]s?|reduzid[oa]s?|acima|abaixo|limitrofes?|deficiencias?|excesso|adequad[oa]s?|inadequad[oa]s?)\b/;
const semAcento = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const respostaSchema = z.object({
  secoes: z.array(z.object({ secao: z.enum(SECOES_RESUMO), frases: z.array(z.object({ texto: z.string(), fontes: z.array(z.string()) })) })),
});

/**
 * US-120 / D13: a resposta da IA revalidada no worker — só frases com fonte enviada, sem URL nem caractere de controle ou
 * invisível (a frase que `limparTexto` mudaria sai inteira, em vez de ir cortada), com até 400 caracteres, até 30 por seção,
 * e, na seção de exames, sem termo de interpretação (A-D17; guarda de código além da instrução, desvio 8). Seções na ordem
 * da tela. Fora do formato (JSON inválido, seção desconhecida) → null.
 */
export function validarRespostaResumo(texto: string, enviados: ReadonlySet<string>): Pick<ResultadoResumo, 'secoes' | 'retiradas'> | null {
  let obj: unknown;
  try {
    obj = JSON.parse(texto);
  } catch {
    return null;
  }
  const r = respostaSchema.safeParse(obj);
  if (!r.success) return null;
  let retiradas = 0;
  const porSecao = new Map<SecaoResumo, { texto: string; fontes: string[] }[]>();
  for (const s of r.data.secoes) {
    for (const f of s.frases) {
      const limpo = limparTexto(f.texto);
      // a comparação ignora só a forma Unicode e espaços repetidos (o que limparTexto também normaliza sem ser ameaça)
      const original = f.texto.normalize('NFC').replace(/ {2,}/g, ' ').trim();
      const fontes = [...new Set(f.fontes)];
      const ok =
        limpo === original &&
        limpo.length > 0 &&
        limpo.length <= MAX_FRASE &&
        fontes.length > 0 &&
        fontes.every((x) => enviados.has(x)) &&
        !(s.secao === 'exames' && INTERPRETACAO.test(semAcento(limpo)));
      const lista = porSecao.get(s.secao) ?? [];
      if (!ok || lista.length >= MAX_FRASES_POR_SECAO) {
        retiradas++;
        continue;
      }
      porSecao.set(s.secao, [...lista, { texto: limpo, fontes }]);
    }
  }
  return { secoes: SECOES_RESUMO.filter((s) => porSecao.get(s)?.length).map((s) => ({ secao: s, frases: porSecao.get(s)! })), retiradas };
}
