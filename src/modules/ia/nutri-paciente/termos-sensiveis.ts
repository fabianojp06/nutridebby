import { normalizar } from './sinais-risco';

/**
 * Plano 15 (RN-176, D25 = b): suplemento, remédio e termos sensíveis — lista a revisar pela Debby. Atua sobre os TRECHOS
 * citados: o trecho é exibido quando o termo da pergunta está nele, verbatim (a nutricionista publicou); pergunta com
 * termo que NÃO está nos trechos citados recebe o texto fixo de suplemento_ou_remedio (invalida_termo).
 */
export const TERMOS_SENSIVEIS: readonly string[] = [
  'whey', 'creatina', 'termogenico', 'cha emagrecedor', 'jejum', 'deficit calorico', 'laxante', 'diuretico', 'suplemento',
  'fitoterapico', 'capsula', 'colageno', 'bcaa', 'glutamina', 'multivitaminico', 'vitamina d', 'omega 3', 'remedio',
  'medicamento', 'sibutramina', 'ozempic', 'semaglutida', 'tirzepatida', 'orlistate', 'anfepramona', 'cafeina em capsula',
];
/**
 * /code-review do PR #37: a borda depois do termo aceita o plural (`s`/`es`: "suplementos", "cápsulas", "remédios") e
 * números colados ("vitamina D3", "ômega-3" → "omega 3"), mas nunca outra letra ("vitamina de banana" não é "vitamina d").
 * Hífen, barra e sublinhado viram espaço nos dois lados (pergunta e trecho).
 */
const semSeparador = (s: string): string => normalizar(s).replace(/[-_/]+/g, ' ');
const comBorda = (termo: string) => new RegExp(`(?<![a-z0-9])${termo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:e?s)?\\d*(?![a-z0-9])`);
export const temTermo = (texto: string, termo: string): boolean => comBorda(termo).test(semSeparador(texto));
export const termosNaPergunta = (pergunta: string): string[] => TERMOS_SENSIVEIS.filter((t) => temTermo(pergunta, t));

/**
 * Revisão de 09/10/2026 (RN-175, §5.2): "posso X se tenho/estou Y" nunca recebe resposta montada — as instruções mandam
 * classificar como sintoma_ou_exame e, como defesa a mais (Review Focus 4), o código também recusa: pergunta de permissão
 * com marcador de condição de saúde, gravidez ou remédio.
 */
const PERMISSAO = /\b(posso|pode|devo|da (pra|para)|tem problema)\b/;
// radicais (gripad, enjoad…) casam o começo da palavra; as palavras curtas têm fim de palavra ("dor" não casa "dormir"),
// com o plural e o verbo (/code-review do PR #37: "dores", "dói")
const CONDICAO = /\b(diarreia|febre|gripe|gripad|resfriad|enjoo|enjoad|nausea|vomit|dor(es)?(?![a-z])|doi(?![a-z])|doendo|azia|refluxo|intestino preso|constipad|gastrite|gravida|gestante|gravidez|amamenta|menstrua|alergi|intoleran|diabet|pressao (alta|baixa)|hipertens|colesterol|glicose|tireoide|cirurgia|operad|remedio|medicamento|antibiotico|tratamento|doente|exames?(?![a-z]))/;
export const perguntaComCondicao = (pergunta: string): boolean => {
  const t = normalizar(pergunta);
  return PERMISSAO.test(t) && CONDICAO.test(t);
};
