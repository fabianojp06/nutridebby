import { BotaoLink } from '@/components/ui/botao';
import { Cartao } from '@/components/ui/cartao';
import { montarAdicionar } from '@/modules/ficha/adicionar';
import { secoesDoInicio } from '@/modules/ficha/inicio';
import { cartaoResumo, linhasDoResumo } from '@/modules/ficha/resumo';
import { MSG_FICHA } from '@/modules/ficha/textos';
import { MSG_RESUMO } from '@/modules/ia/constantes';
import { MSG_BLOQUEADO } from '@/modules/pacientes/base';
import { iaDoAssistente } from './ia-assistente';
import { acoesDoAdicionar } from './inicio/acoes';
import { Adicionar } from './inicio/adicionar';
import { Secao } from './inicio/secao';
import { carregarProntuario } from './prontuario';

export const dynamic = 'force-dynamic';

/**
 * Aba Início (Plano 18, US-262, US-263): o aviso do paciente bloqueado, o botão Adicionar (nunca para bloqueado ou anonimizado; arquivado registra, como
 * cada aba), o cartão Resumo (RN-276), o bloco da IA (US-120) e as seções do registro, na ordem dele (RN-277, RN-278). O
 * cadastro, o acesso ao app e as etiquetas ficam no Perfil (D12).
 */
export default async function InicioPage({ params }: PageProps<'/painel/pacientes/[id]'>) {
  const { id } = await params;
  const { ctx, tenant, paciente } = await carregarProntuario(id);
  const [ia, secoes, resumo] = await Promise.all([
    iaDoAssistente(ctx, tenant, paciente, 'resumo_historico'),
    secoesDoInicio(ctx, tenant, paciente),
    cartaoResumo(ctx, tenant.fuso, paciente),
  ]);
  const bloqueado = paciente.status === 'bloqueado';
  const podeAdicionar = !bloqueado && !paciente.anonimizadoEm;
  const grupos = podeAdicionar ? montarAdicionar(paciente.id, secoes) : [];
  const chaves = grupos.flatMap((g) => g.itens.flatMap((i) => ('acao' in i ? [i.acao] : [])));
  return (
    <div className="space-y-6">
      {/* o aviso que o antigo Resumo mostrava (code review do PR 1 do Plano 18), o mesmo do Perfil */}
      {bloqueado && <p role="status">{MSG_BLOQUEADO}</p>}
      {podeAdicionar && <Adicionar grupos={grupos} acoes={acoesDoAdicionar(paciente.id, chaves)} />}
      <div className="grid gap-6 md:grid-cols-2">
        <Cartao id="resumo-titulo" titulo={MSG_FICHA.resumo.titulo}>
          <ul className="space-y-1">
            {linhasDoResumo(resumo).map((l) => <li key={l}>{l}</li>)}
          </ul>
        </Cartao>
      </div>
      {/* US-120 (Plano 14B): só com a IA da plataforma presente e o paciente ativo; sem poder pedir, o motivo (texto da aba Exames) */}
      {ia && (
        <section aria-labelledby="ia-titulo" className="space-y-2">
          <h2 id="ia-titulo" className="text-lg font-semibold">Inteligência artificial</h2>
          {ia.podePedir ? (
            <BotaoLink href={`/painel/pacientes/${paciente.id}/resumo-ia`} variante="secundario">{MSG_RESUMO.botao}</BotaoLink>
          ) : (
            <p className="text-sm text-suave">{ia.aviso}</p>
          )}
        </section>
      )}
      <section aria-labelledby="secoes-titulo" data-guia="secoes-inicio" className="rounded-3xl border border-borda bg-cartao px-5 py-2">
        <h2 id="secoes-titulo" className="sr-only">{MSG_FICHA.secoesTitulo}</h2>
        {secoes.map((s) => <Secao key={s.id} secao={s} patientId={paciente.id} />)}
      </section>
    </div>
  );
}
