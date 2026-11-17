import { and, desc, eq, isNotNull, ne, sql } from 'drizzle-orm';
import type { Db, Tx } from '@/db/client';
import { consultations, iaNutriMensagens, mealPlans, patients, tenants, user } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { formatarData } from '@/modules/pacientes/datas';
import { kcalTexto, totaisDoDia } from '@/modules/plano-alimentar/calculo';
import { lerPlanoNaTransacao } from '@/modules/plano-alimentar/carregar';
import { DIA_CURTO, diaDaSemanaNoFuso, ORDEM_DIAS, refeicoesDoDia, rotuloDosDias, valeNoDia, type DiaDaSemana } from '@/modules/plano-alimentar/dias';
import type { ItemDaListaLigada, ItemPlano, ListaLigada, PlanoCompleto, RefeicaoPlano } from '@/modules/plano-alimentar/tipos';
import { kcalDo, quantidadeDoItem } from '@/modules/portal/plano';
import type { CATEGORIAS_DA_IA_NUTRI } from '../campos-enviados';
import { TOKENS_ENTRADA_TETO_CONVERSA, TOKENS_INSTRUCOES_TETO, tokensDeBytes } from '../precos';
import { mascarar, type AlvoDaMascara } from '../pseudonimizar';
import { ATENDIMENTOS_NO_CONTEXTO, ULTIMAS_MENSAGENS_DA_SESSAO, type TipoResposta } from './constantes';
import { INSTRUCAO_CONVERSA, SISTEMA_CONVERSA } from './instrucoes';
import { cortarParaCaber, type Trecho } from './montar-resposta';

/**
 * Plano 15 (§4.2 passo 2, §7.3, RNF-163): o contexto da pergunta, lido na SESSÃO DE PACIENTE sem conta (`semConta`, N7):
 * a RLS do portal isola o paciente, barra rascunho e STAFF_ONLY; o "só o publicado" é filtro explícito (a RLS do paciente
 * vê o `arquivado`). `auditar: false`: a montagem não grava "ler" (o registro é o `exportar` do portão). Índices locais
 * (#R refeição, #I item, #S substituição, #L{lista}-{grupo} grupo da lista de substituição ligada, #O orientação do
 * plano, #A orientação de atendimento); o mapa índice → linha fica no worker. Texto livre mascarado (nome, e-mail,
 * telefone e CPF do paciente; nomes da equipe; nome do consultório). ÚNICO arquivo novo que lê a tabela `user` (regra 1):
 * só `user.name` das contas de nutricionista do tenant. Só o worker importa (o job `ia-paciente`; guarda de grafo, T13).
 * Sem escrita: só leitura nas duas funções.
 *
 * Plano 19 (RN-255, D25; RN-247 (h); RN-240): cada refeição vai com os dias em que vale e o contexto diz o dia de hoje no
 * fuso do consultório; "kcal do dia" é a do perfil de hoje (só com "mostrar calorias" no plano com alimentos: no texto
 * livre não há cálculo, RN-243); no texto livre, a `descricao_livre` mascarada é o trecho #R; a lista de substituição
 * ligada (a cópia do publicado) vai mascarada, um índice por grupo. Micros, perfil de referência, receitas e materiais
 * ligados nunca entram (RN-240, D9 = a do Plano 15). O plano é lido por `lerPlanoNaTransacao` (a cópia congelada já
 * passa por `lerCongelados` lá dentro): este arquivo não lê `meal_items.nutrientes`.
 *
 * R-239 (PM-PA9, ruling do controlador): com os limites do editor (50 refeições, 400 itens, 5 listas de 20 × 30) o plano
 * inteiro não cabe na reserva da pergunta (`TOKENS_ENTRADA_TETO_CONVERSA`). O contexto do plano passa a caber por
 * prioridade (`contextoDoPlano`): sempre o esqueleto (dia de hoje, kcal do dia, cada refeição com nome, horário e dias,
 * as orientações do plano e os nomes de cada lista e grupo); depois (1) as refeições de hoje completas, (2) as dos
 * outros dias, a partir de amanhã, (3) a orientação e os itens de cada grupo das listas — enquanto couber. O que fica de
 * fora leva `resumido: MARCADOR_RESUMIDO` e o modelo é instruído a não supor o que não vê (`SISTEMA_CONVERSA`). O
 * orçamento é a conta do portão (bytes/2 + TOKENS_INSTRUCOES_TETO) menos o que o resto do turno já ocupa.
 */
export type FonteDoContexto = {
  indice: string;
  tipo: 'refeicao' | 'item' | 'substituicao' | 'lista_substituicao' | 'orientacao_plano' | 'orientacao_atendimento';
  /** A linha relida: refeição, item, plano, atendimento ou, em `lista_substituicao`, a ligação (`plano_listas_substituicao`). */
  id: string;
  /** Só em `lista_substituicao`: a posição do grupo (0…) na cópia da lista ligada. */
  grupo?: number;
};
type Dados = Record<(typeof CATEGORIAS_DA_IA_NUTRI)[number], unknown>;
export type ContextoDaConversa = {
  planId: string;
  dados: Dados;
  fontes: FonteDoContexto[];
  /** A pergunta como o paciente escreveu (sem máscara): fica no worker, para a validação e os termos sensíveis; nunca sai. */
  pergunta: string;
  /** O texto EXATO do turno do usuário que sai ao provedor (DP-8). */
  corpo: string;
  /** Bytes de `corpo` + `SISTEMA_CONVERSA` (o teto do portão, DP-8). */
  bytes: number;
  /** R-239: alguma parte do plano foi resumida para caber na reserva. */
  resumido: boolean;
};

/** R-239: o marcador de "detalhes não incluídos" (refeição, orientação de lista ou grupo que não coube). */
export const MARCADOR_RESUMIDO = '(resumido: detalhes não incluídos)';

/** DP-8: a conta do portão do envio (job.ts) — o turno cabe na reserva da pergunta (a reserva nunca sobe, RN-104). */
export const cabeNaReserva = (bytes: number): boolean => tokensDeBytes(bytes) + TOKENS_INSTRUCOES_TETO <= TOKENS_ENTRADA_TETO_CONVERSA;
/** O maior `bytes` (corpo + SISTEMA_CONVERSA) que `cabeNaReserva` aceita (o inverso de `tokensDeBytes`). */
export const BYTES_DA_RESERVA = (TOKENS_ENTRADA_TETO_CONVERSA - TOKENS_INSTRUCOES_TETO) * 2;

/** O plano como o contexto o lê: o publicado (`PlanoCompleto`) ou o fictício da avaliação da RN-184 (sem banco). */
type ItemDoContexto = Pick<ItemPlano, 'id' | 'nome' | 'quantidadeG' | 'medidaCaseiraTxt' | 'porCem' | 'substituiItemId'>;
type RefeicaoDoContexto = Pick<RefeicaoPlano, 'id' | 'nome' | 'horario' | 'observacao' | 'diasSemana' | 'descricaoLivre'> & { itens: ItemDoContexto[] };
type ItemDaListaDoContexto = Pick<ItemDaListaLigada, 'nome' | 'quantidadeG' | 'medidaCaseiraTxt' | 'porCem'>;
type ListaDoContexto = Pick<ListaLigada, 'id' | 'nome' | 'orientacao'> & { grupos: { nome: string; itens: ItemDaListaDoContexto[] }[] };
export type PlanoDoContexto = Pick<PlanoCompleto, 'id' | 'modo' | 'mostrarCalorias' | 'orientacoes'> & { refeicoes: RefeicaoDoContexto[]; listas: ListaDoContexto[] };

const sessaoDoPaciente = (tenantId: string, patientId: string): TenantContext => ({ tenantId, role: 'paciente', patientId, semConta: true });

/**
 * DP-8 / RN-184: o corpo EXATO do turno que sai, montado num lugar só — histórico e pergunta uma vez, no topo (nunca em
 * dobro dentro de `contexto`). Função pura: o job (por `montarContexto`) e o avaliador da T13 (`avaliar-conversa.ts`)
 * mandam o mesmo formato, para a avaliação medir o prompt de produção.
 */
export type ItemDoHistorico = { autor: 'paciente'; texto: string } | { autor: 'ia'; tipo_resposta: string | null; fontes: string[] };
export function corpoDaConversa(
  contexto: { plano: unknown; orientacoes: unknown },
  fontes: readonly Pick<FonteDoContexto, 'indice'>[],
  historico: readonly ItemDoHistorico[],
  pergunta: string,
): string {
  return `${INSTRUCAO_CONVERSA}\n${JSON.stringify({ contexto: { plano: contexto.plano, orientacoes: contexto.orientacoes, indices: fontes.map((f) => f.indice) }, historico, pergunta })}`;
}

/** PM-3: o paciente (nome, e-mail, telefone), a equipe (só `user.name` das nutricionistas do tenant) e o consultório. */
async function alvoDaMascara(tx: Tx, tenantId: string, patientId: string): Promise<AlvoDaMascara> {
  const [p] = await tx.select({ nome: patients.nome, email: patients.email, telefone: patients.telefoneE164 }).from(patients).where(eq(patients.id, patientId));
  const [t] = await tx.select({ nomeExibicao: tenants.nomeExibicao, nomeProfissional: tenants.nomeProfissional }).from(tenants).where(eq(tenants.id, tenantId));
  const equipe = await tx.select({ nome: user.name }).from(user).where(and(eq(user.tenantId, tenantId), eq(user.appRole, 'nutri')));
  return {
    nome: p?.nome ?? '',
    email: p?.email ?? null,
    telefone: p?.telefone ?? null,
    outrosNomes: [...equipe.map((u) => u.nome), ...(t?.nomeProfissional ? [t.nomeProfissional] : [])].filter(Boolean),
    frasesExatas: t?.nomeExibicao ? [t.nomeExibicao] : [],
  };
}

/** O item como a tela do plano mostra (nome — quantidade · kcal); serve ao item da refeição e ao da lista. */
const textoDoItem = (i: ItemDaListaDoContexto, mostrar: boolean): string => {
  const kcal = kcalDo(i, mostrar);
  return `${i.nome} — ${quantidadeDoItem(i)}${kcal ? ` · ${kcal}` : ''}`;
};

/** RN-243: no texto livre não há cálculo — "mostrar calorias" fica sem efeito (como no portal). */
const mostraCalorias = (plano: Pick<PlanoCompleto, 'mostrarCalorias' | 'modo'>): boolean => plano.mostrarCalorias && plano.modo === 'calculado';
const textoLivreDa = (plano: Pick<PlanoCompleto, 'modo'>, r: Pick<RefeicaoPlano, 'descricaoLivre'>): string | null =>
  plano.modo === 'livre' && r.descricaoLivre?.trim() ? r.descricaoLivre : null;
const diasCurtos = (dias: readonly number[]): string[] => ORDEM_DIAS.filter((d) => dias.includes(d)).map((d) => DIA_CURTO[d]);
/** Os dias da refeição no trecho relido, só quando não são todos ("seg a sex"; RN-246, `rotuloDosDias`). */
const diasDoTrecho = (r: Pick<RefeicaoPlano, 'diasSemana'>): string | null => (r.diasSemana.length < 7 ? rotuloDosDias(r.diasSemana) : null);

const bytesDe = (v: unknown): number => Buffer.byteLength(JSON.stringify(v));
/** Cada índice ocupa no máximo `"#I12",` em `indices` (aspas e vírgula): o teto que o orçamento desconta. */
const bytesDosIndices = (fs: readonly Pick<FonteDoContexto, 'indice'>[]): number => fs.reduce((t, f) => t + Buffer.byteLength(f.indice) + 3, 0);

/** Uma parte do plano que entra resumida (sempre) ou completa (enquanto couber), com os índices que a completa traz. */
type Parte = { resumo: Record<string, unknown>; completa: Record<string, unknown>; fontesDaCompleta: FonteDoContexto[]; incluida: boolean };
const custoDa = (p: Parte): number => bytesDe(p.completa) - bytesDe(p.resumo) + bytesDosIndices(p.fontesDaCompleta);
const versao = (p: Parte) => (p.incluida ? p.completa : p.resumo);

/**
 * O plano publicado no formato do contexto (função pura: `montarContexto`, a avaliação da RN-184 e a medição do PM-PA9
 * usam a mesma), com os índices na ordem: por refeição #R, os itens (#I) e as substituições (#S), contadores do plano
 * inteiro (o número não muda quando a refeição vai resumida); depois os grupos das listas (#L{lista}-{grupo}) e a
 * orientação do plano (#O1). Nenhuma id do banco sai. R-239: `orcamentoBytes` é o teto de JSON do plano + os índices
 * dele; o esqueleto entra sempre, as partes completas por prioridade enquanto couberem.
 */
export function contextoDoPlano(
  plano: PlanoDoContexto,
  alvo: AlvoDaMascara,
  hoje: DiaDaSemana,
  orcamentoBytes = Number.POSITIVE_INFINITY,
): { plano: unknown; fontes: FonteDoContexto[]; resumido: boolean } {
  const mostrar = mostraCalorias(plano);
  let nI = 0;
  let nS = 0;
  const refeicoes = plano.refeicoes.map((r, k) => {
    const indice = `#R${k + 1}`;
    const cabeca = { indice, nome: mascarar(r.nome, alvo), horario: r.horario || null, dias: diasCurtos(r.diasSemana) };
    const itens = r.itens
      .filter((i) => !i.substituiItemId)
      .map((i) => ({ indice: `#I${++nI}`, id: i.id, alimento: mascarar(i.nome, alvo), quantidade: quantidadeDoItem(i), kcal: kcalDo(i, mostrar) }));
    const substituicoes = r.itens
      .filter((i) => i.substituiItemId)
      .map((s) => ({
        indice: `#S${++nS}`,
        id: s.id,
        substitui: itens.find((x) => x.id === s.substituiItemId)?.indice ?? null,
        alimento: mascarar(s.nome, alvo),
        quantidade: quantidadeDoItem(s),
        kcal: kcalDo(s, mostrar),
      }));
    const livre = textoLivreDa(plano, r);
    const parte: Parte = {
      resumo: { ...cabeca, resumido: MARCADOR_RESUMIDO },
      completa: {
        ...cabeca,
        observacao: r.observacao ? mascarar(r.observacao, alvo) : null,
        ...(livre ? { texto_livre: mascarar(livre, alvo) } : {}),
        // nenhuma id do banco sai
        itens: itens.map((x) => ({ indice: x.indice, alimento: x.alimento, quantidade: x.quantidade, kcal: x.kcal })),
        substituicoes: substituicoes.map((x) => ({ indice: x.indice, substitui: x.substitui, alimento: x.alimento, quantidade: x.quantidade, kcal: x.kcal })),
      },
      fontesDaCompleta: [
        ...itens.map((x): FonteDoContexto => ({ indice: x.indice, tipo: 'item', id: x.id })),
        ...substituicoes.map((x): FonteDoContexto => ({ indice: x.indice, tipo: 'substituicao', id: x.id })),
      ],
      incluida: false,
    };
    return { fonte: { indice, tipo: 'refeicao', id: r.id } satisfies FonteDoContexto, parte };
  });
  const listas = plano.listas.map((l, k) => {
    const nome = mascarar(l.nome, alvo);
    const orientacao: Parte | null = l.orientacao
      ? { resumo: { nome, resumido: MARCADOR_RESUMIDO }, completa: { nome, orientacao: mascarar(l.orientacao, alvo) }, fontesDaCompleta: [], incluida: false }
      : null;
    const grupos = l.grupos.map((g, j) => {
      const indice = `#L${k + 1}-${j + 1}`;
      const cabeca = { indice, nome: mascarar(g.nome, alvo) };
      const parte: Parte = {
        resumo: { ...cabeca, resumido: MARCADOR_RESUMIDO },
        completa: { ...cabeca, itens: g.itens.map((i) => ({ alimento: mascarar(i.nome, alvo), quantidade: quantidadeDoItem(i), kcal: kcalDo(i, mostrar) })) },
        fontesDaCompleta: [],
        incluida: false,
      };
      return { fonte: { indice, tipo: 'lista_substituicao', id: l.id, grupo: j } satisfies FonteDoContexto, parte };
    });
    return { nome, orientacao, grupos };
  });
  const orientacoes = plano.orientacoes ? [{ indice: '#O1', texto: mascarar(plano.orientacoes, alvo) }] : [];
  // RN-247 (h): a kcal do dia é a do perfil de hoje (as refeições que valem hoje), nunca a soma de todas
  const kcalDoDia = mostrar && refeicoesDoDia(plano.refeicoes, hoje).length ? `${kcalTexto(totaisDoDia(plano.refeicoes, hoje).kcal)} kcal` : null;

  const montar = () => ({
    hoje: DIA_CURTO[hoje],
    kcal_do_dia: kcalDoDia,
    refeicoes: refeicoes.map((r) => versao(r.parte)),
    listas: listas.map((l) => ({ ...(l.orientacao ? versao(l.orientacao) : { nome: l.nome, orientacao: null }), grupos: l.grupos.map((g) => versao(g.parte)) })),
    orientacoes,
  });
  const fontesBase: FonteDoContexto[] = [
    ...refeicoes.map((r) => r.fonte),
    ...listas.flatMap((l) => l.grupos.map((g) => g.fonte)),
    ...(plano.orientacoes ? [{ indice: '#O1', tipo: 'orientacao_plano', id: plano.id } satisfies FonteDoContexto] : []),
  ];
  // a prioridade (R-239): as refeições de hoje; as dos outros dias, a partir de amanhã; a orientação e os grupos das listas
  const diasDepois = Array.from({ length: 6 }, (_, n) => ((hoje + n + 1) % 7) as DiaDaSemana);
  const outras = [...new Set(diasDepois.flatMap((d) => refeicoes.filter((_, k) => valeNoDia(plano.refeicoes[k], d))))];
  const prioridade: Parte[] = [
    ...refeicoes.filter((_, k) => valeNoDia(plano.refeicoes[k], hoje)).map((r) => r.parte),
    ...outras.map((r) => r.parte),
    ...listas.flatMap((l) => [...(l.orientacao ? [l.orientacao] : []), ...l.grupos.map((g) => g.parte)]),
  ];
  let usado = bytesDe(montar()) + bytesDosIndices(fontesBase);
  for (const p of prioridade) {
    if (p.incluida) continue;
    const custo = custoDa(p);
    if (usado + custo > orcamentoBytes) continue; // não coube: fica resumida (uma menor, mais adiante, ainda pode caber)
    p.incluida = true;
    usado += custo;
  }
  const fontes: FonteDoContexto[] = [
    ...refeicoes.flatMap((r) => [r.fonte, ...(r.parte.incluida ? r.parte.fontesDaCompleta : [])]),
    ...listas.flatMap((l) => l.grupos.map((g) => g.fonte)),
    ...(plano.orientacoes ? [{ indice: '#O1', tipo: 'orientacao_plano', id: plano.id } satisfies FonteDoContexto] : []),
  ];
  const resumido = refeicoes.some((r) => !r.parte.incluida) || listas.some((l) => (l.orientacao && !l.orientacao.incluida) || l.grupos.some((g) => !g.parte.incluida));
  return { plano: montar(), fontes, resumido };
}

/**
 * O turno inteiro (plano no orçamento + orientações dos atendimentos + histórico + pergunta), puro: `montarContexto` e a
 * avaliação da RN-184 montam igual. O orçamento do plano é `BYTES_DA_RESERVA` menos o que o resto já ocupa (o turno com
 * `plano: null` e os índices dos atendimentos); `null` (4 bytes) dá lugar ao JSON do plano e os índices dele entram antes
 * dos #A (no máximo `"#R1",` cada). Se nem o esqueleto couber (textos no limite e quase todos com acento), o portão do
 * job recusa com `limite_custo`, como antes.
 */
export function turnoDaConversa(o: {
  plano: PlanoDoContexto;
  alvo: AlvoDaMascara;
  hoje: DiaDaSemana;
  orientacoes: readonly unknown[];
  fontesDosAtendimentos: readonly FonteDoContexto[];
  historico: readonly ItemDoHistorico[];
  pergunta: string;
}): { plano: unknown; fontes: FonteDoContexto[]; corpo: string; bytes: number; resumido: boolean } {
  const semPlano = Buffer.byteLength(corpoDaConversa({ plano: null, orientacoes: o.orientacoes }, o.fontesDosAtendimentos, o.historico, o.pergunta)) + Buffer.byteLength(SISTEMA_CONVERSA);
  const doPlano = contextoDoPlano(o.plano, o.alvo, o.hoje, BYTES_DA_RESERVA - semPlano + Buffer.byteLength('null'));
  const fontes = [...doPlano.fontes, ...o.fontesDosAtendimentos];
  const corpo = corpoDaConversa({ plano: doPlano.plano, orientacoes: o.orientacoes }, fontes, o.historico, o.pergunta);
  return { plano: doPlano.plano, fontes, corpo, bytes: Buffer.byteLength(corpo) + Buffer.byteLength(SISTEMA_CONVERSA), resumido: doPlano.resumido };
}

export async function montarContexto(db: Db, d: { tenantId: string; patientId: string; mensagemId: string; agora?: Date }): Promise<ContextoDaConversa | null> {
  return withTenant(
    sessaoDoPaciente(d.tenantId, d.patientId),
    async (tx) => {
      const [m] = await tx
        .select({ texto: iaNutriMensagens.texto })
        .from(iaNutriMensagens)
        .where(and(eq(iaNutriMensagens.id, d.mensagemId), eq(iaNutriMensagens.patientId, d.patientId), eq(iaNutriMensagens.autor, 'paciente')));
      if (!m?.texto) return null;
      const [pub] = await tx.select({ id: mealPlans.id }).from(mealPlans).where(and(eq(mealPlans.patientId, d.patientId), eq(mealPlans.status, 'publicado')));
      if (!pub) return null;
      const plano = await lerPlanoNaTransacao(tx, pub.id, { auditar: false, comMedidas: false });
      if (!plano || plano.status !== 'publicado') return null;
      const alvo = await alvoDaMascara(tx, d.tenantId, d.patientId);
      // RN-246: o dia de hoje no fuso do consultório (o mesmo dos lembretes e do portal)
      const [t] = await tx.select({ fuso: tenants.fuso }).from(tenants).where(eq(tenants.id, d.tenantId));
      const hoje = diaDaSemanaNoFuso(d.agora ?? new Date(), t?.fuso ?? 'America/Sao_Paulo');
      const atend = await tx
        .select({ id: consultations.id, data: consultations.data, texto: consultations.orientacoesPaciente })
        .from(consultations)
        .where(and(eq(consultations.patientId, d.patientId), isNotNull(consultations.orientacoesPaciente), ne(consultations.orientacoesPaciente, '')))
        .orderBy(desc(consultations.data), desc(consultations.createdAt))
        .limit(ATENDIMENTOS_NO_CONTEXTO);
      const fontesDosAtendimentos: FonteDoContexto[] = atend.map((a, k) => ({ indice: `#A${k + 1}`, tipo: 'orientacao_atendimento', id: a.id }));
      const orientacoesAtend = atend.map((a, k) => ({ indice: `#A${k + 1}`, data: a.data, texto: mascarar(a.texto ?? '', alvo) }));
      // RN-174 / §7.4 item 1 ("nada sai do país"): do paciente, o histórico leva SÓ a pergunta que já passou pelo portão do
      // envio (`enviado_em` preenchido) e sem risco. Ficam de fora: a barrada pelo filtro de risco (sem job), a enviada
      // direto à nutricionista (DP-16: `respondida` sem job, nunca passa pelo portão — o paciente escolheu "sem IA"), a que
      // falhou ou foi cancelada antes de sair (cota, pausa, bloqueio, `nao_enviado` na última tentativa: `enviado_em` volta
      // a nulo antes de repetir) e a de risco percebido pelo modelo. A encaminhada DEPOIS de respondida continua (saiu).
      // A mensagem `sistema` e a resposta de texto fixo têm `texto` nulo e ficam de fora; das respostas `ia` montadas vai só
      // o tipo e os índices citados (DP-8): o texto montado é o próprio plano, já no contexto.
      const historico = (
        await tx
          .select({ autor: iaNutriMensagens.autor, texto: iaNutriMensagens.texto, tipo: iaNutriMensagens.tipoResposta, fontes: iaNutriMensagens.fontes })
          .from(iaNutriMensagens)
          .where(
            and(
              eq(iaNutriMensagens.patientId, d.patientId),
              // a sessão e a hora da pergunta comparadas no banco: o Date do JS só guarda milissegundos e o timestamptz tem
              // microssegundos (a sessão de uma pergunta gravada pela função nunca seria igual à lida de volta)
              sql`${iaNutriMensagens.sessaoInicio} = (select q.sessao_inicio from ia_nutri_mensagens q where q.id = ${d.mensagemId})`,
              sql`${iaNutriMensagens.createdAt} < (select q.created_at from ia_nutri_mensagens q where q.id = ${d.mensagemId})`,
              isNotNull(iaNutriMensagens.texto),
              sql`((${iaNutriMensagens.autor} = 'paciente' and ${iaNutriMensagens.risco} is null and ${iaNutriMensagens.enviadoEm} is not null) or ${iaNutriMensagens.autor} = 'ia')`,
            ),
          )
          .orderBy(desc(iaNutriMensagens.createdAt), desc(iaNutriMensagens.id))
          .limit(ULTIMAS_MENSAGENS_DA_SESSAO)
      )
        .reverse()
        .map((h): ItemDoHistorico => (h.autor === 'paciente' ? { autor: 'paciente', texto: mascarar(h.texto!, alvo) } : { autor: 'ia', tipo_resposta: h.tipo, fontes: h.fontes ?? [] }));
      const pergunta = mascarar(m.texto, alvo);
      const turno = turnoDaConversa({ plano, alvo, hoje, orientacoes: orientacoesAtend, fontesDosAtendimentos, historico, pergunta });
      const dados: Dados = { plano: turno.plano, orientacoes: orientacoesAtend, perguntas: { historico, pergunta } };
      return { planId: plano.id, dados, fontes: turno.fontes, pergunta: m.texto, corpo: turno.corpo, bytes: turno.bytes, resumido: turno.resumido };
    },
    db,
  );
}

/**
 * O trecho de uma fonte do PLANO como a tela o mostra (sem máscara: o paciente lê o próprio plano), puro: `relerTrechos`
 * (sobre o publicado relido) e a avaliação da RN-184 (sobre o fictício) usam o mesmo. A refeição relida é sempre a
 * inteira, mesmo que o contexto a tenha levado resumida (R-239); o grupo da lista mostra os itens dele. Fonte de
 * atendimento ou que não acha a linha → null.
 */
export function trechoDoPlano(plano: PlanoDoContexto, f: Pick<FonteDoContexto, 'indice' | 'tipo' | 'id' | 'grupo'>, tipo: TipoResposta): Trecho | null {
  const mostrar = mostraCalorias(plano);
  if (f.tipo === 'orientacao_atendimento') return null;
  if (f.tipo === 'orientacao_plano') return f.id === plano.id && plano.orientacoes ? { indice: f.indice, fonte: 'Orientações do plano', texto: plano.orientacoes } : null;
  if (f.tipo === 'lista_substituicao') {
    // RN-255 (c): o grupo citado da cópia da lista ligada ao plano publicado
    const grupo = f.grupo === undefined ? undefined : plano.listas.find((l) => l.id === f.id)?.grupos[f.grupo];
    if (!grupo?.itens.length) return null;
    return { indice: f.indice, fonte: `Lista de substituição — ${grupo.nome}`, texto: grupo.itens.map((i) => textoDoItem(i, mostrar)).join('; ') };
  }
  const refeicao = plano.refeicoes.find((r) => (f.tipo === 'refeicao' ? r.id === f.id : r.itens.some((i) => i.id === f.id)));
  if (!refeicao) return null;
  if (f.tipo === 'refeicao') {
    const dias = diasDoTrecho(refeicao);
    if (tipo === 'horario') return { indice: f.indice, fonte: `${refeicao.nome} — horário`, texto: `${refeicao.nome}: ${refeicao.horario || 'sem horário marcado'}${dias ? ` (${dias})` : ''}` };
    const entre = [refeicao.horario, dias].filter(Boolean).join(', ');
    // a observação depois do texto; sem ponto dobrado quando o texto livre já termina numa pontuação
    const comObs = (base: string) => (refeicao.observacao ? `${base}${/[.!?…]\s*$/.test(base) ? ' ' : '. '}${refeicao.observacao}` : base);
    const cabeca = `${refeicao.nome}${entre ? ` (${entre})` : ''}: `;
    // RN-255 (b): no texto livre, o trecho da refeição é o texto do plano
    const livre = textoLivreDa(plano, refeicao);
    if (livre) return { indice: f.indice, fonte: `${refeicao.nome} — texto do plano`, texto: comObs(`${cabeca}${livre}`) };
    const itens = refeicao.itens
      .filter((i) => !i.substituiItemId)
      .map((i) => textoDoItem(i, mostrar))
      .join('; ');
    return { indice: f.indice, fonte: `${refeicao.nome} — itens`, texto: comObs(`${cabeca}${itens}`) };
  }
  const item = refeicao.itens.find((i) => i.id === f.id)!;
  if ((f.tipo === 'substituicao') !== !!item.substituiItemId) return null;
  return { indice: f.indice, fonte: `${refeicao.nome} — ${f.tipo === 'substituicao' ? 'substituições' : 'itens'}`, texto: textoDoItem(item, mostrar) };
}

/**
 * §4.2 passo 5 / RN-172 / RNF-163: os trechos citados, RELIDOS na sessão de paciente, por junção explícita com o plano
 * `publicado` e o MESMO id do contexto (republicado ou arquivado no meio → null → "Não encontrei…"). O texto é o da tela
 * (o paciente lê o plano dele, sem máscara); a lista é a cópia ligada ao plano publicado (RN-252). Qualquer fonte que não
 * ache a linha → null. R-239: os trechos são cortados para a resposta montada caber no CHECK de 24.000 caracteres.
 */
export async function relerTrechos(
  db: Db,
  d: { tenantId: string; patientId: string; planId: string },
  citados: readonly FonteDoContexto[],
  tipo: TipoResposta,
): Promise<Trecho[] | null> {
  return withTenant(
    sessaoDoPaciente(d.tenantId, d.patientId),
    async (tx) => {
      const [pub] = await tx
        .select({ id: mealPlans.id })
        .from(mealPlans)
        .where(and(eq(mealPlans.id, d.planId), eq(mealPlans.patientId, d.patientId), eq(mealPlans.status, 'publicado')));
      const plano: PlanoCompleto | null = pub ? await lerPlanoNaTransacao(tx, pub.id, { auditar: false, comMedidas: false }) : null;
      const trechos: Trecho[] = [];
      for (const f of citados) {
        if (f.tipo === 'orientacao_atendimento') {
          const [a] = await tx
            .select({ data: consultations.data, texto: consultations.orientacoesPaciente })
            .from(consultations)
            .where(and(eq(consultations.id, f.id), eq(consultations.patientId, d.patientId)));
          if (!a?.texto) return null;
          trechos.push({ indice: f.indice, fonte: `Atendimento de ${formatarData(a.data)} — orientações`, texto: a.texto });
          continue;
        }
        if (!plano || plano.status !== 'publicado') return null;
        const t = trechoDoPlano(plano, f, tipo);
        if (!t) return null;
        trechos.push(t);
      }
      return cortarParaCaber(tipo, trechos);
    },
    db,
  );
}
