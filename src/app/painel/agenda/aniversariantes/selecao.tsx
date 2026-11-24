'use client';

import { useActionState, useEffect, useId, useState } from 'react';
import { Dialogo } from '@/components/dialogo';
import { Botao } from '@/components/ui/botao';
import { MSG_ANIVERSARIO as M } from '@/modules/agenda/constantes';
import type { AniversarioState } from './actions';
import { RegistrarAutorizacao } from './autorizacao-dialogo';
import { urlWhatsappAniversario } from './whatsapp';

type Acao = (prev: AniversarioState, fd: FormData) => Promise<AniversarioState>;

/** Uma linha da lista, já com os textos (montada no servidor, page.tsx). */
export type LinhaDoAniversario = {
  patientId: string;
  nome: string;
  /** 'dd/mm' */
  dia: string;
  faz: number;
  situacao: string;
  /** "Pode receber" no mês corrente: a caixa de seleção fica habilitada. */
  pode: boolean;
  /** Aniversário hoje (entra no "{n} de hoje saem agora."). */
  deHoje: boolean;
  /** Já tem a autorização que conta: sem "Registrar autorização". */
  autorizado: boolean;
  podeRetirar: boolean;
  menorHoje: boolean;
  whatsapp: { telefone: string; primeiroNome: string } | null;
  registrar: Acao;
  retirar: () => Promise<void>;
};

/** O envio dentro do diálogo da prévia: os marcados em `ids` e "Enviar mensagem" (o `<form>` dentro do `<Dialogo>`). */
function FormularioDoEnvio({ ids, enviar, aoCancelar, aoMudarPendente }: { ids: string[]; enviar: Acao; aoCancelar: () => void; aoMudarPendente: (p: boolean) => void }) {
  const [, acao, pendente] = useActionState<AniversarioState, FormData>(enviar, {});
  useEffect(() => aoMudarPendente(pendente), [pendente, aoMudarPendente]);
  return (
    <form action={acao} className="flex flex-wrap justify-end gap-3">
      {ids.map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
      <Botao type="button" variante="secundario" onClick={() => !pendente && aoCancelar()} aria-disabled={pendente || undefined} className="aria-disabled:opacity-60">
        Cancelar
      </Botao>
      <Botao type="submit" data-foco-inicial="" aria-disabled={pendente || undefined} className="aria-disabled:opacity-60" onClick={(e) => pendente && e.preventDefault()}>
        {M.enviar}
      </Botao>
    </form>
  );
}

/**
 * Plano 23 (US-412, US-413, §7): a tabela dos aniversariantes com a seleção, a prévia do envio e as ações de cada linha.
 * No mês corrente, cada linha tem a caixa (habilitada só no "Pode receber"; as outras ficam desabilitadas, com a situação
 * em texto ao lado); nos outros meses, só consulta (sem caixa). "Selecionar todos" marca só os "Pode receber" e vira
 * "Limpar seleção"; a região `role="status"` (sempre montada) anuncia "{n} marcados". "Enviar mensagem" abre a prévia no
 * `Dialogo` compartilhado: o texto fixo, "Texto padrão do NutriDebby, enviado em seu nome", "Vai para {n} pacientes…" e,
 * com aniversariante de hoje entre as 9h e as 21h, "{n} de hoje saem agora.". "Abrir no WhatsApp" é um link `wa.me`
 * montado aqui, no navegador (RN-435): nada é gravado nem enviado pelo sistema.
 */
export function TabelaDosAniversariantes({ linhas, corrente, nutri, saemAgora, enviar }: { linhas: LinhaDoAniversario[]; corrente: boolean; nutri: string; saemAgora: boolean; enviar: Acao }) {
  const [marcados, setMarcados] = useState<ReadonlySet<string>>(new Set());
  const [aberto, setAberto] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const idEnviar = useId();
  const podem = linhas.filter((l) => l.pode).map((l) => l.patientId);
  const alternar = (id: string) =>
    setMarcados((m) => {
      const n = new Set(m);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const ids = podem.filter((id) => marcados.has(id));
  const deHoje = linhas.filter((l) => l.deHoje && marcados.has(l.patientId)).length;
  return (
    <div className="space-y-3">
      {corrente && (
        <div className="flex flex-wrap items-center gap-3">
          <Botao type="button" variante="secundario" disabled={!podem.length} onClick={() => setMarcados(ids.length ? new Set() : new Set(podem))}>
            {ids.length ? M.limparSelecao : M.selecionarTodos}
          </Botao>
          <Botao id={idEnviar} type="button" aria-haspopup="dialog" aria-disabled={!ids.length || undefined} className="aria-disabled:opacity-60" onClick={() => ids.length && setAberto(true)}>
            {M.enviar}
          </Botao>
          {/* RNF-401: a região existe desde o início; só o texto muda */}
          <p role="status" className="text-sm">{ids.length ? M.marcados(ids.length) : ''}</p>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left">
          <thead>
            <tr className="border-b border-borda">
              {corrente && <th scope="col" className="w-12 p-2"><span className="sr-only">{M.colunaSelecao}</span></th>}
              <th scope="col" className="p-2">{M.colunas.paciente}</th>
              <th scope="col" className="p-2">{M.colunas.dia}</th>
              <th scope="col" className="p-2">{M.colunas.faz}</th>
              <th scope="col" className="p-2">{M.colunas.situacao}</th>
              <th scope="col" className="p-2"><span className="sr-only">{M.colunaAcoes}</span></th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.patientId} className="border-b border-borda align-top">
                {corrente && (
                  <td className="p-2">
                    <input
                      type="checkbox"
                      // dentro da tabela com rolagem lateral: o contorno do foco para dentro (RNF-10/D25)
                      className="size-6 focus-visible:outline-offset-[-3px]"
                      checked={marcados.has(l.patientId) && l.pode}
                      disabled={!l.pode}
                      onChange={() => alternar(l.patientId)}
                      aria-label={M.selecionar(l.nome)}
                      aria-describedby={`situacao-${l.patientId}`}
                    />
                  </td>
                )}
                <th scope="row" className="p-2 font-medium [overflow-wrap:anywhere]">{l.nome}</th>
                <td className="p-2">{l.dia}</td>
                <td className="p-2">{l.faz}</td>
                <td id={`situacao-${l.patientId}`} className="p-2">{l.situacao}</td>
                <td className="p-2">
                  <div className="flex flex-wrap gap-2">
                    {!l.autorizado && <RegistrarAutorizacao nome={l.nome} menor={l.menorHoje} registrar={l.registrar} />}
                    {l.podeRetirar && (
                      <form action={l.retirar}>
                        <Botao type="submit" variante="secundario" aria-label={M.retirarDe(l.nome)} className="focus-visible:outline-offset-[-3px]">{M.retirar}</Botao>
                      </form>
                    )}
                    {l.whatsapp && (
                      <a
                        href={urlWhatsappAniversario(l.whatsapp.telefone, l.whatsapp.primeiroNome, nutri)}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={M.whatsappDe(l.nome)}
                        className="inline-flex min-h-11 items-center rounded-full border border-borda px-4 font-semibold focus-visible:outline-offset-[-3px]"
                      >
                        {M.abrirWhatsapp}
                      </a>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialogo aberto={aberto} titulo={M.enviar} descricao={M.textoPadrao} aoFechar={() => setAberto(false)} ocupado={ocupado} rodape={null} focoAoFechar={() => document.getElementById(idEnviar)}>
        <div className="space-y-3">
          <div role="group" aria-label={M.previa} className="space-y-2 rounded-2xl border border-borda bg-fundo p-3 text-sm">
            <p className="font-semibold">{M.assunto}</p>
            <p>{M.mensagem(M.primeiroNomeNaPrevia, nutri)}</p>
            <p className="text-suave">{M.rodape(nutri)}</p>
            <p className="text-suave underline">{M.naoQueroMais}</p>
          </div>
          <p>{M.vaiPara(ids.length)}</p>
          {saemAgora && deHoje > 0 && <p>{M.saemAgora(deHoje)}</p>}
          <FormularioDoEnvio ids={ids} enviar={enviar} aoCancelar={() => setAberto(false)} aoMudarPendente={setOcupado} />
        </div>
      </Dialogo>
    </div>
  );
}
