import { randomUUID } from 'node:crypto';
import type { Db } from '@/db/client';
import { whatsappConexoes } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { instanciaDoTenant } from '@/modules/notificacoes/whatsapp/conexao';
import type { EnvioTexto, EstadoConexao, ProvedorWhatsapp, ResultadoEnvio } from '@/modules/notificacoes/whatsapp/provedor';

/** WhatsApp em memória para os testes; `resposta` decide o resultado de cada envio. */
export function whatsappFalso(opts: { resposta?: (e: EnvioTexto) => ResultadoEnvio; estado?: EstadoConexao } = {}): ProvedorWhatsapp & { enviados: EnvioTexto[]; conectadas: string[]; desconectadas: string[] } {
  const enviados: EnvioTexto[] = [];
  const conectadas: string[] = [];
  const desconectadas: string[] = [];
  return {
    nome: 'fake',
    enviados,
    conectadas,
    desconectadas,
    async enviarTexto(e) {
      enviados.push(e);
      return opts.resposta?.(e) ?? { ok: true, id: `fake-${randomUUID()}`, jid: `${e.numero}@s.whatsapp.net` };
    },
    async conectar(i) {
      conectadas.push(i);
      return opts.estado === 'conectada' ? { estado: 'conectada' } : { estado: 'qr', qr: 'data:image/png;base64,AAAA' };
    },
    async estado() {
      return { estado: opts.estado ?? 'conectando', numero: opts.estado === 'conectada' ? '+5511900001111' : null };
    },
    async desconectar(i) {
      desconectadas.push(i);
    },
  };
}

/** Conexão do WhatsApp gravada direto (ex.: "conectada" para testar o envio). */
export async function conexaoDeTeste(db: Db, ctx: TenantContext, estado: EstadoConexao = 'conectada'): Promise<void> {
  await withTenant(
    ctx,
    (tx) =>
      tx
        .insert(whatsappConexoes)
        .values({ tenantId: ctx.tenantId, instancia: instanciaDoTenant(ctx.tenantId), estado, numeroE164: estado === 'conectada' ? '+5511900001111' : null, conectadaEm: estado === 'conectada' ? new Date() : null })
        .onConflictDoUpdate({ target: whatsappConexoes.tenantId, set: { estado } }),
    db,
  );
}
