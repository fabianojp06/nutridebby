'use client';

import { useActionState, useState } from 'react';
import { Campo } from '@/components/campo';
import type { TipoDeLocal } from '@/db/schema';
import { DURACOES, ROTULO_TIPO_LOCAL } from '@/modules/agenda/constantes';
import type { ConsultaState } from './actions';

/** Plano 23 (US-402): o local do seletor; a sala fixa só neste formulário do painel. */
export type LocalDoFormulario = { id: string; nome: string; tipo: TipoDeLocal; linkSala: string | null };

type Props = {
  acao: (prev: ConsultaState, fd: FormData) => Promise<ConsultaState>;
  /** `localId` inicial: o principal na Nova consulta; o da consulta em "Alterar data e hora". */
  inicial: Record<string, string>;
  pacientes?: { id: string; nome: string; email: string }[];
  locais: LocalDoFormulario[];
  /** Aviso junto do campo "Local" (o local da consulta foi arquivado: não está entre as opções). */
  avisoDoLocal?: string;
  botao: string;
};

/**
 * US-031 / Plano 23 (US-402, RN-407): o "Local" no lugar da modalidade (a modalidade é o tipo do local). Num local de
 * videoconferência aparece "Link da chamada": vazio = a sala fixa do local. O link gravado só volta ao campo com o mesmo
 * local da consulta; trocando de local, o campo recomeça vazio (o link de uma sala não passa para outra).
 */
export function ConsultaForm({ acao, inicial, pacientes, locais, avisoDoLocal, botao }: Props) {
  const [state, action, pendente] = useActionState<ConsultaState, FormData>(acao, {});
  const v = state.valores ?? inicial;
  const e = state.erros ?? {};
  // `localId` só decide se o campo do link aparece e o que ele sugere; quem escolhe a opção é o `defaultValue` (o reset automático do formulário, depois de um erro, volta ao último valor enviado)
  const [localId, setLocalId] = useState(v.localId ?? '');
  const local = locais.find((l) => l.id === localId);
  const aria = (k: string) => (e[k] ? { 'aria-invalid': true as const, 'aria-describedby': `${k}-erro` } : {});
  const erro = (k: string) => e[k] && <p id={`${k}-erro`} role="alert" className="text-sm text-erro">{e[k]}</p>;
  return (
    <form action={action} className="max-w-xl space-y-4">
      {pacientes && (
        <div className="space-y-1">
          <label htmlFor="patientId" className="block font-medium">Paciente</label>
          {/* key (aqui e na duração): o React não re-sincroniza o defaultValue de um <select>, e o reset automático do formulário voltaria à opção inicial */}
          <select key={v.patientId} id="patientId" name="patientId" defaultValue={v.patientId ?? ''} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto" {...aria('patientId')}>
            <option value="" disabled>Selecione o paciente</option>
            {pacientes.map((p) => <option key={p.id} value={p.id}>{`${p.nome} (${p.email})`}</option>)}
          </select>
          {erro('patientId')}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Campo id="data" rotulo="Data" type="date" required defaultValue={v.data} erro={e.data} />
        <Campo id="hora" rotulo="Hora" type="time" required defaultValue={v.hora} erro={e.hora} />
        <div className="space-y-1">
          <label htmlFor="duracaoMin" className="block font-medium">Duração</label>
          <select key={v.duracaoMin} id="duracaoMin" name="duracaoMin" defaultValue={v.duracaoMin || '60'} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto" {...aria('duracaoMin')}>
            {DURACOES.map((d) => <option key={d} value={d}>{`${d} min`}</option>)}
          </select>
          {erro('duracaoMin')}
        </div>
      </div>
      <div className="space-y-1">
        <label htmlFor="localId" className="block font-medium">Local</label>
        <select key={v.localId} id="localId" name="localId" defaultValue={v.localId ?? ''} onChange={(ev) => setLocalId(ev.target.value)} className="min-h-11 w-full rounded-xl border border-campo bg-cartao p-2 text-texto" {...aria('localId')}
          aria-describedby={[avisoDoLocal ? 'localId-aviso' : null, e.localId ? 'localId-erro' : null].filter(Boolean).join(' ') || undefined}>
          <option value="" disabled>Escolha o local</option>
          {locais.map((l) => <option key={l.id} value={l.id}>{`${l.nome} (${ROTULO_TIPO_LOCAL[l.tipo]})`}</option>)}
        </select>
        {avisoDoLocal && <p id="localId-aviso" className="text-sm text-suave">{avisoDoLocal}</p>}
        {erro('localId')}
      </div>
      {local?.tipo === 'online' && (
        <Campo key={local.id} id="linkOnline" rotulo="Link da chamada" type="url" defaultValue={local.id === (state.valores?.localId ?? inicial.localId) ? v.linkOnline : ''} erro={e.linkOnline}
          placeholder={local.linkSala ?? 'https://…'} dica={local.linkSala ? 'Vazio = a sala fixa do local.' : undefined} />
      )}
      {erro('geral')}
      <button disabled={pendente} className="inline-flex min-h-11 items-center justify-center rounded-full bg-destaque px-5 font-semibold text-white hover:brightness-95">{botao}</button>
    </form>
  );
}
