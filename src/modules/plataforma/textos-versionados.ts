import type { TextoLegal } from '@/modules/ia/textos-legais';

/**
 * P08-06: o que o termo do paciente e o DPA têm em comum. Cada versão guarda a data e os parágrafos; o formulário de aceite
 * manda a versão que a pessoa leu (campo `versao`), e a action recusa o aceite se a versão em vigor mudou nesse meio-tempo
 * (deploy com a página aberta): a prova de aceite nunca registra um texto que a pessoa não viu.
 */
export type TextoVersionado = { data: string; paragrafos: readonly string[] };

export const MSG_TEXTO_ATUALIZADO = 'O texto mudou enquanto esta página estava aberta. Recarregue a página, leia a versão nova e aceite de novo.';

/** A versão lida (campo `versao` do formulário) é a versão em vigor? */
export const leuAVersaoEmVigor = (formData: FormData, emVigor: string): boolean => formData.get('versao') === emVigor;

/**
 * Plano 26 (RN-500, RE-D21, PM-R3, spec §10): o Termo de confidencialidade da equipe, aceito pela pessoa da recepção no
 * primeiro acesso (`consents`: `sigilo-equipe-<versão>`, a conta dela, o consultório e o IP; sem DPA). Mostrado inteiro na
 * página do convite (`TextoLegalView`) e na página pública `/termos/sigilo-equipe`. Conteúdo mínimo da PM-R3, um item por
 * cláusula: (1) partes, (2) objeto, (3) finalidade, (4) proibições e credenciais, (5) incidentes, (6) sigilo depois da
 * desativação, (7) os dados da própria pessoa, (8) normas. Texto 1.0 sem a revisão do advogado (pacote E-09, P-R2), como o
 * DPA 1.0; mudar o texto sobe a versão. Neutro em gênero para a pessoa da recepção ("você"). A data é a do PR e é
 * conferida (e ajustada, se o deploy mudar de dia) antes do merge, como `DPA_VERSAO_DATA`.
 */
export const SIGILO_EQUIPE_VERSAO = '1.0';
export const SIGILO_EQUIPE_VERSAO_DATA = '2026-11-23';
export const SIGILO_EQUIPE_TERMO = `sigilo-equipe-${SIGILO_EQUIPE_VERSAO}`;
export const SIGILO_EQUIPE_TITULO = 'Termo de confidencialidade da equipe';

const SIGILO_EQUIPE_1_0: readonly string[] = [
  '1. Partes e aceite. Este termo é firmado entre a nutricionista responsável pelo consultório, que decide sobre o tratamento dos dados dos pacientes (controladora, nos termos da Lei 13.709/2018, a LGPD), e você, a pessoa que ela convidou para a recepção do consultório no NutriDebby. A plataforma NutriDebby não é parte deste termo: ela só registra o seu aceite. Ao marcar a caixa de aceite, você declara que leu e aceita este termo; o aceite fica registrado com a versão, a data, a hora e o IP.',
  '2. O que é confidencial. São confidenciais todos os dados de pacientes a que você tiver acesso pelo NutriDebby ou no consultório: nome, contatos, documentos, endereço, horários e qualquer outra informação, inclusive o simples fato de uma pessoa ser paciente do consultório.',
  '3. Para que você usa os dados. Você usa os dados só nas tarefas da recepção que a nutricionista definir — a agenda e o cadastro dos pacientes e, quando ela permitir, o Financeiro do consultório — e só o necessário para cada tarefa (LGPD, art. 6º, I e III). O prontuário clínico (anamnese, medidas, exames, planos, documentos e notas do atendimento) não faz parte do seu trabalho: não tente acessá-lo.',
  '4. O que você não pode fazer. Fora do que a tarefa da recepção exige, é proibido copiar, fotografar, exportar ou repassar dados de pacientes a qualquer pessoa, inclusive familiares, colegas e outros pacientes. A sua senha e a verificação em duas etapas são pessoais: não as compartilhe nem as deixe anotadas à vista. Ao sair do computador, mesmo por pouco tempo, saia do NutriDebby (botão "Sair"), principalmente num computador compartilhado.',
  '5. Incidentes. Se você suspeitar de qualquer problema com os dados — senha descoberta, celular da verificação em duas etapas perdido, acesso de outra pessoa à sua conta, dado enviado à pessoa errada —, avise a nutricionista na hora, pelo meio mais rápido. O prazo que ela tem para comunicar o incidente à ANPD e aos pacientes começa a contar quando ela fica sabendo (Res. CD/ANPD 15/2024, art. 6º).',
  '6. Depois da desativação. O dever de sigilo continua depois que o seu acesso for desativado e depois que você deixar de trabalhar no consultório, sem prazo para acabar.',
  '7. Os seus dados. Para o seu acesso, o NutriDebby guarda o seu nome, o seu e-mail, o IP de cada aceite e de cada ação, a autoria do que você faz, que aparece com o seu nome no Histórico de acessos de cada paciente, e a data e a hora do seu último acesso, que a nutricionista vê na tela Equipe. Esses dados servem à segurança e ao registro das operações do consultório e continuam guardados depois da desativação, porque o registro de quem acessou os dados dos pacientes precisa ficar (LGPD, arts. 6º, VI, e 9º). A responsável por eles é a nutricionista: fale com ela para exercer os seus direitos de titular (LGPD, art. 18).',
  '8. Normas. Este termo atende à Res. CFN 599/2018 (Código de Ética e de Conduta do Nutricionista), art. 20, I, que manda a nutricionista impedir que pessoas não obrigadas ao mesmo sigilo profissional manuseiem documentos sigilosos e prevê o termo de sigilo ou confidencialidade; a partir de 23/01/2027, aos arts. 23 e 36 da Res. CFN 856/2026 (sigilo, privacidade e medidas de segurança); e ao art. 47 da LGPD, que obriga quem participa do tratamento de dados a garantir a segurança deles. Descumprir este termo leva à desativação do seu acesso, sem prejuízo das outras responsabilidades previstas em lei.',
  `Versão ${SIGILO_EQUIPE_VERSAO}, de ${SIGILO_EQUIPE_VERSAO_DATA.split('-').reverse().join('/')}.`,
];

/** As versões do termo (a linha de `consents` guarda só a versão): só a em vigor é mostrada e aceita. */
export const SIGILO_EQUIPE_TEXTOS: Readonly<Record<string, TextoVersionado>> = {
  [SIGILO_EQUIPE_VERSAO]: { data: SIGILO_EQUIPE_VERSAO_DATA, paragrafos: SIGILO_EQUIPE_1_0 },
};

/** O texto em vigor no formato do `TextoLegalView` (sem trechos em destaque). */
export const SIGILO_EQUIPE_TEXTO: TextoLegal = {
  titulo: SIGILO_EQUIPE_TITULO,
  paragrafos: SIGILO_EQUIPE_1_0.map((p) => [{ texto: p }]),
};
