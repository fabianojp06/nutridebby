import type { SecaoNoInicio } from './inicio';
import { SECOES_DA_FICHA } from './secoes';
import { MSG_FICHA } from './textos';
import type { ChaveDeAcao, GrupoDoAdicionar, SecaoDaFicha } from './tipos';

/** Item do diálogo Adicionar: link (já resolvido) ou ação (Server Action da aba Documentos, RN-280). */
export type ItemDoAdicionar = { rotulo: string; href: string } | { rotulo: string; acao: ChaveDeAcao };
export type GrupoNoAdicionar = { grupo: GrupoDoAdicionar; titulo: string; itens: ItemDoAdicionar[] };

const GRUPOS: readonly GrupoDoAdicionar[] = ['avaliacoes', 'prescricoes', 'outros'];

/**
 * US-263: dentro de "Avaliações", a ordem do diálogo é a do roteiro da consulta (Anamnese, Antropometria, Gasto
 * energético, Exame, Atendimento), não a das seções. Seção que não está aqui (de outro plano) vem depois, na ordem do registro.
 */
const ORDEM_NO_ADICIONAR: readonly string[] = ['anamneses', 'antropometria', 'gasto-energetico', 'exames', 'atendimentos'];

/**
 * `href` de seção (RN-277): relativo à ficha (sem `/` inicial) ou absoluto em `/painel/`. Plano 25 (CH-D44): no absoluto,
 * `{id}` vira o paciente (o "Enviar mensagem" vai para `/painel/mensagens/{id}`).
 */
export const caminhoNaFicha = (patientId: string, href: string): string =>
  href.startsWith('/painel/') ? href.replaceAll('{id}', patientId) : `/painel/pacientes/${patientId}/${href}`;

/**
 * Plano 18 (RN-280): os grupos do diálogo Adicionar a partir das seções que o Início mostrou (`secoesDoInicio` já tirou as
 * indisponíveis, como Documentos desligados) e do `adicionar` de cada uma no registro; `podeAdicionar: false` tira os itens
 * da seção. Grupos na ordem Avaliações, Prescrições, Outros, cada um só com item. Quem decide se o botão aparece (paciente
 * bloqueado ou anonimizado) é a página.
 */
export function montarAdicionar(
  patientId: string,
  secoes: readonly Pick<SecaoNoInicio, 'id' | 'podeAdicionar'>[],
  registro: readonly SecaoDaFicha[] = SECOES_DA_FICHA,
): GrupoNoAdicionar[] {
  const naTela = new Set(secoes.filter((s) => s.podeAdicionar).map((s) => s.id));
  const posicao = (id: string, i: number) => {
    const o = ORDEM_NO_ADICIONAR.indexOf(id);
    return o === -1 ? ORDEM_NO_ADICIONAR.length + i : o;
  };
  const entradas = registro
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => naTela.has(s.id))
    .sort((a, b) => posicao(a.s.id, a.i) - posicao(b.s.id, b.i))
    .flatMap(({ s }) => s.adicionar ?? []);
  return GRUPOS.map((grupo) => ({
    grupo,
    titulo: MSG_FICHA.grupos[grupo],
    itens: entradas
      .filter((e) => e.grupo === grupo)
      .map((e): ItemDoAdicionar => ('acao' in e.destino ? { rotulo: e.rotulo, acao: e.destino.acao } : { rotulo: e.rotulo, href: caminhoNaFicha(patientId, e.destino.href) })),
  })).filter((g) => g.itens.length > 0);
}
