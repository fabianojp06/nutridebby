import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
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
        'Foram apagados agora: as autorizações de mensagens por WhatsApp e os convites de acesso. Você não recebe mais lembretes nem mensagens deste acompanhamento.',
        `Por obrigação legal (LGPD, art. 16, I), o prontuário clínico fica guardado de forma bloqueada, só para consulta da nutricionista, até ${msg.anonimizarApos}. Depois dessa data, seus dados de identificação são anonimizados.`,
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
      const linhas = ['A exportação de dados que você pediu no NutriDebby está pronta.', 'O link vale por 24 horas e pede que você entre no painel.'];
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
    case 'consulta': {
      const subject = {
        lembrete_24h: `Lembrete: sua consulta é amanhã às ${msg.hora}`,
        lembrete_2h: `Lembrete: sua consulta é hoje às ${msg.hora}`,
        consulta_marcada: `Consulta marcada: ${msg.quando}`,
        consulta_cancelada: `Consulta cancelada: ${msg.quando}`,
      }[msg.evento];
      const abertura = {
        lembrete_24h: `Este é um lembrete da sua consulta com ${msg.nutri}: ${msg.quando}.`,
        lembrete_2h: `Sua consulta com ${msg.nutri} é hoje: ${msg.quando}.`,
        consulta_marcada: `Sua consulta com ${msg.nutri} está marcada para ${msg.quando}.`,
        consulta_cancelada: `Sua consulta com ${msg.nutri} de ${msg.quando} foi cancelada.`,
      }[msg.evento];
      if (msg.evento === 'consulta_cancelada') return simples(subject, [`Olá, ${msg.nome}!`, abertura, 'Para marcar outro horário, fale com sua nutricionista.']);
      const local = !msg.local ? [] : [msg.modalidade === 'online' ? `Link da chamada: ${msg.local}` : `Endereço: ${msg.local}`];
      return simples(
        subject,
        [`Olá, ${msg.nome}!`, abertura, ...local],
        msg.link ? { href: msg.link, rotulo: 'Confirmar presença ou remarcar' } : undefined,
        ['Se não puder ir, use o mesmo link para remarcar ou cancelar.'],
      );
    }
    default: {
      const nunca: never = msg;
      throw new Error(`Tipo de e-mail desconhecido: ${String((nunca as { tipo?: string }).tipo)}`);
    }
  }
}
