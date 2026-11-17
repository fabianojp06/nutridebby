/**
 * Plano 18 (US-261, spec §8.1): os textos exatos da lista de pacientes. Arquivo sem dependência de servidor: o menu da
 * linha (cliente) também usa.
 */
export const MSG_LISTA = {
  titulo: 'Pacientes',
  abas: { ativos: 'Ativos', inativos: 'Inativos', todos: 'Todos' },
  rotuloDasAbas: 'Situação dos pacientes',
  verBloqueados: 'Ver bloqueados',
  dicaInativos: 'Pacientes arquivados: sem acesso ao app e sem notificações. O prontuário continua guardado.',
  tituloBloqueados: 'Bloqueados por pedido de exclusão (LGPD): só para consulta.',
  voltarParaALista: 'Voltar para a lista',
  ordenarPor: 'Ordenar por',
  ordens: { nome: 'Nome (A–Z)', nome_desc: 'Nome (Z–A)', recentes: 'Mais recentes', antigos: 'Mais antigos' },
  colunas: ['Nome', 'Idade', 'E-mail', 'Acesso ao app', 'Desde', 'Ações'],
  vazio: 'Nenhum paciente encontrado.',
  vazioInativos: 'Nenhum paciente arquivado.',
  acoes: 'Ações',
  acoesDe: (nome: string) => `Ações de ${nome}`,
  itens: { abrir: 'Abrir ficha', editar: 'Editar cadastro', arquivar: 'Arquivar', reativar: 'Reativar', exclusao: 'Pedir exclusão (LGPD)' },
  confirmarArquivar: (nome: string) =>
    `Arquivar ${nome}? O paciente perde o acesso ao app e deixa de receber notificações. Convites ainda não aceitos são cancelados. O prontuário continua guardado e você pode reativar quando quiser.`,
  confirmarReativar: (nome: string) =>
    `Reativar ${nome}? O paciente volta para os ativos e recupera o acesso ao app. Se ele ainda não entrou no app, reenvie o convite em Perfil.`,
  ok: { arquivado: 'Paciente arquivado.', reativado: 'Paciente reativado.' },
} as const;

/** O id do título da lista: depois de arquivar ou reativar, o foco vai a ele (D26). */
export const ID_DO_TITULO = 'titulo-pacientes';

/** Os campos ocultos que o formulário de arquivar/reativar leva, para a volta à mesma lista (a URL é montada no servidor). */
export type CamposDaLista = { aba: string; busca: string; etiqueta: string; ordem: string };
