import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { and, asc, desc, eq, inArray, lt, ne, or, sql } from 'drizzle-orm';
import { strToU8, zipSync } from 'fflate';
import { fromDrizzle, type PgBoss } from 'pg-boss';
import type { Db, Tx } from '@/db/client';
import {
  anamneses,
  anthropometry,
  appointments,
  consents,
  consultations,
  contents,
  dataExports,
  diaryEntries,
  energyCalcs,
  examSubmissions,
  exams,
  examVersoes,
  examInterpretacoes,
  foods,
  iaAutorizacoes,
  iaTarefas,
  lembretesRotina,
  mealItems,
  mealPlans,
  meals,
  notifications,
  patientCadastro,
  patients,
  privacyRequests,
  pushSubscriptions,
  storedFiles,
  user,
} from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { enqueueEmail } from '@/email/queue';
import { getBoss } from '@/jobs/boss';
import { getEnv } from '@/env';
import { logger } from '@/lib/logger';
import {
  apagarArquivo,
  CotaEsgotadaError,
  motivoDoErro,
  resolverCaminho,
  salvarArquivo,
} from '@/modules/plataforma/armazenamento';
import {
  buscarTenant,
  listarTenantsParaVarredura,
  tenantIsActive,
} from '@/modules/plataforma/tenant-status';
import { conteudosDoTitular, type ConteudosDoTitular } from '@/modules/conteudo/titular';
import { DESTINO_ROTULO, ROTULO_DESTINO_LEGADO, type DestinoIA } from '@/modules/ia/constantes';
import { iaNutriParaExportacao, type IaNutriExportado } from '@/modules/ia/nutri-paciente/lgpd';
import { documentosParaExportacao, type DocumentoExportado } from '@/modules/documentos/lgpd-documentos';
import { financeiroParaExportacao, type FinanceiroExportado } from '@/modules/financeiro/titular';
import { mensagensParaExportacao, type ConversaExportada, type MensagemExportada } from '@/modules/mensagens/lgpd';
import { ROTULO_RESPOSTA, type RespostaDoDiario } from '@/modules/portal/diario-constantes';
import { respostaParaCampo } from './anamnese-tipos';
import { ESCOLARIDADES, ESTADOS_CIVIS, IDENTIDADES_DE_GENERO, type Opcao } from './cadastro-textos';
import { formatarCep } from './cep';
import { formatarCpf } from './cpf';
import { ROTULO_MOTIVO_RECUSA, type MotivoRecusa } from './exames-enviados-constantes';
import { hojeNoFuso } from './datas';
import { EXPORTACAO_VALIDADE_MS, linkDaExportacao } from './exportacao';
import { FORMULAS_TMB, kcal } from './formulas';
import { formatarTelefone } from './telefone';
import { renderizarProntuario } from './prontuario-pdf';

// Só o worker importa este arquivo (e o PDF): @react-pdf/renderer fica fora do grafo do Next.

/** Plano 18 (§10): o cadastro complementar no `dados.json`. */
export type CadastroExportado = {
  cpf: string | null;
  nomeSocial: string | null;
  identidadeDeGenero: string | null;
  estadoCivil: string | null;
  escolaridade: string | null;
  ocupacao: string | null;
  nacionalidade: string | null;
  naturalidade: string | null;
  telefoneFixo: string | null;
  endereco: {
    cep: string | null;
    rua: string | null;
    numero: string | null;
    complemento: string | null;
    bairro: string | null;
    cidade: string | null;
    uf: string | null;
  };
  observacao: string | null;
};

/** O rótulo da tela de um valor de lista fechada (um valor fora da lista, que o CHECK não deixa gravar, sai como está). */
const rotuloDe = (opcoes: readonly Opcao<string>[], valor: string | null) =>
  valor === null ? null : (opcoes.find((o) => o.valor === valor)?.rotulo ?? valor);

/**
 * Plano 18 (§10, D18): o cadastro complementar por inclusão explícita — cada coluna nomeada aqui (as decisões de cada
 * coluna em `colunas-decididas.test.ts`); uma coluna nova da tabela não entra sem passar por lá.
 */
async function cadastroParaExportacao(tx: Tx, patientId: string): Promise<CadastroExportado | null> {
  const [c] = await tx
    .select({
      cpf: patientCadastro.cpf,
      nomeSocial: patientCadastro.nomeSocial,
      identidadeGenero: patientCadastro.identidadeGenero,
      estadoCivil: patientCadastro.estadoCivil,
      escolaridade: patientCadastro.escolaridade,
      ocupacao: patientCadastro.ocupacao,
      nacionalidade: patientCadastro.nacionalidade,
      naturalidade: patientCadastro.naturalidade,
      telefoneFixoE164: patientCadastro.telefoneFixoE164,
      cep: patientCadastro.cep,
      logradouro: patientCadastro.logradouro,
      numero: patientCadastro.numero,
      complemento: patientCadastro.complemento,
      bairro: patientCadastro.bairro,
      cidade: patientCadastro.cidade,
      uf: patientCadastro.uf,
      observacao: patientCadastro.observacao,
    })
    .from(patientCadastro)
    .where(eq(patientCadastro.patientId, patientId));
  if (!c) return null;
  return {
    cpf: c.cpf ? formatarCpf(c.cpf) : null,
    nomeSocial: c.nomeSocial,
    identidadeDeGenero: rotuloDe(IDENTIDADES_DE_GENERO, c.identidadeGenero),
    estadoCivil: rotuloDe(ESTADOS_CIVIS, c.estadoCivil),
    escolaridade: rotuloDe(ESCOLARIDADES, c.escolaridade),
    ocupacao: c.ocupacao,
    nacionalidade: c.nacionalidade,
    naturalidade: c.naturalidade,
    telefoneFixo: c.telefoneFixoE164 ? formatarTelefone(c.telefoneFixoE164) : null,
    endereco: {
      cep: c.cep ? formatarCep(c.cep) : null,
      rua: c.logradouro,
      numero: c.numero,
      complemento: c.complemento,
      bairro: c.bairro,
      cidade: c.cidade,
      uf: c.uf,
    },
    observacao: c.observacao,
  };
}

/** US-046 (Plano 06): `equipe` = pedida pela nutricionista; `titular` = pelo paciente no portal (sem rascunho). */
export type EscopoExportacao = 'equipe' | 'titular';

export type DadosExportacao = {
  versao: 1;
  geradoEm: string;
  /** Data da emissão no fuso do tenant (RN-06): 22h em São Paulo ainda é o mesmo dia. */
  dataEmissao: string;
  paciente: {
    nome: string;
    dataNascimento: string | null;
    sexo: string | null;
    email: string;
    telefone: string | null;
    status: string;
    cadastradoEm: string;
    /**
     * Plano 11 (legado, RN-128): a ciência do aviso de IA e o "Não usar IA" — saem só quando preenchidos (as colunas estão
     * congeladas desde o Plano 14A; o esperado em produção é nunca).
     */
    avisoIa?: { versao: string; em: string; canal: string };
    avisoIaEnviadoEm?: string;
    recusouIaEm?: string;
    /**
     * Plano 14A (US-113, LGPD art. 18): cada evento da autorização de IA — autorizou, retirou, pedido por e-mail — com a
     * versão, os usos, o destino (código e rótulo, RN-109), o canal, o ato, o registro, o IP e o user-agent (nulos no papel,
     * no pedido e na retirada pela nutricionista); `termo` = a foto ou o PDF do termo em papel no ZIP (`autorizacao-ia/…`).
     * O HMAC do e-mail não sai (não serve ao titular).
     */
    autorizacoesIa: {
      evento: string;
      versao: string | null;
      usos: string[] | null;
      destino: { codigo: string; rotulo: string } | null;
      canal: string;
      em: string;
      registradoEm: string;
      ip: string | null;
      userAgent: string | null;
      termo: string | null;
    }[];
    /**
     * Plano 16 (G-D1, D6 ★ revista na revisão do plano): preferência de exibição no app definida pela nutricionista ("Não
     * mostrar peso no app", desde quando) — nos DOIS escopos: é dado pessoal do titular (LGPD art. 5º, I; art. 18, II). Tirar
     * da cópia do titular só com o parecer do advogado (E-09) e a base no LEIA-ME. O peso das avaliações vai nos dois (RN-204).
     */
    pesoOcultoNoAppEm: string | null;
    /** Plano 17 (§5.5): "Pausar todos os lembretes" (desde quando), escolha do próprio titular — nos dois escopos. */
    lembretesPausadosEm: string | null;
    /**
     * Plano 18 (§10, D18, RN-262): o cadastro complementar (`patient_cadastro`) — nos dois escopos. CPF e telefone fixo
     * formatados como a tela; identidade de gênero, estado civil e escolaridade pelo rótulo que a tela mostra (LGPD, art.
     * 18, II e V; art. 19, § 3º); CEP como a tela. O único lugar fora do formulário com o CPF (RN-262). Sem linha (nunca
     * preenchido): `null`.
     */
    cadastro: CadastroExportado | null;
  };
  anamneses: {
    data: string;
    modelo: string;
    respostas: { pergunta: string; resposta: string }[];
  }[];
  antropometria: {
    data: string;
    pesoKg: number;
    alturaCm: number;
    imc: number | null;
    percGordura: number | null;
    protocolo: string;
    circunferencias: Record<string, number>;
    dobrasMm: Record<string, number>;
  }[];
  gastoEnergetico: {
    data: string;
    formula: string;
    pesoKg: number;
    alturaCm: number;
    idade: number;
    fatorAtividade: number;
    tmbKcal: number;
    getKcal: number;
  }[];
  exames: {
    data: string;
    titulo: string;
    temLaudo: boolean;
    /** Caminho do laudo dentro do ZIP (`laudos/…`); null se não há laudo ou se ele ficou de fora. */
    laudo: string | null;
    /**
     * Plano 11: `iaTarefaId` = a linha veio de uma sugestão da IA conferida (liga com `ia[].id`). Plano 22 (RN-376):
     * `refMin`/`refMax`, a faixa numérica do laudo, quando informada.
     */
    valores: { nome: string; valor: number; unidade: string | null; referencia: string | null; iaTarefaId?: string; refMin?: number; refMax?: number }[];
    /**
     * Plano 22 (RN-378, EP-D41; Review Focus 6): o estado do exame antes de cada edição (`exam_versoes`, staff_only, por
     * inclusão explícita), da mais antiga para a mais nova — sem a justificativa e sem o autor (RN-399).
     */
    versoesAnteriores: {
      versao: number;
      titulo: string;
      data: string;
      valores: { nome: string; valor: number; unidade: string | null; referencia: string | null; iaTarefaId?: string; refMin?: number; refMax?: number }[];
      alteradoEm: string;
    }[];
    /**
     * Plano 22 (RN-383, RN-399, EP-D19; Review Focus 6): a nota de interpretação em vigor (`exam_interpretacoes`,
     * staff_only, por inclusão explícita) — nos dois escopos: é a interpretação clínica do exame do próprio titular
     * (prontuário), não nota privada; o campo diz isso à nutricionista. `null` sem nota (ou apagada). Nunca vai ao PDF.
     */
    notaDeInterpretacao: string | null;
    /** Só no escopo da equipe: as versões da nota antes da em vigor (`texto` nulo = "Apagar nota"), sem o autor. */
    notasAnteriores?: { versao: number; texto: string | null; criadoEm: string }[];
  }[];
  /** Só as orientações: notas privadas (staff_only) nunca saem (US-016). */
  atendimentos: { data: string; orientacoes: string | null }[];
  /** Planos alimentares: todas as versões; o rascunho só no escopo da equipe. Publicado/arquivado com os valores congelados (D10). */
  planos: {
    versao: number;
    status: string;
    titulo: string;
    publicadoEm: string | null;
    metaKcal: number | null;
    orientacoes: string;
    refeicoes: {
      nome: string;
      horario: string;
      observacao: string;
      /** US-054 (Plano 07): o título da receita sugerida na refeição (null sem sugestão ou se o conteúdo não existe mais). */
      sugestaoDeReceita: string | null;
      itens: { alimento: string; quantidadeG: number; medida: string | null; substituiDe: string | null }[];
    }[];
  }[];
  pedidosLgpd: { tipo: string; status: string; prazo: string; concluidoEm: string | null }[];
  /**
   * Plano 05: consultas da agenda. O motivo do cancelamento só quando o paciente cancelou: o da nutricionista é
   * anotação dela ("Só você vê.", como as notas privadas — US-016).
   */
  consultas: { inicio: string; fim: string; modalidade: string; status: string; origem: string; canceladoPor: string | null; motivoCancelamento: string | null }[];
  /** Plano 05: mensagens ao titular (tipo, canal, situação e datas) — sem texto, número de destino nem ids do provedor. */
  lembretes: { tipo: string; canal: string; status: string; agendadaPara: string; enviadaEm: string | null; motivoNaoEnviado: string | null }[];
  /**
   * Plano 17 (§5.5): lembretes de rotina por push (configuração da equipe, o nome do suplemento ou o texto livre e a escolha
   * do titular de desligar) — nos dois escopos. Sem a marca do último envio (lembretes_rotina_envios: registro técnico do
   * worker, STAFF_ONLY) nem quem criou. A chave `lembretes` é das mensagens das consultas (Plano 05).
   */
  lembretesDeRotina: { tipo: string; config: unknown; texto: string | null; ligado: boolean; desligadoPeloPacienteEm: string | null; criadoEm: string }[];
  /** D13: aceites do termo do paciente neste consultório (pela conta ou pela página pública), com o IP do aceite. */
  aceitesDoTermo: { termoVersao: string; aceitoEm: string; ip: string | null }[];
  /** D14 / T13: aparelhos inscritos para notificação no app — só a data e o navegador (nunca o endereço ou as chaves). */
  dispositivosPush: { criadaEm: string; navegador: string | null }[];
  /**
   * Plano 06: diário alimentar (US-042/043) — texto, refeição, a resposta à refeição do plano (Plano 16), comentário da
   * nutricionista e a foto (em `diario/`).
   */
  diario: {
    dataHora: string;
    refeicao: string;
    texto: string | null;
    foto: string | null;
    comentarioNutri: string | null;
    /** Plano 16 (RN-197): "como_no_plano" | "outra_coisa" | null. */
    resposta: string | null;
    /** O texto que o paciente viu: "Comi assim" | "Comi outra coisa" | null (LGPD art. 19, II). */
    respostaRotulo: string | null;
    /** "{nome} · {HH:MM}" da refeição do plano (cópia). */
    refeicaoDoPlano: string | null;
  }[];
  /** Plano 07 (D15): conteúdos que o titular abriu e favoritou (título e data). */
  conteudos: ConteudosDoTitular;
  /** Plano 10A (US-150 base): receitas; o titular recebe só as emitidas (D15 = (b): com a justificativa de uso). */
  documentos: DocumentoExportado[];
  /**
   * Plano 11 (spec §5.3; LGPD art. 18, VII, e art. 37): pedidos à IA — id (liga com `exames[].valores[].iaTarefaId`), tipo,
   * situação, datas, se o laudo saiu ao provedor (`enviadoEm` = `saiu_em`) e para quem. Nunca a sugestão (ia_tarefas é
   * staff_only: inclusão explícita).
   */
  ia: {
    id: string;
    tipo: string;
    status: string;
    criadoEm: string;
    encerradoEm: string | null;
    enviadoEm: string | null;
    /**
     * RN-109: o código gravado no portão do envio; `provedor` é o rótulo dele — tarefa antiga com saída e sem destino =
     * Anthropic, EUA, o único provedor do Plano 11.
     */
    destino: string | null;
    provedor: string | null;
  }[];
  /**
   * Plano 12 (§13.3): exames enviados pelo paciente pelo app — envio, coleta, nome, observação, situação e motivo da recusa.
   * `pdf` = o PDF limpo no ZIP (`envios/…`), só dos que aguardam revisão (o dos aceitos já sai em `laudos/`, como exame).
   * Nunca as imagens de página nem os originais.
   */
  examesEnviados: {
    enviadoEm: string;
    dataColeta: string;
    nome: string | null;
    observacao: string | null;
    situacao: string;
    motivoRecusa: string | null;
    /** Revisão do plano (LGPD art. 19, II — origem do dado): quando a nutricionista aceitou ou recusou. */
    revisadoEm: string | null;
    /** Revisão do plano: o exame em que o envio aceito se transformou (o mesmo de `exames[]`); null se não aceito ou excluído. */
    exame: { data: string; titulo: string } | null;
    pdf: string | null;
  }[];
  /**
   * Plano 15 (§7.6, RN-109): a conversa com a IA Nutri e os consentimentos — o titular e a equipe recebem; nunca índices,
   * motivo técnico, modelo nem custo. Cópia integral do que é do titular (LGPD art. 19, § 3º; revisão da T10): IP e
   * user-agent dos consentimentos, a avaliação das respostas, e nas perguntas enviadas à nutricionista a data e a situação
   * da dúvida. Datas em ISO 8601, como os outros blocos; `enviadaEm` e `destino` só nas perguntas que saíram ao provedor.
   * Na equipe, a pergunta com risco de quem desativou a IA Nutri vem sem o texto (D22: lê-se uma vez, pela fila).
   */
  iaNutri: IaNutriExportado;
  /**
   * Plano 25 (RN-467, CH-D74): a conversa por mensagens com a nutricionista — a liberação (forma do TCLE, nome e CRN de quem
   * liberou), a pausa e as mensagens (o carimbo só nas da nutricionista) — nos dois escopos: é prontuário (CH-D2).
   */
  conversa: ConversaExportada | null;
  mensagens: MensagemExportada[];
  /** Os laudos, fotos do diário ou PDFs de documentos passaram do teto de memória da exportação e não foram no ZIP. */
  laudosForaDoZip: boolean;
  /**
   * Plano 20 (US-307, spec §10, F-D22): os lançamentos do Financeiro com o titular — nos dois escopos, só aqui (o
   * prontuario.pdf não muda). Cópia integral do que é do titular (LGPD art. 19, § 3º): descrição, categoria e motivo do
   * cancelamento inclusive; nunca quem lançou nem quem cancelou (dado da equipe). fin_lancamentos é staff_only: inclusão explícita.
   */
  financeiro: FinanceiroExportado[];
};

/**
 * Arquivo a copiar para o ZIP: laudo (`indice` em `exames`), foto do diário (`indice` em `diario`), PDF assinado de
 * documento (`indice` em `documentos`, Plano 10A), PDF limpo de exame enviado aguardando revisão (`indice` em
 * `examesEnviados`, Plano 12) ou termo em papel da autorização de IA (`indice` em `paciente.autorizacoesIa`, Plano 14A);
 * `nome` sem texto do usuário (data + posição).
 */
type AnexoParaZip = { tipo: 'laudo' | 'foto' | 'documento' | 'envio' | 'termo'; indice: number; caminho: string; nome: string };

/** O ZIP é montado em memória no worker: acima disto, laudos e fotos ficam de fora (com aviso), não a exportação. */
export const LIMITE_LAUDOS_BYTES = 100 * 1024 ** 2;

/** "Sim"/"Não" só na pergunta sim/não: em texto livre, "nao" é o que foi digitado. */
const texto = (tipo: string, v: string | string[]) =>
  Array.isArray(v) ? v.join(', ') : tipo === 'sim_nao' ? ({ sim: 'Sim', nao: 'Não' }[v] ?? v) : v;
const NOME_FORMULA = Object.fromEntries(FORMULAS_TMB.map((f) => [f.id, f.nome]));

/**
 * D04-1: todas as versões do plano em 4 consultas fixas — planos, refeições, itens e os títulos das receitas (antes, uma
 * leitura completa por versão). Publicado/arquivado com os nomes congelados na publicação (D10 do Plano 04); o rascunho
 * com os atuais. Mesma forma de antes, mais a sugestão de receita da refeição (o título, se ainda existir — D13; para o
 * titular, só se estiver publicada).
 */
async function planosParaExportacao(tx: Tx, ids: string[], escopo: EscopoExportacao): Promise<DadosExportacao['planos']> {
  if (!ids.length) return [];
  const ps = await tx.select().from(mealPlans).where(inArray(mealPlans.id, ids)).orderBy(asc(mealPlans.versao));
  const rs = await tx.select().from(meals).where(inArray(meals.planId, ids)).orderBy(asc(meals.ordem));
  const its = await tx
    .select({ i: mealItems, nome: foods.nome })
    .from(mealItems)
    .innerJoin(foods, eq(foods.id, mealItems.foodId))
    .where(inArray(mealItems.planId, ids))
    .orderBy(asc(mealItems.ordem));
  const idsReceita = [...new Set(rs.flatMap((r) => (r.recipeContentId ? [r.recipeContentId] : [])))];
  // P-16 b / D13: o titular vê a sugestão só da receita publicada, como no portal (o cartão some) — o título de uma
  // receita despublicada (e talvez renomeada como rascunho interno) não vai para o dados.json dele; a equipe vê todas
  const titulos = new Map(
    idsReceita.length
      ? (await tx.select({ id: contents.id, titulo: contents.titulo, status: contents.status }).from(contents).where(inArray(contents.id, idsReceita)))
          .filter((c) => escopo !== 'titular' || c.status === 'publicado')
          .map((c) => [c.id, c.titulo])
      : [],
  );
  return ps.map((p) => {
    const nomeDo = (x: (typeof its)[number]) => (p.status !== 'rascunho' && x.i.nutrientes ? x.i.nutrientes.nome : x.nome);
    return {
      versao: p.versao,
      status: p.status,
      titulo: p.titulo,
      publicadoEm: p.publicadoEm?.toISOString() ?? null,
      metaKcal: p.metaKcal,
      orientacoes: p.orientacoes,
      refeicoes: rs
        .filter((r) => r.planId === p.id)
        .map((r) => {
          const itens = its.filter((x) => x.i.mealId === r.id);
          return {
            nome: r.nome,
            horario: r.horario ? r.horario.slice(0, 5) : '',
            observacao: r.observacao,
            sugestaoDeReceita: r.recipeContentId ? (titulos.get(r.recipeContentId) ?? null) : null,
            itens: itens.map((x) => {
              const principal = x.i.substituiItemId ? itens.find((y) => y.i.id === x.i.substituiItemId) : undefined;
              return { alimento: nomeDo(x), quantidadeG: x.i.quantidadeG, medida: x.i.medidaCaseiraTxt, substituiDe: principal ? nomeDo(principal) : null };
            }),
          };
        }),
    };
  });
}

/**
 * Todas as tabelas do paciente, menos as staff_only (notas privadas, etiquetas; ia_tarefas e fin_lancamentos entram por
 * inclusão explícita), salvo `exam_versoes` (Plano 22, EP-D41) e `exam_interpretacoes` (EP-D19) — inclusive o cadastro
 * complementar (`patient_cadastro`, Plano 18, por inclusão explícita: `cadastroParaExportacao`). Consultas em sequência:
 * uma transação é uma conexão só, e consultas paralelas nela geram o aviso de descontinuação do pg 8.23
 * (erro no pg 9).
 */
export async function montarDados(
  tx: Tx,
  patientId: string,
  now: Date,
  fuso: string,
  escopo: EscopoExportacao = 'equipe',
): Promise<{ dados: DadosExportacao; laudos: AnexoParaZip[] }> {
  const [p] = await tx.select().from(patients).where(eq(patients.id, patientId));
  const cadastro = await cadastroParaExportacao(tx, patientId); // Plano 18 (§10): os dois escopos
  const as = await tx
    .select()
    .from(anamneses)
    .where(eq(anamneses.patientId, patientId))
    .orderBy(asc(anamneses.data));
  const an = await tx
    .select()
    .from(anthropometry)
    .where(eq(anthropometry.patientId, patientId))
    .orderBy(asc(anthropometry.data));
  const gs = await tx
    .select()
    .from(energyCalcs)
    .where(eq(energyCalcs.patientId, patientId))
    .orderBy(asc(energyCalcs.createdAt));
  const ex = await tx
    .select()
    .from(exams)
    .where(eq(exams.patientId, patientId))
    .orderBy(asc(exams.data));
  // Plano 22 (EP-D41): as versões anteriores, por inclusão explícita (staff_only), só as colunas que saem
  const vs = await tx
    .select({ examId: examVersoes.examId, versao: examVersoes.versao, titulo: examVersoes.titulo, data: examVersoes.data, valores: examVersoes.valores, alteradoEm: examVersoes.alteradoEm })
    .from(examVersoes)
    .where(eq(examVersoes.patientId, patientId))
    .orderBy(asc(examVersoes.examId), asc(examVersoes.versao));
  const versoesPorExame = new Map<string, DadosExportacao['exames'][number]['versoesAnteriores']>();
  for (const v of vs) {
    const lista = versoesPorExame.get(v.examId) ?? [];
    lista.push({ versao: v.versao, titulo: v.titulo, data: v.data, valores: v.valores, alteradoEm: v.alteradoEm.toISOString() });
    versoesPorExame.set(v.examId, lista);
  }
  // Plano 22 (EP-D19): a nota de interpretação, por inclusão explícita (staff_only), sem o autor; da mais nova para a mais antiga
  const notasDosExames = await tx
    .select({ examId: examInterpretacoes.examId, versao: examInterpretacoes.versao, texto: examInterpretacoes.texto, criadoEm: examInterpretacoes.criadoEm })
    .from(examInterpretacoes)
    .where(eq(examInterpretacoes.patientId, patientId))
    .orderBy(asc(examInterpretacoes.examId), desc(examInterpretacoes.versao));
  const notasPorExame = new Map<string, { versao: number; texto: string | null; criadoEm: string }[]>();
  for (const n of notasDosExames) {
    const lista = notasPorExame.get(n.examId) ?? [];
    lista.push({ versao: n.versao, texto: n.texto, criadoEm: n.criadoEm.toISOString() });
    notasPorExame.set(n.examId, lista);
  }
  const at = await tx
    .select({ data: consultations.data, orientacoes: consultations.orientacoesPaciente })
    .from(consultations)
    .where(eq(consultations.patientId, patientId))
    .orderBy(asc(consultations.data));
  const pr = await tx
    .select()
    .from(privacyRequests)
    .where(eq(privacyRequests.patientId, patientId))
    .orderBy(asc(privacyRequests.createdAt));
  const cs = await tx.select().from(appointments).where(eq(appointments.patientId, patientId)).orderBy(asc(appointments.inicio));
  const ns = await tx
    .select({ tipo: notifications.tipo, canal: notifications.canal, status: notifications.status, agendadaPara: notifications.agendadaPara, enviadaEm: notifications.enviadaEm, motivo: notifications.motivoIgnorada })
    .from(notifications)
    .where(eq(notifications.patientId, patientId))
    .orderBy(asc(notifications.agendadaPara), asc(notifications.createdAt));
  // consents fica fora da RLS (RLS_EXCEPTIONS): filtra pelo tenant do contexto e pelo titular (prontuário ou conta)
  const ac = await tx
    .select({ termoVersao: consents.termoVersao, aceitoEm: consents.aceitoEm, ip: consents.ip })
    .from(consents)
    .where(and(eq(consents.tenantId, p.tenantId), or(eq(consents.patientId, p.id), p.userId ? eq(consents.userId, p.userId) : undefined)))
    .orderBy(asc(consents.aceitoEm));
  const ps = await tx
    .select({ criadaEm: pushSubscriptions.createdAt, navegador: pushSubscriptions.userAgent })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.patientId, patientId))
    .orderBy(asc(pushSubscriptions.createdAt));
  const lr = await tx
    .select({ tipo: lembretesRotina.tipo, config: lembretesRotina.config, texto: lembretesRotina.texto, ligado: lembretesRotina.ligado, desligadoPeloPacienteEm: lembretesRotina.desligadoPeloPacienteEm, criadoEm: lembretesRotina.createdAt })
    .from(lembretesRotina)
    .where(eq(lembretesRotina.patientId, patientId))
    .orderBy(asc(lembretesRotina.createdAt), asc(lembretesRotina.id));
  const di = await tx.select().from(diaryEntries).where(eq(diaryEntries.patientId, patientId)).orderBy(asc(diaryEntries.dataHora));
  const ee = await tx.select().from(examSubmissions).where(eq(examSubmissions.patientId, patientId)).orderBy(asc(examSubmissions.createdAt));
  // P-16 (b): o titular não recebe o rascunho (a sessão de paciente também não o vê — paciente_sem_rascunho)
  const ids = await tx
    .select({ id: mealPlans.id })
    .from(mealPlans)
    .where(and(eq(mealPlans.patientId, patientId), escopo === 'titular' ? ne(mealPlans.status, 'rascunho') : undefined))
    .orderBy(asc(mealPlans.versao));
  const planos = await planosParaExportacao(tx, ids.map((x) => x.id), escopo); // a exportação já registra "exportar"
  const conteudos = await conteudosDoTitular(tx, patientId);
  const docs = await documentosParaExportacao(tx, patientId, escopo);
  const tarefasIa = await tx
    .select({ id: iaTarefas.id, tipo: iaTarefas.tipo, status: iaTarefas.status, criadoEm: iaTarefas.criadoEm, encerradoEm: iaTarefas.encerradoEm, saiuEm: iaTarefas.saiuEm, destino: iaTarefas.destino })
    .from(iaTarefas)
    .where(eq(iaTarefas.patientId, patientId))
    .orderBy(asc(iaTarefas.criadoEm));
  // Plano 14A (US-113): os eventos da autorização de IA, na ordem em que foram registrados (o titular lê os próprios — sem staff_only)
  const autorizacoes = await tx
    .select({
      evento: iaAutorizacoes.evento,
      versao: iaAutorizacoes.versao,
      usos: iaAutorizacoes.usos,
      destino: iaAutorizacoes.destino,
      canal: iaAutorizacoes.canal,
      em: iaAutorizacoes.em,
      registradoEm: iaAutorizacoes.registradoEm,
      ip: iaAutorizacoes.ip,
      userAgent: iaAutorizacoes.userAgent,
      arquivoPath: iaAutorizacoes.arquivoPath,
    })
    .from(iaAutorizacoes)
    .where(eq(iaAutorizacoes.patientId, patientId))
    .orderBy(asc(iaAutorizacoes.registradoEm), asc(iaAutorizacoes.id));
  // Plano 15 (§7.6): a conversa com a IA Nutri e os consentimentos (os dois escopos; na equipe, sem o texto da D22)
  const iaNutri = await iaNutriParaExportacao(tx, patientId, escopo);
  // Plano 25 (RN-467): a conversa por mensagens (os dois escopos)
  const chat = await mensagensParaExportacao(tx, patientId);
  // Plano 20 (US-307): a situação no dia da exportação, no fuso do consultório (RN-305)
  const financeiro = await financeiroParaExportacao(tx, patientId, hojeNoFuso(fuso, now));
  // O termo em papel no ZIP: a data do ato (no fuso do consultório, como a escolhida no registro) e a ordem entre os
  // termos — sem texto do usuário (regra 9)
  let nTermo = 0;
  const termos: AnexoParaZip[] = autorizacoes.flatMap((a, i) =>
    a.arquivoPath
      ? [{ tipo: 'termo' as const, indice: i, caminho: a.arquivoPath, nome: `autorizacao-ia/${hojeNoFuso(fuso, a.em)}-${String(++nTermo).padStart(2, '0')}${path.extname(a.arquivoPath)}` }]
      : [],
  );
  const laudos: AnexoParaZip[] = ex.flatMap((e, i) =>
    e.arquivoPath
      ? [
          {
            tipo: 'laudo' as const,
            indice: i,
            caminho: e.arquivoPath,
            nome: `laudos/${e.data}-${String(i + 1).padStart(2, '0')}${path.extname(e.arquivoPath)}`,
          },
        ]
      : [],
  );
  // Fotos do diário (JPEG convertido): no ZIP, no mesmo teto dos laudos; o original nunca vai
  const fotos: AnexoParaZip[] = di.flatMap((e, i) =>
    e.fotoStatus === 'pronta' && e.fotoPath
      ? [{ tipo: 'foto' as const, indice: i, caminho: e.fotoPath, nome: `diario/${hojeNoFuso(fuso, e.dataHora)}-${i + 1}.jpg` }]
      : [],
  );
  // Plano 12: o PDF limpo dos envios que aguardam revisão (nome sem texto do usuário: data da coleta + posição)
  const envios: AnexoParaZip[] = ee.flatMap((e, i) =>
    e.status === 'recebido' && e.arquivoPath
      ? [{ tipo: 'envio' as const, indice: i, caminho: e.arquivoPath, nome: `envios/${e.dataColeta}-${String(i + 1).padStart(2, '0')}.pdf` }]
      : [],
  );
  const dados: DadosExportacao = {
    versao: 1,
    geradoEm: now.toISOString(),
    dataEmissao: hojeNoFuso(fuso, now),
    paciente: {
      nome: p.nome,
      dataNascimento: p.dataNascimento,
      sexo: p.sexo,
      email: p.email,
      telefone: p.telefoneE164 ? formatarTelefone(p.telefoneE164) : null,
      status: p.status,
      cadastradoEm: p.createdAt.toISOString(),
      ...(p.iaAvisoVersao && p.iaAvisoEm && p.iaAvisoCanal ? { avisoIa: { versao: p.iaAvisoVersao, em: p.iaAvisoEm.toISOString(), canal: p.iaAvisoCanal } } : {}),
      ...(p.iaAvisoEnviadoEm ? { avisoIaEnviadoEm: p.iaAvisoEnviadoEm.toISOString() } : {}),
      ...(p.iaRecusadaEm ? { recusouIaEm: p.iaRecusadaEm.toISOString() } : {}),
      autorizacoesIa: autorizacoes.map((a) => ({
        evento: a.evento,
        versao: a.versao,
        usos: a.usos,
        destino: a.destino ? { codigo: a.destino, rotulo: DESTINO_ROTULO[a.destino as DestinoIA] } : null,
        canal: a.canal,
        em: a.em.toISOString(),
        registradoEm: a.registradoEm.toISOString(),
        ip: a.ip,
        userAgent: a.userAgent,
        termo: null,
      })),
      pesoOcultoNoAppEm: p.pesoOcultoNoAppEm?.toISOString() ?? null, // D6 ★ revista: nos dois escopos
      lembretesPausadosEm: p.lembretesPausadosEm?.toISOString() ?? null,
      cadastro,
    },
    anamneses: as.map((a) => ({
      data: a.data,
      modelo: a.templateSnapshot.nome,
      respostas: a.templateSnapshot.perguntas
        .filter((q) => a.respostas[q.id] !== undefined)
        .map((q) => ({
          pergunta: q.rotulo,
          resposta: `${texto(q.tipo, respostaParaCampo(a.respostas[q.id]))}${q.tipo === 'numero' && q.unidade ? ` ${q.unidade}` : ''}`,
        })),
    })),
    antropometria: an.map((a) => ({
      data: a.data,
      pesoKg: a.pesoKg,
      alturaCm: a.alturaCm,
      imc: a.imc,
      percGordura: a.percGordura,
      protocolo: a.protocolo,
      circunferencias: a.circunferencias,
      dobrasMm: a.dobrasMm,
    })),
    gastoEnergetico: gs.map((g) => ({
      data: hojeNoFuso(fuso, g.createdAt),
      formula: NOME_FORMULA[g.formula] ?? g.formula,
      pesoKg: g.pesoKg,
      alturaCm: g.alturaCm,
      idade: g.idade,
      fatorAtividade: g.fatorAtividade,
      tmbKcal: kcal(g.tmb),
      getKcal: kcal(g.get),
    })),
    exames: ex.map((e) => ({
      data: e.data,
      titulo: e.titulo,
      temLaudo: !!e.arquivoPath,
      laudo: null,
      valores: e.valores,
      versoesAnteriores: versoesPorExame.get(e.id) ?? [],
      notaDeInterpretacao: notasPorExame.get(e.id)?.[0]?.texto ?? null,
      ...(escopo === 'equipe' ? { notasAnteriores: (notasPorExame.get(e.id) ?? []).slice(1) } : {}),
    })),
    atendimentos: at,
    planos,
    pedidosLgpd: pr.map((r) => ({
      tipo: r.tipo,
      status: r.status,
      prazo: r.prazo,
      concluidoEm: r.concluidoEm?.toISOString() ?? null,
    })),
    consultas: cs.map((c) => ({
      inicio: c.inicio.toISOString(),
      fim: c.fim.toISOString(),
      modalidade: c.modalidade,
      status: c.status,
      origem: c.origem,
      canceladoPor: c.canceladoPor,
      motivoCancelamento: c.canceladoPor === 'paciente' ? c.motivoCancelamento : null,
    })),
    lembretes: ns.map((n) => ({
      tipo: n.tipo,
      canal: n.canal,
      status: n.status,
      agendadaPara: n.agendadaPara.toISOString(),
      enviadaEm: n.enviadaEm?.toISOString() ?? null,
      motivoNaoEnviado: n.motivo,
    })),
    aceitesDoTermo: ac.map((a) => ({ termoVersao: a.termoVersao, aceitoEm: a.aceitoEm.toISOString(), ip: a.ip })),
    dispositivosPush: ps.map((d) => ({ criadaEm: d.criadaEm.toISOString(), navegador: d.navegador })),
    lembretesDeRotina: lr.map((l) => ({
      tipo: l.tipo,
      config: l.config,
      texto: l.texto,
      ligado: l.ligado,
      desligadoPeloPacienteEm: l.desligadoPeloPacienteEm?.toISOString() ?? null,
      criadoEm: l.criadoEm.toISOString(),
    })),
    diario: di.map((e) => ({
      dataHora: e.dataHora.toISOString(),
      refeicao: e.refeicao,
      texto: e.texto,
      foto: null,
      comentarioNutri: e.comentarioNutri,
      resposta: e.resposta,
      respostaRotulo: e.resposta ? ROTULO_RESPOSTA[e.resposta as RespostaDoDiario] : null,
      refeicaoDoPlano: e.refeicaoDoPlano,
    })),
    conteudos,
    documentos: docs.documentos,
    // RN-109 (Plano 14A): o destino gravado no portão; tarefa antiga com saída e sem destino = Anthropic, EUA (Plano 11)
    ia: tarefasIa.map((t) => ({
      id: t.id,
      tipo: t.tipo,
      status: t.status,
      criadoEm: t.criadoEm.toISOString(),
      encerradoEm: t.encerradoEm?.toISOString() ?? null,
      enviadoEm: t.saiuEm?.toISOString() ?? null,
      destino: t.destino,
      provedor: t.saiuEm ? (t.destino ? DESTINO_ROTULO[t.destino as DestinoIA] : ROTULO_DESTINO_LEGADO) : null,
    })),
    examesEnviados: ee.map((e) => {
      const exame = e.examId ? ex.find((x) => x.id === e.examId) : undefined;
      return {
        enviadoEm: e.createdAt.toISOString(),
        dataColeta: e.dataColeta,
        nome: e.nome,
        observacao: e.observacao,
        situacao: e.status,
        motivoRecusa: e.motivoRecusa === 'outro' ? e.motivoRecusaTexto : e.motivoRecusa ? ROTULO_MOTIVO_RECUSA[e.motivoRecusa as MotivoRecusa] : null,
        revisadoEm: e.revisadoEm?.toISOString() ?? null,
        exame: exame ? { data: exame.data, titulo: exame.titulo } : null,
        pdf: null,
      };
    }),
    iaNutri,
    conversa: chat.conversa,
    mensagens: chat.mensagens,
    laudosForaDoZip: false,
    financeiro,
  };
  // Plano 10A: o PDF assinado (nunca o preparado) em documentos/, no mesmo teto dos laudos
  const pdfsDeDocumentos: AnexoParaZip[] = docs.anexos.map((a) => ({ tipo: 'documento', ...a }));
  return { dados, laudos: [...laudos, ...fotos, ...envios, ...pdfsDeDocumentos, ...termos] };
}

/**
 * Lê os anexos (laudos, fotos do diário, PDFs assinados de documentos, PDFs limpos de exames enviados e termos em papel da autorização de IA) de /data para o ZIP e marca em `dados` onde cada um ficou. Acima do teto,
 * o que não cabe não vai (e `laudosForaDoZip` avisa); arquivo que sumiu do disco fica de fora sem derrubar a exportação.
 */
async function lerAnexos(
  dados: DadosExportacao,
  laudos: AnexoParaZip[],
  dataDir: string,
  limite: number,
  tenantId: string,
): Promise<Record<string, Uint8Array>> {
  const presentes: (AnexoParaZip & { bytes: number })[] = [];
  let ausentes = 0;
  for (const l of laudos) {
    try {
      presentes.push({ ...l, bytes: (await stat(resolverCaminho(dataDir, l.caminho))).size });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      ausentes++;
    }
  }
  // Entram os que cabem no teto, na ordem dos exames; os demais ficam de fora com o aviso
  const arquivos: Record<string, Uint8Array> = {};
  let total = 0;
  for (const l of presentes) {
    if (total + l.bytes > limite) {
      dados.laudosForaDoZip = true;
      continue;
    }
    let conteudo: Buffer;
    try {
      conteudo = await readFile(resolverCaminho(dataDir, l.caminho));
    } catch (err) {
      // Exame excluído entre o stat e a leitura: fica de fora como o que já não estava no disco
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      ausentes++;
      continue;
    }
    arquivos[l.nome] = conteudo;
    if (l.tipo === 'laudo') dados.exames[l.indice].laudo = l.nome;
    else if (l.tipo === 'foto') dados.diario[l.indice].foto = l.nome;
    else if (l.tipo === 'documento') dados.documentos[l.indice].pdf = l.nome;
    else if (l.tipo === 'envio') dados.examesEnviados[l.indice].pdf = l.nome;
    else if (l.tipo === 'termo') dados.paciente.autorizacoesIa[l.indice].termo = l.nome;
    total += conteudo.length;
  }
  if (ausentes)
    logger.warn({ tenantId, ausentes }, 'anexo ausente no disco ficou fora da exportação');
  return arquivos;
}

type DadosJob = { tenantId: string; exportId: string };
type DepsJob = {
  db: Db;
  dataDir: string;
  appUrl: string;
  now?: Date;
  boss?: PgBoss;
  /** pg-boss: esta é a última tentativa (retryCount ≥ retryLimit) — em erro, marca "falhou". */
  ultimaTentativa: boolean;
  /** Testes trocam o PDF. */
  renderizar?: typeof renderizarProntuario;
  /** Testes baixam o teto dos laudos. */
  limiteLaudosBytes?: number;
};

/** Outro worker marcou o pedido antes: o `registrar` desiste e o salvarArquivo desfaz ZIP, registro e cota. */
class JaConcluidaError extends Error {}
/** A anonimização (retencao-lgpd) passou no meio: o ZIP montado antes teria dados identificados. */
class PacienteAnonimizadoError extends Error {}
/**
 * L-2: pedido do titular (portal) de quem deixou de ser ativo (bloqueado, arquivado): o link do e-mail cairia em
 * /p/sem-acesso. Decisão (débitos pré-go-live): vira "falhou", sem e-mail; os dados ficam com a nutricionista (US-018).
 */
class TitularSemAcessoError extends Error {}

/**
 * Job `exportacao-paciente`. Idempotente: só age sobre pedido `pendente` (um retry depois do sucesso
 * não gera outro ZIP). Tenant suspenso: não gera (RN-15) e marca "falhou" — senão o pedido ficaria
 * pendente para sempre e "Exportar dados" devolveria o mesmo id sem job. Erro: o pg-boss tenta de novo;
 * na última tentativa, "falhou" (a nutricionista pede de novo). ZIP, pedido "pronta", e-mail e job de
 * expiração vão na MESMA transação (`registrar`): uma queda no meio não deixa ZIP sem dono em /data.
 */
export async function gerarExportacao(
  data: DadosJob,
  deps: DepsJob,
): Promise<'pronta' | 'ignorada' | 'falhou'> {
  const { db } = deps;
  const now = deps.now ?? new Date();
  const ctx: TenantContext = { tenantId: data.tenantId, role: 'worker' };
  const marcarFalhou = () =>
    withTenant(
      ctx,
      (tx) =>
        tx
          .update(dataExports)
          .set({ status: 'falhou', updatedAt: now })
          .where(and(eq(dataExports.id, data.exportId), eq(dataExports.status, 'pendente'))),
      db,
    );
  if (!(await tenantIsActive(db, data.tenantId))) {
    await marcarFalhou();
    return 'ignorada';
  }
  const [pedido] = await withTenant(
    ctx,
    (tx) =>
      tx
        .select()
        .from(dataExports)
        .where(and(eq(dataExports.id, data.exportId), eq(dataExports.status, 'pendente'))),
    db,
  );
  if (!pedido) return 'ignorada';
  try {
    const tenant = await buscarTenant(db, data.tenantId);
    const { dados, laudos } = await withTenant(
      ctx,
      async (tx) => {
        // L-2 (achado 8 do /code-review): conferência barata antes de montar o PDF e o ZIP inteiros; a definitiva, com o
        // paciente travado, continua em antesDaReserva
        if (pedido.escopo === 'titular') {
          const [p] = await tx.select({ status: patients.status }).from(patients).where(eq(patients.id, pedido.patientId));
          if (p?.status !== 'ativo') throw new TitularSemAcessoError();
        }
        return montarDados(tx, pedido.patientId, now, tenant?.fuso ?? 'America/Sao_Paulo', pedido.escopo as EscopoExportacao);
      },
      db,
    );
    const arquivosDosLaudos = await lerAnexos(
      dados,
      laudos,
      deps.dataDir,
      deps.limiteLaudosBytes ?? LIMITE_LAUDOS_BYTES,
      data.tenantId,
    );
    const pdf = await (deps.renderizar ?? renderizarProntuario)(
      dados,
      tenant?.nomeExibicao ?? 'NutriDebby',
    );
    const zip = zipSync({
      'dados.json': strToU8(JSON.stringify(dados, null, 2)),
      'prontuario.pdf': new Uint8Array(pdf.buffer, pdf.byteOffset, pdf.length),
      // Laudo (PDF/JPEG/PNG) já vem comprimido: guardado sem recomprimir, para poupar CPU do worker
      ...Object.fromEntries(
        Object.entries(arquivosDosLaudos).map(([nome, u8]) => [nome, [u8, { level: 0 }] as const]),
      ),
    });
    const boss = deps.boss ?? (await getBoss());
    const expiraEm = new Date(now.getTime() + EXPORTACAO_VALIDADE_MS);
    await salvarArquivo(
      ctx,
      {
        tipo: 'exportacao',
        conteudo: Buffer.from(zip.buffer, zip.byteOffset, zip.length),
        permitidos: ['zip'],
        naoBarrarPelaCota: true,
        patientId: pedido.patientId,
        // Trava o paciente (mesma ordem de travas dos laudos) e desiste se a anonimização chegou antes;
        // a anonimização, por sua vez, confere os anexos com o paciente travado (lgpd.ts).
        antesDaReserva: async (tx) => {
          const [p] = await tx
            .select({ anonimizadoEm: patients.anonimizadoEm, status: patients.status })
            .from(patients)
            .where(eq(patients.id, pedido.patientId))
            .for('update');
          if (!p || p.anonimizadoEm) throw new PacienteAnonimizadoError();
          // com o paciente travado: o atendimento da exclusão (ou o arquivamento) que chegar depois já acha "pronta"
          if (pedido.escopo === 'titular' && p.status !== 'ativo') throw new TitularSemAcessoError();
        },
        registrar: async (tx, arquivo) => {
          const [e] = await tx
            .update(dataExports)
            .set({ status: 'pronta', arquivoPath: arquivo.caminho, expiraEm, updatedAt: now })
            .where(and(eq(dataExports.id, pedido.id), eq(dataExports.status, 'pendente')))
            .returning({ id: dataExports.id });
          if (!e) throw new JaConcluidaError();
          const [quem] = pedido.solicitadoPor
            ? await tx
                .select({ email: user.email })
                .from(user)
                .where(eq(user.id, pedido.solicitadoPor))
            : [];
          if (quem)
            await enqueueEmail(
              {
                tipo: 'exportacao_pronta',
                para: quem.email,
                link: linkDaExportacao(deps.appUrl, { tenantId: data.tenantId, patientId: pedido.patientId, id: pedido.id, escopo: pedido.escopo as EscopoExportacao }),
                titular: pedido.escopo === 'titular',
              },
              { tenantId: data.tenantId, tx, boss },
            );
          await boss.send('expirar-exportacao', data, {
            startAfter: expiraEm,
            db: fromDrizzle(tx, sql),
          });
        },
      },
      { db, dataDir: deps.dataDir },
    );
    await expirarAnteriores(ctx, pedido.patientId, pedido.id, pedido.escopo as EscopoExportacao, { db, dataDir: deps.dataDir });
    return 'pronta';
  } catch (err) {
    if (err instanceof JaConcluidaError) return 'ignorada';
    if (err instanceof TitularSemAcessoError) {
      await marcarFalhou();
      logger.info({ tenantId: data.tenantId, exportId: data.exportId }, 'exportação do titular sem acesso ao portal: não gerada');
      return 'falhou';
    }
    const definitivo =
      deps.ultimaTentativa ||
      err instanceof CotaEsgotadaError ||
      err instanceof PacienteAnonimizadoError;
    logger.error(
      {
        motivo: motivoDoErro(err),
        tenantId: data.tenantId,
        exportId: data.exportId,
        definitivo,
      },
      'falha ao gerar exportação',
    );
    // o worker limpa o erro relançado ao pg-boss (semDetalhe: só a fila e o código — RNF-11, achado 5 do /code-review)
    if (!definitivo) throw err;
    await marcarFalhou();
    return 'falhou';
  }
}

/**
 * Rede de segurança do "some em 24 h", chamada pelo job diário `retencao-lgpd`: pedidos prontos já
 * vencidos (o `expirar-exportacao` esgotou as tentativas) perdem o ZIP; pendentes esquecidos há mais de
 * um dia (worker caiu na última tentativa) viram "falhou".
 */
export async function expirarExportacoesVencidas(
  db: Db,
  now: Date,
  deps: { dataDir?: string } = {},
): Promise<{ expiradas: number }> {
  let expiradas = 0;
  for (const t of await listarTenantsParaVarredura(db)) {
    const ctx: TenantContext = { tenantId: t.id, role: 'worker' };
    try {
      const vencidas = await withTenant(
        ctx,
        (tx) =>
          tx
            .select({ id: dataExports.id })
            .from(dataExports)
            .where(and(eq(dataExports.status, 'pronta'), lt(dataExports.expiraEm, now))),
        db,
      );
      for (const { id } of vencidas) {
        await expirarExportacao(
          { tenantId: t.id, exportId: id },
          { db, dataDir: deps.dataDir ?? getEnv().DATA_DIR },
        );
        expiradas++;
      }
      await withTenant(
        ctx,
        (tx) =>
          tx
            .update(dataExports)
            .set({ status: 'falhou', updatedAt: now })
            .where(
              and(
                eq(dataExports.status, 'pendente'),
                lt(dataExports.createdAt, new Date(now.getTime() - EXPORTACAO_VALIDADE_MS)),
              ),
            ),
        db,
      );
    } catch (err) {
      logger.error(
        { motivo: motivoDoErro(err), tenantId: t.id },
        'falha ao expirar exportações vencidas',
      );
    }
  }
  return { expiradas };
}

/**
 * Um ZIP válido por paciente e escopo: o novo pronto apaga os anteriores do mesmo escopo (cota e disco) — o do
 * titular não apaga o que a nutricionista acabou de pedir, nem o contrário (D16). Falha aqui não desfaz a
 * exportação nova — o job de expiração e a varredura diária apagam o resto.
 */
async function expirarAnteriores(
  ctx: TenantContext,
  patientId: string,
  atual: string,
  escopo: EscopoExportacao,
  deps: { db: Db; dataDir: string },
) {
  try {
    const anteriores = await withTenant(
      ctx,
      (tx) =>
        tx
          .select({ id: dataExports.id })
          .from(dataExports)
          .where(
            and(
              eq(dataExports.patientId, patientId),
              eq(dataExports.escopo, escopo),
              eq(dataExports.status, 'pronta'),
              ne(dataExports.id, atual),
            ),
          ),
      deps.db,
    );
    for (const { id } of anteriores)
      await expirarExportacao({ tenantId: ctx.tenantId, exportId: id }, deps);
  } catch (err) {
    logger.warn(
      { motivo: motivoDoErro(err), tenantId: ctx.tenantId },
      'falha ao apagar exportação anterior',
    );
  }
}

/** Job `expirar-exportacao` (24 h depois): apaga o ZIP e marca o pedido como expirado. */
export async function expirarExportacao(
  data: DadosJob,
  deps: { db: Db; dataDir: string },
): Promise<void> {
  const ctx: TenantContext = { tenantId: data.tenantId, role: 'worker' };
  const [e] = await withTenant(
    ctx,
    (tx) => tx.select().from(dataExports).where(eq(dataExports.id, data.exportId)),
    deps.db,
  );
  if (!e) return;
  // CLAUDE.md regra 9: o pedido deixa de apontar para o ZIP na mesma transação que apaga o arquivo
  const expirar = async (tx: Tx) => {
    // Ordem de travas da anonimização (apagarArquivo: stored_files → data_exports pelo SET NULL):
    // trava o arquivo antes do pedido, senão as duas juntas se travam em ordem inversa (deadlock)
    if (e.arquivoPath)
      await tx
        .select({ id: storedFiles.id })
        .from(storedFiles)
        .where(eq(storedFiles.caminho, e.arquivoPath))
        .for('update');
    await tx
      .update(dataExports)
      .set({ status: 'expirada', arquivoPath: null, updatedAt: new Date() })
      .where(eq(dataExports.id, e.id));
    return true;
  };
  if (e.arquivoPath)
    await apagarArquivo(ctx, { caminho: e.arquivoPath }, { ...deps, naMesmaTransacao: expirar });
  else await withTenant(ctx, expirar, deps.db);
}
