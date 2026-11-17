import { and, desc, eq, isNotNull, ne, sql } from 'drizzle-orm';
import type { Db, Tx } from '@/db/client';
import { consultations, iaNutriMensagens, mealPlans, patients, tenants, user } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { formatarData } from '@/modules/pacientes/datas';
import { lerPlanoNaTransacao } from '@/modules/plano-alimentar/carregar';
import type { PlanoCompleto, RefeicaoPlano } from '@/modules/plano-alimentar/tipos';
import { kcalDo, quantidadeDoItem } from '@/modules/portal/plano';
import type { CATEGORIAS_DA_IA_NUTRI } from '../campos-enviados';
import { nomeSocialParaMascara } from '../nome-social-worker';
import { comNomeSocial, mascarar, type AlvoDaMascara } from '../pseudonimizar';
import { ATENDIMENTOS_NO_CONTEXTO, ULTIMAS_MENSAGENS_DA_SESSAO, type TipoResposta } from './constantes';
import { INSTRUCAO_CONVERSA, SISTEMA_CONVERSA } from './instrucoes';
import type { Trecho } from './montar-resposta';

/**
 * Plano 15 (§4.2 passo 2, §7.3, RNF-163): o contexto da pergunta, lido na SESSÃO DE PACIENTE sem conta (`semConta`, N7):
 * a RLS do portal isola o paciente, barra rascunho e STAFF_ONLY; o "só o publicado" é filtro explícito (a RLS do paciente
 * vê o `arquivado`). `auditar: false`: a montagem não grava "ler" (o registro é o `exportar` do portão). Índices locais
 * (#R refeição, #I item, #S substituição, #O orientação do plano, #A orientação de atendimento); o mapa índice → linha
 * fica no worker. Texto livre mascarado (nome, e-mail, telefone e CPF do paciente; nomes da equipe; nome do consultório).
 * ÚNICO arquivo novo que lê a tabela `user` (regra 1): só `user.name` das contas de nutricionista do tenant. Só o worker
 * importa (o job `ia-paciente`; guarda de grafo, T13). Sem escrita: só leitura nas duas funções.
 * Plano 18 (RN-282, D19): o nome social do paciente também sai pela máscara (`outrosNomes`). A sessão de paciente sem
 * login não lê `patient_cadastro`: o nome social é lido por `nomeSocialParaMascara` (contexto worker próprio) ANTES e fora
 * desta transação; falhou a leitura, a montagem falha (nada sai sem a máscara).
 */
export type FonteDoContexto = { indice: string; tipo: 'refeicao' | 'item' | 'substituicao' | 'orientacao_plano' | 'orientacao_atendimento'; id: string };
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
};

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

/**
 * PM-3: o paciente (nome, e-mail, telefone), a equipe (só `user.name` das nutricionistas do tenant) e o consultório.
 * Plano 18: e o nome social do paciente (já lido no contexto worker).
 */
async function alvoDaMascara(tx: Tx, tenantId: string, patientId: string, nomeSocial: string | null): Promise<AlvoDaMascara> {
  const [p] = await tx.select({ nome: patients.nome, email: patients.email, telefone: patients.telefoneE164 }).from(patients).where(eq(patients.id, patientId));
  const [t] = await tx.select({ nomeExibicao: tenants.nomeExibicao, nomeProfissional: tenants.nomeProfissional }).from(tenants).where(eq(tenants.id, tenantId));
  const equipe = await tx.select({ nome: user.name }).from(user).where(and(eq(user.tenantId, tenantId), eq(user.appRole, 'nutri')));
  return comNomeSocial(
    {
      nome: p?.nome ?? '',
      email: p?.email ?? null,
      telefone: p?.telefone ?? null,
      outrosNomes: [...equipe.map((u) => u.nome), ...(t?.nomeProfissional ? [t.nomeProfissional] : [])].filter(Boolean),
      frasesExatas: t?.nomeExibicao ? [t.nomeExibicao] : [],
    },
    nomeSocial,
  );
}

/** O item como a tela do plano mostra (nome — quantidade · kcal). */
const textoDoItem = (i: RefeicaoPlano['itens'][number], mostrar: boolean): string => {
  const kcal = kcalDo(i, mostrar);
  return `${i.nome} — ${quantidadeDoItem(i)}${kcal ? ` · ${kcal}` : ''}`;
};

export async function montarContexto(db: Db, d: { tenantId: string; patientId: string; mensagemId: string }): Promise<ContextoDaConversa | null> {
  const nomeSocial = await nomeSocialParaMascara(db, d.tenantId, d.patientId);
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
      const alvo = await alvoDaMascara(tx, d.tenantId, d.patientId, nomeSocial);
      const fontes: FonteDoContexto[] = [];
      let nI = 0;
      let nS = 0;
      // refeições e itens na ordem: os índices #R/#I/#S seguem a ordem das refeições e dos itens
      const refeicoes = plano.refeicoes.map((r, k) => {
        const indice = `#R${k + 1}`;
        fontes.push({ indice, tipo: 'refeicao', id: r.id });
        const itens = r.itens
          .filter((i) => !i.substituiItemId)
          .map((i) => {
            const ii = `#I${++nI}`;
            fontes.push({ indice: ii, tipo: 'item', id: i.id });
            return { indice: ii, alimento: mascarar(i.nome, alvo), quantidade: quantidadeDoItem(i), kcal: kcalDo(i, plano.mostrarCalorias), id: i.id };
          });
        const substituicoes = r.itens
          .filter((i) => i.substituiItemId)
          .map((s) => {
            const is = `#S${++nS}`;
            fontes.push({ indice: is, tipo: 'substituicao', id: s.id });
            return { indice: is, substitui: itens.find((x) => x.id === s.substituiItemId)?.indice ?? null, alimento: mascarar(s.nome, alvo), quantidade: quantidadeDoItem(s), kcal: kcalDo(s, plano.mostrarCalorias) };
          });
        return {
          indice,
          nome: mascarar(r.nome, alvo),
          horario: r.horario || null,
          observacao: r.observacao ? mascarar(r.observacao, alvo) : null,
          itens: itens.map((x) => ({ indice: x.indice, alimento: x.alimento, quantidade: x.quantidade, kcal: x.kcal })), // nenhuma id do banco sai
          substituicoes,
        };
      });
      const orientacoesPlano = plano.orientacoes ? [{ indice: '#O1', texto: mascarar(plano.orientacoes, alvo) }] : [];
      if (plano.orientacoes) fontes.push({ indice: '#O1', tipo: 'orientacao_plano', id: plano.id });
      const atend = await tx
        .select({ id: consultations.id, data: consultations.data, texto: consultations.orientacoesPaciente })
        .from(consultations)
        .where(and(eq(consultations.patientId, d.patientId), isNotNull(consultations.orientacoesPaciente), ne(consultations.orientacoesPaciente, '')))
        .orderBy(desc(consultations.data), desc(consultations.createdAt))
        .limit(ATENDIMENTOS_NO_CONTEXTO);
      const orientacoesAtend = atend.map((a, k) => {
        fontes.push({ indice: `#A${k + 1}`, tipo: 'orientacao_atendimento', id: a.id });
        return { indice: `#A${k + 1}`, data: a.data, texto: mascarar(a.texto ?? '', alvo) };
      });
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
      const dados: Dados = { plano: { refeicoes, orientacoes: orientacoesPlano }, orientacoes: orientacoesAtend, perguntas: { historico, pergunta } };
      const corpo = corpoDaConversa({ plano: dados.plano, orientacoes: dados.orientacoes }, fontes, historico, pergunta);
      return { planId: plano.id, dados, fontes, pergunta: m.texto, corpo, bytes: Buffer.byteLength(corpo) + Buffer.byteLength(SISTEMA_CONVERSA) };
    },
    db,
  );
}

/**
 * §4.2 passo 5 / RN-172 / RNF-163: os trechos citados, RELIDOS na sessão de paciente, por junção explícita com o plano
 * `publicado` e o MESMO id do contexto (republicado ou arquivado no meio → null → "Não encontrei…"). O texto é o da tela
 * (o paciente lê o plano dele, sem máscara). Qualquer fonte que não ache a linha → null.
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
        if (f.tipo === 'orientacao_plano') {
          if (f.id !== plano.id || !plano.orientacoes) return null;
          trechos.push({ indice: f.indice, fonte: 'Orientações do plano', texto: plano.orientacoes });
          continue;
        }
        const refeicao = plano.refeicoes.find((r) => (f.tipo === 'refeicao' ? r.id === f.id : r.itens.some((i) => i.id === f.id)));
        if (!refeicao) return null;
        if (f.tipo === 'refeicao') {
          const itens = refeicao.itens
            .filter((i) => !i.substituiItemId)
            .map((i) => textoDoItem(i, plano.mostrarCalorias))
            .join('; ');
          trechos.push(
            tipo === 'horario'
              ? { indice: f.indice, fonte: `${refeicao.nome} — horário`, texto: `${refeicao.nome}: ${refeicao.horario || 'sem horário marcado'}` }
              : { indice: f.indice, fonte: `${refeicao.nome} — itens`, texto: `${refeicao.nome}${refeicao.horario ? ` (${refeicao.horario})` : ''}: ${itens}${refeicao.observacao ? `. ${refeicao.observacao}` : ''}` },
          );
          continue;
        }
        const item = refeicao.itens.find((i) => i.id === f.id)!;
        if ((f.tipo === 'substituicao') !== !!item.substituiItemId) return null;
        trechos.push({ indice: f.indice, fonte: `${refeicao.nome} — ${f.tipo === 'substituicao' ? 'substituições' : 'itens'}`, texto: textoDoItem(item, plano.mostrarCalorias) });
      }
      return trechos;
    },
    db,
  );
}
