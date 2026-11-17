import type { ReactNode } from 'react';
import { noAppDoPaciente, type NoApp } from '@/modules/ficha/no-app';
import { MSG_NO_APP } from '@/modules/ficha/textos';
import { formatarData } from '@/modules/pacientes/datas';
import { AcessoNoApp } from '../inicio/cartao-no-app';
import { carregarProntuario } from '../prontuario';

export const dynamic = 'force-dynamic';

type Linha = { rotulo: string; texto: ReactNode };
const juntar = (partes: (string | null | false | undefined)[]) => partes.filter(Boolean).join(' · ');

/**
 * As linhas da §8.5, na ordem do esboço. Sem acesso (arquivado, bloqueado), só a linha do acesso. Sem conta ainda (convite
 * pendente, vencido ou sem convite), o que a nutricionista configurou para quando ele entrar (notificações, plano,
 * lembretes, peso e % de gordura, IA Nutri), sem as contagens — que só existem com o acesso ativo.
 */
function linhasDoNoApp(n: NoApp, patientId: string, o: { documentos: boolean; exames: boolean }): Linha[] {
  const t = MSG_NO_APP;
  const r = t.rotulos;
  const acesso: Linha = { rotulo: r.acesso, texto: <AcessoNoApp acesso={n.acesso} patientId={patientId} cartao={false} /> };
  if (n.acesso.estado === 'arquivado' || n.acesso.estado === 'bloqueado') return [acesso];
  const c = n.contagens;
  const linhas: (Linha | null)[] = [
    acesso,
    { rotulo: r.notificacoes, texto: juntar([n.notificacoes.aparelhos ? t.notificacoes.ativas(n.notificacoes.aparelhos) : t.notificacoes.desligadas, n.notificacoes.whatsapp ? t.notificacoes.whatsapp : t.notificacoes.semWhatsapp]) },
    {
      rotulo: r.plano,
      texto: n.plano.publicadoEm
        ? juntar([t.plano.publicadoEm(formatarData(n.plano.publicadoEm)), n.receitasSugeridas ? t.plano.receitas(n.receitasSugeridas) : null, n.plano.listaDeCompras && t.plano.listaDeCompras])
        : t.plano.nenhum,
    },
    n.lembretes
      ? { rotulo: r.lembretes, texto: juntar([t.lembretes.ligados(n.lembretes.ligados), n.lembretes.desligadosPeloPaciente > 0 && t.lembretes.desligadosPeloPaciente(n.lembretes.desligadosPeloPaciente), n.lembretes.pausados && t.lembretes.pausados]) }
      : null,
    {
      rotulo: r.evolucao,
      texto: juntar([c && t.evolucao.avaliacoes(c.antropometria ?? 0), n.pesoOculto ? t.evolucao.pesoOculto : t.evolucao.pesoVisivel, n.gorduraNoApp ? t.evolucao.gorduraAparece : t.evolucao.gorduraNaoAparece]),
    },
    c ? { rotulo: r.jornada, texto: t.atendimentos(c.atendimentos ?? 0) } : null,
    c && o.documentos ? { rotulo: r.documentos, texto: t.documentos(c.documentos ?? 0) } : null,
    c ? { rotulo: r.conteudos, texto: t.conteudosNaBiblioteca(c.conteudos ?? 0) } : null,
    // RN-192: com o recebimento de exames ligado ou algum envio
    c && (o.exames || (c['exames-enviados'] ?? 0) > 0) ? { rotulo: r.exames, texto: t.envios(c['exames-enviados'] ?? 0) } : null,
    c ? { rotulo: r.diario, texto: t.diario(c.diario30d ?? 0) } : null,
    n.iaNutri ? { rotulo: r.iaNutri, texto: n.iaNutri === 'ligada' ? t.iaNutri.ligada : t.iaNutri.desligada } : null,
  ];
  return linhas.filter((l): l is Linha => l !== null);
}

/**
 * Plano 18 (D16, US-264, spec §8.5): "No app do paciente" — o que o paciente vê hoje no app, contado no contexto dele
 * (`noAppDoPaciente`): só contagens e situações, nenhum conteúdo clínico e nenhuma linha "Visualizou" além da do cabeçalho
 * da ficha (o layout). Chega pelo "Ver detalhes" do cartão no Início; cai no guia `prontuario`.
 */
export default async function NoAppPage({ params }: PageProps<'/painel/pacientes/[id]/app'>) {
  const { id } = await params;
  const { ctx, tenant, paciente } = await carregarProntuario(id);
  const noApp = await noAppDoPaciente(ctx, paciente.id);
  const linhas = linhasDoNoApp(noApp, paciente.id, { documentos: tenant.documentosLiberados, exames: tenant.examesPacienteAtivadoEm !== null });
  return (
    <section aria-labelledby="no-app-titulo" className="max-w-3xl space-y-4 rounded-3xl border border-borda bg-cartao p-5">
      <h2 id="no-app-titulo" className="font-titulo text-lg font-semibold">{MSG_NO_APP.titulo}</h2>
      {/* D7, RN-266: na tela, o nome social primeiro */}
      <p>{MSG_NO_APP.intro(paciente.nomeSocial ?? paciente.nome)}</p>
      <dl className="space-y-2">
        {linhas.map((l) => (
          <div key={l.rotulo} className="sm:grid sm:grid-cols-[9rem_1fr] sm:gap-4">
            <dt className="font-semibold">{l.rotulo}</dt>
            <dd>{l.texto}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
