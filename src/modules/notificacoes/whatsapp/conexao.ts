import { eq } from 'drizzle-orm';
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

type Deps = { db?: Db; agora?: Date; appUrl?: string };

/** "Conectar WhatsApp": grava a conexão como "conectando" (cria na primeira vez) e pede o QR ao provedor. */
export async function conectarWhatsapp(ctx: TenantContext, provedor: ProvedorWhatsapp, deps: Deps = {}): Promise<Conexao> {
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  const instancia = instanciaDoTenant(ctx.tenantId);
  await withTenant(
    ctx,
    (tx) =>
      tx
        .insert(whatsappConexoes)
        .values({ tenantId: ctx.tenantId, instancia, estado: 'conectando', createdAt: agora, updatedAt: agora })
        .onConflictDoUpdate({ target: whatsappConexoes.tenantId, set: { estado: 'conectando', updatedAt: agora } }),
    db,
  );
  const r = await provedor.conectar(instancia);
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

/** "Desconectar WhatsApp" pelo painel: sem e-mail de aviso (foi a própria nutricionista). */
export async function desconectarWhatsapp(ctx: TenantContext, provedor: ProvedorWhatsapp, deps: Deps = {}): Promise<void> {
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  await provedor.desconectar(instanciaDoTenant(ctx.tenantId));
  await withTenant(
    ctx,
    (tx) => tx.update(whatsappConexoes).set({ estado: 'desconectada', desconectadaEm: agora, avisoDesconexaoEm: agora, updatedAt: agora }).where(eq(whatsappConexoes.tenantId, ctx.tenantId)),
    db,
  );
}

/**
 * connection.update (webhook) ou polling. Só atualiza conexão que existe (o webhook nunca cria). De "conectada"
 * para "desconectada" sem ter sido pelo painel: e-mail à nutricionista, uma vez por desconexão (D18).
 */
export async function atualizarEstadoConexao(tenantId: string, novo: { estado: EstadoConexao; numero?: string | null }, deps: Deps = {}): Promise<void> {
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  await withTenant(
    { tenantId, role: 'worker' },
    async (tx) => {
      const [c] = await tx.select().from(whatsappConexoes).where(eq(whatsappConexoes.tenantId, tenantId)).for('update');
      if (!c || (c.estado === novo.estado && (novo.numero === undefined || novo.numero === c.numeroE164))) return;
      if (novo.estado === 'conectada') {
        await tx
          .update(whatsappConexoes)
          .set({ estado: 'conectada', numeroE164: novo.numero ?? c.numeroE164, conectadaEm: agora, desconectadaEm: null, avisoDesconexaoEm: null, updatedAt: agora })
          .where(eq(whatsappConexoes.id, c.id));
        return;
      }
      const caiu = c.estado === 'conectada' && novo.estado === 'desconectada';
      const avisar = caiu && !c.avisoDesconexaoEm;
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
