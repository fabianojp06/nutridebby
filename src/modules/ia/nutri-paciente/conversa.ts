import { and, asc, count, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { fromDrizzle } from 'pg-boss';
import { getDb, type Db } from '@/db/client';
import { iaNutriMensagens, patients, tenants } from '@/db/schema';
import { sessaoDePacienteComConta, withTenant, type TenantContext } from '@/db/tenant';
import { getBoss } from '@/jobs/boss';
import { idValido } from '@/modules/pacientes/base';
import { auditRead, recordAudit } from '@/modules/plataforma/audit';
import { lerPausa } from '@/modules/plataforma/ia-nutri-pausa';
import { IA_NUTRI_TERMO_VERSAO_MIN } from '../textos-legais';
import { AVALIACOES, LIMITE_DUVIDAS_ABERTAS, MAX_PERGUNTA, MSG_IA_NUTRI, ROTULO_CATEGORIA, type Autor, type CategoriaConversa, type CodigoPergunta, type StatusPergunta } from './constantes';
import type { DepsIaNutri } from './deps';
import { consentimentoVigente, estadoIaNutriDoTenant, liberadoNaTransacao, ultimoEvento } from './estado';
import { IaNutriError } from './participacao';
import { detectarRisco } from './sinais-risco';
import { COM_ENCAMINHAR, textoDoRiscoSemEnvio, type CodigoTextoFixo } from './textos';

export type { DepsIaNutri } from './deps';
export type ResultadoPergunta = { codigo: CodigoPergunta; mensagemId: string | null; textoFixo: CodigoTextoFixo | null };
export type ResultadoEnvioDireto = { codigo: 'encaminhada' | 'limite' | 'indisponivel' | 'risco'; mensagemId: string | null; textoFixo: CodigoTextoFixo | null };

/** O texto do cliente: sem espaços nas pontas; vazio ou acima de 500 caracteres (contados como o banco conta) → "Escreva sua dúvida em até 500 caracteres." */
function textoDaPergunta(textoBruto: unknown): string {
  const texto = typeof textoBruto === 'string' ? textoBruto.trim() : '';
  if (!texto || Array.from(texto).length > MAX_PERGUNTA) throw new IaNutriError(MSG_IA_NUTRI.longa);
  return texto;
}

/**
 * US-172 / §4.2 (passos do app): (1) o filtro de risco, antes de gravar e de chamar o provedor; (2) a parte do consultório
 * da RN-170 (IA, retenção, aditivo 1.2, ativação, pausa, IA_NUTRI_DESLIGADA); (3) a função fechada (a parte do paciente, uma
 * por vez, limites e a gravação); (4) com `ok`, "Perguntou à IA" e o job `ia-paciente` NA MESMA transação (a função não
 * enfileira: o migrator não alcança o schema pgboss em produção). Nada do texto vai a log, fila ou auditoria.
 */
export async function perguntar(ctx: TenantContext, textoBruto: string, deps: DepsIaNutri): Promise<ResultadoPergunta> {
  if (!sessaoDePacienteComConta(ctx)) throw new Error('perguntar: só a sessão de paciente com conta');
  const texto = textoDaPergunta(textoBruto);
  const risco = detectarRisco(texto);
  const boss = deps.boss ?? (await getBoss()); // fora da transação: o produtor tem pool próprio (boss.test.ts)
  // RN-174: o texto fixo de risco aparece SEMPRE que o filtro acha — também se a IA Nutri ficou indisponível entre a tela e o
  // envio (nesse caso nada é gravado nem enfileirado, e a tela mostra o texto pelo código devolvido). Sem a mensagem gravada
  // (indisponível, parte do paciente recusada ou acima de LIMITE_RISCO_GRAVADO_DIA), nada foi ao consultório: o de emergência
  const soTextoDeRisco: ResultadoPergunta | null = risco ? { codigo: 'risco', mensagemId: null, textoFixo: textoDoRiscoSemEnvio(risco.textoFixo) } : null;
  const indisponivel: ResultadoPergunta = soTextoDeRisco ?? { codigo: 'indisponivel', mensagemId: null, textoFixo: null };
  return withTenant(
    ctx,
    async (tx): Promise<ResultadoPergunta> => {
      const [t] = await tx.select().from(tenants).where(eq(tenants.id, ctx.tenantId));
      const pausa = deps.pausa ?? (await lerPausa(tx));
      if (!t || !deps.ia.destino || estadoIaNutriDoTenant(t, deps.ia, pausa) !== 'ativa') return indisponivel;
      const r = await tx.execute(
        sql`select * from app_ia_nutri_perguntar(${texto}, ${risco?.risco ?? null}, ${risco?.textoFixo ?? null}, ${IA_NUTRI_TERMO_VERSAO_MIN}, ${deps.ia.destino})`,
      );
      const { codigo, mensagem_id: mensagemId } = r.rows[0] as { codigo: CodigoPergunta; mensagem_id: string | null };
      if (codigo === 'indisponivel') return indisponivel;
      // "Perguntou à IA" (RN-183) sempre que a pergunta foi gravada: também a com risco (a mensagem existe e a nutricionista a lê)
      if ((codigo === 'ok' || codigo === 'risco') && mensagemId) {
        await recordAudit(tx, { acao: 'criar', entidade: 'ia_nutri_pergunta', entidadeId: mensagemId, patientId: ctx.patientId! });
      }
      if (codigo === 'ok' && mensagemId) {
        const job = await boss.send('ia-paciente', { tenantId: ctx.tenantId, mensagemId }, { db: fromDrizzle(tx, sql) });
        if (!job) throw new Error('A fila recusou a pergunta da IA Nutri');
      }
      // o aviso só quando a mensagem foi gravada (acima de LIMITE_RISCO_GRAVADO_DIA a função não grava: nada a avisar de novo)
      if (codigo === 'risco' && mensagemId) {
        // sem singletonKey aqui: um job imediato sempre nasce; dentro da janela de 15 min ele se reagenda (risco-job.ts)
        const job = await boss.send('ia-nutri-risco', { tenantId: ctx.tenantId }, { db: fromDrizzle(tx, sql) });
        if (!job) throw new Error('A fila recusou o aviso de risco da IA Nutri');
      }
      if (codigo === 'risco' && !mensagemId) return soTextoDeRisco ?? indisponivel; // acima do teto do dia: nada gravado
      if (codigo === 'risco') {
        // /code-review do PR #37: o texto fixo que a função GRAVOU na mensagem `sistema` — gravada fora da fila (já 10 na fila
        // hoje), o de transtorno vira o de emergência lá (0117); a tela mostra o mesmo que a conversa relida vai mostrar
        const [aviso] = await tx
          .select({ textoFixo: iaNutriMensagens.textoFixo })
          .from(iaNutriMensagens)
          .where(and(eq(iaNutriMensagens.respondeA, mensagemId!), eq(iaNutriMensagens.autor, 'sistema')));
        return { codigo, mensagemId, textoFixo: (aviso?.textoFixo as CodigoTextoFixo | null | undefined) ?? textoDoRiscoSemEnvio(risco!.textoFixo) };
      }
      return { codigo, mensagemId, textoFixo: null };
    },
    deps.db ?? getDb(),
  );
}

/**
 * DP-16 / §7.5 / RN-178: "Enviar direto para minha nutricionista" do formulário — sem IA, sem job, sem contar no limite;
 * vale com o limite do dia ou do mês e com a cota esgotada. Com sinal de risco, vai por `perguntar` (o texto fixo na hora e
 * a fila de risco). "Enviou dúvida à nutricionista" na auditoria (`criar` de `ia_nutri_duvida`).
 */
export async function enviarANutri(ctx: TenantContext, textoBruto: string, deps: DepsIaNutri): Promise<ResultadoEnvioDireto> {
  if (!sessaoDePacienteComConta(ctx)) throw new Error('enviarANutri: só a sessão de paciente com conta');
  const texto = textoDaPergunta(textoBruto);
  if (detectarRisco(texto)) {
    const r = await perguntar(ctx, texto, deps);
    return { codigo: r.codigo === 'risco' ? 'risco' : 'indisponivel', mensagemId: r.mensagemId, textoFixo: r.textoFixo };
  }
  return withTenant(
    ctx,
    async (tx): Promise<ResultadoEnvioDireto> => {
      const [t] = await tx.select().from(tenants).where(eq(tenants.id, ctx.tenantId));
      const pausa = deps.pausa ?? (await lerPausa(tx));
      if (!t || !deps.ia.destino || estadoIaNutriDoTenant(t, deps.ia, pausa) !== 'ativa') return { codigo: 'indisponivel', mensagemId: null, textoFixo: null };
      const r = await tx.execute(sql`select * from app_ia_nutri_enviar_a_nutri(${texto}, ${IA_NUTRI_TERMO_VERSAO_MIN}, ${deps.ia.destino})`);
      const { codigo, mensagem_id: mensagemId } = r.rows[0] as { codigo: 'encaminhada' | 'limite' | 'indisponivel'; mensagem_id: string | null };
      if (codigo === 'encaminhada' && mensagemId) await recordAudit(tx, { acao: 'criar', entidade: 'ia_nutri_duvida', entidadeId: mensagemId, patientId: ctx.patientId! });
      return { codigo, mensagemId, textoFixo: null };
    },
    deps.db ?? getDb(),
  );
}

/**
 * US-172 "Ajudou / Não ajudou": uma vez, numa resposta da IA com conteúdo (o gatilho confere as colunas). Fica só no NutriDebby
 * (§7.6). /code-review do PR #37 (aba antiga): a spec não pede a RN-170 inteira para avaliar uma resposta já dada (pausa ou
 * consultório desligado não impedem); recusa só com a participação bloqueada ou o consentimento desativado (último evento
 * ≠ aceite) — a conversa só para ler já esconde "Ajudou".
 */
export async function avaliar(ctx: TenantContext, mensagemId: string, valor: 'ajudou' | 'nao_ajudou', db: Db = getDb()): Promise<boolean> {
  if (!sessaoDePacienteComConta(ctx)) throw new Error('avaliar: só a sessão de paciente com conta');
  // /code-review do PR #37: id e valor vêm do cliente (argumentos da Server Action) — fora do formato → false, nunca 22P02/23514
  if (!idValido(mensagemId) || !(AVALIACOES as readonly unknown[]).includes(valor)) return false;
  const r = await withTenant(
    ctx,
    async (tx) => {
      // P15-02a: o paciente travado (FOR SHARE, ordem DP-10) — a avaliação fica inteira antes ou depois da revogação, e o
      // seu "Alterou" nunca cai na janela que o Histórico de acessos esconde (visivelNoHistorico, audit.ts)
      await tx.select({ id: patients.id }).from(patients).where(eq(patients.id, ctx.patientId!)).for('share');
      if (!(await liberadoNaTransacao(tx, ctx.patientId!)) || (await ultimoEvento(tx, ctx.patientId!))?.evento !== 'aceite') return [];
      return tx
        .update(iaNutriMensagens)
        .set({ avaliacao: valor, updatedAt: new Date() })
        .where(
          and(
            eq(iaNutriMensagens.id, mensagemId),
            eq(iaNutriMensagens.patientId, ctx.patientId!),
            eq(iaNutriMensagens.autor, 'ia'),
            isNull(iaNutriMensagens.avaliacao),
            or(isNotNull(iaNutriMensagens.texto), isNotNull(iaNutriMensagens.textoFixo)), // esvaziada → false, nunca 42501
          ),
        )
        .returning({ id: iaNutriMensagens.id });
    },
    db,
  );
  return r.length > 0;
}

/**
 * US-174 / RN-177 (D24 = b): a PERGUNTA (não a resposta da IA) vai à fila; até 3 abertas por paciente (risco não conta).
 * /code-review do PR #37 (aba antiga): a mesma RN-170 de `enviarANutri` — a parte do consultório (estadoIaNutriDoTenant, com
 * a pausa) e, com o paciente travado, a do paciente (ativo, não anonimizado, participação liberada, consentimento vigente na
 * versão e no destino em uso); fora dela → `nao_pode` ("A IA Nutri não está disponível no momento.").
 */
export async function encaminhar(ctx: TenantContext, perguntaId: string, deps: DepsIaNutri): Promise<'encaminhada' | 'limite' | 'nao_pode'> {
  if (!sessaoDePacienteComConta(ctx)) throw new Error('encaminhar: só a sessão de paciente com conta');
  if (!idValido(perguntaId)) return 'nao_pode'; // /code-review do PR #37: id do cliente fora do formato, nunca 22P02
  return withTenant(
    ctx,
    async (tx) => {
      // a mesma trava das funções fechadas: duas abas encaminhando ao mesmo tempo não passam do limite (e a revogação, o
      // bloqueio e o arquivamento, que travam o paciente, ficam de um lado ou do outro da conferência)
      const [p] = await tx.select({ status: patients.status, anon: patients.anonimizadoEm }).from(patients).where(eq(patients.id, ctx.patientId!)).for('update');
      const [t] = await tx.select().from(tenants).where(eq(tenants.id, ctx.tenantId));
      const pausa = deps.pausa ?? (await lerPausa(tx));
      if (!p || p.status !== 'ativo' || p.anon || !t || estadoIaNutriDoTenant(t, deps.ia, pausa) !== 'ativa') return 'nao_pode';
      if (!(await liberadoNaTransacao(tx, ctx.patientId!)) || !consentimentoVigente(await ultimoEvento(tx, ctx.patientId!), deps.ia.destino)) return 'nao_pode';
      const [{ n }] = await tx
        .select({ n: count() })
        .from(iaNutriMensagens)
        .where(and(eq(iaNutriMensagens.patientId, ctx.patientId!), isNotNull(iaNutriMensagens.encaminhadaEm), isNull(iaNutriMensagens.resolvidaEm), isNull(iaNutriMensagens.risco)));
      if (n >= LIMITE_DUVIDAS_ABERTAS) return 'limite';
      const r = await tx
        .update(iaNutriMensagens)
        .set({ encaminhadaEm: sql`now()`, updatedAt: new Date() })
        .where(
          and(
            eq(iaNutriMensagens.id, perguntaId),
            eq(iaNutriMensagens.patientId, ctx.patientId!),
            eq(iaNutriMensagens.autor, 'paciente'),
            isNull(iaNutriMensagens.encaminhadaEm),
            inArray(iaNutriMensagens.status, ['respondida', 'falhou']), // na fila ou processando → nao_pode (o gatilho também recusa)
            isNull(iaNutriMensagens.risco),
            isNull(iaNutriMensagens.revogadaEm),
            isNotNull(iaNutriMensagens.texto),
          ),
        )
        .returning({ id: iaNutriMensagens.id });
      return r.length ? 'encaminhada' : 'nao_pode';
    },
    deps.db ?? getDb(),
  );
}

export type MensagemDoPaciente = {
  id: string;
  criadaEm: Date;
  autor: Autor;
  texto: string | null;
  textoFixo: CodigoTextoFixo | null;
  status: StatusPergunta | null;
  avaliacao: 'ajudou' | 'nao_ajudou' | null;
  duvida: 'aberta' | 'vista' | 'encerrada' | null;
  podeEncaminhar: boolean;
  rotuloCategoria: string | null;
  /** Só a marca de que a PRÓPRIA pergunta teve sinal de risco (nunca o grupo): a tela não mostra "Pronto! Sua pergunta foi enviada…" sob ela. */
  risco: boolean;
};

/**
 * §13.1 "Projeção fechada" e RN-183: a conversa do PRÓPRIO paciente (a RLS isola; o filtro repete) — nunca fontes, motivo
 * técnico, modelo, versão das instruções, reserva, grupo do risco, quem resolveu ou quando a nutricionista abriu. Leitura do
 * titular auditada (Plano 06, D22). Na mesma marca de tempo (a pergunta com risco e o aviso do sistema), a pergunta vem antes.
 */
export async function conversaDoPaciente(ctx: TenantContext, db: Db = getDb()): Promise<MensagemDoPaciente[]> {
  if (ctx.role !== 'paciente' || !ctx.patientId) throw new Error('conversaDoPaciente: só a sessão de paciente');
  return withTenant(
    ctx,
    async (tx) => {
      const ms = await tx
        .select({
          id: iaNutriMensagens.id,
          criadaEm: iaNutriMensagens.createdAt,
          autor: iaNutriMensagens.autor,
          texto: iaNutriMensagens.texto,
          textoFixo: iaNutriMensagens.textoFixo,
          status: iaNutriMensagens.status,
          avaliacao: iaNutriMensagens.avaliacao,
          categoria: iaNutriMensagens.categoria,
          encaminhadaEm: iaNutriMensagens.encaminhadaEm,
          resolucao: iaNutriMensagens.resolucao,
          risco: iaNutriMensagens.risco,
          revogadaEm: iaNutriMensagens.revogadaEm,
        })
        .from(iaNutriMensagens)
        .where(eq(iaNutriMensagens.patientId, ctx.patientId!))
        .orderBy(asc(iaNutriMensagens.createdAt), sql`case ${iaNutriMensagens.autor} when 'paciente' then 0 else 1 end`, asc(iaNutriMensagens.id));
      await auditRead(tx, { entidade: 'ia_nutri', entidadeId: null, patientId: ctx.patientId! });
      return ms.map(
        (m): MensagemDoPaciente => ({
          id: m.id,
          criadaEm: m.criadaEm,
          autor: m.autor as Autor,
          texto: m.texto,
          textoFixo: (m.textoFixo as CodigoTextoFixo | null) ?? null,
          status: (m.status as StatusPergunta | null) ?? null,
          avaliacao: (m.avaliacao as 'ajudou' | 'nao_ajudou' | null) ?? null,
          duvida: m.encaminhadaEm ? (m.resolucao === 'vista' ? 'vista' : m.resolucao === 'encerrada' ? 'encerrada' : 'aberta') : null,
          podeEncaminhar: m.autor === 'paciente' && !m.encaminhadaEm && !m.risco && !m.revogadaEm && !!m.texto && (m.status === 'respondida' || m.status === 'falhou'),
          rotuloCategoria: m.autor === 'ia' && m.categoria ? (ROTULO_CATEGORIA[m.categoria as CategoriaConversa] ?? null) : null,
          risco: m.autor === 'paciente' && !!m.risco,
        }),
      );
    },
    db,
  );
}

/** RNF-160: a consulta da tela — só id e situação das 5 últimas perguntas (a em andamento é sempre a última), sem auditRead (molde de /api/p/exames/situacoes). */
export async function situacoesDasPerguntas(ctx: TenantContext, db: Db = getDb()): Promise<{ id: string; status: StatusPergunta }[]> {
  if (ctx.role !== 'paciente' || !ctx.patientId) throw new Error('situacoesDasPerguntas: só a sessão de paciente');
  const r = await withTenant(
    ctx,
    (tx) =>
      tx
        .select({ id: iaNutriMensagens.id, status: iaNutriMensagens.status })
        .from(iaNutriMensagens)
        .where(and(eq(iaNutriMensagens.patientId, ctx.patientId!), eq(iaNutriMensagens.autor, 'paciente')))
        .orderBy(desc(iaNutriMensagens.createdAt), desc(iaNutriMensagens.id))
        .limit(5),
    db,
  );
  return r.map((x) => ({ id: x.id, status: x.status as StatusPergunta }));
}
export { COM_ENCAMINHAR };
