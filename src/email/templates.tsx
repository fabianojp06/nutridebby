import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MSG_FINANCEIRO } from '@/modules/financeiro/constantes';
import { MSG_ANIVERSARIO } from '@/modules/agenda/constantes';
import { DESTINO_ROTULO, MSG_AUTORIZACAO, type UsoIA } from '@/modules/ia/constantes';
import { NOME_IA_NUTRI, RETENCAO_DIAS, RISCO_REVOGADO_MAX_DIAS } from '@/modules/ia/nutri-paciente/constantes';
import { DESCRICAO_DO_USO } from '@/modules/ia/textos-legais';
import { MSG_REVISAO } from '@/modules/pacientes/exames-enviados-constantes';
import type { EmailMessage, RenderedEmail } from './types';

// Só o worker importa este arquivo (react-dom/server fora do grafo do Next).
const COR = '#047857';

function Layout({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <html lang="pt-BR">
      {/* eslint-disable-next-line @next/next/no-head-element -- e-mail renderizado por react-dom/server, fora do grafo do Next (next/head não se aplica) */}
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width" />
        <title>{titulo}</title>
      </head>
      <body style={{ margin: 0, backgroundColor: '#f4f4f5', fontFamily: 'Arial, Helvetica, sans-serif', color: '#18181b' }}>
        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0}>
          <tbody>
            <tr>
              <td align="center" style={{ padding: '24px 12px' }}>
                <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} style={{ maxWidth: 560, backgroundColor: '#ffffff', borderRadius: 8 }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: '24px 28px 0', fontSize: 20, fontWeight: 700, color: COR }}>NutriDebby</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '16px 28px 28px', fontSize: 15, lineHeight: '22px' }}>{children}</td>
                    </tr>
                  </tbody>
                </table>
                <p style={{ fontSize: 12, color: '#71717a', marginTop: 16 }}>Mensagem automática. Não responda este e-mail.</p>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  );
}

function P({ children }: { children: ReactNode }) {
  return <p style={{ margin: '0 0 16px' }}>{children}</p>;
}

function Botao({ href, children }: { href: string; children: ReactNode }) {
  return (
    <p style={{ margin: '0 0 16px' }}>
      <a href={href} style={{ display: 'inline-block', backgroundColor: COR, color: '#ffffff', padding: '12px 20px', borderRadius: 6, textDecoration: 'none', fontWeight: 700 }}>
        {children}
      </a>
    </p>
  );
}

function LinkReserva({ href }: { href: string }) {
  return (
    <p style={{ margin: 0, fontSize: 13, color: '#52525b' }}>
      Se o botão não funcionar, copie e cole este endereço no navegador: <span style={{ wordBreak: 'break-all' }}>{href}</span>
    </p>
  );
}

const html = (el: ReactNode) => `<!doctype html>${renderToStaticMarkup(el)}`;

/** Plano 05: parágrafos + botão opcional + parágrafos depois, com a versão em texto igual. */
function simples(subject: string, linhas: string[], botao?: { href: string; rotulo: string }, depois: string[] = []): RenderedEmail {
  return {
    subject,
    html: html(
      <Layout titulo={subject}>
        {linhas.map((l) => <P key={l}>{l}</P>)}
        {botao && <Botao href={botao.href}>{botao.rotulo}</Botao>}
        {depois.map((l) => <P key={l}>{l}</P>)}
        {botao && <LinkReserva href={botao.href} />}
      </Layout>,
    ),
    text: [...linhas, ...(botao ? [`${botao.rotulo}: ${botao.href}`] : []), ...depois].join('\n\n'),
  };
}

export function renderEmail(msg: EmailMessage): RenderedEmail {
  switch (msg.tipo) {
    case 'convite_nutri': {
      const subject = 'Seu acesso ao NutriDebby';
      return {
        subject,
        html: html(
          <Layout titulo={subject}>
            <P>{`Olá, ${msg.nome}!`}</P>
            <P>Sua conta de nutricionista no NutriDebby foi criada. Para entrar, defina sua senha e aceite o contrato de tratamento de dados (DPA).</P>
            <Botao href={msg.link}>Definir minha senha</Botao>
            <P>O link vale por 72 horas e só pode ser usado uma vez. Se ele expirar, peça um novo ao suporte.</P>
            <LinkReserva href={msg.link} />
          </Layout>,
        ),
        text: [
          `Olá, ${msg.nome}!`,
          'Sua conta de nutricionista no NutriDebby foi criada. Para entrar, defina sua senha e aceite o contrato de tratamento de dados (DPA):',
          msg.link,
          'O link vale por 72 horas e só pode ser usado uma vez. Se ele expirar, peça um novo ao suporte.',
        ].join('\n\n'),
      };
    }
    case 'redefinir_senha': {
      const subject = 'Redefinição de senha';
      return {
        subject,
        html: html(
          <Layout titulo={subject}>
            <P>Recebemos um pedido para redefinir a senha da sua conta no NutriDebby.</P>
            <Botao href={msg.link}>Criar nova senha</Botao>
            <P>O link vale por 1 hora e só pode ser usado uma vez. Se você não pediu a redefinição, ignore este e-mail: sua senha continua a mesma.</P>
            <LinkReserva href={msg.link} />
          </Layout>,
        ),
        text: [
          'Recebemos um pedido para redefinir a senha da sua conta no NutriDebby. Para criar uma nova senha, acesse:',
          msg.link,
          'O link vale por 1 hora e só pode ser usado uma vez. Se você não pediu a redefinição, ignore este e-mail: sua senha continua a mesma.',
        ].join('\n\n'),
      };
    }
    case 'alerta_disco': {
      const subject = `Alerta: disco da VPS em ${msg.percentual}%`;
      const linhas = [
        `O disco do servidor está com ${msg.percentual}% de uso (limite de alerta: 70%).`,
        'Libere espaço ou amplie o disco antes que os uploads e os backups falhem.',
      ];
      return {
        subject,
        html: html(
          <Layout titulo={subject}>
            {linhas.map((l) => (
              <P key={l}>{l}</P>
            ))}
            <Botao href={msg.painelUrl}>Abrir a administração</Botao>
          </Layout>,
        ),
        text: [...linhas, msg.painelUrl].join('\n\n'),
      };
    }
    case 'alerta_backup': {
      const subject = 'Alerta: backup diário não concluído';
      const linhas = [
        'O backup diário do NutriDebby não foi concluído nas últimas 26 horas.',
        `Detalhe: ${msg.detalhe}`,
        'Confira o serviço nutri-backup no servidor (journalctl -u nutri-backup) e rode o backup manualmente, se preciso.',
      ];
      return {
        subject,
        html: html(
          <Layout titulo={subject}>
            {linhas.map((l) => (
              <P key={l}>{l}</P>
            ))}
            <Botao href={msg.painelUrl}>Abrir a administração</Botao>
          </Layout>,
        ),
        text: [...linhas, msg.painelUrl].join('\n\n'),
      };
    }
    case 'convite_paciente': {
      const subject = `Convite de ${msg.nutri} no NutriDebby`;
      const linhas = msg.contaExistente
        ? [
            `Olá, ${msg.nome}!`,
            `Entre com sua conta existente para ver os dados da nutricionista ${msg.nutri}.`,
            'Depois de entrar, confirme o termo de uso e privacidade para liberar o acompanhamento.',
          ]
        : [`Olá, ${msg.nome}!`, `${msg.nutri} convidou você para acompanhar seu tratamento pelo NutriDebby.`, 'Para começar, crie sua senha e leia o termo de uso e privacidade.'];
      const validade = 'O link vale por 7 dias e só pode ser usado uma vez. Se ele expirar, peça um novo à sua nutricionista.';
      return {
        subject,
        html: html(
          <Layout titulo={subject}>
            {linhas.map((l) => (
              <P key={l}>{l}</P>
            ))}
            <Botao href={msg.link}>{msg.contaExistente ? 'Entrar e aceitar o convite' : 'Criar minha senha'}</Botao>
            <P>{validade}</P>
            <LinkReserva href={msg.link} />
          </Layout>,
        ),
        text: [...linhas, msg.link, validade].join('\n\n'),
      };
    }
    case 'exclusao_atendida': {
      const subject = 'Seu pedido de exclusão de dados foi atendido';
      const linhas = [
        `Olá, ${msg.nome}!`,
        `${msg.nutri} atendeu o seu pedido de exclusão de dados no NutriDebby.`,
        `Foram apagados agora: as fotos do diário alimentar, os exames enviados pelo app que ainda não tinham sido aceitos, as autorizações de mensagens por WhatsApp, as notificações no aparelho, os convites de acesso e as conversas com a ${NOME_IA_NUTRI}. Suas consultas futuras foram canceladas e você não tem mais acesso ao portal deste acompanhamento. Você não recebe mais lembretes nem mensagens deste acompanhamento.`,
        // D22 (LGPD art. 18, § 4º, II: a razão da retenção): no molde da frase do consentimento da IA Nutri
        `Se houver uma mensagem com sinal de risco enviada à ${NOME_IA_NUTRI} que sua nutricionista ainda não leu, ela fica guardada até ser lida, por no máximo ${RISCO_REVOGADO_MAX_DIAS} dias, para a sua proteção. Depois disso, o texto é apagado e fica só o registro de que houve o aviso, até ${RETENCAO_DIAS} dias da mensagem.`,
        `Por obrigação legal (LGPD, art. 16, I), o prontuário clínico fica guardado de forma bloqueada, só para consulta da nutricionista, até ${msg.anonimizarApos}. Depois dessa data, seus dados de identificação são anonimizados.`,
        // Plano 20 (US-307, spec §6.2; LGPD art. 18, § 4º, II: a razão da retenção, no molde da D22)
        MSG_FINANCEIRO.lgpd.emailExclusaoAtendida,
        'Se tiver dúvidas, fale com a sua nutricionista.',
      ];
      return {
        subject,
        html: html(
          <Layout titulo={subject}>
            {linhas.map((l) => (
              <P key={l}>{l}</P>
            ))}
          </Layout>,
        ),
        text: linhas.join('\n\n'),
      };
    }
    case 'exportacao_pronta': {
      const subject = 'Exportação de dados pronta';
      const linhas = [
        'A exportação de dados que você pediu no NutriDebby está pronta.',
        msg.titular ? 'O link vale por 24 horas e pede que você entre no portal.' : 'O link vale por 24 horas e pede que você entre no painel.',
      ];
      return {
        subject,
        html: html(
          <Layout titulo={subject}>
            {linhas.map((l) => (
              <P key={l}>{l}</P>
            ))}
            <Botao href={msg.link}>Baixar exportação</Botao>
            <LinkReserva href={msg.link} />
          </Layout>,
        ),
        text: [...linhas, msg.link].join('\n\n'),
      };
    }
    case 'pedido_exclusao_registrado': {
      const subject = 'Seu pedido foi registrado';
      const linhas = [
        `Recebemos seu pedido de exclusão de dados. ${msg.nutri} tem até ${msg.prazo} para responder.`,
        // Plano 20 (US-307, spec §6.2): também os registros de pagamento das consultas
        MSG_FINANCEIRO.lgpd.emailPedidoExclusao,
      ];
      return {
        subject,
        html: html(
          <Layout titulo={subject}>
            {linhas.map((l) => (
              <P key={l}>{l}</P>
            ))}
          </Layout>,
        ),
        text: linhas.join('\n\n'),
      };
    }
    case 'plano_novo': {
      const subject = 'Seu novo plano alimentar está disponível';
      const linhas = ['Sua nutricionista publicou um novo plano alimentar para você no NutriDebby.', 'Entre no portal para ver as refeições e baixar o PDF.'];
      return {
        subject,
        html: html(
          <Layout titulo={subject}>
            {linhas.map((l) => (
              <P key={l}>{l}</P>
            ))}
            <Botao href={msg.link}>Ver meu plano</Botao>
            <LinkReserva href={msg.link} />
          </Layout>,
        ),
        text: [...linhas, msg.link].join('\n\n'),
      };
    }
    case 'documento_novo':
    case 'documento_link': {
      const subject = 'Você tem um novo documento';
      const linhas =
        msg.tipo === 'documento_novo'
          ? [`Olá, ${msg.nome}. ${msg.consultorio} disponibilizou um novo documento para você. Para ver, entre no app: ${msg.link}`]
          : [`Olá, ${msg.nome}. ${msg.consultorio} disponibilizou um novo documento para você.`, 'Para abrir, use o link abaixo. Vamos enviar um código de 6 dígitos para este e-mail. O link vale por 30 dias.'];
      return {
        subject,
        html: html(
          <Layout titulo={subject}>
            {linhas.map((l) => (
              <P key={l}>{l}</P>
            ))}
            <Botao href={msg.link}>{msg.tipo === 'documento_novo' ? 'Ver meus documentos' : 'Abrir documento'}</Botao>
            <LinkReserva href={msg.link} />
          </Layout>,
        ),
        text: [...linhas, msg.link].join('\n\n'),
      };
    }
    case 'documento_atualizado': {
      // US-149 / D11: o mesmo texto com e sem conta (o link sem conta abre a página do link, que diz "não está mais disponível")
      const subject = 'Um documento seu foi atualizado';
      const linhas = [`Olá, ${msg.nome}. ${msg.consultorio} atualizou um documento seu. Para ver, entre no app: ${msg.link}`];
      return {
        subject,
        html: html(
          <Layout titulo={subject}>
            {linhas.map((l) => (
              <P key={l}>{l}</P>
            ))}
            <Botao href={msg.link}>Ver meus documentos</Botao>
            <LinkReserva href={msg.link} />
          </Layout>,
        ),
        text: [...linhas, msg.link].join('\n\n'),
      };
    }
    case 'consulta': {
      const subject = {
        lembrete_24h: `Lembrete: sua consulta é amanhã às ${msg.hora}`,
        lembrete_2h: `Lembrete: sua consulta é hoje às ${msg.hora}`,
        consulta_marcada: `Consulta marcada: ${msg.quando}`,
        consulta_cancelada: `Consulta cancelada: ${msg.quando}`,
        resposta_remarcar: `Remarcar sua consulta: ${msg.quando}`,
      }[msg.evento];
      const abertura = {
        lembrete_24h: `Este é um lembrete da sua consulta com ${msg.nutri}: ${msg.quando}.`,
        lembrete_2h: `Sua consulta com ${msg.nutri} é hoje: ${msg.quando}.`,
        consulta_marcada: `Sua consulta com ${msg.nutri} está marcada para ${msg.quando}.`,
        consulta_cancelada: `Sua consulta com ${msg.nutri} de ${msg.quando} foi cancelada.`,
        resposta_remarcar: `Você pediu pelo WhatsApp para remarcar sua consulta com ${msg.nutri} de ${msg.quando}.`,
      }[msg.evento];
      if (msg.evento === 'consulta_cancelada') return simples(subject, [`Olá, ${msg.nome}!`, abertura, 'Para marcar outro horário, fale com sua nutricionista.']);
      // US-035 (fechamento): a resposta "2" no WhatsApp não leva link (D3) — o link para remarcar vem neste e-mail novo
      if (msg.evento === 'resposta_remarcar')
        return simples(
          subject,
          [`Olá, ${msg.nome}!`, abertura],
          msg.link ? { href: msg.link, rotulo: 'Escolher outro horário' } : undefined,
          msg.prazoH ? [`Se faltarem menos de ${msg.prazoH} h para a consulta, fale direto com ${msg.nutri}.`] : [],
        );
      const local = !msg.local ? [] : [msg.modalidade === 'online' ? `Link da chamada: ${msg.local}` : `Endereço: ${msg.local}`];
      return simples(
        subject,
        [`Olá, ${msg.nome}!`, abertura, ...local],
        msg.link ? { href: msg.link, rotulo: 'Confirmar presença ou remarcar' } : undefined,
        ['Se não puder ir, use o mesmo link para remarcar ou cancelar.'],
      );
    }
    case 'aviso_agenda': {
      // D18: o nome do paciente fica só no corpo, não no assunto (o assunto aparece em notificações e listas).
      const { subject, linha } = {
        marcada: { subject: 'Consulta marcada pelo paciente', linha: `${msg.paciente} marcou uma consulta para ${msg.quando}.` },
        remarcada: { subject: 'Consulta remarcada pelo paciente', linha: `${msg.paciente} remarcou a consulta para ${msg.quando}.` },
        cancelada: { subject: 'Consulta cancelada pelo paciente', linha: `${msg.paciente} cancelou a consulta de ${msg.quando}.` },
        pedido_remarcacao: { subject: 'Paciente pediu para remarcar', linha: `${msg.paciente} pediu para remarcar a consulta de ${msg.quando}.` },
        novo_paciente_publico: {
          subject: 'Novo paciente via agendamento online',
          linha: `${msg.paciente} marcou uma consulta pela sua página de agendamento para ${msg.quando}. Complete o cadastro (data de nascimento e sexo) antes do atendimento.`,
        },
        // Plano 23 (§6.2): o pedido leva à fila Solicitações; a retirada só com o primeiro nome
        pedido: { subject: 'Novo pedido de consulta', linha: `${msg.paciente} pediu ${msg.quando}.` },
        pedido_desistido: { subject: 'Pedido de consulta retirado', linha: `${msg.paciente} retirou o pedido de ${msg.quando}.` },
      }[msg.evento];
      return simples(subject, [linha], { href: msg.link, rotulo: msg.evento === 'pedido' ? 'Responda em Solicitações' : 'Ver na agenda' });
    }
    case 'codigo_agendamento':
      return simples(`Seu código para agendar com ${msg.nutri}: ${msg.codigo}`, [
        `Use o código ${msg.codigo} para confirmar o agendamento com ${msg.nutri}.`,
        'Ele vale por 10 minutos. Se não foi você que pediu, ignore este e-mail.',
      ]);
    case 'codigo_documento':
      return simples(`Código para abrir seu documento: ${msg.codigo}`, [
        `Use o código ${msg.codigo} para abrir o documento enviado por ${msg.consultorio}.`,
        'Ele vale por 10 minutos. Se não foi você que pediu, ignore este e-mail.',
      ]);
    case 'exclusao_consultas_canceladas':
      // o nome do paciente só no corpo, não no assunto (D18)
      return simples('Pedido de exclusão atendido', [
        msg.quantidade === 1
          ? `Pedido de exclusão atendido: 1 consulta futura de ${msg.paciente} foi cancelada.`
          : `Pedido de exclusão atendido: ${msg.quantidade} consultas futuras de ${msg.paciente} foram canceladas.`,
      ]);
    case 'whatsapp_desconectado':
      return simples(
        'Seu WhatsApp foi desconectado do NutriDebby',
        ['O WhatsApp do consultório foi desconectado (o celular saiu de "Aparelhos conectados" ou ficou muito tempo sem internet).', 'Os lembretes estão saindo só por e-mail e notificação no app.'],
        { href: msg.link, rotulo: 'Conectar o WhatsApp de novo' },
      );
    case 'cota_whatsapp':
      return simples(
        'Você usou 80% dos WhatsApps do mês',
        [
          `Já foram ${msg.usadas} de ${msg.cota} mensagens de WhatsApp neste mês.`,
          'Quando chegar a 100%, os lembretes seguem só por e-mail e notificação no app até o mês que vem (ou até o suporte ampliar a cota).',
        ],
        { href: msg.link, rotulo: 'Ver o uso do WhatsApp' },
      );
    case 'aviso_2fa_reiniciado':
      return simples('A verificação em duas etapas da sua conta foi desativada', [
        'A verificação em duas etapas da sua conta no NutriDebby foi desativada pelo suporte, e as sessões abertas foram encerradas.',
        'Na próxima entrada, ative de novo em Conta > Segurança (para a administração, a ativação é obrigatória).',
        'Se você não pediu isso, fale com o suporte agora.',
      ]);
    case 'cota_ia':
      return simples(
        'Você já usou 80% do limite de IA deste mês',
        [
          'Você já usou 80% do limite de IA deste mês.',
          'Quando chegar a 100%, a leitura de laudos com IA fica indisponível até o dia 1º ou até o suporte ampliar o limite. Lançar os valores à mão continua igual.',
        ],
        { href: msg.link, rotulo: 'Ver o uso da IA' },
      );
    case 'cota_ia_nutri':
      // e-mail da equipe: o nome de trabalho "IA Nutri" (desvio 6), não a constante que o paciente vê
      return simples(
        'Os pacientes já usaram 80% do limite da IA Nutri deste mês',
        [
          'Os pacientes já usaram 80% do limite da IA Nutri deste mês.',
          'Quando chegar a 100%, a IA Nutri fica indisponível para os pacientes até o dia 1º ou até o suporte ampliar o limite. A leitura de laudos e as outras funções de IA não mudam.',
        ],
        { href: msg.link, rotulo: 'Ver o uso da IA' },
      );
    case 'alerta_ia':
      return simples(
        'IA do NutriDebby: atenção',
        msg.motivo === 'credencial'
          ? ['O provedor de IA recusou a credencial do worker (chave ausente, inválida ou sem pagamento). As leituras de laudo estão falhando.', 'Confira a variável ANTHROPIC_API_KEY do worker no Easypanel e o faturamento no Console do provedor.']
          : msg.motivo === 'risco_ia_nutri'
            ? // Plano 15 (D22, RN-182; desvio 5: texto novo): sem consultório, paciente, contagem nem texto (regra 3)
              ['Há mensagens com sinal de risco na IA Nutri que nenhuma nutricionista abriu há mais de 72 horas. Avise os consultórios pelo canal de suporte.']
            : ['O teto mensal de gasto com IA foi atingido (o da plataforma ou o limite do workspace no Console). As leituras de laudo estão indisponíveis até o mês que vem ou até o teto ser revisto.'],
        { href: msg.painelUrl, rotulo: 'Abrir o painel do admin' },
      );
    case 'autorizacao_ia':
      // US-107: só o consultório e o link; nada de saúde (desvio 9: corpo novo, vai ao advogado com a autorização)
      return simples(
        MSG_AUTORIZACAO.emailAssunto(msg.consultorio),
        [
          `${msg.consultorio} pede a sua autorização para usar uma ferramenta de inteligência artificial (IA) com os seus dados de saúde.`,
          'Leia o texto completo pelo botão abaixo e decida. Autorizar é opcional: recusar não muda nada no seu atendimento.',
          MSG_AUTORIZACAO.autorizacaoPessoal, // F4 (§18.5)
          'O link vale por 7 dias.',
        ],
        { href: msg.link, rotulo: MSG_AUTORIZACAO.lerEDecidir },
      );
    case 'autorizacao_ia_confirmada': {
      // US-107/US-108: o resumo do que foi autorizado e a retirada a qualquer momento (art. 8º, § 5º). F4: "Se não foi você".
      // Plano 14B (F2): os usos da versão gravada, como no texto; job antigo, sem `usos`, é da 0.1 ou da 1.0 (só a leitura).
      const usos = (msg.usos?.length ? msg.usos : ['leitura_laudos']).map((u) => DESCRICAO_DO_USO[u as UsoIA]).filter(Boolean);
      return simples(
        MSG_AUTORIZACAO.confirmacaoAssunto,
        [
          `Você autorizou ${msg.consultorio} a usar inteligência artificial com os seus dados de saúde (texto da versão ${msg.versao}), só para${usos.length > 1 ? `: ${usos.join('; ')}` : ` ${usos[0]}`}.`,
          ...(msg.destino === DESTINO_ROTULO.teste ? [] : [`Destino dos dados: ${msg.destino}. Os seus dados saem do Brasil.`]),
          'Você pode retirar a autorização quando quiser, sem custo, pelo botão abaixo. Retirar não muda nada no seu atendimento.',
          MSG_AUTORIZACAO.seNaoFoiVoce,
        ],
        { href: msg.link, rotulo: MSG_AUTORIZACAO.retirarALink },
      );
    }
    case 'risco_ia_nutri':
      // D10 / RNF-166: genérico — nem paciente, nem texto, nem categoria (o assunto é o texto da spec)
      return simples(
        'Há uma mensagem de paciente que precisa da sua atenção.',
        ['Há uma mensagem de paciente que precisa da sua atenção.', 'Abra as dúvidas dos pacientes no NutriDebby.'],
        { href: msg.link, rotulo: 'Abrir as dúvidas dos pacientes' },
      );
    case 'exames_recebidos':
      // RN-168 / C-05: genérico — nem paciente, nem exame, nem arquivo
      return simples(
        'Exames enviados por pacientes',
        [MSG_REVISAO.avisoEmail, ...(msg.pendentesAntigos ? [MSG_REVISAO.lembrete30] : [])],
        { href: msg.link, rotulo: 'Ver exames recebidos' },
      );
    case 'pedido_nao_confirmado':
      // Plano 23 (RN-428, AG-D23): texto fixo, sem o motivo da recusa; sem link (página pública desligada), só a primeira frase
      return simples('Seu pedido de consulta não foi confirmado', [`O horário de ${msg.quando} não foi confirmado.`], msg.link ? { href: msg.link, rotulo: 'Escolha outro horário' } : undefined);
    case 'pedido_recebido':
      // Plano 23 (RN-426): o mesmo texto para paciente e pessoa nova; só a pessoa nova leva o link de desistência (AG-D42)
      return simples(
        'Recebemos seu pedido de consulta',
        [`Seu pedido para ${msg.quando} foi enviado. Você recebe outro e-mail quando a nutricionista responder.`],
        msg.linkDesistir ? { href: msg.linkDesistir, rotulo: 'Desistir do pedido' } : undefined,
      );
    case 'pedido_nao_confirmado_publico':
      // Plano 23 (RN-428, AG-D23): o mesmo texto do paciente; o link só com a página pública ligada
      return simples('Seu pedido de consulta não foi confirmado', [`O horário de ${msg.quando} não foi confirmado.`], msg.link ? { href: msg.link, rotulo: 'Escolha outro horário' } : undefined);
    case 'aniversario': {
      // Plano 23 (RN-432, RN-434, §6.2): texto fixo, sem oferta, preço nem dado de saúde; o nome do paciente só no corpo; o
      // rodapé diz que o envio é automático, a pedido da nutricionista; o link de saída na página e, no cabeçalho, a rota
      // de um clique (RFC 8058)
      const subject = MSG_ANIVERSARIO.assunto;
      const corpo = MSG_ANIVERSARIO.mensagem(msg.nome, msg.nutricionista);
      const rodape = MSG_ANIVERSARIO.rodape(msg.nutricionista);
      return {
        subject,
        html: html(
          <Layout titulo={subject}>
            <P>{corpo}</P>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: '#52525b' }}>{rodape}</p>
            <p style={{ margin: 0, fontSize: 13 }}>
              <a href={msg.link} style={{ color: COR }}>{MSG_ANIVERSARIO.naoQueroMais}</a>
            </p>
          </Layout>,
        ),
        text: [corpo, rodape, `${MSG_ANIVERSARIO.naoQueroMais}: ${msg.link}`].join('\n\n'),
        headers: { 'List-Unsubscribe': `<${msg.umClique}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      };
    }
    default: {
      const nunca: never = msg;
      throw new Error(`Tipo de e-mail desconhecido: ${String((nunca as { tipo?: string }).tipo)}`);
    }
  }
}
