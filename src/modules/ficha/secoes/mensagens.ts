import { sql } from 'drizzle-orm';
import { MSG_MENSAGENS } from '@/modules/mensagens/constantes';
import { MSG_FICHA } from '../textos';
import type { SecaoDaFicha } from '../tipos';
import { diaNoFuso, LIMITE_DA_SECAO } from './comum';

const F = MSG_MENSAGENS.ficha;

type Linha = { ativo: boolean; nao_lidas: number; id: string | null; autor: string | null; recado: boolean | null; risco: boolean | null; ms: number | null };

/**
 * Plano 25 (US-451, RN-468, §4.4): "Mensagens" no Início da ficha. `total` = mensagens do paciente ainda não lidas pelo
 * consultório (depois do marcador `consultorio`), mostrado como "{n} não lidas"; os 3 últimos com o rótulo genérico
 * ("Mensagem do paciente", "Mensagem enviada" ou "Recado"), a data no fuso e "Sinal de risco" quando há risco. Nunca o
 * conteúdo nem o nome do anexo, e sem trilha de leitura (RN-453): abrir a conversa é que lê. Sempre disponível; "Enviar
 * mensagem" (Outros) só com o titular ativo e não anonimizado (`podeAdicionar`). Uma consulta: o titular, a contagem e os
 * últimos (LATERAL pelo índice da conversa).
 */
export const secaoMensagens: SecaoDaFicha = {
  id: 'mensagens',
  titulo: MSG_FICHA.titulos.mensagens,
  aba: '',
  verTodos: (patientId) => `/painel/mensagens/${patientId}`,
  disponivel: () => true,
  rotuloDoTotal: F.naoLidas,
  adicionar: [{ grupo: 'outros', rotulo: F.enviarMensagem, destino: { href: '/painel/mensagens/{id}' } }],
  async resumo(tx, patientId, fuso) {
    const r = await tx.execute<Linha>(sql`
      select (p.status = 'ativo' and p.anonimizado_em is null) as ativo, nl.n as nao_lidas,
             u.id, u.autor, u.recado, u.risco, u.ms
        from patients p
        -- o marcador do consultório atrás da cerca "offset 0", como o da caixa (mensagens/caixa.ts, MARCADOR_DO_CONSULTORIO):
        -- "criada_em > lida.ate" entra no índice da conversa em vez de ler todas as mensagens (revisão final do PR 2)
        cross join lateral (
          select coalesce((select l.lida_ate from chat_leituras l
                            where l.tenant_id = p.tenant_id and l.patient_id = p.id and l.lado = 'consultorio' limit 1),
                          '-infinity'::timestamptz) as ate
          offset 0) lida
        cross join lateral (
          select count(*)::int as n from chat_mensagens m
           where m.tenant_id = p.tenant_id and m.patient_id = p.id and m.autor = 'paciente'
             and m.criada_em > lida.ate) nl
        left join lateral (
          select m.id, m.autor, m.recado_id is not null as recado, m.risco is not null as risco,
                 (extract(epoch from m.criada_em) * 1000)::float8 as ms
            from chat_mensagens m
           where m.tenant_id = p.tenant_id and m.patient_id = p.id
           order by m.criada_em desc, m.id desc
           limit ${LIMITE_DA_SECAO}) u on true
       where p.tenant_id = app_current_tenant() and p.id = ${patientId}`);
    const linhas = r.rows;
    const primeira = linhas[0];
    return {
      total: primeira?.nao_lidas ?? 0,
      podeAdicionar: primeira?.ativo ?? false,
      ultimos: linhas
        .filter((l): l is Linha & { id: string; ms: number } => l.id !== null && l.ms !== null)
        .map((l) => ({
          id: l.id,
          rotulo: l.recado ? F.recado : l.autor === 'paciente' ? F.mensagemDoPaciente : F.mensagemEnviada,
          data: diaNoFuso(new Date(l.ms), fuso),
          ...(l.risco ? { situacao: F.sinalDeRisco } : {}),
          href: `/painel/mensagens/${patientId}`,
        })),
    };
  },
};
