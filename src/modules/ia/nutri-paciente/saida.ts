import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { iaNutriMensagens } from '@/db/schema';
import { recordAudit } from '@/modules/plataforma/audit';

/**
 * /code-review do PR #37 (RN-109, §13.1; LGPD art. 33): o REGISTRO da saída da pergunta ao provedor — `saiu_em`, `destino` e
 * o "Pergunta enviada à IA" (`exportar` de `ia_nutri`, ator nulo) — só quando o pedido PODE ter saído. O portão do envio grava
 * só `enviado_em` (a marca de "pode ter sido processado", que nunca deixa reenviar); este registro vem quando o resultado é
 * conhecido: a resposta voltou (passo 6), o provedor recusou ou falhou com o pedido já enviado (`repetir`, `incerto`,
 * `credencial`…), a nova tentativa encontrou `enviado_em` (o job caiu no meio da chamada) ou a varredura encerrou a pergunta
 * com `enviado_em`. Com `nao_enviado` (nada saiu da máquina: DNS, conexão recusada) não há registro, e `enviado_em` volta a nulo.
 *
 * `saiu_em` = `enviado_em` (o instante em que o pedido pôde sair; fixo pelo gatilho depois de gravado); `destino` = o do aceite
 * que valia naquele instante (o portão só deixa sair com o consentimento vigente NO destino em uso — RN-170 —, então é o
 * destino do envio, mesmo lido depois de uma revogação ou por quem não tem a configuração, como a varredura). Idempotente: só
 * a primeira saída é registrada (`saiu_em` nulo), e a auditoria vai junto, na mesma transação — uma por pergunta, sem
 * duplicar na nova tentativa.
 */
export async function registrarSaida(tx: Tx, o: { mensagemId: string; patientId: string; agora: Date }): Promise<boolean> {
  const m = iaNutriMensagens;
  const r = await tx
    .update(m)
    .set({
      saiuEm: sql`${m.enviadoEm}`,
      // nomes qualificados à mão: dentro da subconsulta, uma coluna sem tabela seria a de `c`
      // re-revisão: o enviado_em vem do relógio do worker e o registrado_em do banco — com desvio, cai no último aceite anterior
      // à pergunta e, por fim, no último aceite (a saída nunca fica sem destino; o gatilho o fixa depois de gravado)
      destino: sql`coalesce(
                     (select c.destino from ia_nutri_consentimentos c
                       where c.tenant_id = ia_nutri_mensagens.tenant_id and c.patient_id = ia_nutri_mensagens.patient_id
                         and c.evento = 'aceite' and c.registrado_em <= ia_nutri_mensagens.enviado_em
                       order by c.registrado_em desc, c.id desc limit 1),
                     (select c.destino from ia_nutri_consentimentos c
                       where c.tenant_id = ia_nutri_mensagens.tenant_id and c.patient_id = ia_nutri_mensagens.patient_id
                         and c.evento = 'aceite'
                       order by (c.registrado_em <= ia_nutri_mensagens.created_at) desc, c.registrado_em desc, c.id desc limit 1))`,
      updatedAt: o.agora,
    })
    .where(and(eq(m.id, o.mensagemId), eq(m.autor, 'paciente'), isNotNull(m.enviadoEm), isNull(m.saiuEm)))
    .returning({ id: m.id });
  if (!r.length) return false;
  await recordAudit(tx, { acao: 'exportar', entidade: 'ia_nutri', entidadeId: o.mensagemId, patientId: o.patientId }); // "Pergunta enviada à IA"
  return true;
}
