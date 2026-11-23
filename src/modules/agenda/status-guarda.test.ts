import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Plano 23 (R-400, I-03, spec §4.3): o status `solicitada` entra só nos pontos da tabela fechada da §4.3. Esta guarda
 * conta, em `src/modules` e `src/app` (fora dos testes), as comparações e os filtros de status **de consulta** e exige a
 * contagem exata de cada arquivo listado em `EXCECOES` (por arquivo, nunca por linha: o número da linha quebra a cada
 * rebase). Um arquivo novo com comparação de status, ou uma comparação nova num arquivo listado, quebra o CI até alguém
 * decidir, pela §4.3, se o pedido conta ali — e atualizar a contagem com o motivo.
 *
 * Padrões (restritos a status de consulta: `status === '` sozinho casa centenas de linhas de outros status):
 * - `status === '<agendada|confirmada|cancelada|realizada|faltou|solicitada>'` (e `!==`);
 * - `ne|eq|inArray|notInArray(appointments.status` (Drizzle), também pelo namespace (`schema.appointments.status`);
 * - `ne|eq|inArray|notInArray(<alias>.status, …)` com um status de consulta ou `STATUS_ATIVOS`/`STATUS_OCUPA` no valor
 *   (`ap.status`, `a.status`: a tabela importada com outro nome);
 * - SQL cru `status <> | != | = | not in | in` com um status de consulta, literal (`'cancelada'`, `('agendada', …`) ou
 *   parametrizado (`<> ${'cancelada'}`), também com a coluna interpolada (`${appointments.status} <> 'cancelada'`);
 * - `.includes(c.status)` (o filtro por uma lista de status: `STATUS_ATIVOS.includes(c.status)`);
 * - `Record<string, …> = { agendada: …`: todo mapa indexado por status é `Record<StatusConsulta, …>` (I-03) — este padrão
 *   não tem exceção.
 * Os falsos positivos (status de documento, de mensagem, HTTP) entram em `EXCECOES` com o motivo "falso positivo".
 */

const ST = 'agendada|confirmada|cancelada|realizada|faltou|solicitada';
const PADROES: readonly RegExp[] = [
  new RegExp(`status\\s*[!=]==\\s*'(?:${ST})'`, 'g'),
  /\b(?:ne|eq|inArray|notInArray)\(\s*(?:[\w$]+\.)*appointments\.status\b/g,
  new RegExp(`\\b(?:ne|eq|inArray|notInArray)\\(\\s*(?![\\w$.]*appointments\\.status\\b)[\\w$]+(?:\\.[\\w$]+)*\\.status\\s*,\\s*(?:\\[\\s*(?:\\.\\.\\.)?)?(?:'(?:${ST})'|STATUS_(?:ATIVOS|OCUPA)\\b)`, 'g'),
  new RegExp(`status\\}?\\s*(?:<>|!=|=|not in|in)\\s*\\(?\\s*(?:'(?:${ST})'|\\$\\{\\s*'(?:${ST})'\\s*\\})`, 'gi'),
  /\.includes\(\s*[\w$.?]*\bstatus\b/g,
];
const MAPA_SEM_TIPO = /Record<string\s*,[^>]*>\s*=\s*\{[^}]*\bagendada:/g;

/** Quantas comparações de status de consulta o texto tem. */
function comparacoesDeStatus(texto: string): number {
  return PADROES.reduce((n, p) => n + (texto.match(p)?.length ?? 0), 0);
}

const mapasSemTipo = (texto: string) => texto.match(MAPA_SEM_TIPO)?.length ?? 0;

/** Os pontos da §4.3 e as comparações que já existiam, com o motivo (o pedido conta ali ou não, e por quê). */
const EXCECOES: Record<string, { n: number; motivo: string }> = {
  'src/modules/agenda/status.ts': { n: 7, motivo: 'selos da consulta (§4.3 "Selos e rótulos"), a situação do pedido no portal (leitura preguiçosa do vencido, RN-427) e o `realizada` do sqlEhRetorno (RN-416)' },
  'src/modules/agenda/consultas.ts': { n: 4, motivo: 'EXCLUDE e horários livres (`status <> cancelada`: o pedido ocupa, §4.3), o motivo da nutricionista (só cancelada) e moverConsulta só em STATUS_ATIVOS (o pedido não se altera)' },
  'src/modules/agenda/presenca.ts': { n: 10, motivo: 'presença recusa pedido; atendimento → "pedido"; pendências com STATUS_ATIVOS; métricas (`= faltou`, `not in (cancelada, solicitada)`) e novidades sem o pedido (§4.3, critério do #59)' },
  'src/modules/agenda/inicio.ts': { n: 5, motivo: 'agenda de hoje: o pedido aparece com o selo e não conta no número nem é a próxima (STATUS_ATIVOS); nº da consulta pela lista literal (§4.3)' },
  'src/modules/agenda/cancelamento.ts': { n: 3, motivo: 'exclusão LGPD cancela também o pedido (STATUS_OCUPA, §4.3); cancelar, remarcar e confirmar só em STATUS_ATIVOS (AG-D70)' },
  'src/modules/agenda/agendamento-paciente.ts': { n: 2, motivo: 'teto de 3 futuras do portal conta o pedido (STATUS_OCUPA, §4.3); o status do RETURNING decide lembretes e avisos (AG-D53)' },
  'src/modules/agenda/agendamento-publico.ts': { n: 2, motivo: 'teto de 3 futuras da página pública conta o pedido (STATUS_OCUPA, §4.3); o status do RETURNING decide entre "agendada" e "pedido" (RN-426, AG-D53)' },
  'src/modules/agenda/acoes-link.ts': { n: 2, motivo: 'link da consulta: ações só em STATUS_ATIVOS e "confirmada" (o pedido não tem link, §4.3)' },
  'src/modules/agenda/solicitacoes.ts': { n: 5, motivo: 'a fila, o aceite, a recusa, a desistência e o vencimento agem só sobre `solicitada` (RN-422, RN-427a)' },
  'src/modules/agenda/visoes.ts': { n: 3, motivo: 'a grade mostra tudo menos cancelada (RN-413; o pedido aparece com o selo); presença a registrar só STATUS_ATIVOS; `realizada` da Primeira consulta/Retorno (RN-416)' },
  'src/modules/notificacoes/enviar.ts': { n: 5, motivo: 'motivoParaIgnorar (§4.3): nada sai de pedido; "não confirmado" só com a cancelada; cancelada e encerrada' },
  'src/modules/notificacoes/agendar.ts': { n: 1, motivo: 'reativar lembretes depois da suspensão: lista literal sem o pedido (§4.3)' },
  'src/modules/notificacoes/whatsapp/webhook.ts': { n: 1, motivo: 'resposta "1"/"2": lista literal sem o pedido (§4.3)' },
  'src/modules/notificacoes/whatsapp/evolution.ts': { n: 1, motivo: 'falso positivo: status HTTP da Evolution, não da consulta' },
  'src/modules/portal/agenda.ts': { n: 3, motivo: 'Minhas consultas: o pedido entra em "Próximas" (STATUS_OCUPA, §4.3); alterar só em STATUS_ATIVOS' },
  'src/modules/portal/mural.ts': { n: 2, motivo: 'mural: STATUS_ATIVOS (o pedido não aparece, §4.3) e "Confirmar presença" só agendada' },
  'src/modules/portal/jornada.ts': { n: 1, motivo: 'jornada: STATUS_ATIVOS (o pedido não aparece, §4.3)' },
  'src/modules/pacientes/atendimentos.ts': { n: 1, motivo: 'o atendimento leva a consulta a realizada (a regra do pedido mora em motivoParaNaoIniciarAtendimento)' },
  'src/modules/plataforma/metricas-sucesso.ts': { n: 2, motivo: 'métricas do admin: só `realizada` (o pedido nunca é realizado; o recorte do pedido está nas funções SQL da 0127, R-410)' },
  'src/modules/financeiro/cobranca.ts': { n: 2, motivo: 'Plano 20: só a consulta realizada é cobrada (o pedido nunca é realizado)' },
  'src/modules/documentos/documentos.ts': { n: 1, motivo: 'falso positivo: status do documento assinado, não da consulta' },
  'src/modules/ia/leitura-job.ts': { n: 1, motivo: 'falso positivo: status da tarefa de IA, não da consulta' },
  'src/modules/ia/nutri-paciente/job.ts': { n: 1, motivo: 'falso positivo: status da mensagem da IA Nutri, não da consulta' },
  'src/modules/ia/nutri-paciente/revogacao-job.ts': { n: 1, motivo: 'falso positivo: status da mensagem da IA Nutri (`cancelada`), não da consulta' },
  'src/app/painel/agenda/item-consulta.tsx': { n: 1, motivo: 'só a cancelada fica riscada (o pedido não)' },
  'src/app/painel/agenda/consultas/[id]/page.tsx': { n: 4, motivo: 'tela da consulta: cobrança da realizada, ações só em STATUS_ATIVOS, "começou" e o motivo da nutricionista (só cancelada)' },
  'src/app/p/(portal)/agenda/[id]/page.tsx': { n: 4, motivo: 'portal: ações só na agendada/confirmada (o pedido não remarca nem confirma, §4.3)' },
};

const PASTAS = ['src/modules', 'src/app'];
const ehFonte = (f: string) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f);

function arquivos(pasta: string): string[] {
  return readdirSync(pasta, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(pasta, e.name);
    return e.isDirectory() ? arquivos(p) : ehFonte(p) ? [p] : [];
  });
}

const fontes = PASTAS.flatMap(arquivos).map((arquivo) => ({ arquivo: arquivo.split(path.sep).join('/'), texto: readFileSync(arquivo, 'utf8') }));

describe('guarda de status (Plano 23, R-400, I-03)', () => {
  it('controle positivo: os padrões pegam o texto sintético (inclusive alias, namespace, `!=`/`=`, valor parametrizado e `.includes`)', () => {
    expect(comparacoesDeStatus("and(ne(appointments.status, 'cancelada'), lt(appointments.inicio, x))")).toBe(1);
    expect(comparacoesDeStatus("if (c.status === 'solicitada') return; if (c.status !== 'cancelada') x();")).toBe(2);
    expect(comparacoesDeStatus("sql`count(*) filter (where ${appointments.status} <> 'cancelada')`")).toBe(1);
    expect(comparacoesDeStatus("sql`a.status not in ('cancelada', 'solicitada')`")).toBe(1);
    expect(comparacoesDeStatus("inArray(appointments.status, STATUS_OCUPA)")).toBe(1);
    // desvios: `!=` e `=` no SQL, valor parametrizado, alias e namespace no Drizzle, `.includes`
    expect(comparacoesDeStatus("sql`ap.status != 'cancelada' and ap.status = 'realizada'`")).toBe(2);
    expect(comparacoesDeStatus("sql`${appointments.status} <> ${'cancelada'}`")).toBe(1);
    expect(comparacoesDeStatus("and(eq(a.status, 'solicitada'), ne(ap.status, 'cancelada'), inArray(c.status, [...STATUS_ATIVOS]))")).toBe(3);
    expect(comparacoesDeStatus("eq(schema.appointments.status, 'agendada')")).toBe(1);
    expect(comparacoesDeStatus("STATUS_ATIVOS.includes(c.status); (STATUS_OCUPA as readonly string[]).includes(x.status as StatusConsulta)")).toBe(2);
    // o que não é status de consulta não conta
    expect(comparacoesDeStatus("if (p.status === 'bloqueado' || m.status === 'pendente') x();")).toBe(0);
    expect(comparacoesDeStatus("and(eq(patients.status, 'ativo'), inArray(notifications.status, ['pendente', 'enviando']))")).toBe(0);
    expect(comparacoesDeStatus("sql`p.status = 'ativo'`")).toBe(0);
    expect(mapasSemTipo("const SITUACAO: Record<string, string> = { agendada: 'Agendada' };")).toBe(1);
    expect(mapasSemTipo("const SITUACAO: Record<StatusConsulta, string> = { agendada: 'Agendada' };")).toBe(0);
  });

  it('nenhum mapa de status `Record<string, …>` com a chave `agendada:` (I-03: `Record<StatusConsulta, …>`)', () => {
    expect(fontes.filter((f) => mapasSemTipo(f.texto) > 0).map((f) => f.arquivo)).toEqual([]);
  });

  it('comparações de status de consulta só nos arquivos de EXCECOES, com a contagem exata (spec §4.3)', () => {
    const achados = Object.fromEntries(fontes.map((f) => [f.arquivo, comparacoesDeStatus(f.texto)]).filter(([, n]) => (n as number) > 0));
    const esperado = Object.fromEntries(Object.entries(EXCECOES).map(([a, e]) => [a, e.n]));
    expect(achados).toEqual(esperado);
  });

  it('toda exceção tem motivo', () => {
    for (const [arquivo, e] of Object.entries(EXCECOES)) expect(e.motivo.length, arquivo).toBeGreaterThan(10);
  });
});
