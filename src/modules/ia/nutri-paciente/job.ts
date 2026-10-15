import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { fromDrizzle, type PgBoss } from 'pg-boss';
import type { Db, Tx } from '@/db/client';
import { iaNutriMensagens, patients, tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getBoss } from '@/jobs/boss';
import { logger } from '@/lib/logger';
import { recordAudit } from '@/modules/plataforma/audit';
import { lerPausa, type PausaIaNutri } from '@/modules/plataforma/ia-nutri-pausa';
import { avisarCredencialInvalida, avisarTetoGlobal } from '../alertas';
import type { DestinoIA, ModeloIA, RegiaoIA } from '../constantes';
import { acertar, avisarSeChegou80Ia, CotaIaError, estornar, marcarIncerto, reduzirReserva, reservar } from '../cota';
import { RepetirIaError } from '../leitura-job';
import type { ConfigIA, ModoIA, RetencaoIA } from '../modo';
import { custoMaximoMicroUsd, custoMicroUsd, MAX_TOKENS_CONVERSA, TOKENS_ENTRADA_TETO_CONVERSA, TOKENS_INSTRUCOES_TETO, tokensDeBytes } from '../precos';
import { ErroProvedor, type ProvedorIA, type RespostaGeracao } from '../provedor';
import { LIMITE_RISCO_NA_FILA_DIA, PERGUNTA_PRESA_MS, PRAZO_CONVERSA_MS, RETENCAO_DIAS, type CategoriaConversa, type MotivoTecnico } from './constantes';
import { montarContexto, relerTrechos, type ContextoDaConversa } from './contexto';
import { consentimentoVigente, estadoIaNutriDoTenant, liberadoNaTransacao, ultimoEvento } from './estado';
import { ESFORCO_CONVERSA, PROMPT_VERSAO_CONVERSA, SCHEMA_CONVERSA, SISTEMA_CONVERSA } from './instrucoes';
import { conferirTermos, montarResposta } from './montar-resposta';
import type { CodigoTextoFixo } from './textos';
import { validarSaida } from './validar-resposta';

export type DadosJobIaPaciente = { tenantId: string; mensagemId: string };
export type DepsJobIaPaciente = {
  db: Db;
  modo: ModoIA;
  provedor: ProvedorIA | null;
  geo: RegiaoIA;
  tetoGlobalMicroUsd: number;
  /** RN-109: o destino do provedor em uso (o consentimento tem de ser para ele; o portão o grava). Nulo = sem IA_PROVEDOR. */
  destino: DestinoIA | null;
  retencao: RetencaoIA;
  /** D5: o modelo da IA Nutri do paciente (IA_MODELO_PACIENTE). */
  modeloPaciente: ModeloIA;
  /** RN-185: IA_NUTRI_DESLIGADA=1 (a segunda barreira). */
  nutriDesligada: boolean;
  appUrl: string;
  ultimaTentativa: boolean;
  /** pg-boss: o job expirou e outra execução assumiu — não passa do passo 1 (a outra segue). */
  abortado?: () => boolean;
  agora?: () => Date;
  boss?: PgBoss;
  /** testes: a pausa injetada (a linha é uma só para o banco). */
  pausa?: PausaIaNutri;
};
type Fim = 'respondida' | 'falhou' | 'ignorada';
/**
 * A sessão e a guarda da resposta são as da pergunta, copiadas NO BANCO: o Date do JS só guarda milissegundos e o
 * timestamptz tem microssegundos — a resposta com a sessão lida de volta ficaria numa "sessão" diferente da pergunta, e a
 * pergunta seguinte (que herda a sessão da última mensagem, 0117) perderia o histórico.
 */
const daPergunta = (perguntaId: string) => ({
  sessaoInicio: sql<Date>`(select q.sessao_inicio from ia_nutri_mensagens q where q.id = ${perguntaId})`,
  expiraEm: sql<Date>`(select q.expira_em from ia_nutri_mensagens q where q.id = ${perguntaId})`,
});
/** RN-180 / DP-9: no máximo 3 perguntas em andamento por consultório. */
const MAX_EM_ANDAMENTO_POR_TENANT = 3;
/**
 * Revisão da T9: a pergunta mais velha que isto não passa pelo portão. A varredura (e `app_ia_nutri_perguntar`) a encerra
 * aos 3 min (PERGUNTA_PRESA_MS) sem olhar se a chamada está no ar; o que sai do portão até aqui volta (45 s, com folga para
 * a releitura e o passo 6) antes disso — nada é pago para ser descartado. Fila atrasada → `falhou`/`interrompida`, estorno.
 */
const FOLGA_DO_PORTAO_MS = 15_000;
const IDADE_MAXIMA_NO_PORTAO_MS = PERGUNTA_PRESA_MS - PRAZO_CONVERSA_MS - FOLGA_DO_PORTAO_MS; // 2 min

/** O `ConfigIA` que o estado do consultório precisa, a partir das dependências do job. */
const configDoJob = (deps: DepsJobIaPaciente): Pick<ConfigIA, 'modo' | 'destino' | 'retencao' | 'nutriDesligada'> => ({
  modo: deps.modo,
  destino: deps.destino,
  retencao: deps.retencao,
  nutriDesligada: deps.nutriDesligada,
});

/**
 * Plano 15 (§4.2 do worker, RN-170, RN-172, RN-175, RN-179, RN-180, D21, D30): fila `ia-paciente` (só o worker importa —
 * guarda de grafo, T13). (1) trava o paciente, reconfere a RN-170 e RESERVA a cota no escopo `paciente` → (2) contexto na
 * sessão de paciente (contexto.ts) → (3) PORTÃO DO ENVIO (paciente → tenant → mensagem): reconfere, desce a reserva pelo
 * pedido montado, grava enviado_em/saiu_em/destino e "Pergunta enviada à IA" → (4) `gerar`, sem ferramentas, 45 s → (5)
 * valida e relê os trechos → (6) grava com as mesmas travas, conferindo de novo a RN-170 e a revogação. Nada de conteúdo
 * (pergunta, contexto, trecho, resposta, categoria) em log: só ids, códigos, modelo, tokens, custo e duração.
 */
export async function processarPerguntaIaNutri(d: DadosJobIaPaciente, deps: DepsJobIaPaciente): Promise<Fim> {
  const agora = deps.agora ?? (() => new Date());
  const ctx: TenantContext = { tenantId: d.tenantId, role: 'worker' };
  const modelo = deps.modeloPaciente;
  let pacienteId = ''; // lido no passo 1 (a pergunta diz de quem é)

  /** RN-170 dentro de uma transação com o paciente travado: o consultório, a liberação, o consentimento e a revogação. */
  const conferir = async (tx: Tx, criadaEm: Date): Promise<boolean> => {
    const [p] = await tx.select({ status: patients.status, anon: patients.anonimizadoEm }).from(patients).where(eq(patients.id, pacienteId));
    const [t] = await tx.select().from(tenants).where(eq(tenants.id, d.tenantId));
    if (!p || p.status !== 'ativo' || p.anon || !t || !deps.destino) return false;
    if (estadoIaNutriDoTenant(t, configDoJob(deps) as ConfigIA, deps.pausa ?? (await lerPausa(tx))) !== 'ativa') return false;
    if (!(await liberadoNaTransacao(tx, pacienteId))) return false;
    const ev = await ultimoEvento(tx, pacienteId);
    // a pergunta criada antes da última revogação vale como revogada (molde de situacaoParaTarefa)
    return consentimentoVigente(ev, deps.destino) && !!ev && ev.registradoEm < criadaEm;
  };

  /** Termina com um texto fixo (mensagem `ia`) ou sem resposta (cancelada); reserva estornada (não saiu) ou incerta (saiu). */
  const encerrar = async (o: { status: 'falhou' | 'cancelada'; textoFixo: CodigoTextoFixo | null; motivo: MotivoTecnico; reserva: 'estornar' | 'manter' | 'nenhuma' }): Promise<Fim> => {
    await withTenant(
      ctx,
      async (tx) => {
        await tx.select({ id: patients.id }).from(patients).where(eq(patients.id, pacienteId)).for('share');
        const [m] = await tx
          .update(iaNutriMensagens)
          .set({ status: o.status, motivoTecnico: o.motivo, updatedAt: agora() })
          .where(and(eq(iaNutriMensagens.id, d.mensagemId), inArray(iaNutriMensagens.status, ['na_fila', 'processando'])))
          .returning({ id: iaNutriMensagens.id });
        if (!m) return;
        if (o.textoFixo) {
          await tx.insert(iaNutriMensagens).values({
            tenantId: d.tenantId, patientId: pacienteId, ...daPergunta(d.mensagemId), autor: 'ia', textoFixo: o.textoFixo, motivoTecnico: o.motivo,
            respondeA: d.mensagemId, modelo, promptVersao: PROMPT_VERSAO_CONVERSA,
          });
        }
        if (o.reserva === 'estornar') await estornar(tx, d.mensagemId, agora());
        else if (o.reserva === 'manter') await marcarIncerto(tx, d.mensagemId, agora());
      },
      deps.db,
    );
    logger.warn({ mensagemId: d.mensagemId, tenantId: d.tenantId, finalidade: 'conversa_paciente', status: o.status, motivoTecnico: o.motivo }, 'pergunta da IA Nutri sem resposta montada');
    return 'falhou';
  };

  // (1) pega a pergunta, reconfere e reserva (paciente FOR UPDATE → mensagem FOR UPDATE → tenant FOR NO KEY UPDATE, ANTES da
  // contagem das 3 em andamento — a mesma trava que a reserva pega logo depois, na mesma transação)
  type Passo1 = { fim: null; criadaEm: Date } | { fim: 'ignorada' | 'incerto' | 'cancelada' | 'indisponivel' | 'cheio' | CotaIaError['motivo'] };
  const passo1 = await withTenant(
    ctx,
    async (tx): Promise<Passo1> => {
      const [m0] = await tx.select({ patientId: iaNutriMensagens.patientId }).from(iaNutriMensagens).where(eq(iaNutriMensagens.id, d.mensagemId));
      if (!m0) return { fim: 'ignorada' };
      pacienteId = m0.patientId;
      await tx.select({ id: patients.id }).from(patients).where(eq(patients.id, pacienteId)).for('update');
      const [m] = await tx.select().from(iaNutriMensagens).where(eq(iaNutriMensagens.id, d.mensagemId)).for('update');
      if (!m || m.autor !== 'paciente' || (m.status !== 'na_fila' && m.status !== 'processando')) return { fim: 'ignorada' };
      if (m.enviadoEm) return { fim: 'incerto' }; // D4 do Plano 11: nunca reenviar
      if (!(await conferir(tx, m.createdAt))) return { fim: 'cancelada' };
      if (!deps.provedor || !deps.provedor.aceita(modelo, deps.geo)) return { fim: 'indisponivel' };
      // DP-9 / RN-180 (/code-review do PR #37): a contagem SERIALIZADA pelo tenant — sem a trava antes, dois jobs de pacientes
      // diferentes liam n = 2 ao mesmo tempo e o consultório ficava com 4 chamadas. Com ela, o segundo espera o primeiro gravar
      // `processando` e, no READ COMMITTED, a contagem seguinte já o vê. A ordem não muda: a reserva já travava o tenant depois
      // da mensagem.
      await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, d.tenantId)).for('no key update');
      const [{ n }] = await tx
        .select({ n: count() })
        .from(iaNutriMensagens)
        .where(and(eq(iaNutriMensagens.status, 'processando'), sql`${iaNutriMensagens.id} <> ${m.id}`));
      if (n >= MAX_EM_ANDAMENTO_POR_TENANT) return { fim: 'cheio' };
      if (m.status === 'na_fila') {
        const teto = custoMaximoMicroUsd(modelo, deps.geo, TOKENS_ENTRADA_TETO_CONVERSA, MAX_TOKENS_CONVERSA);
        try {
          await reservar(tx, { tenantId: d.tenantId, tarefaId: m.id, tipo: 'conversa_paciente', modelo, promptVersao: PROMPT_VERSAO_CONVERSA, microUsd: teto, agora: agora(), tetoGlobalMicroUsd: deps.tetoGlobalMicroUsd });
        } catch (e) {
          if (e instanceof CotaIaError) return { fim: e.motivo };
          throw e;
        }
        await tx
          .update(iaNutriMensagens)
          .set({ status: 'processando', modelo, promptVersao: PROMPT_VERSAO_CONVERSA, reservaMicroUsd: teto, updatedAt: agora() })
          .where(eq(iaNutriMensagens.id, m.id));
      }
      return { fim: null, criadaEm: m.createdAt };
    },
    deps.db,
  );
  switch (passo1.fim) {
    case null:
      break;
    case 'ignorada':
      return 'ignorada';
    case 'incerto':
      return encerrar({ status: 'falhou', textoFixo: 'falha', motivo: 'resultado_incerto', reserva: 'manter' });
    case 'cancelada':
      return encerrar({ status: 'cancelada', textoFixo: null, motivo: 'indisponivel', reserva: 'estornar' });
    case 'indisponivel':
      return encerrar({ status: 'falhou', textoFixo: 'indisponivel', motivo: 'indisponivel', reserva: 'estornar' });
    case 'cota':
    case 'teto_plataforma':
      if (passo1.fim === 'teto_plataforma') await avisarTetoGlobal(deps.db, agora(), deps.appUrl).catch(() => undefined);
      return encerrar({ status: 'falhou', textoFixo: 'indisponivel', motivo: passo1.fim, reserva: 'nenhuma' });
    case 'cheio':
      if (!deps.ultimaTentativa) throw new RepetirIaError('IA Nutri: 3 perguntas em andamento no consultório');
      return encerrar({ status: 'falhou', textoFixo: 'falha', motivo: 'provedor_indisponivel', reserva: 'estornar' });
  }
  if (deps.abortado?.()) return 'ignorada';

  // (2) o contexto, na sessão de paciente (só leitura)
  const c: ContextoDaConversa | null = await montarContexto(deps.db, { tenantId: d.tenantId, patientId: pacienteId, mensagemId: d.mensagemId });
  if (!c) return encerrar({ status: 'falhou', textoFixo: 'nao_encontrei', motivo: 'indisponivel', reserva: 'estornar' });

  // (3) PORTÃO DO ENVIO: paciente FOR SHARE → tenant FOR SHARE → mensagem FOR UPDATE → ia_uso → plataforma
  const portao = await withTenant(
    ctx,
    async (tx): Promise<'ok' | 'cancelada' | 'limite_custo' | 'velha' | 'ignorada'> => {
      await tx.select({ id: patients.id }).from(patients).where(eq(patients.id, pacienteId)).for('share');
      await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, d.tenantId)).for('share');
      const [m] = await tx.select().from(iaNutriMensagens).where(eq(iaNutriMensagens.id, d.mensagemId)).for('update');
      if (!m || m.status !== 'processando' || m.enviadoEm) return 'ignorada';
      if (!(await conferir(tx, m.createdAt))) return 'cancelada';
      if (m.createdAt.getTime() <= agora().getTime() - IDADE_MAXIMA_NO_PORTAO_MS) return 'velha'; // a varredura a encerraria no ar
      if (m.destino && m.destino !== deps.destino) return 'cancelada'; // RN-109: o que já saiu para um destino não sai para outro
      // DP-8: os bytes do corpo exato que sai (c.corpo) mais as instruções — nada sai além do que foi medido
      const teto = custoMaximoMicroUsd(modelo, deps.geo, tokensDeBytes(c.bytes) + TOKENS_INSTRUCOES_TETO, MAX_TOKENS_CONVERSA);
      if (teto > m.reservaMicroUsd) return 'limite_custo'; // a reserva nunca sobe (RN-104)
      await tx
        .update(iaNutriMensagens)
        .set({ enviadoEm: agora(), saiuEm: m.saiuEm ?? agora(), destino: m.destino ?? deps.destino, reservaMicroUsd: teto, updatedAt: agora() })
        .where(eq(iaNutriMensagens.id, m.id));
      await reduzirReserva(tx, m.id, teto, agora());
      await recordAudit(tx, { acao: 'exportar', entidade: 'ia_nutri', entidadeId: m.id, patientId: pacienteId }); // "Pergunta enviada à IA"
      return 'ok';
    },
    deps.db,
  );
  if (portao === 'ignorada') return 'ignorada';
  if (portao === 'cancelada') return encerrar({ status: 'cancelada', textoFixo: null, motivo: 'indisponivel', reserva: 'estornar' });
  if (portao === 'limite_custo') return encerrar({ status: 'falhou', textoFixo: 'falha', motivo: 'limite_custo', reserva: 'estornar' });
  if (portao === 'velha') return encerrar({ status: 'falhou', textoFixo: 'falha', motivo: 'interrompida', reserva: 'estornar' });

  // (4) uma chamada, sem ferramentas, 45 s
  const inicio = Date.now();
  let r: RespostaGeracao;
  try {
    r = await deps.provedor!.gerar({
      finalidade: 'conversa_paciente',
      modelo,
      geo: deps.geo,
      sistema: SISTEMA_CONVERSA,
      turnos: [{ papel: 'usuario', blocos: [{ tipo: 'texto', texto: c.corpo }] }], // montado uma vez em contexto.ts (DP-8)
      ferramentas: [],
      schema: SCHEMA_CONVERSA as unknown as Record<string, unknown>,
      maxTokens: MAX_TOKENS_CONVERSA,
      esforco: ESFORCO_CONVERSA,
      prazoMs: PRAZO_CONVERSA_MS,
    });
  } catch (e) {
    const tipo = e instanceof ErroProvedor ? e.tipo : 'incerto';
    logger.warn(
      { mensagemId: d.mensagemId, tenantId: d.tenantId, finalidade: 'conversa_paciente', tipo, status: e instanceof ErroProvedor ? e.status : null, requestId: e instanceof ErroProvedor ? e.requestId : null },
      'provedor de IA recusou ou falhou',
    );
    if (tipo === 'nao_enviado' || tipo === 'repetir') {
      // nada foi processado: `enviado_em` volta a nulo antes de repetir (a mesma pergunta pode passar de novo pelo portão)
      await withTenant(
        ctx,
        (tx) => tx.update(iaNutriMensagens).set({ enviadoEm: null, updatedAt: agora() }).where(and(eq(iaNutriMensagens.id, d.mensagemId), eq(iaNutriMensagens.status, 'processando'))),
        deps.db,
      );
      if (!deps.ultimaTentativa) throw new RepetirIaError(`provedor: ${tipo}`);
      return encerrar({ status: 'falhou', textoFixo: 'falha', motivo: 'provedor_indisponivel', reserva: 'estornar' });
    }
    if (tipo === 'credencial') await avisarCredencialInvalida(deps.db, agora(), deps.appUrl).catch(() => undefined);
    if (tipo === 'limite_de_gasto') await avisarTetoGlobal(deps.db, agora(), deps.appUrl).catch(() => undefined);
    return encerrar({ status: 'falhou', textoFixo: 'falha', motivo: tipo === 'incerto' ? 'resultado_incerto' : 'provedor_indisponivel', reserva: tipo === 'incerto' ? 'manter' : 'estornar' });
  }

  // (5) valida a saída e relê os trechos (sessão de paciente; mesmo plano publicado). Nenhuma palavra do modelo chega ao
  // paciente: o texto é montado com os trechos relidos, ou é um texto fixo (RN-172, RN-175)
  type Resultado = { texto: string | null; textoFixo: CodigoTextoFixo | null; categoria: CategoriaConversa | null; tipo: string | null; fontes: string[] | null; motivo: MotivoTecnico | null; risco: boolean };
  let res: Resultado;
  if (r.tipo === 'recusa') res = { texto: null, textoFixo: 'nao_encontrei', categoria: null, tipo: null, fontes: null, motivo: 'recusa', risco: false };
  else if (r.tipo !== 'final') res = { texto: null, textoFixo: 'nao_encontrei', categoria: null, tipo: null, fontes: null, motivo: 'invalida_formato', risco: false };
  else {
    const v = validarSaida(r.texto, { enviados: new Set(c.fontes.map((f) => f.indice)), pergunta: c.pergunta });
    if (!v.ok) res = { texto: null, textoFixo: v.textoFixo, categoria: v.categoria, tipo: null, fontes: null, motivo: v.motivo, risco: v.risco };
    else {
      const citados = v.fontes.map((i) => c.fontes.find((f) => f.indice === i)!);
      const trechos = await relerTrechos(deps.db, { tenantId: d.tenantId, patientId: pacienteId, planId: c.planId }, citados, v.tipo);
      if (!trechos) res = { texto: null, textoFixo: 'nao_encontrei', categoria: 'plano', tipo: null, fontes: v.fontes, motivo: 'invalida_fonte', risco: false };
      else if (!conferirTermos(c.pergunta, trechos)) res = { texto: null, textoFixo: 'suplemento_ou_remedio', categoria: 'suplemento_ou_remedio', tipo: null, fontes: v.fontes, motivo: 'invalida_termo', risco: false };
      else res = { texto: montarResposta(v.tipo, trechos), textoFixo: null, categoria: 'plano', tipo: v.tipo, fontes: v.fontes, motivo: null, risco: false };
    }
  }

  // (6) grava com as mesmas travas do portão, conferindo de novo; o custo é acertado sempre (o pedido saiu)
  const custo = custoMicroUsd(modelo, deps.geo, r.uso);
  const fim = await withTenant(
    ctx,
    async (tx): Promise<Fim> => {
      await tx.select({ id: patients.id }).from(patients).where(eq(patients.id, pacienteId)).for('share');
      const [t] = await tx.select({ fuso: tenants.fuso }).from(tenants).where(eq(tenants.id, d.tenantId)).for('share');
      const [m] = await tx.select().from(iaNutriMensagens).where(eq(iaNutriMensagens.id, d.mensagemId)).for('update');
      if (!m) {
        await marcarIncerto(tx, d.mensagemId, agora()); // o pedido saiu: a reserva fica como custo (RN-182)
        return 'falhou';
      }
      const valido = m.status === 'processando' && (await conferir(tx, m.createdAt));
      // /code-review do PR #37 (RN-174, D22): o sinal de risco do MODELO não se perde porque a RN-170 deixou de valer durante a
      // chamada. (a) A pergunta ainda está `processando` (bloqueio, paciente arquivado, IA Nutri desativada no consultório,
      // pausa, consentimento com texto novo): segue o caminho do risco abaixo — o texto fixo de transtorno ao paciente (ele
      // continua lendo a conversa, Review Focus 5), a pergunta na fila com risco `modelo` e o aviso à nutricionista. (b) A
      // revogação já esvaziou a pergunta (`cancelada`, `revogada_em`, sem texto): só o aviso mínimo da D22 b ("Aviso: houve
      // sinal de risco" — risco `modelo`, sem texto, na fila, até o prazo da D8, como a retenção faz depois dos 30 dias), sem
      // mensagem `ia` e sem trazer de volta nada do que o paciente mandou apagar.
      // (c) Revisão da T9: a pergunta foi encerrada POR FORA com a chamada no ar — a varredura de 3 min ou
      // `app_ia_nutri_perguntar` (`falhou`/`interrompida`, texto fixo `falha`) ou outra execução deste job depois de o pg-boss
      // dar o job por expirado (`resultado_incerto`) — e não houve revogação: o risco segue como em (a), a pergunta continua
      // `falhou` (é o que aconteceu com ela) e a mensagem `ia` de falha vira o texto fixo de transtorno (uma resposta só).
      // Revogada depois disso (`falhou`, `revogada_em`, sem texto): o aviso mínimo de (b).
      const encerradaPorFora = m.status === 'falhou' && m.revogadaEm === null && (m.motivoTecnico === 'interrompida' || m.motivoTecnico === 'resultado_incerto');
      const riscoNoMeio = !valido && res.risco && (m.status === 'processando' || encerradaPorFora);
      const riscoRevogado = !valido && res.risco && (m.status === 'cancelada' || m.status === 'falhou') && m.revogadaEm !== null && m.texto === null;
      if (!valido && !riscoNoMeio && !riscoRevogado) {
        if (m.status === 'processando') {
          await tx.update(iaNutriMensagens).set({ status: 'cancelada', motivoTecnico: 'indisponivel', updatedAt: agora() }).where(eq(iaNutriMensagens.id, m.id));
        }
        await marcarIncerto(tx, d.mensagemId, agora()); // o pedido saiu: a reserva fica como custo (RN-182)
        return 'falhou';
      }
      let encaminhar = false;
      if (res.risco) {
        // até 10 na fila por paciente por dia, contado no dia do FUSO do consultório (como a função app_ia_nutri_perguntar)
        const fuso = t?.fuso ?? 'America/Sao_Paulo';
        const [{ n }] = await tx
          .select({ n: count() })
          .from(iaNutriMensagens)
          .where(
            and(
              eq(iaNutriMensagens.patientId, pacienteId),
              sql`${iaNutriMensagens.risco} is not null`,
              sql`${iaNutriMensagens.encaminhadaEm} is not null`,
              sql`${iaNutriMensagens.createdAt} >= (date_trunc('day', now() AT TIME ZONE ${fuso}) AT TIME ZONE ${fuso})`,
            ),
          );
        encaminhar = n < LIMITE_RISCO_NA_FILA_DIA;
      }
      /** D10 / DP-6: o e-mail genérico de risco às nutricionistas, na mesma transação (só o id do tenant na fila). */
      const enviarAvisoDeRisco = async () => {
        if (!encaminhar) return;
        const job = await (deps.boss ?? (await getBoss())).send('ia-nutri-risco', { tenantId: d.tenantId }, { db: fromDrizzle(tx, sql) });
        if (!job) throw new Error('A fila recusou o aviso de risco da IA Nutri');
      };
      if (riscoRevogado) {
        if (encaminhar) {
          await tx
            .update(iaNutriMensagens)
            .set({ risco: 'modelo', encaminhadaEm: sql`now()`, expiraEm: sql`${iaNutriMensagens.createdAt} + make_interval(days => ${RETENCAO_DIAS})`, updatedAt: agora() })
            .where(eq(iaNutriMensagens.id, m.id));
        }
        await marcarIncerto(tx, d.mensagemId, agora()); // como na revogação sem risco (Review Focus 2)
        await enviarAvisoDeRisco();
        return 'falhou';
      }
      // coalesce: nunca sobrescreve um encaminhamento que já exista (o gatilho só deixa encaminhar respondida/falhou, mas por segurança)
      await tx
        .update(iaNutriMensagens)
        .set({
          ...(encerradaPorFora ? {} : { status: 'respondida' as const }),
          ...(res.risco ? { risco: 'modelo', encaminhadaEm: encaminhar ? sql`coalesce(${iaNutriMensagens.encaminhadaEm}, now())` : sql`${iaNutriMensagens.encaminhadaEm}` } : {}),
          updatedAt: agora(),
        })
        .where(eq(iaNutriMensagens.id, m.id));
      const resposta = { texto: res.texto, textoFixo: res.textoFixo, categoria: res.categoria, tipoResposta: res.tipo, fontes: res.fontes, motivoTecnico: res.motivo };
      const trocadas = encerradaPorFora
        ? await tx
            .update(iaNutriMensagens)
            .set({ ...resposta, updatedAt: agora() })
            .where(and(eq(iaNutriMensagens.respondeA, m.id), eq(iaNutriMensagens.autor, 'ia')))
            .returning({ id: iaNutriMensagens.id })
        : [];
      if (!trocadas.length) {
        await tx.insert(iaNutriMensagens).values({
          tenantId: d.tenantId, patientId: pacienteId, ...daPergunta(m.id), autor: 'ia', ...resposta, respondeA: m.id, modelo, promptVersao: PROMPT_VERSAO_CONVERSA,
        });
      }
      await acertar(tx, { tarefaId: m.id, custoMicroUsd: custo, uso: r.uso, recusaCategoria: r.tipo === 'recusa' ? r.categoria : null, requestId: r.requestId, agora: agora() });
      await enviarAvisoDeRisco();
      return 'respondida';
    },
    deps.db,
  );
  logger.info(
    {
      mensagemId: d.mensagemId, tenantId: d.tenantId, finalidade: 'conversa_paciente', modelo, promptVersao: PROMPT_VERSAO_CONVERSA,
      tokensEntrada: r.uso.entrada, tokensSaida: r.uso.saida, custoMicroUsd: custo, duracaoMs: Date.now() - inicio, motivoTecnico: res.motivo, requestId: r.requestId,
    },
    'pergunta da IA Nutri',
  );
  await avisarSeChegou80Ia(deps.db, d.tenantId, agora(), deps.appUrl, 'paciente').catch((err: unknown) =>
    logger.error({ tenantId: d.tenantId, err: err instanceof Error ? err.name : 'erro' }, 'falha no aviso de 80% da IA Nutri'),
  );
  return fim;
}
