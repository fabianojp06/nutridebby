import { and, eq, ne } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { whatsappConexoes, type WhatsappConexaoRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getEnv } from '@/env';
import { urlDoApp } from '@/lib/url-do-app';
import { avisarNutri } from '@/modules/agenda/aviso-nutri';
import { idValido } from '@/modules/pacientes/base';
import { provedorDoAmbiente } from './ambiente';
import type { Conexao, EstadoConexao, ProvedorWhatsapp } from './provedor';

export const instanciaDoTenant = (tenantId: string) => `nd-${tenantId}`;

/** Instância do webhook → tenant; só o formato `nd-<uuid>` (D4). */
export function tenantDaInstancia(instancia: unknown): string | null {
  if (typeof instancia !== 'string' || !instancia.startsWith('nd-')) return null;
  const id = instancia.slice(3);
  return idValido(id) ? id : null;
}

/** O app usa as variáveis dele (sem MAILPIT_URL: o sandbox do app só gera o QR). */
export function provedorDoApp(): ProvedorWhatsapp | null {
  return provedorDoAmbiente(getEnv());
}

export type SituacaoWhatsapp = { ligado: boolean; estado: EstadoConexao; numero: string | null; desconectadaEm: Date | null; conectadaAntes: boolean };

/** A conexão do tenant do `tx` (no máximo uma: `tenant_id` UNIQUE; a RLS restringe ao tenant). */
export async function lerConexao(tx: Tx): Promise<WhatsappConexaoRow | null> {
  const [c] = await tx.select().from(whatsappConexoes);
  return c ?? null;
}

const situacao = (ligado: boolean, c: WhatsappConexaoRow | null): SituacaoWhatsapp => ({
  ligado,
  estado: (c?.estado as EstadoConexao | undefined) ?? 'desconectada',
  numero: c?.numeroE164 ?? null,
  desconectadaEm: c?.desconectadaEm ?? null,
  conectadaAntes: !!c?.conectadaEm,
});

export async function situacaoDoWhatsapp(ctx: TenantContext, ligado: boolean, db: Db = getDb()): Promise<SituacaoWhatsapp> {
  return situacao(ligado, await withTenant(ctx, lerConexao, db));
}

export async function situacaoDoWhatsappNaTransacao(tx: Tx, ligado: boolean): Promise<SituacaoWhatsapp> {
  return situacao(ligado, await lerConexao(tx));
}

type Deps = { db?: Db; agora?: Date; appUrl?: string };

/** D18 (revisão 1 da T12, item 6): no máximo um e-mail de desconexão a cada 6 h por consultório. */
const INTERVALO_AVISO_DESCONEXAO_MS = 6 * 3_600_000;

/**
 * "Conectar WhatsApp": pede o QR ao provedor e só então grava a conexão como "conectando" (cria na primeira vez).
 * Revisão da T9 (b): com o serviço fora do ar (WhatsappIndisponivelError) nada é gravado — a conexão não fica presa em
 * "conectando" e o aviso de desconectado do painel continua.
 */
export async function conectarWhatsapp(ctx: TenantContext, provedor: ProvedorWhatsapp, deps: Deps = {}): Promise<Conexao> {
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  const instancia = instanciaDoTenant(ctx.tenantId);
  const r = await provedor.conectar(instancia);
  await withTenant(
    ctx,
    (tx) =>
      tx
        .insert(whatsappConexoes)
        .values({ tenantId: ctx.tenantId, instancia, estado: 'conectando', createdAt: agora, updatedAt: agora })
        .onConflictDoUpdate({ target: whatsappConexoes.tenantId, set: { estado: 'conectando', updatedAt: agora } }),
    db,
  );
  if (r.estado === 'conectada') await atualizarEstadoConexao(ctx.tenantId, { estado: 'conectada' }, deps);
  return r;
}

/** Polling do painel: pergunta ao provedor (Evolution) e grava; o sandbox não informa (fica o que o webhook gravou). */
export async function sincronizarEstado(ctx: TenantContext, provedor: ProvedorWhatsapp, deps: Deps = {}): Promise<SituacaoWhatsapp> {
  const db = deps.db ?? getDb();
  const atual = await withTenant(ctx, lerConexao, db);
  if (atual) {
    const r = await provedor.estado(atual.instancia);
    if (r) await atualizarEstadoConexao(ctx.tenantId, r, deps);
  }
  return situacaoDoWhatsapp(ctx, true, db);
}

/**
 * "Desconectar WhatsApp" pelo painel: sem e-mail de aviso (foi a própria nutricionista). Revisão da T9 (c): a
 * desconexão (`desconectada_em`) é marcada ANTES de chamar o provedor — o webhook do logout pode ser processado antes do
 * UPDATE final e, com a desconexão já registrada, não manda e-mail. Revisão 1 da T12 (item 6): a marca é a desconexão, não
 * `aviso_desconexao_em` (o último e-mail mandado), para a desconexão pelo painel não gastar a vez do e-mail de uma queda
 * de verdade. Se o serviço falhar, a marca volta (a conexão continua; uma queda depois ainda avisa) e o erro sobe.
 */
export async function desconectarWhatsapp(ctx: TenantContext, provedor: ProvedorWhatsapp, deps: Deps = {}): Promise<void> {
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  const antes = await withTenant(
    ctx,
    async (tx) => {
      const [c] = await tx.select({ id: whatsappConexoes.id, desconectadaEm: whatsappConexoes.desconectadaEm }).from(whatsappConexoes).where(eq(whatsappConexoes.tenantId, ctx.tenantId)).for('update');
      if (c && !c.desconectadaEm) await tx.update(whatsappConexoes).set({ desconectadaEm: agora, updatedAt: agora }).where(eq(whatsappConexoes.id, c.id));
      return c ?? null;
    },
    db,
  );
  try {
    await provedor.desconectar(instanciaDoTenant(ctx.tenantId));
  } catch (e) {
    if (antes && !antes.desconectadaEm) {
      await withTenant(
        ctx,
        // só se ninguém mexeu: um "close" processado no meio (o logout saiu, a resposta não voltou) mantém a marca
        (tx) => tx.update(whatsappConexoes).set({ desconectadaEm: null }).where(and(eq(whatsappConexoes.id, antes.id), eq(whatsappConexoes.desconectadaEm, agora), ne(whatsappConexoes.estado, 'desconectada'))),
        db,
      );
    }
    throw e;
  }
  await withTenant(
    ctx,
    (tx) => tx.update(whatsappConexoes).set({ estado: 'desconectada', desconectadaEm: agora, updatedAt: agora }).where(eq(whatsappConexoes.tenantId, ctx.tenantId)),
    db,
  );
}

/**
 * connection.update (webhook) ou polling. Só atualiza conexão que existe (o webhook nunca cria). Número `null` (o
 * provedor não informou) = sem mudança (revisão da T9 d: o polling não reescreve "conectada em").
 * Revisão da T9 (a): "conectando" só vale fora de uma sessão conectada (QR na tela); com a sessão conectada é a
 * reconexão do Baileys e o estado fica. Desconexão (D18): "desconectada" depois de ter estado conectada desde a última
 * desconexão — direto ou passando por "conectando" (o "Conectar" pediu outro QR) — grava `desconectada_em` (a do painel
 * já vem gravada: não conta como queda) e manda um e-mail à nutricionista. Revisão 1 da T12 (item 6): no máximo um e-mail a
 * cada 6 h por consultório (`aviso_desconexao_em` = o último), para "open"/"close" alternados (JWT capturado) não
 * dispararem e-mails sem fim; a queda dentro da janela atualiza o estado e o painel. QR que expira sem nunca ter
 * conectado não avisa.
 */
export async function atualizarEstadoConexao(tenantId: string, novo: { estado: EstadoConexao; numero?: string | null }, deps: Deps = {}): Promise<void> {
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  const numero = novo.numero ?? undefined;
  await withTenant(
    { tenantId, role: 'worker' },
    async (tx) => {
      const [c] = await tx.select().from(whatsappConexoes).where(eq(whatsappConexoes.tenantId, tenantId)).for('update');
      if (!c || (c.estado === novo.estado && (numero === undefined || numero === c.numeroE164))) return;
      // "connecting" com a sessão conectada = o Baileys reconectando a mesma sessão (segundos): não pisca o painel nem
      // ignora lembretes no meio; uma queda de verdade termina em "close" (desconectada, com e-mail)
      if (novo.estado === 'conectando' && c.estado === 'conectada') return;
      if (novo.estado === 'conectada') {
        // já conectada: só o número mudou (o aparelho trocou de número sem passar por "desconectada")
        const set = c.estado === 'conectada' ? { numeroE164: numero, updatedAt: agora } : { estado: 'conectada', numeroE164: numero ?? c.numeroE164, conectadaEm: agora, desconectadaEm: null, updatedAt: agora };
        await tx.update(whatsappConexoes).set(set).where(eq(whatsappConexoes.id, c.id));
        return;
      }
      const caiu = novo.estado === 'desconectada' && c.conectadaEm !== null && c.desconectadaEm === null;
      const avisar = caiu && (!c.avisoDesconexaoEm || c.avisoDesconexaoEm.getTime() <= agora.getTime() - INTERVALO_AVISO_DESCONEXAO_MS);
      await tx
        .update(whatsappConexoes)
        .set({ estado: novo.estado, ...(caiu ? { desconectadaEm: agora } : {}), ...(avisar ? { avisoDesconexaoEm: agora } : {}), updatedAt: agora })
        .where(eq(whatsappConexoes.id, c.id));
      if (avisar) {
        const link = urlDoApp(deps.appUrl ?? getEnv().APP_URL, '/painel/whatsapp');
        await avisarNutri(tx, tenantId, (para) => ({ tipo: 'whatsapp_desconectado', para, link }));
      }
    },
    db,
  );
}
