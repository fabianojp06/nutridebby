import { getDb, type Db } from '@/db/client';
import { withTenant, type TenantContext } from '@/db/tenant';
import { formatarData } from '@/modules/pacientes/datas';
import { recordAudit } from '@/modules/plataforma/audit';
import { nomeDoMesDoAno } from './calendario';
import { ROTULO_MODALIDADE } from './constantes';
import type { TenantAgenda } from './consultas';
import { inicioDoDia, partesNoFuso, somarDias } from './fuso';
import { ROTULO_STATUS, ROTULO_TIPO_CONSULTA } from './status';
import { agendaDoPeriodoNaTransacao, type FiltrosDaAgenda } from './visoes';

/**
 * Plano 23 (US-406, RN-418, RN-419, AG-D15): a agenda para imprimir ou salvar em PDF pelo navegador (sem PDF no servidor).
 * Lista fechada de campos: hora, nome de registro, Primeira consulta/Retorno, local, modalidade e situação. Nunca link,
 * contato, observação, motivo, valor, aniversário ou previsão; o bloqueio sai como "Bloqueado", com o horário e sem o motivo.
 */
export const CAMPOS_DA_IMPRESSAO = ['hora', 'paciente', 'tipoConsulta', 'local', 'modalidade', 'situacao'] as const;
export type LinhaDaImpressao = { [K in (typeof CAMPOS_DA_IMPRESSAO)[number]]: string };
/** O bloqueio do dia: só o horário "hh:mm–hh:mm" (recortado ao dia). */
export type BloqueioDaImpressao = { bloqueado: string };
export type AgendaParaImprimir = { titulo: string; local: string; dias: { dia: string; linhas: (LinhaDaImpressao | BloqueioDaImpressao)[] }[] };

const SEM_LOCAL = '—';

function tituloDoPeriodo(f: FiltrosDaAgenda, de: string, ate: string): string {
  if (f.visao === 'dia') return `Agenda de ${formatarData(de)}`;
  if (f.visao === 'mes') return `Agenda de ${nomeDoMesDoAno(de)}`;
  return `Agenda de ${formatarData(de)} a ${formatarData(ate)}`;
}

/**
 * Lê a visão (sem marcadores) e grava **um** `exportar` da entidade `agenda`, sem paciente, na mesma transação (RN-419):
 * `entidade_id` = `{de}..{ate}|{localId ou 'todos'}` — o período e o local, sem nome de paciente nem endereço.
 */
export async function agendaParaImprimir(
  ctx: TenantContext,
  tenant: Pick<TenantAgenda, 'id' | 'fuso' | 'enderecoConsultorio'>,
  f: FiltrosDaAgenda,
  deps: { db?: Db; agora?: Date } = {},
): Promise<AgendaParaImprimir> {
  if (ctx.role !== 'nutri') throw new Error('agenda: só a sessão nutri'); // RN-400, antes de abrir a transação
  const agora = deps.agora ?? new Date();
  return withTenant(
    ctx,
    async (tx) => {
      const a = await agendaDoPeriodoNaTransacao(tx, tenant, { ...f, aniversario: false, retorno: false }, agora);
      const { fuso } = tenant;
      const hora = (d: Date) => partesNoFuso(d, fuso).hora;
      const dias = a.periodo.dias.flatMap((dia) => {
        const inicio = inicioDoDia(dia, fuso);
        const fim = inicioDoDia(somarDias(dia, 1), fuso);
        const consultas = a.itens
          .filter((c) => partesNoFuso(c.inicio, fuso).data === dia)
          .map((c) => ({
            ordem: c.inicio.getTime(),
            linha: {
              hora: `${hora(c.inicio)}–${hora(c.fim)}`,
              paciente: c.paciente,
              tipoConsulta: ROTULO_TIPO_CONSULTA[c.tipoConsulta],
              local: c.local?.nome ?? SEM_LOCAL,
              modalidade: ROTULO_MODALIDADE[c.modalidade],
              situacao: ROTULO_STATUS[c.status],
            } satisfies LinhaDaImpressao,
          }));
        const bloqueios = a.bloqueios
          .filter((b) => b.inicio < fim && b.fim > inicio)
          .map((b) => {
            const de = b.inicio > inicio ? b.inicio : inicio;
            return { ordem: de.getTime(), linha: { bloqueado: `${hora(de)}–${b.fim < fim ? hora(b.fim) : '24:00'}` } satisfies BloqueioDaImpressao };
          });
        const linhas = [...bloqueios, ...consultas].sort((x, y) => x.ordem - y.ordem).map((x) => x.linha);
        return linhas.length ? [{ dia, linhas }] : [];
      });
      const local = f.local ? (a.opcoes.locais.find((l) => l.id === f.local)?.nome ?? SEM_LOCAL) : 'Todos os locais';
      await recordAudit(tx, { acao: 'exportar', entidade: 'agenda', entidadeId: `${a.periodo.de}..${a.periodo.ate}|${f.local ?? 'todos'}`, patientId: null });
      return { titulo: tituloDoPeriodo(f, a.periodo.de, a.periodo.ate), local, dias };
    },
    deps.db ?? getDb(),
  );
}
