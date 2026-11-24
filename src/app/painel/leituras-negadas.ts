import type { VitestUtils } from 'vitest';

/**
 * Plano 26 (R-482, RNF-484 e): o espião das leituras negadas à recepção, para os testes das páginas de ROTAS_DA_RECEPCAO.
 *
 * Na sessão `recepcao`, a RLS devolve vazio em silêncio numa tabela negada (e um `auditRead` gravaria "Visualizou" em nome
 * dela): o teste da página não veria nada errado. Por isso a lista nomeia os módulos que leem tabela negada à recepção e o
 * espião faz a página FALHAR se chamar algum deles — ou `auditRead` fora da entidade do cadastro (`patients`, "Cadastro do
 * paciente", RN-515). O layout e o Início da recepção são os primeiros a usar (T8); cada página da recepção no PR 3 (T9 a
 * T11b) usa no próprio teste. Contador ou leitura clínica nova de outro plano (22, 23, 25) entra aqui no fim, com o motivo.
 *
 * Não é código do app: só os testes importam (o tipo do `vi` é só tipo; nenhuma rota importa este arquivo).
 */
export type LeituraNegada = {
  /** O módulo, como a página o importa. */
  modulo: string;
  /** As funções que leem tabela negada; `'todas'` = toda função exportada, salvo `exceto` (puras, sem banco). */
  funcoes: readonly string[] | 'todas';
  exceto?: readonly string[];
  motivo: string;
};

export const LEITURAS_NEGADAS: readonly LeituraNegada[] = [
  { modulo: '@/modules/pacientes/etiquetas', funcoes: 'todas', motivo: 'etiquetas (patient_tags, patient_tag_links): podem ser clínicas (RN-508)' },
  {
    modulo: '@/modules/notificacoes/whatsapp/conexao',
    funcoes: 'todas',
    exceto: ['provedorDoApp', 'tenantDaInstancia'],
    motivo: 'conexão do WhatsApp (whatsapp_conexoes, RN-517)',
  },
  {
    modulo: '@/modules/notificacoes/whatsapp/cota',
    funcoes: ['usoDoMes', 'situacaoDaCota', 'situacaoDaCotaNaTransacao', 'avisarSeChegou80'],
    motivo: 'cota do WhatsApp: indicador do Início da nutricionista (RN-514)',
  },
  { modulo: '@/app/painel/pacientes/[id]/prontuario', funcoes: ['carregarProntuario'], motivo: 'a ficha do prontuário (RN-517)' },
  { modulo: '@/modules/agenda/inicio', funcoes: ['lerInicio', 'resumoDoDia', 'resumoDoDiaNaTransacao'], motivo: 'o Início da nutricionista: diário, acesso ao app, métricas e documentos' },
  { modulo: '@/modules/pacientes/exames-enviados', funcoes: 'todas', motivo: 'contador e fila de "Exames recebidos" (exam_submissions)' },
  { modulo: '@/modules/ia/nutri-paciente/duvidas', funcoes: 'todas', motivo: 'contador e fila de "Dúvidas dos pacientes" (ia_nutri_mensagens)' },
  { modulo: '@/modules/portal/diario-nutri', funcoes: 'todas', motivo: 'diários (diary_entries)' },
  { modulo: '@/modules/plataforma/metricas-sucesso', funcoes: 'todas', motivo: 'critérios de sucesso (consultations, access_events)' },
  { modulo: '@/modules/documentos/documentos', funcoes: 'todas', exceto: ['dataHora', 'situacaoNoPainel'], motivo: 'documentos assinados (signed_documents)' },
  { modulo: '@/modules/pacientes/lgpd', funcoes: ['pedidosDoTitularAbertos', 'pedidosDoTitularAbertosNaTransacao'], motivo: 'pedidos do titular (privacy_requests)' },
  { modulo: '@/modules/financeiro/cobranca', funcoes: 'todas', motivo: 'a Cobrança da consulta é só da nutricionista (RE-D61)' },
  { modulo: '@/modules/agenda/presenca', funcoes: ['consultaParaIniciarAtendimento'], motivo: '"Iniciar atendimento" lê consultations (vazio calado na sessão dela)' },
  { modulo: '@/modules/agenda/consultas', funcoes: ['motivoDoCancelamentoDaNutri'], motivo: 'o motivo do cancelamento é só da nutricionista (RE-D44)' },
];

/** RN-515: a única leitura auditada que a recepção faz é a do cadastro do paciente (entidade `patients`). */
export const AUDIT_READ_DA_RECEPCAO: readonly string[] = ['patients'];

export class LeituraNegadaError extends Error {}

/**
 * Registra, com `vi.doMock`, o espião em cada módulo de LEITURAS_NEGADAS e em `auditRead`; devolve a lista do que foi
 * chamado. Chame ANTES do `await import()` da página (e depois de `vi.resetModules()` se ela já foi importada). A função
 * negada lança `LeituraNegadaError` (a página falha) e entra em `chamadas`; as outras funções do módulo continuam as
 * originais. Função listada que não existe no módulo também falha: a lista não apodrece calada.
 */
export function espiarLeiturasNegadas(vi: VitestUtils): { chamadas: string[] } {
  const chamadas: string[] = [];
  for (const l of LEITURAS_NEGADAS) {
    vi.doMock(l.modulo, async (importOriginal: () => Promise<Record<string, unknown>>) => {
      const original = await importOriginal();
      const nomes = l.funcoes === 'todas' ? Object.keys(original).filter((k) => typeof original[k] === 'function' && !(l.exceto ?? []).includes(k)) : l.funcoes;
      const espiado: Record<string, unknown> = { ...original };
      for (const nome of nomes) {
        if (typeof original[nome] !== 'function') throw new Error(`LEITURAS_NEGADAS: ${l.modulo} não exporta a função ${nome}`);
        espiado[nome] = () => {
          chamadas.push(`${l.modulo}#${nome}`);
          throw new LeituraNegadaError(`leitura negada à recepção: ${l.modulo}#${nome} (${l.motivo})`);
        };
      }
      return espiado;
    });
  }
  vi.doMock('@/modules/plataforma/audit', async (importOriginal: () => Promise<typeof import('@/modules/plataforma/audit')>) => {
    const original = await importOriginal();
    return {
      ...original,
      auditRead: (...a: Parameters<typeof original.auditRead>) => {
        const fora = (Array.isArray(a[1]) ? a[1] : [a[1]]).map((x) => x.entidade).filter((e) => !AUDIT_READ_DA_RECEPCAO.includes(e));
        if (fora.length) {
          chamadas.push(...fora.map((e) => `auditRead#${e}`));
          throw new LeituraNegadaError(`auditRead da entidade ${fora.join(', ')} na sessão da recepção (só ${AUDIT_READ_DA_RECEPCAO.join(', ')})`);
        }
        return original.auditRead(...a);
      },
    };
  });
  return { chamadas };
}
