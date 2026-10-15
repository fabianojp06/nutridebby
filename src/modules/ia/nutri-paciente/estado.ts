import { and, desc, eq, isNotNull, isNull, or } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { iaNutriConsentimentos, iaNutriMensagens, iaNutriParticipacoes, mealPlans, patients, type TenantRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { formatarDataNoFuso } from '@/modules/pacientes/datas';
import { lerPausa, type PausaIaNutri } from '@/modules/plataforma/ia-nutri-pausa';
import type { DestinoIA } from '../constantes';
import { estadoIaComPaciente, type ConfigIA } from '../modo';
import { IA_NUTRI_ADITIVO_VERSAO_MIN, IA_NUTRI_TERMO_VERSAO_MIN, responsavelDoTenant, versaoAtende } from '../textos-legais';
import { MSG_IA_NUTRI } from './constantes';

export type EstadoIaNutriTenant = 'sem_ia' | 'pausada' | 'aditivo_desatualizado' | 'desativada' | 'ativa';
export type EntradaIaNutri = 'nenhuma' | 'decidir' | 'texto_mudou' | 'sem_plano' | 'indisponivel' | 'conversa';

/**
 * RN-170 (1), parte do consultório, na ordem em que a tela explica: a IA com dado de paciente (estadoIaComPaciente: plataforma,
 * retenção, conta, admin, ativação, aditivo ≥ 1.1) → emergência, IA_NUTRI_DESLIGADA, pausa da plataforma → aditivo ≥ 1.2
 * (só a IA Nutri) → ativação da IA Nutri pela nutricionista.
 */
export function estadoIaNutriDoTenant(
  t: Pick<TenantRow, 'status' | 'iaLiberada' | 'iaAtivadaEm' | 'iaAditivoVersao' | 'iaNutriAtivadaEm'>,
  ia: ConfigIA,
  pausa: PausaIaNutri,
): EstadoIaNutriTenant {
  const base = estadoIaComPaciente(t, ia);
  if (base === 'emergencia') return 'pausada';
  if (base !== 'ativa') return 'sem_ia';
  if (ia.nutriDesligada || pausa.pausadaEm || !ia.destino) return 'pausada';
  if (!versaoAtende(t.iaAditivoVersao, IA_NUTRI_ADITIVO_VERSAO_MIN)) return 'aditivo_desatualizado';
  if (!t.iaNutriAtivadaEm) return 'desativada';
  return 'ativa';
}

/** D6: liberado = `liberada_em` preenchida e `bloqueada_em` nula. */
export async function liberadoNaTransacao(tx: Tx, patientId: string): Promise<boolean> {
  const [x] = await tx
    .select({ id: iaNutriParticipacoes.id })
    .from(iaNutriParticipacoes)
    .where(and(eq(iaNutriParticipacoes.patientId, patientId), isNotNull(iaNutriParticipacoes.liberadaEm), isNull(iaNutriParticipacoes.bloqueadaEm)));
  return !!x;
}

export type EventoIaNutri = { id: string; evento: 'aceite' | 'revogacao'; versao: string | null; destino: string | null; registradoEm: Date };

/** O último evento (por registrado_em, o relógio do banco depois da trava; desempate pelo id), como `ultimaDecisao` da 14A. */
export async function ultimoEvento(tx: Tx, patientId: string): Promise<EventoIaNutri | null> {
  const [u] = await tx
    .select({ id: iaNutriConsentimentos.id, evento: iaNutriConsentimentos.evento, versao: iaNutriConsentimentos.versao, destino: iaNutriConsentimentos.destino, registradoEm: iaNutriConsentimentos.registradoEm })
    .from(iaNutriConsentimentos)
    .where(eq(iaNutriConsentimentos.patientId, patientId))
    .orderBy(desc(iaNutriConsentimentos.registradoEm), desc(iaNutriConsentimentos.id))
    .limit(1);
  return (u as EventoIaNutri | undefined) ?? null;
}

/** DP-2 / US-171 "Nova versão": vale só o aceite da versão mínima de agora, no destino de agora. */
export const consentimentoVigente = (ev: EventoIaNutri | null, destino: DestinoIA | null): boolean =>
  !!ev && ev.evento === 'aceite' && versaoAtende(ev.versao, IA_NUTRI_TERMO_VERSAO_MIN) && ev.destino === destino;

/** §7.2, tabela de estados: o que a entrada em Plano mostra (dentro de withTenant da sessão de paciente). */
export async function entradaNaTransacao(tx: Tx, patientId: string, tenant: TenantRow, ia: ConfigIA, pausa: PausaIaNutri): Promise<EntradaIaNutri> {
  if (!(await liberadoNaTransacao(tx, patientId))) return 'nenhuma';
  const e = estadoIaNutriDoTenant(tenant, ia, pausa);
  if (e === 'pausada') return 'indisponivel';
  if (e !== 'ativa' || !responsavelDoTenant(tenant)) return 'nenhuma';
  const [p] = await tx.select({ status: patients.status, anon: patients.anonimizadoEm }).from(patients).where(eq(patients.id, patientId));
  if (!p || p.status !== 'ativo' || p.anon) return 'nenhuma';
  const ev = await ultimoEvento(tx, patientId);
  if (!ev || ev.evento === 'revogacao') return 'decidir';
  if (!consentimentoVigente(ev, ia.destino)) return 'texto_mudou';
  const [plano] = await tx.select({ id: mealPlans.id }).from(mealPlans).where(and(eq(mealPlans.patientId, patientId), eq(mealPlans.status, 'publicado'))).limit(1);
  return plano ? 'conversa' : 'sem_plano';
}

export async function entradaDoPaciente(ctx: TenantContext, tenant: TenantRow, ia: ConfigIA, o: { db?: Db; pausa?: PausaIaNutri } = {}): Promise<EntradaIaNutri> {
  if (ia.modo === 'ausente' || ctx.role !== 'paciente' || !ctx.patientId) return 'nenhuma';
  const pid = ctx.patientId;
  return withTenant(ctx, async (tx) => entradaNaTransacao(tx, pid, tenant, ia, o.pausa ?? (await lerPausa(tx))), o.db ?? getDb());
}

export type BlocoIaNutriApp = { situacao: string; podeDecidir: boolean; podeDesativar: boolean; temConversa: boolean };

/**
 * §7.6, §7.8, RN-182: o bloco de Eu › Privacidade. Aparece sempre que houver qualquer evento de consentimento (vigente ou
 * desativado — a confirmação "Você desativou em …" não some com o bloco) ou conversa guardada — também com o paciente
 * bloqueado, o consultório desligado ou a plataforma pausada (revogação gratuita e facilitada, LGPD art. 8º, § 5º) — e,
 * para decidir, quando a entrada diz "decidir"/"texto_mudou". Também sem IA_PROVEDOR (modo `ausente`, revisão da T7): o
 * consentimento e as conversas guardadas não somem com a configuração, então a porta para ler e desativar também não; a
 * entrada cai em "nenhuma" e o bloco só mostra a situação, "Desativar…" e o acesso para ler. A rota de "Desativar" (T12) não
 * recusa no modo ausente (desativarNoApp não confere o modo).
 */
export async function blocoIaNutriDoApp(ctx: TenantContext, tenant: TenantRow, ia: ConfigIA, o: { db?: Db; pausa?: PausaIaNutri } = {}): Promise<BlocoIaNutriApp | null> {
  if (ctx.role !== 'paciente' || !ctx.patientId) return null;
  const pid = ctx.patientId;
  return withTenant(
    ctx,
    async (tx) => {
      const pausa = o.pausa ?? (await lerPausa(tx));
      const ev = await ultimoEvento(tx, pid);
      const [conversa] = await tx
        .select({ id: iaNutriMensagens.id })
        .from(iaNutriMensagens)
        .where(and(eq(iaNutriMensagens.patientId, pid), or(isNotNull(iaNutriMensagens.texto), isNotNull(iaNutriMensagens.textoFixo))))
        .limit(1);
      const entrada = await entradaNaTransacao(tx, pid, tenant, ia, pausa);
      const podeDecidir = entrada === 'decidir' || entrada === 'texto_mudou';
      // /code-review do PR #37: só com o consentimento vigente (o último evento é o aceite) — é o único caso em que
      // app_ia_nutri_revogar faz alguma coisa. Depois da revogação, a pergunta de risco não aberta guardada com o texto (D22)
      // é "conversa", mas o botão "Desativar … e apagar as conversas" voltaria por até 30 dias e daria `nada_a_desativar`.
      const podeDesativar = ev?.evento === 'aceite';
      if (!podeDecidir && !podeDesativar && !ev && !conversa) return null;
      const data = ev ? formatarDataNoFuso(ev.registradoEm, tenant.fuso) : '';
      const situacao = ev?.evento === 'aceite' ? MSG_IA_NUTRI.situacaoVigente(data) : ev ? MSG_IA_NUTRI.situacaoDesativada(data) : MSG_IA_NUTRI.situacaoNunca;
      return { situacao, podeDecidir, podeDesativar, temConversa: !!conversa };
    },
    o.db ?? getDb(),
  );
}
