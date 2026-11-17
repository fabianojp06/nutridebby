/** D25: os ids que as telas com parâmetro precisam (criados pelo caminho real da UI em prepararTelasComId). */
export type IdsDoPainel = {
  paciente: string; consulta: string; alimento: string; modeloAnamnese: string; modeloPlano: string; diario: string;
  anamnese: string; atendimento: string; exportacao: string; plano: string; conteudo: string; documento: string; envio: string;
  /** Plano 15 (US-175): a dúvida enviada direto pela segunda paciente da IA Nutri do seed. */
  duvida: string;
};

/**
 * RNF-10 (D25): toda tela do painel. A guarda rotas-axe.test.ts compara as chaves com os page.tsx — tela nova sem axe quebra o CI.
 */
export const ROTAS_DO_PAINEL: Record<string, (i: IdsDoPainel) => string> = {
  '/painel': () => '/painel',
  '/painel/agenda': () => '/painel/agenda',
  '/painel/agenda/nova': () => '/painel/agenda/nova',
  '/painel/agenda/horarios': () => '/painel/agenda/horarios',
  '/painel/agenda/pendencias': () => '/painel/agenda/pendencias',
  '/painel/agenda/consultas/[id]': (i) => `/painel/agenda/consultas/${i.consulta}`,
  '/painel/ajuda': () => '/painel/ajuda',
  '/painel/alimentos': () => '/painel/alimentos',
  '/painel/alimentos/novo': () => '/painel/alimentos/novo',
  '/painel/alimentos/[id]': (i) => `/painel/alimentos/${i.alimento}`,
  '/painel/alimentos/[id]/editar': (i) => `/painel/alimentos/${i.alimento}/editar`,
  '/painel/anamnese/modelos': () => '/painel/anamnese/modelos',
  '/painel/anamnese/modelos/novo': () => '/painel/anamnese/modelos/novo',
  '/painel/anamnese/modelos/[modeloId]': (i) => `/painel/anamnese/modelos/${i.modeloAnamnese}`,
  '/painel/configuracoes': () => '/painel/configuracoes',
  '/painel/configuracoes/perfil': () => '/painel/configuracoes/perfil',
  '/painel/conteudos': () => '/painel/conteudos',
  '/painel/conteudos/novo': () => '/painel/conteudos/novo?tipo=video',
  '/painel/conteudos/[id]': (i) => `/painel/conteudos/${i.conteudo}`,
  '/painel/conteudos/[id]/visualizacoes': (i) => `/painel/conteudos/${i.conteudo}/visualizacoes`,
  '/painel/diarios': () => '/painel/diarios',
  '/painel/diarios/[id]': (i) => `/painel/diarios/${i.diario}`,
  '/painel/dpa': () => '/painel/dpa',
  '/painel/duvidas': () => '/painel/duvidas', // Plano 15 (US-175)
  '/painel/duvidas/[id]': (i) => `/painel/duvidas/${i.duvida}`,
  '/painel/exames-recebidos': () => '/painel/exames-recebidos',
  '/painel/exames-recebidos/[id]': (i) => `/painel/exames-recebidos/${i.envio}`,
  '/painel/financeiro': () => '/painel/financeiro', // Plano 20 (a semente deixa o Financeiro configurado)
  '/painel/financeiro/configuracoes': () => '/painel/financeiro/configuracoes',
  '/painel/pacientes': () => '/painel/pacientes',
  '/painel/pacientes/novo': () => '/painel/pacientes/novo',
  '/painel/pacientes/[id]': (i) => `/painel/pacientes/${i.paciente}`, // a aba Início (Plano 18; era o Resumo)
  '/painel/pacientes/[id]/perfil': (i) => `/painel/pacientes/${i.paciente}/perfil`, // Plano 18 (D12): cadastro, Acesso ao app e Etiquetas
  '/painel/pacientes/[id]/app': (i) => `/painel/pacientes/${i.paciente}/app`, // Plano 18 (D16, US-264): "No app do paciente"
  '/painel/pacientes/[id]/anamnese': (i) => `/painel/pacientes/${i.paciente}/anamnese`,
  '/painel/pacientes/[id]/anamnese/nova': (i) => `/painel/pacientes/${i.paciente}/anamnese/nova`,
  '/painel/pacientes/[id]/anamnese/[anamneseId]': (i) => `/painel/pacientes/${i.paciente}/anamnese/${i.anamnese}`,
  '/painel/pacientes/[id]/antropometria': (i) => `/painel/pacientes/${i.paciente}/antropometria`,
  '/painel/pacientes/[id]/atendimentos': (i) => `/painel/pacientes/${i.paciente}/atendimentos`,
  '/painel/pacientes/[id]/atendimentos/[atendimentoId]': (i) => `/painel/pacientes/${i.paciente}/atendimentos/${i.atendimento}`,
  '/painel/pacientes/[id]/documentos': (i) => `/painel/pacientes/${i.paciente}/documentos`,
  '/painel/pacientes/[id]/documentos/[docId]': (i) => `/painel/pacientes/${i.paciente}/documentos/${i.documento}`,
  '/painel/pacientes/[id]/evolucao': (i) => `/painel/pacientes/${i.paciente}/evolucao`,
  '/painel/pacientes/[id]/exames': (i) => `/painel/pacientes/${i.paciente}/exames`,
  '/painel/pacientes/[id]/exportacoes/[exportId]': (i) => `/painel/pacientes/${i.paciente}/exportacoes/${i.exportacao}`,
  '/painel/pacientes/[id]/gasto-energetico': (i) => `/painel/pacientes/${i.paciente}/gasto-energetico`,
  '/painel/pacientes/[id]/historico': (i) => `/painel/pacientes/${i.paciente}/historico`,
  '/painel/pacientes/[id]/ia-nutri': (i) => `/painel/pacientes/${i.paciente}/ia-nutri`, // Plano 15 (US-170, US-175)
  '/painel/pacientes/[id]/plano-alimentar': (i) => `/painel/pacientes/${i.paciente}/plano-alimentar`,
  '/painel/pacientes/[id]/plano-alimentar/[planId]': (i) => `/painel/pacientes/${i.paciente}/plano-alimentar/${i.plano}`, // o editor
  '/painel/pacientes/[id]/plano-alimentar/rascunho-ia': (i) => `/painel/pacientes/${i.paciente}/plano-alimentar/rascunho-ia`, // Plano 14B (US-121)
  '/painel/pacientes/[id]/privacidade': (i) => `/painel/pacientes/${i.paciente}/privacidade`,
  '/painel/pacientes/[id]/privacidade/termo-ia': (i) => `/painel/pacientes/${i.paciente}/privacidade/termo-ia`,
  '/painel/pacientes/[id]/resumo-ia': (i) => `/painel/pacientes/${i.paciente}/resumo-ia`, // Plano 14B (US-120)
  '/painel/planos/modelos': () => '/painel/planos/modelos',
  '/painel/planos/modelos/[id]': (i) => `/painel/planos/modelos/${i.modeloPlano}`,
  '/painel/whatsapp': () => '/painel/whatsapp',
};
