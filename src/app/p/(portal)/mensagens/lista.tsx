import type { ReactNode } from 'react';
import { EstadoDaMinha } from '@/components/mensagens/leitura';
import { partesNoFuso } from '@/modules/agenda/fuso';
import { MSG_MENSAGENS, MSG_PORTAL_MENSAGENS } from '@/modules/mensagens/constantes';
import type { MensagemNaTela } from '@/modules/mensagens/conversa';
import { formatarData, hojeNoFuso } from '@/modules/pacientes/datas';
import { Socorro } from './socorro';

const P = MSG_PORTAL_MENSAGENS;
const C = MSG_MENSAGENS.conversa;

/** 'AAAA-MM-DD' do dia anterior (calendário puro). */
function diaAnterior(data: string): string {
  const [a, m, d] = data.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d - 1)).toISOString().slice(0, 10);
}
/** O separador do dia: "Hoje", "Ontem" ou "dd/mm/aaaa", no fuso do consultório. */
const rotuloDoDia = (dia: string, hoje: string) => (dia === hoje ? C.hoje : dia === diaAnterior(hoje) ? C.ontem : formatarData(dia));
/** "1,2 MB" / "350 KB" (só para mostrar). */
const tamanho = (bytes: number | null) =>
  !bytes ? '' : bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** O que aparece do anexo (o download e o envio de foto são da T8): a foto do paciente e o arquivo da nutricionista. */
function Anexo({ m }: { m: MensagemNaTela }) {
  const a = m.anexo!;
  if (m.minha) {
    if (a.status === 'processando') return <p className="text-sm text-suave">{P.enviandoFoto}</p>;
    if (a.status === 'falhou') return <p className="text-sm text-erro">{P.fotoFalhou}</p>;
    return a.status === 'pronto' ? <p className="text-sm">{P.foto}</p> : null;
  }
  if (a.status === 'processando') return <p className="text-sm text-suave">{C.imagemProcessando}</p>;
  if (a.status === 'falhou') return <p className="text-sm text-erro">{C.imagemFalhou}</p>;
  if (a.status !== 'pronto') return null;
  return <p className="text-sm">{a.tipo === 'pdf' ? C.arquivoPdf(a.nome ?? '', tamanho(a.bytes)) : MSG_MENSAGENS.caixa.tipos.imagem}</p>;
}

/** Mensagens seguidas do mesmo autor (no mesmo dia) formam um bloco: o autor uma vez, no começo. O recado é um bloco só. */
const chaveDoBloco = (m: MensagemNaTela) => (m.recado ? `recado:${m.id}` : m.minha ? 'eu' : `nutri:${m.autorNome}:${m.autorCrn}`);

/** RN-471: "Você"; o carimbo "{nome} · Nutricionista · {CRN}" da linha; o recado com "Recado do consultório · {nome} · {CRN}". */
function autorDo(m: MensagemNaTela): string {
  if (m.minha) return P.voce;
  if (!m.autorNome || !m.autorCrn) return '';
  return m.recado ? P.carimboRecado(m.autorNome, m.autorCrn) : P.carimbo(m.autorNome, m.autorCrn);
}

/**
 * US-443 (§6.2, §7.3, RN-471): as mensagens no desenho do portal G — o separador do dia, as do paciente à direita e as da
 * nutricionista à esquerda, o autor no começo de cada bloco (o carimbo gravado na linha; nunca "CRN " antes do CRN, que já
 * vem com o prefixo), a hora (`<time datetime>`) em cada mensagem, o recado com borda e o rótulo, "Enviada"/"Lida" nas
 * próprias e, logo abaixo da mensagem de risco, o socorro (RN-449). Texto como texto (RNF-444). Cada mensagem recebe o foco
 * (`tabIndex=-1`) depois de "Mostrar novas mensagens", com a margem de rolagem do rodapé `sticky`.
 */
export function ListaDoPortal({ mensagens, fuso }: { mensagens: MensagemNaTela[]; fuso: string }) {
  const hoje = hojeNoFuso(fuso);
  const itens: ReactNode[] = [];
  mensagens.forEach((m, i) => {
    const p = partesNoFuso(m.criadaEm, fuso);
    const ant = mensagens[i - 1];
    const diaAnt = ant ? partesNoFuso(ant.criadaEm, fuso).data : null;
    const inicio = !ant || p.data !== diaAnt || chaveDoBloco(ant) !== chaveDoBloco(m);
    const autor = autorDo(m);
    itens.push(
      <li
        key={m.id}
        data-mensagem={m.id}
        data-recado={m.recado ? '' : undefined}
        tabIndex={-1}
        className={`flex scroll-mt-4 scroll-mb-64 flex-col gap-1 ${m.minha ? 'items-end' : 'items-start'} ${inicio ? 'mt-3' : 'mt-1'}`}
      >
        {p.data !== diaAnt && <p className="w-full py-2 text-center text-sm font-semibold text-suave">{rotuloDoDia(p.data, hoje)}</p>}
        {inicio && autor && <p className="text-sm font-semibold">{autor}</p>}
        <div className={`max-w-[85%] space-y-1 rounded-2xl p-3 ${m.recado ? 'border-2 border-marca bg-cartao' : m.minha ? 'bg-p-clara' : 'border border-borda bg-cartao'}`}>
          {m.texto !== null && <p className="wrap-break-word whitespace-pre-line">{m.texto}</p>}
          {m.anexo && <Anexo m={m} />}
          <p className="flex flex-wrap items-center gap-2 text-sm text-suave">
            <time dateTime={m.criadaEm.toISOString()}>{p.hora}</time>
            {m.minha && <EstadoDaMinha id={m.id} />}
          </p>
        </div>
        {m.minha && m.risco && <Socorro risco={m.risco} />}
      </li>,
    );
  });
  return (
    <ul aria-label={P.titulo} className="flex flex-col">
      {itens}
    </ul>
  );
}
