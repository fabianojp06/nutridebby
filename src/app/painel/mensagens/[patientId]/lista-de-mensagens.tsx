import type { ReactNode } from 'react';
import { Selo } from '@/components/ui/selo';
import { partesNoFuso } from '@/modules/agenda/fuso';
import { MSG_MENSAGENS } from '@/modules/mensagens/constantes';
import type { MensagemNaTela } from '@/modules/mensagens/conversa';
import { formatarData, hojeNoFuso } from '@/modules/pacientes/datas';
import { EstadoDaMinha } from './situacao';

const C = MSG_MENSAGENS.conversa;
const CAIXA = MSG_MENSAGENS.caixa;

/** 'AAAA-MM-DD' do dia anterior (calendário puro). */
function diaAnterior(data: string): string {
  const [a, m, d] = data.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d - 1)).toISOString().slice(0, 10);
}

/** O separador do dia (§6.2): "Hoje", "Ontem" ou "dd/mm/aaaa", no fuso do consultório. */
function rotuloDoDia(dia: string, hoje: string): string {
  if (dia === hoje) return C.hoje;
  if (dia === diaAnterior(hoje)) return C.ontem;
  return formatarData(dia);
}

/** "1,2 MB" / "350 KB" (só para mostrar). */
function tamanho(bytes: number | null): string {
  if (!bytes) return '';
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** O que aparece do anexo (o download é da T8): processando, falhou, PDF com nome e tamanho, imagem. */
function Anexo({ anexo }: { anexo: NonNullable<MensagemNaTela['anexo']> }) {
  if (anexo.status === 'processando') return <p className="text-sm text-suave">{C.imagemProcessando}</p>;
  if (anexo.status === 'falhou') return <p className="text-sm text-erro">{C.imagemFalhou}</p>;
  if (anexo.status !== 'pronto') return null;
  return <p className="text-sm">{anexo.tipo === 'pdf' ? C.arquivoPdf(anexo.nome ?? '', tamanho(anexo.bytes)) : CAIXA.tipos.imagem}</p>;
}

/** Mensagens seguidas do mesmo autor (no mesmo dia) formam um bloco: o autor no começo e, na equipe, o carimbo no fim. */
const chaveDoBloco = (m: MensagemNaTela) => (m.recado ? `recado:${m.id}` : m.autor === 'paciente' ? 'paciente' : `nutri:${m.minha}:${m.autorNome}:${m.autorCrn}`);

/**
 * US-441 (§6.2, §7.2, RN-471): a lista das mensagens (`aria-label="Mensagens"`, não `role="log"`) — o separador do dia, as
 * do paciente à esquerda e as da equipe à direita, o autor no começo de cada bloco ("Você", o nome gravado na linha ou o
 * primeiro nome do paciente), a hora (`<time datetime>`) em cada mensagem, o carimbo "{nome} · Nutricionista · {CRN}" sob
 * cada bloco da equipe (o CRN já vem com o prefixo: nunca "CRN " antes), "Sinal de risco" no selo de alerta, a cópia do
 * recado com borda e o rótulo "Recado", "Enviada"/"Lida" nas próprias. Texto como texto (sem HTML nem link automático,
 * RNF-444). Cada mensagem recebe o foco (`tabIndex=-1`) depois de "Mostrar novas mensagens".
 */
export function ListaDeMensagens({ mensagens, fuso, primeiroNome }: { mensagens: MensagemNaTela[]; fuso: string; primeiroNome: string }) {
  const hoje = hojeNoFuso(fuso);
  const itens: ReactNode[] = [];
  mensagens.forEach((m, i) => {
    const p = partesNoFuso(m.criadaEm, fuso);
    const ant = mensagens[i - 1];
    const prox = mensagens[i + 1];
    const diaAnt = ant ? partesNoFuso(ant.criadaEm, fuso).data : null;
    const diaProx = prox ? partesNoFuso(prox.criadaEm, fuso).data : null;
    const inicio = !ant || p.data !== diaAnt || chaveDoBloco(ant) !== chaveDoBloco(m);
    const fim = !prox || diaProx !== p.data || chaveDoBloco(prox) !== chaveDoBloco(m);
    const daEquipe = m.autor === 'nutri';
    const autor = daEquipe ? (m.minha ? C.voce : (m.autorNome ?? '')) : primeiroNome;
    itens.push(
      <li
        key={m.id}
        data-mensagem={m.id}
        data-recado={m.recado ? '' : undefined}
        tabIndex={-1}
        // a margem de rolagem do tamanho do rodapé sticky: o foco da primeira nova não fica embaixo dele (WCAG 2.4.11)
        className={`flex scroll-mt-4 scroll-mb-64 flex-col ${daEquipe ? 'items-end' : 'items-start'} ${inicio ? 'mt-3' : 'mt-1'}`}
      >
        {/* o dia é o começo do primeiro item do dia (não um item da lista: a lista só conta mensagens) */}
        {p.data !== diaAnt && <p className="w-full py-2 text-center text-sm font-semibold text-suave">{rotuloDoDia(p.data, hoje)}</p>}
        {inicio && autor && <p className="text-sm font-semibold">{autor}</p>}
        <div className={`max-w-[85%] space-y-1 rounded-2xl border p-3 ${m.recado ? 'border-2 border-marca bg-cartao' : daEquipe ? 'border-borda bg-linha' : 'border-borda bg-cartao'}`}>
          {m.recado && <Selo>{C.recado}</Selo>}
          {m.duvidaEm && <p className="text-sm text-suave">{C.respostaADuvida(formatarData(hojeNoFuso(fuso, m.duvidaEm)))}</p>}
          {m.texto !== null && <p className="wrap-break-word whitespace-pre-line">{m.texto}</p>}
          {m.anexo && <Anexo anexo={m.anexo} />}
          <p className="flex flex-wrap items-center gap-2 text-xs text-suave">
            <time dateTime={m.criadaEm.toISOString()}>{p.hora}</time>
            {m.risco && <Selo variante="alerta">{C.seloRisco}</Selo>}
            {m.minha && <EstadoDaMinha id={m.id} />}
          </p>
        </div>
        {daEquipe && fim && m.autorNome && m.autorCrn && <p className="text-xs text-suave">{C.carimbo(m.autorNome, m.autorCrn)}</p>}
      </li>,
    );
  });
  return (
    <ul aria-label="Mensagens" data-guia="conversa-mensagens" className="flex flex-col">
      {itens}
    </ul>
  );
}
