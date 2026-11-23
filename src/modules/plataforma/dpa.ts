import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Queryable } from '@/db/client';
import { consents, tenants } from '@/db/schema';
import { IA_ADITIVO_TERMO, IA_ADITIVO_VERSAO } from '@/modules/ia/textos-legais';
import { formatarData } from '@/modules/pacientes/datas';
import { EMAIL_PRIVACIDADE } from './privacidade';
import type { TextoVersionado } from './textos-versionados';

/**
 * US-002. Contrato de tratamento de dados (DPA) da nutricionista. P08-06 (15/10/2026): a 1.0 definitiva substitui a 0.1
 * provisória, publicada pelo dono sem a revisão do advogado (na linha da A-D27). Plano 20 (F-D17, US-309): a 1.1 cita o
 * Financeiro nas cláusulas 2 e 5, também sem o advogado (vai no pacote E-09). Mudar a versão obriga novo aceite
 * (`requireNutri` leva a /painel/dpa e as APIs do painel dão 403 até o aceite). Aceite em `consents` (`dpa-<versão>`, só
 * INSERT) e a marca em `tenants.dpa_versao`.
 */
export const DPA_VERSAO = '1.1';
/**
 * A data impressa no fim da versão em vigor. R-309: fixa no PR e conferida (e ajustada, se o deploy mudar de dia) antes
 * do merge.
 */
export const DPA_VERSAO_DATA = '2026-11-23';
export const DPA_TERMO = `dpa-${DPA_VERSAO}`;
export const DPA_TITULO = 'Contrato de tratamento de dados (DPA)';
export const DPA_ROTULO = `Li e aceito o contrato de tratamento de dados (DPA), versão ${DPA_VERSAO}`;
export const DPA_NAO_ACEITO = 'Para continuar, aceite o contrato de tratamento de dados (DPA).';

/** Aviso de /painel/dpa para quem já aceitou uma versão anterior (P08-06; o texto é o da US-309 do Plano 20). */
export const DPA_MUDOU = `O contrato de tratamento de dados mudou (versão ${DPA_VERSAO}, de ${formatarData(DPA_VERSAO_DATA)}). Leia e aceite para continuar usando o painel.`;
/**
 * US-309: o que a versão em vigor muda em relação à anterior, logo abaixo de `DPA_MUDOU`. Literal, sem importar de
 * `MSG_FINANCEIRO.lgpd.dpaOQueMudou`: o grafo da IA chega a este arquivo (`ia/ativacao.ts`) e não pode alcançar o módulo
 * do Financeiro (RN-323, `financeiro/guardas.test.ts`); a igualdade fica no teste (`textos-legais.test.ts`).
 */
export const DPA_O_QUE_MUDOU = 'O que mudou: o contrato passa a citar os registros financeiros do consultório, inclusive os pagamentos dos pacientes (Financeiro).';

/** A 1.0 congelada: a chave e a data são dela, não da versão em vigor. */
const DPA_VERSAO_1_0 = '1.0';

/**
 * O texto da 1.0, fora do mapa: o build de produção (Turbopack) descartou a entrada `'1.0'` do objeto literal e
 * `DPA_TEXTOS['1.0']` virou `undefined` (CI do PR #38). A chave do mapa é a constante da versão. É o que quem aceitou a
 * 1.0 leu: a data é literal, não a da versão em vigor.
 */
const DPA_1_0: readonly string[] = [
  '1. Partes e objeto. Este contrato de tratamento de dados (DPA) é firmado entre a nutricionista titular da conta, identificada pelos dados do cadastro (CONTROLADORA), e WEB SMART SISTEMAS+13 LTDA, CNPJ 66.657.250/0001-07, que mantém a plataforma NutriDebby (OPERADORA), nos termos da Lei 13.709/2018 (LGPD). Ele vale do aceite até o fim da conta, mais o prazo da cláusula 13.',
  '2. Instruções. A OPERADORA trata os dados pessoais dos pacientes, da equipe e de quem agenda pela página pública, incluindo dados de saúde, que são dados sensíveis (cadastro, anamnese, medidas, exames, planos, diário, documentos e registros de acesso). O tratamento serve só para prestar o serviço (prontuário, agenda, lembretes, app do paciente, página de agendamento, documentos assinados, conteúdos e as funções que a CONTROLADORA ativar) e segue as instruções da CONTROLADORA: este contrato, as configurações do painel e os pedidos por escrito. Se uma instrução parecer contrária à lei, a OPERADORA avisa a CONTROLADORA.',
  '3. Uso proibido. A OPERADORA não vende os dados, não os usa para publicidade, para oferecer ou divulgar produtos, nem para treinar inteligência artificial. A CONTROLADORA também não usa dados de pacientes tratados na plataforma, inclusive exportações, para divulgar ou vender produtos.',
  '4. Deveres da CONTROLADORA. A CONTROLADORA define a base legal de cada tratamento, guarda o prontuário pelo prazo das normas do CFN, informa os pacientes, pede as autorizações em separado quando exigidas e responde aos pedidos dos titulares. A OPERADORA oferece as ferramentas: cópia dos dados de cada paciente, correção, bloqueio, exclusão (com o prontuário bloqueado e guardado) e Histórico de acessos.',
  `5. Direitos dos titulares. Pedido de titular que chegar à OPERADORA, inclusive pelo e-mail ${EMAIL_PRIVACIDADE}, é repassado à CONTROLADORA sem demora. A OPERADORA apoia a CONTROLADORA, que responde em até 15 dias, com a resposta completa. No pedido de exclusão atendido, o prontuário fica bloqueado e guardado por 20 anos contados do bloqueio; depois, os anexos são apagados e o cadastro, os aceites e os documentos são anonimizados.`,
  '6. Segurança. Medidas adotadas: dados separados por consultório no banco, senhas guardadas com hash forte, verificação em duas etapas (obrigatória para o administrador da plataforma e pedida à CONTROLADORA ao assinar documentos), sessões com tempo limite, registro das aberturas e alterações de dados de saúde, conexão por HTTPS e cópia de segurança diária do banco de dados, criptografada e guardada fora do servidor. Nenhuma medida elimina todo risco.',
  '7. Acesso técnico e sigilo. O servidor é contratado da Hostinger e fica no Brasil. A OPERADORA não controla a criptografia do disco do servidor; a cópia de segurança é criptografada antes de sair dele. A equipe técnica da OPERADORA tem acesso ao servidor e ao banco de dados, usado só para manutenção, suporte e segurança. Quem na OPERADORA acessa os dados está obrigado a sigilo, para que a CONTROLADORA possa manter o sigilo profissional.',
  '8. Suboperadores (empresas que a OPERADORA contrata para ajudar a prestar o serviço). Em uso hoje: Hostinger (servidor, banco de dados e arquivos, no Brasil). Resend, dos Estados Unidos (envio de e-mails: endereço, nome e conteúdo do aviso). Cloudflare, dos Estados Unidos (verificação anti-robô Turnstile nas páginas públicas e na recuperação de senha). Backblaze, dos Estados Unidos (guarda da cópia de segurança, fora do Brasil, criptografada antes do envio; a Backblaze não tem a chave para abri-la). Serviços de notificação dos navegadores, de Google, Apple, Mozilla e Microsoft (entrega do aviso protegido até o aparelho). Os vídeos do YouTube e do Vimeo publicados pela CONTROLADORA só carregam quando o paciente toca neles; nessa hora, esses sites recebem o IP dele. O fornecedor de inteligência artificial, quando a CONTROLADORA ativa a IA, está descrito no aditivo de IA.',
  '9. WhatsApp. Só quando a CONTROLADORA ativar este recurso. As mensagens saem pelo número dela, conectado ao NutriDebby por QR code por meio de um serviço de conexão (Evolution API) que roda no servidor da plataforma. Elas passam pela rede do WhatsApp (Meta) e só vão a pacientes que autorizaram. Atenção: a conexão recebe todas as mensagens desse número, inclusive as pessoais. Por isso, prefira um número só do consultório.',
  '10. Troca de suboperador e transferência. A OPERADORA avisa a CONTROLADORA com 15 dias de antecedência antes de incluir ou trocar um suboperador, e a CONTROLADORA pode se opor ou encerrar o contrato. A OPERADORA exige dos suboperadores obrigações de proteção de dados compatíveis com este contrato e responde por eles perante a CONTROLADORA. Quando o suboperador fica fora do Brasil, a transferência internacional de dados segue o art. 33 da LGPD e a Res. CD/ANPD 19/2024. A pedido da CONTROLADORA, a OPERADORA informa, sem demora, o país onde cada suboperador trata os dados e o mecanismo usado com ele.',
  '11. Incidentes. A OPERADORA avisa a CONTROLADORA em até 24 horas depois de saber de um incidente de segurança que possa afetar os dados dela, com as informações que já tiver, e completa depois. A comunicação à ANPD e aos titulares cabe à CONTROLADORA, no prazo da ANPD. A OPERADORA prepara as informações e apoia os avisos. Ela também registra todo incidente, mesmo o que não for comunicado, guarda o registro por no mínimo cinco anos e entrega uma cópia à CONTROLADORA.',
  '12. Registro, verificação e autoridades. A OPERADORA mantém o registro das operações de tratamento (Histórico de acessos, uso da IA e acessos ao app) e o entrega quando a CONTROLADORA pedir. Uma vez por ano, a pedido, envia um relatório das medidas de segurança, com a lista atualizada de suboperadores, e responde a um questionário de segurança. Se uma autoridade pedir dados, a OPERADORA avisa a CONTROLADORA, quando a lei permitir, e entrega só o que for obrigatório.',
  '13. Fim do contrato. Como a guarda do prontuário é da CONTROLADORA, ela tem 30 dias depois do fim do contrato para baixar os dados: pela exportação do painel, paciente por paciente, ou por pedido de exportação completa à OPERADORA. Antes de eliminar, a OPERADORA avisa a CONTROLADORA por e-mail que a guarda do prontuário pelo prazo das normas do CFN continua sendo dever dela. Depois, a OPERADORA elimina os dados do servidor e confirma a eliminação por escrito. As cópias de segurança saem no ciclo de substituição, em até 6 meses. Fica só o que a lei obriga a guardar, como a prova dos aceites.',
  '14. Responsabilidade. Cada parte responde pelos danos que causar, nos termos da LGPD. A OPERADORA responde junto com a CONTROLADORA (responsabilidade solidária) quando descumprir a lei ou as instruções lícitas da CONTROLADORA (art. 42, § 1º, I). Nada neste contrato limita os direitos dos titulares.',
  `15. Outros textos e mudanças. O uso de inteligência artificial tem aditivo próprio, aceito à parte; este contrato vale no que o aditivo não tratar. Os avisos à CONTROLADORA vão ao e-mail da conta, e os da CONTROLADORA à OPERADORA vão a ${EMAIL_PRIVACIDADE}. Mudança neste contrato gera versão nova, e o painel pede novo aceite.`,
  'Versão 1.0, de 15/10/2026.',
];

/**
 * A 1.1 (Plano 20, spec §10): só as cláusulas 2 e 5 e a linha da versão mudam; a numeração fica, porque o aditivo de IA
 * remete a ela. As outras cláusulas são as da 1.0 (teste em `textos-legais.test.ts`).
 */
const DPA_1_1: readonly string[] = [
  DPA_1_0[0],
  '2. Instruções. A OPERADORA trata os dados pessoais dos pacientes, da equipe e de quem agenda pela página pública, incluindo dados de saúde, que são dados sensíveis (cadastro, anamnese, medidas, exames, planos, diário, documentos, registros de acesso e registros financeiros do consultório, inclusive os pagamentos dos pacientes). O tratamento serve só para prestar o serviço (prontuário, agenda, lembretes, app do paciente, página de agendamento, documentos assinados, conteúdos, financeiro do consultório e as funções que a CONTROLADORA ativar) e segue as instruções da CONTROLADORA: este contrato, as configurações do painel e os pedidos por escrito. Se uma instrução parecer contrária à lei, a OPERADORA avisa a CONTROLADORA.',
  ...DPA_1_0.slice(2, 4),
  `5. Direitos dos titulares. Pedido de titular que chegar à OPERADORA, inclusive pelo e-mail ${EMAIL_PRIVACIDADE}, é repassado à CONTROLADORA sem demora. A OPERADORA apoia a CONTROLADORA, que responde em até 15 dias, com a resposta completa. No pedido de exclusão atendido, o prontuário fica bloqueado e guardado por 20 anos contados do bloqueio; depois, os anexos são apagados e o cadastro, os aceites, os documentos e os registros de pagamento são anonimizados.`,
  ...DPA_1_0.slice(5, 15),
  `Versão ${DPA_VERSAO}, de ${formatarData(DPA_VERSAO_DATA)}.`,
];

/**
 * As versões do DPA, como em `textos-legais.ts` da IA: as antigas ficam para mostrar o que quem aceitou nelas leu (a
 * linha de `consents` guarda só a versão). Só a versão em vigor é mostrada e aceita. O aditivo de IA (cláusula 3) remete
 * às cláusulas e à lista de suboperadores (cláusula 8), iguais na 1.0 e na 1.1.
 */
export const DPA_TEXTOS: Readonly<Record<string, TextoVersionado>> = {
  '0.1-provisorio': {
    data: '2026-09-28',
    paragrafos: [
      'Este contrato regula o tratamento de dados pessoais feito pela plataforma NutriDebby (operadora) em nome da nutricionista titular da conta (controladora), nos termos da Lei 13.709/2018 (LGPD).',
      'A operadora trata os dados dos pacientes somente para prestar o serviço contratado — prontuário, plano alimentar, agenda, lembretes e portal do paciente — e segundo as instruções da controladora. Nenhum dado é vendido, compartilhado para publicidade ou usado para outra finalidade.',
      'A controladora é responsável pela base legal do tratamento, pelo consentimento dos pacientes quando exigido e pelo atendimento aos direitos dos titulares. A operadora oferece as ferramentas para isso: exportação, bloqueio e registro de acessos.',
      'Medidas de segurança: dados isolados por conta, senhas guardadas com hash forte, verificação em duas etapas, registro de acessos a dados de saúde, backups diários criptografados e comunicação por HTTPS.',
      'Suboperadores: Hostinger (servidor), Cloudflare (armazenamento do backup criptografado e proteção anti-robô), Resend (envio de e-mails) e Meta (mensagens de WhatsApp, quando ativadas pela controladora).',
      'Incidentes de segurança que afetem dados da controladora serão comunicados a ela sem demora injustificada, com as informações disponíveis para que ela avalie a comunicação à ANPD e aos titulares.',
      'Ao fim do contrato, a controladora pode exportar os dados. Depois disso, a operadora os elimina, salvo o que a lei obrigar a guardar.',
      'Versão provisória 0.1, em revisão jurídica. Quando a versão definitiva for publicada, um novo aceite será pedido.',
    ],
  },
  [DPA_VERSAO_1_0]: { data: '2026-10-15', paragrafos: DPA_1_0 },
  [DPA_VERSAO]: { data: DPA_VERSAO_DATA, paragrafos: DPA_1_1 },
};

/** O texto mostrado e aceito: o da versão em vigor. */
export const DPA_PARAGRAFOS: readonly string[] = DPA_1_1;

/**
 * Registro do aceite (quem, versão, quando, IP) + marca no tenant (US-002: tenants.dpa_aceito_em).
 * T6-R2b: se o `consents` já existe para esta versão (`onConflictDoNothing`), a linha não é inserida de novo e
 * `dpa_aceito_em` nunca é adiantado: a marca do tenant não diverge da prova de aceite.
 * #153 (revisão final do PR 2): a linha da versão já existe, mas o tenant está marcado com outra versão (uma volta atrás
 * da imagem e um novo avanço, ou a correção manual do runbook do Financeiro, §6). Sem regravar o tenant, a nutricionista
 * ficaria presa em /painel/dpa. Então o tenant volta a apontar para esta versão, com a data do aceite já registrado em
 * `consents` (nunca `now`), e nenhuma linha nova de prova. Com o tenant já nesta versão, nada muda.
 */
export async function registrarAceiteDpa(
  q: Queryable,
  a: { userId: string; tenantId: string; ip: string | null; now?: Date },
): Promise<void> {
  const now = a.now ?? new Date();
  const inserido = await q
    .insert(consents)
    .values({ userId: a.userId, termoVersao: DPA_TERMO, aceitoEm: now, ip: a.ip })
    .onConflictDoNothing()
    .returning({ id: consents.id });
  if (inserido.length) {
    await q.update(tenants).set({ dpaAceitoEm: now, dpaVersao: DPA_VERSAO, updatedAt: now }).where(eq(tenants.id, a.tenantId));
    return;
  }
  const [prova] = await q
    .select({ aceitoEm: consents.aceitoEm })
    .from(consents)
    .where(and(eq(consents.userId, a.userId), eq(consents.termoVersao, DPA_TERMO), isNull(consents.tenantId), isNull(consents.patientId)))
    .limit(1);
  if (!prova) return;
  await q
    .update(tenants)
    .set({ dpaAceitoEm: prova.aceitoEm, dpaVersao: DPA_VERSAO, updatedAt: now })
    .where(and(eq(tenants.id, a.tenantId), sql`${tenants.dpaVersao} is distinct from ${DPA_VERSAO}`));
}

/**
 * Plano 11 (A-D20 = (a)): aceite do aditivo de IA, separado do DPA (mudar o DPA travaria o painel de todos os tenants).
 * Prova em consents (termo `ia-aditivo-<versão>`, a usuária, o CONSULTÓRIO, data e IP) + marca no tenant, na mesma
 * transação de quem chama. Diferente do DPA, a marca do tenant muda mesmo se o aceite da versão já existia: reativar a IA
 * depois de desativar não pede um aceite novo da mesma versão.
 * Devolve se o aceite é novo (`true`) ou se a linha da versão já existia (reativação): quem chama registra no log.
 */
export async function registrarAceiteAditivoIa(q: Queryable, a: { userId: string; tenantId: string; ip: string | null; now?: Date }): Promise<boolean> {
  const now = a.now ?? new Date();
  const inserido = await q
    .insert(consents)
    .values({ userId: a.userId, tenantId: a.tenantId, termoVersao: IA_ADITIVO_TERMO, aceitoEm: now, ip: a.ip })
    .onConflictDoNothing()
    .returning({ id: consents.id });
  // Minor 8 da revisão final: com a IA já ativa (aceite de versão nova do aditivo, clique repetido), a data da ativação fica
  await q
    .update(tenants)
    .set({ iaAtivadaEm: sql`coalesce(${tenants.iaAtivadaEm}, ${now.toISOString()}::timestamptz)`, iaAditivoVersao: IA_ADITIVO_VERSAO, updatedAt: now })
    .where(eq(tenants.id, a.tenantId));
  return inserido.length > 0;
}
