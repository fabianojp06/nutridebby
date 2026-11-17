import Link from 'next/link';
import type { ReactNode } from 'react';
import { Cartao } from '@/components/ui/cartao';
import type { NoApp } from '@/modules/ficha/no-app';
import { MSG_NO_APP } from '@/modules/ficha/textos';
import { formatarData } from '@/modules/pacientes/datas';

const classeDoLink = 'inline-flex min-h-11 items-center text-link underline';

/**
 * Plano 18 (§8.5, US-264): o acesso ao app, como o cartão e a página dizem. Sem conta: "Ainda não entrou no app." e o
 * texto do convite (o mesmo do Perfil); sem convite ou com ele vencido, o link para reenviar no Perfil (que grava a
 * leitura do cadastro: sem prefetch). Arquivado e bloqueado nunca entram no app.
 */
export function AcessoNoApp({ acesso, patientId, cartao }: { acesso: NoApp['acesso']; patientId: string; cartao: boolean }): ReactNode {
  const t = MSG_NO_APP.acesso;
  switch (acesso.estado) {
    case 'arquivado':
      return t.arquivado;
    case 'bloqueado':
      return t.bloqueado;
    case 'ativo':
      if (cartao) return `${t.ativoNoCartao} · ${acesso.ultimoAcesso ? t.ultimoAcessoEmNoCartao(formatarData(acesso.ultimoAcesso)) : t.nuncaAcessouNoCartao}`;
      return `${t.ativo} · ${acesso.ultimoAcesso ? t.ultimoAcessoEm(formatarData(acesso.ultimoAcesso)) : t.nuncaAcessou}`;
    case 'pendente':
      return [t.naoEntrou, acesso.textoDoConvite].filter(Boolean).join(' ');
    case 'expirado':
    case 'sem_convite':
      return (
        <>
          {[t.naoEntrou, acesso.textoDoConvite].filter(Boolean).join(' ')}{' '}
          <Link href={`/painel/pacientes/${patientId}/perfil`} prefetch={false} className={classeDoLink}>{t.reenviar}</Link>
        </>
      );
  }
}

/**
 * Plano 18 (D16, §8.3, US-264): o cartão "No app do paciente" do Início — Acesso, Plano, Documentos e Conteúdos (estas
 * três só com o acesso ativo: sem acesso, o paciente não vê nada) e "Ver detalhes". As contagens vêm de `noAppDoPaciente`,
 * contadas no contexto do paciente; os documentos só com os documentos liberados pelo admin.
 */
export function CartaoNoApp({ noApp, patientId, documentos }: { noApp: NoApp; patientId: string; documentos: boolean }) {
  const t = MSG_NO_APP;
  const c = noApp.contagens;
  const numeros = c ? [documentos ? t.documentos(c.documentos ?? 0) : null, t.conteudos(c.conteudos ?? 0)].filter(Boolean).join(' · ') : null;
  return (
    <Cartao id="no-app-titulo" titulo={t.titulo} data-guia="no-app-cartao">
      <ul className="space-y-1">
        <li><AcessoNoApp acesso={noApp.acesso} patientId={patientId} cartao /></li>
        {c && <li>{noApp.plano.publicadoEm ? t.plano.publicadoNoCartao : t.plano.nenhum}</li>}
        {numeros && <li>{numeros}</li>}
      </ul>
      {/* a página não grava leitura, mas o layout da ficha grava a do cabeçalho: sem prefetch, como os links das seções */}
      <Link href={`/painel/pacientes/${patientId}/app`} prefetch={false} className={classeDoLink}>{t.verDetalhes}</Link>
    </Cartao>
  );
}
