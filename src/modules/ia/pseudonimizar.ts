/**
 * Plano 14B (RN-115, §5.4, D9): a máscara de texto livre do resumo e do rascunho. Some: o nome completo do paciente, o
 * primeiro nome com qualquer sobrenome, o primeiro nome sozinho (com 3 letras ou mais e fora das palavras comuns de
 * alimentação — PM-7, lista a revisar com a Debby), o e-mail e o telefone dele e os padrões de e-mail, telefone e CPF.
 * Sem diferença de acento nem de maiúsculas.
 *
 * LIMITE DECLARADO (no texto da autorização 1.1, "O que é enviado", e no item 5 do aditivo 1.1 — revisão da T6): passam
 * o primeiro nome sozinho quando tem menos de três letras ou é palavra comum de alimentação (como Rosa ou Clara); as
 * outras partes do nome escritas sem o primeiro nome (um segundo nome, os sobrenomes); apelidos; nomes de outras
 * pessoas, endereço e outros documentos. Mudou a regra (o `>= 3`, a lista ou as partes do nome) → o texto 1.1 muda junto,
 * e depois do merge isso é versão nova da autorização (RN-109; P14A-16). Pseudonimizar reduz, mas o resultado continua
 * dado pessoal (art. 13, § 4º).
 *
 * Plano 15 (PM-3, §7.3): `outrosNomes` (a equipe: a mesma regra do nome do paciente) e `frasesExatas` (o nome do
 * consultório, só inteiro). O resumo e o rascunho da 14B continuam sem a equipe e o consultório (backlog P15-B1).
 *
 * Plano 18 (RN-282, D7, D19): o nome social do paciente, quando houver, entra em `outrosNomes` (`comNomeSocial`) no
 * resumo, no rascunho e no contexto da IA Nutri — a mesma regra do nome de registro, com o mesmo limite declarado. É lido
 * só para a máscara (nome-social.ts) e nunca sai. RN-109: a regra da máscara não muda (nem o `>= 3`, nem a lista, nem as
 * partes do nome); passa a valer para mais um nome do próprio paciente, então sai MENOS do que o texto 1.1 descreve ("o
 * sistema retira o seu nome"; o nome social é o nome do paciente). Na leitura da Tarefa 11, sem mudança no texto da
 * autorização nem versão nova; a confirmação do `normas-cfn-lgpd` contra o texto 1.1 fica para antes do merge do PR 2
 * (spec §10 e §14).
 */
import type { Resposta, SnapshotModelo } from '@/modules/pacientes/anamnese-tipos';

export type AlvoDaMascara = {
  nome: string;
  email: string | null;
  telefone: string | null;
  /** PM-3: os nomes da equipe do consultório — saem pela mesma regra do nome do paciente. */
  outrosNomes?: readonly string[];
  /** PM-3: o nome do consultório — sai só inteiro ("Consultório" sozinho não é nome). */
  frasesExatas?: readonly string[];
};
export const LIMITE_TEXTO_LIVRE = 2000;
const REMOVIDO = '[removido]';
/** PM-7: primeiros nomes que também são palavra comum de alimentação — sozinhos, ficam; com o sobrenome, saem. Sem acento. */
export const PALAVRAS_COMUNS_ALIMENTACAO: readonly string[] = [
  'mel', 'clara', 'amora', 'cereja', 'canela', 'lima', 'roma', 'salsa', 'pimenta', 'jaca', 'pera', 'uva', 'manga', 'caja', 'caju', 'oliva',
  'mostarda', 'cravo', 'ameixa', 'laranja', 'castanha', 'flor', 'rosa', 'baunilha', 'mirtilo', 'nata', 'aveia', 'cacau',
];
const CONECTIVOS = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);
const semAcento = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
/**
 * Um caractere por ponto de código (o que não cabe num caractere — emoji, letras que viram duas — vira U+FFFF): o índice
 * de cada casamento na chave é o índice do ponto de código no texto original.
 */
const chave = (pontos: string[]) =>
  pontos
    .map((c) => {
      const x = semAcento(c);
      return x.length === 1 ? x : '￿';
    })
    .join('');
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const borda = (padrao: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${padrao})(?![\\p{L}\\p{N}])`, 'gu');

function padroesDoNome(nome: string): RegExp[] {
  const todas = semAcento(nome).split(/\s+/).filter(Boolean);
  const partes = todas.filter((p) => !CONECTIVOS.has(p) && p.length >= 2);
  if (!partes.length) return [];
  const [primeiro, ...sobrenomes] = partes;
  const conectivo = '(?:\\s+(?:da|de|do|das|dos|e))?';
  const out = [borda(todas.map(escapar).join('\\s+'))];
  if (sobrenomes.length) out.push(borda(`${escapar(primeiro)}(?:\\s+\\S+)?${conectivo}\\s+(?:${sobrenomes.map(escapar).join('|')})`));
  if (primeiro.length >= 3 && !PALAVRAS_COMUNS_ALIMENTACAO.includes(primeiro)) out.push(borda(escapar(primeiro)));
  return out;
}

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;
const TELEFONE = /(?:\+?55[\s-]?)?(?:\(?\d{2}\)?[\s-]?)?9?\d{4}[\s-]?\d{4}(?!\d)/g;
const CPF = /(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)/g;

/** Troca cada trecho que casa algum padrão por um "[removido]" só (as posições vêm da chave sem acento). */
function apagarPadroes(texto: string, padroes: readonly RegExp[]): string {
  if (!padroes.length) return texto;
  const original = Array.from(texto);
  const k = chave(original);
  const apagar = new Array<boolean>(original.length).fill(false);
  for (const re of padroes) for (const m of k.matchAll(re)) for (let i = m.index; i < m.index + m[0].length; i++) apagar[i] = true;
  let saida = '';
  for (let i = 0; i < original.length; i++) {
    if (!apagar[i]) saida += original[i];
    else if (i === 0 || !apagar[i - 1]) saida += REMOVIDO;
  }
  return saida;
}

/** O nome (do paciente ou de alguém da equipe) pelas regras de `padroesDoNome`. */
const tirarNome = (texto: string, nome: string): string => apagarPadroes(texto, padroesDoNome(nome));

/** A frase inteira, com a mesma chave sem acento do nome; qualquer espaço entre as palavras. Vazia → nada. */
function trocarFrase(texto: string, frase: string): string {
  const palavras = semAcento(frase).split(/\s+/).filter(Boolean);
  return apagarPadroes(texto, palavras.length ? [borda(palavras.map(escapar).join('\\s+'))] : []);
}

export function mascarar(texto: string, alvo: AlvoDaMascara): string {
  let t = texto.normalize('NFC');
  // R5 (pre-flight): os e-mails saem ANTES do nome — senão o primeiro nome casaria dentro do e-mail ("maria.jose@…") e o
  // padrão de e-mail pegaria só o resto
  if (alvo.email) t = t.replace(new RegExp(escapar(alvo.email.normalize('NFC')), 'giu'), REMOVIDO);
  t = t.replace(EMAIL, REMOVIDO);
  if (alvo.telefone) t = t.split(alvo.telefone).join(REMOVIDO);
  for (const f of alvo.frasesExatas ?? []) t = trocarFrase(t, f);
  t = tirarNome(t, alvo.nome);
  for (const outro of alvo.outrosNomes ?? []) t = tirarNome(t, outro);
  // o CPF antes do telefone: 11 dígitos seguidos seriam lidos como telefone
  return t.replace(CPF, REMOVIDO).replace(TELEFONE, REMOVIDO);
}

/** Plano 18 (RN-282): o alvo com o nome social do paciente somado a `outrosNomes`; sem nome social, o mesmo alvo. */
export function comNomeSocial(alvo: AlvoDaMascara, nomeSocial: string | null): AlvoDaMascara {
  if (!nomeSocial?.trim()) return alvo;
  return { ...alvo, outrosNomes: [...(alvo.outrosNomes ?? []), nomeSocial] };
}

/** Texto livre que vai à IA: mascarado, sem espaços nas pontas, cortado em 2.000 caracteres com "[…]" (desvio 5); vazio → null. */
export function textoLivre(texto: string | null | undefined, alvo: AlvoDaMascara): string | null {
  const t = mascarar((texto ?? '').trim(), alvo);
  if (!t) return null;
  const pontos = Array.from(t);
  return pontos.length > LIMITE_TEXTO_LIVRE ? `${pontos.slice(0, LIMITE_TEXTO_LIVRE).join('')}[…]` : t;
}

/** A resposta de uma pergunta da anamnese como texto (antes da máscara): sim/não, lista separada por vírgula, número, texto. */
export function respostaDaAnamnese(r: Resposta): string {
  if (typeof r === 'boolean') return r ? 'sim' : 'não';
  if (Array.isArray(r)) return r.join(', ');
  return String(r);
}

/** A anamnese como sai à IA (resumo e rascunho): pergunta e resposta mascaradas, na ordem do snapshot; sem resposta, fora. */
export function respostasMascaradas(
  ana: { templateSnapshot: SnapshotModelo; respostas: Record<string, Resposta> },
  alvo: AlvoDaMascara,
): { pergunta: string; resposta: string | null }[] {
  return ana.templateSnapshot.perguntas.flatMap((q) => {
    const r = ana.respostas[q.id];
    if (r === undefined || r === null) return [];
    return [{ pergunta: mascarar(q.rotulo, alvo), resposta: textoLivre(respostaDaAnamnese(r), alvo) }];
  });
}
