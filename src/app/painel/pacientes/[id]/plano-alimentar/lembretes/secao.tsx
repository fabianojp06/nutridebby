import { Aviso } from '@/components/ui/aviso';
import { Cartao } from '@/components/ui/cartao';
import type { TenantContext } from '@/db/tenant';
import { sugestaoInicial } from '@/modules/lembretes/config';
import { lembretesDoPaciente } from '@/modules/lembretes/equipe';
import { formatarDataNoFuso } from '@/modules/pacientes/datas';
import { ListaDeLembretes, type LembreteNaTela } from './lista';

const TITULO_ID = 'lembretes-app-titulo';

/**
 * Plano 17 (Tarefa 5, §5.4): a seção "Lembretes no app" da aba Plano alimentar. Lê pela sessão da equipe
 * (`lembretesDoPaciente`, auditada quando há lembretes); paciente bloqueado = só leitura, como o resto da aba; arquivado
 * continua editável, com o aviso de que nada é enviado.
 */
export async function SecaoLembretes({ ctx, tenant, patientId, status }: { ctx: TenantContext; tenant: { fuso: string }; patientId: string; status: string }) {
  const v = await lembretesDoPaciente(ctx, patientId, tenant);
  const data = (d: Date) => formatarDataNoFuso(d, tenant.fuso);
  const lembretes: LembreteNaTela[] = v.lembretes.map((l) => ({ ...l, desligadoPeloPacienteEm: l.desligadoPeloPacienteEm ? data(l.desligadoPeloPacienteEm) : null }));
  const refeicoes = v.lembretes.find((l) => l.tipo === 'refeicoes');
  const avisosDasRefeicoes = [
    ...(refeicoes?.ligado && !v.planoPublicado ? ['O paciente ainda não tem plano publicado: os avisos das refeições começam quando você publicar.'] : []),
    ...v.refeicoesSemHorario.map((nome) => `${nome} sem horário — não gera lembrete`),
    ...v.refeicoesForaDaJanela.map((nome) => `${nome} fora do horário dos lembretes (6h às 22h)`),
  ];
  const [agua, refeicoesSugeridas] = sugestaoInicial();
  const n = v.aparelhosComNotificacao;
  const { total, tipos } = v.cortadosHoje;
  const corte = total === 0 ? null : tipos.length === 1 && tipos[0] === 'agua' ? 'Acima do limite de 24 por dia: alguns lembretes de água não serão enviados.' : 'Acima do limite de 24 por dia: alguns lembretes não serão enviados.';

  return (
    <Cartao
      id={TITULO_ID}
      titulo="Lembretes no app"
      tituloFocavel
      data-guia="lembretes-app"
      acao={n > 0 ? <p className="text-sm text-suave">{n === 1 ? 'Notificações: ativas em 1 aparelho' : `Notificações: ativas em ${n} aparelhos`}</p> : undefined}
    >
      <div className="space-y-4">
        {status === 'arquivado' && <Aviso tipo="aviso" papel="nenhum">Paciente arquivado: os lembretes não são enviados.</Aviso>}
        {v.pausadoEm && <Aviso tipo="aviso" papel="nenhum">O paciente pausou todos os lembretes em {data(v.pausadoEm)}.</Aviso>}
        <ListaDeLembretes
          patientId={patientId}
          tituloId={TITULO_ID}
          lembretes={lembretes}
          sugestao={v.sugestao}
          modelos={{ agua, refeicoes: refeicoesSugeridas }}
          avisosDasRefeicoes={avisosDasRefeicoes}
          somenteLeitura={status === 'bloqueado'}
        />
        <div className="space-y-2 border-t border-linha pt-3">
          <p className="font-medium">
            {v.previstoHoje === 0 ? 'Nenhum lembrete previsto para hoje.' : v.previstoHoje === 1 ? 'Previsto para hoje: 1 lembrete' : `Previsto para hoje: ${v.previstoHoje} lembretes`}
          </p>
          {/* o previsto não sabe dos aparelhos: sem notificação ativa, nada chega (Tarefa 3) */}
          {n === 0 && <Aviso tipo="aviso" papel="nenhum">Este paciente ainda não ativou as notificações no app. Os lembretes começam quando ele ativar.</Aviso>}
          {corte && <Aviso tipo="aviso" papel="nenhum">{corte}</Aviso>}
        </div>
      </div>
    </Cartao>
  );
}
