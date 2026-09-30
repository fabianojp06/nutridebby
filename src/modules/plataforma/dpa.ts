import { eq } from 'drizzle-orm';
import type { Queryable } from '@/db/client';
import { consents, tenants } from '@/db/schema';

/** Texto provisório até o P08-06 (P-02/E-09). Mudar a versão obriga novo aceite (requireNutri). */
export const DPA_VERSAO = '0.1-provisorio';
export const DPA_TERMO = `dpa-${DPA_VERSAO}`;
export const DPA_TITULO = 'Contrato de tratamento de dados (DPA)';
export const DPA_NAO_ACEITO = 'Para continuar, aceite o contrato de tratamento de dados (DPA).';

export const DPA_PARAGRAFOS: readonly string[] = [
  'Este contrato regula o tratamento de dados pessoais feito pela plataforma NutriDebby (operadora) em nome da nutricionista titular da conta (controladora), nos termos da Lei 13.709/2018 (LGPD).',
  'A operadora trata os dados dos pacientes somente para prestar o serviço contratado — prontuário, plano alimentar, agenda, lembretes e portal do paciente — e segundo as instruções da controladora. Nenhum dado é vendido, compartilhado para publicidade ou usado para outra finalidade.',
  'A controladora é responsável pela base legal do tratamento, pelo consentimento dos pacientes quando exigido e pelo atendimento aos direitos dos titulares. A operadora oferece as ferramentas para isso: exportação, bloqueio e registro de acessos.',
  'Medidas de segurança: dados isolados por conta, senhas guardadas com hash forte, verificação em duas etapas, registro de acessos a dados de saúde, backups diários criptografados e comunicação por HTTPS.',
  'Suboperadores: Hostinger (servidor), Cloudflare (armazenamento do backup criptografado e proteção anti-robô), Resend (envio de e-mails) e Meta (mensagens de WhatsApp, quando ativadas pela controladora).',
  'Incidentes de segurança que afetem dados da controladora serão comunicados a ela sem demora injustificada, com as informações disponíveis para que ela avalie a comunicação à ANPD e aos titulares.',
  'Ao fim do contrato, a controladora pode exportar os dados. Depois disso, a operadora os elimina, salvo o que a lei obrigar a guardar.',
  'Versão provisória 0.1, em revisão jurídica. Quando a versão definitiva for publicada, um novo aceite será pedido.',
];

/**
 * Registro do aceite (quem, versão, quando, IP) + marca no tenant (US-002: tenants.dpa_aceito_em).
 * T6-R2b: se o `consents` já existe para esta versão (`onConflictDoNothing`), a linha não é
 * inserida de novo — e então `tenants` também não é tocado, para nunca divergir da prova de
 * aceite (senão um reaceite da mesma versão adiantaria `dpa_aceito_em` sem um `consents` novo).
 */
export async function registrarAceiteDpa(
  q: Queryable,
  a: { userId: string; tenantId: string; ip: string | null; now?: Date },
): Promise<void> {
  const now = a.now ?? new Date();
  const inserido = await q
    .insert(consents)
    .values({ userId: a.userId, termoVersao: DPA_TERMO, aceitoEm: now, ip: a.ip })
    .onConflictDoNothing()
    .returning({ id: consents.id });
  if (!inserido.length) return;
  await q.update(tenants).set({ dpaAceitoEm: now, dpaVersao: DPA_VERSAO, updatedAt: now }).where(eq(tenants.id, a.tenantId));
}
