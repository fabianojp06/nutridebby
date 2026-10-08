/**
 * P12-14 (RNF-06, revisão da Tarefa 14): consulta que a tela faz sozinha, sem ninguém mexer (o "Preparando o PDF…", a
 * leitura da IA, o QR do WhatsApp, o PDF do plano), NÃO é uso — não pode empurrar os 30 min sem uso da equipe nem
 * esconder o aviso de inatividade. Toda consulta automática do painel e do admin manda este cabeçalho, e
 * `requireApiUser` (src/lib/api-auth.ts) não renova a sessão quando ele vem; as rotas que só devolvem estado também
 * não renovam por conta própria (`{ renovar: false }`), para valer até com o JavaScript antigo de uma aba aberta antes
 * do deploy. Guarda: `consulta-automatica.test.ts` varre as telas atrás de temporizador com fetch sem o cabeçalho.
 * SEM imports: componentes 'use client' leem daqui. Mandar o cabeçalho só encurta a própria sessão (nunca a estende).
 */
export const CABECALHO_CONSULTA = 'x-nd-consulta';

/** O `init` do fetch de toda consulta automática: sem cache e com o cabeçalho que diz "não é uso". */
export const CONSULTA_AUTOMATICA: RequestInit = { cache: 'no-store', headers: { [CABECALHO_CONSULTA]: '1' } };

export const ehConsultaAutomatica = (headers: Headers): boolean => headers.get(CABECALHO_CONSULTA) === '1';
