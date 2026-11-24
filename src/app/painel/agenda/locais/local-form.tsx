'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { Campo } from '@/components/campo';
import { Botao } from '@/components/ui/botao';
import type { TipoDeLocal } from '@/db/schema';
import { MSG_LOCAIS, ROTULO_TIPO_LOCAL } from '@/modules/agenda/constantes';
import type { LocalNaTela } from '@/modules/agenda/locais';
import type { LocalFormState } from './actions';

/**
 * US-400: formulário do local. Mostra os campos do tipo escolhido (presencial: endereço, cidade, "mostrar o endereço";
 * videoconferência: sala fixa e o aviso de telenutrição, RN-404). Local em uso: o tipo vira texto, sem campo (RN-401).
 */
export function LocalForm({ acao, local }: { acao: (prev: LocalFormState, fd: FormData) => Promise<LocalFormState>; local?: LocalNaTela }) {
  const [state, action, pendente] = useActionState<LocalFormState, FormData>(acao, {});
  const e = state.erros ?? {};
  const v = state.valores; // em erro, o que foi digitado (inclusive campo limpo de propósito); senão, o gravado
  const tipoFixo = local?.emUso ? local.tipo : null;
  const [tipo, setTipo] = useState<string>(tipoFixo ?? v?.tipo ?? local?.tipo ?? 'presencial');
  const [sala, setSala] = useState<string>(v?.linkSala ?? local?.linkSala ?? '');
  const marcado = (campo: 'mostrarEndereco' | 'agendamentoOnline') => (v ? v[campo] === 'on' : !!local?.[campo]);
  return (
    <form action={action} className="space-y-4">
      {e.geral && <p role="alert" className="text-erro">{e.geral}</p>}
      {tipoFixo ? (
        <p>Tipo: {ROTULO_TIPO_LOCAL[tipoFixo as TipoDeLocal]}</p>
      ) : (
        <fieldset className="space-y-1" aria-describedby={e.tipo ? 'tipo-erro' : undefined}>
          <legend className="font-medium">Tipo</legend>
          <div className="flex flex-wrap gap-x-6">
            {(['presencial', 'online'] as const).map((t) => (
              <label key={t} className="inline-flex min-h-11 items-center gap-2">
                <input type="radio" name="tipo" value={t} defaultChecked={tipo === t} onChange={() => setTipo(t)} />
                {ROTULO_TIPO_LOCAL[t]}
              </label>
            ))}
          </div>
          {e.tipo && <p id="tipo-erro" role="alert" className="text-sm text-erro">{e.tipo}</p>}
        </fieldset>
      )}
      {/* "Editar" e "Novo local" abrem o formulário: o foco vai ao primeiro campo de texto (RNF-401) */}
      <Campo id="nome" rotulo="Nome do local" required autoFocus defaultValue={v ? v.nome : (local?.nome ?? '')} erro={e.nome} dica="Não use nome nem endereço de paciente." />
      {tipo === 'presencial' ? (
        <>
          <Campo id="endereco" rotulo="Endereço" defaultValue={v ? (v.endereco ?? '') : (local?.endereco ?? '')} erro={e.endereco} />
          <Campo id="cidade" rotulo="Cidade" defaultValue={v ? (v.cidade ?? '') : (local?.cidade ?? '')} erro={e.cidade} />
          <div className="flex min-h-11 items-center gap-2">
            <input id="mostrarEndereco" name="mostrarEndereco" type="checkbox" defaultChecked={marcado('mostrarEndereco')} />
            <label htmlFor="mostrarEndereco" className="inline-flex min-h-11 items-center">Mostrar o endereço na página de agendamento</label>
          </div>
        </>
      ) : (
        <>
          <Campo id="linkSala" rotulo="Sala fixa (link, opcional)" type="url" inputMode="url" value={sala} onChange={(ev) => setSala(ev.target.value)} erro={e.linkSala} dica="Sem sala fixa, informe o link em cada consulta." />
          {/* RN-404: o aviso de telenutrição no local de videoconferência; com sala fixa, também o da sala de espera */}
          <div className="space-y-1 rounded-2xl bg-aviso-fundo p-3 text-sm text-aviso">
            <p>{MSG_LOCAIS.telenutricao}</p>
            {sala.trim() !== '' && <p>{MSG_LOCAIS.salaDeEspera}</p>}
          </div>
        </>
      )}
      <div className="space-y-1">
        <div className="flex min-h-11 items-center gap-2">
          <input
            id="agendamentoOnline"
            name="agendamentoOnline"
            type="checkbox"
            defaultChecked={marcado('agendamentoOnline')}
            aria-invalid={e.agendamentoOnline ? true : undefined}
            aria-describedby={['agendamentoOnline-dica', e.agendamentoOnline ? 'agendamentoOnline-erro' : null].filter(Boolean).join(' ')}
          />
          <label htmlFor="agendamentoOnline" className="inline-flex min-h-11 items-center">Aceita agendamento pelo paciente</label>
        </div>
        <p id="agendamentoOnline-dica" className="text-sm text-suave">Vale para o app do paciente e, se a página de agendamento estiver ligada no Perfil, para ela também.</p>
        {e.agendamentoOnline && <p id="agendamentoOnline-erro" role="alert" className="text-sm text-erro">{e.agendamentoOnline}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <Botao disabled={pendente}>Salvar local</Botao>
        <Link href="/painel/agenda/locais" className="inline-flex min-h-11 items-center text-link underline">Cancelar</Link>
      </div>
    </form>
  );
}
