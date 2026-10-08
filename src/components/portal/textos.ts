/** Plano 16: textos da moldura do portal (RN-216). Rascunho até a Debby revisar (G-D10 ★). */
export const MSG_G = {
  acompanhamento: (nome: string) => `Acompanhamento com ${nome}`,
  logo: (nome: string) => `Logo de ${nome}`,
  voltarPara: (secao: string) => `Voltar para ${secao}`,
  navSecoes: 'Seções',
  navAcoes: 'Ações',
  titulos: { hoje: (nome: string) => (nome ? `Olá, ${nome}` : 'Olá'), jornada: 'Sua jornada', plano: 'Plano de hoje', exames: 'Meus exames', eu: 'Eu' },
  acoes: { foto: 'Foto da refeição', exame: 'Enviar exame', agendar: 'Agendar' },
} as const;
