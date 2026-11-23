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
 * - `ne|eq|inArray|notInArray(appointments.status` (Drizzle);
 * - SQL cru `status <> | not in | in ('cancelada'|'agendada'|'confirmada'|'solicitada'…`, também com a coluna interpolada
 *   (`${appointments.status} <> 'cancelada'`);
 * - `Record<string, …> = { agendada: …`: todo mapa indexado por status é `Record<StatusConsulta, …>` (I-03) — este padrão
 *   não tem exceção.
 */

const PADROES: readonly RegExp[] = [
  /status\s*[!=]==\s*'(agendada|confirmada|cancelada|realizada|faltou|solicitada)'/g,
  /\b(ne|eq|inArray|notInArray)\(appointments\.status\b/g,
  /status\}?\s*(<>|not in|in)\s*\(?'(cancelada|agendada|confirmada|solicitada)/gi,
];
const MAPA_SEM_TIPO = /Record<string\s*,[^>]*>\s*=\s*\{[^}]*\bagendada:/g;

/** Quantas comparações de status de consulta o texto tem (exportada para o controle positivo). */
function comparacoesDeStatus(texto: string): number {
  return PADROES.reduce((n, p) => n + (texto.match(p)?.length ?? 0), 0);
}

const mapasSemTipo = (texto: string) => texto.match(MAPA_SEM_TIPO)?.length ?? 0;

/** Os pontos da §4.3 e as comparações que já existiam, com o motivo (o pedido conta ali ou não, e por quê). */
const EXCECOES: Record<string, { n: number; motivo: string }> = {
  'src/modules/agenda/status.ts': { n: 6, motivo: 'selos da consulta (§4.3 "Selos e rótulos") e a situação do pedido no portal (leitura preguiçosa do vencido, RN-427)' },
  'src/modules/agenda/consultas.ts': { n: 3, motivo: 'EXCLUDE e horários livres (`status <> cancelada`: o pedido ocupa, §4.3) e o motivo da nutricionista (só cancelada)' },
  'src/modules/agenda/presenca.ts': { n: 8, motivo: 'presença recusa pedido; atendimento → "pedido"; pendências com STATUS_ATIVOS; métricas e novidades sem o pedido (§4.3, critério do #59)' },
  'src/modules/agenda/inicio.ts': { n: 4, motivo: 'agenda de hoje: o pedido aparece com o selo e não conta no número; nº da consulta pela lista literal (§4.3)' },
  'src/modules/agenda/cancelamento.ts': { n: 2, motivo: 'exclusão LGPD cancela também o pedido (STATUS_OCUPA, §4.3); confirmar presença só agendada → confirmada' },
  'src/modules/agenda/agendamento-paciente.ts': { n: 1, motivo: 'teto de 3 futuras do portal conta o pedido (STATUS_OCUPA, §4.3)' },
  'src/modules/agenda/agendamento-publico.ts': { n: 1, motivo: 'teto de 3 futuras da página pública (T7 passa a STATUS_OCUPA, §4.3)' },
  'src/modules/agenda/acoes-link.ts': { n: 1, motivo: 'link da consulta: "confirmada" (o pedido não tem link, §4.3)' },
  'src/modules/agenda/visoes.ts': { n: 1, motivo: 'a grade mostra tudo menos cancelada (RN-413; o pedido aparece com o selo)' },
  'src/modules/notificacoes/enviar.ts': { n: 3, motivo: 'motivoParaIgnorar (§4.3): cancelada e encerrada' },
  'src/modules/notificacoes/agendar.ts': { n: 1, motivo: 'reativar lembretes depois da suspensão: lista literal sem o pedido (§4.3)' },
  'src/modules/notificacoes/whatsapp/webhook.ts': { n: 1, motivo: 'resposta "1"/"2": lista literal sem o pedido (§4.3)' },
  'src/modules/portal/agenda.ts': { n: 2, motivo: 'Minhas consultas: o pedido entra em "Próximas" (STATUS_OCUPA, §4.3)' },
  'src/modules/portal/mural.ts': { n: 2, motivo: 'mural: STATUS_ATIVOS (o pedido não aparece, §4.3) e "Confirmar presença" só agendada' },
  'src/modules/portal/jornada.ts': { n: 1, motivo: 'jornada: STATUS_ATIVOS (o pedido não aparece, §4.3)' },
  'src/modules/pacientes/atendimentos.ts': { n: 1, motivo: 'o atendimento leva a consulta a realizada (a regra do pedido mora em motivoParaNaoIniciarAtendimento)' },
  'src/modules/financeiro/cobranca.ts': { n: 2, motivo: 'Plano 20: só a consulta realizada é cobrada (o pedido nunca é realizado)' },
  'src/modules/ia/nutri-paciente/job.ts': { n: 1, motivo: 'falso positivo: status da mensagem da IA Nutri, não da consulta' },
  'src/app/painel/agenda/item-consulta.tsx': { n: 1, motivo: 'só a cancelada fica riscada (o pedido não)' },
  'src/app/painel/agenda/consultas/[id]/page.tsx': { n: 3, motivo: 'tela da consulta: cobrança da realizada, "começou" e o motivo da nutricionista (só cancelada)' },
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
  it('controle positivo: os quatro padrões pegam o texto sintético', () => {
    expect(comparacoesDeStatus("and(ne(appointments.status, 'cancelada'), lt(appointments.inicio, x))")).toBe(1);
    expect(comparacoesDeStatus("if (c.status === 'solicitada') return; if (c.status !== 'cancelada') x();")).toBe(2);
    expect(comparacoesDeStatus("sql`count(*) filter (where ${appointments.status} <> 'cancelada')`")).toBe(1);
    expect(comparacoesDeStatus("sql`a.status not in ('cancelada', 'solicitada')`")).toBe(1);
    expect(comparacoesDeStatus("inArray(appointments.status, STATUS_OCUPA)")).toBe(1);
    expect(comparacoesDeStatus("if (p.status === 'bloqueado' || m.status === 'pendente') x();")).toBe(0);
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
