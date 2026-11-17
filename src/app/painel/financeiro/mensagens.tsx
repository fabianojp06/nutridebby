'use client';

import { useEffect, useState } from 'react';
import { focarTitulo, ID_TITULO } from './foco';

const ESTILO = { ok: 'rounded-2xl border border-ok bg-ok-fundo p-3 text-ok', aviso: 'rounded-2xl border border-aviso bg-aviso-fundo p-3 text-aviso' } as const;
/** Quanto a região fica vazia antes de o mesmo texto voltar (o leitor de tela só anuncia o que muda). */
const PAUSA_MS = 100;

/**
 * Spec §7: a região `role="status"` fica sempre montada acima da lista ou do formulário (a linha que muda pode sair da tela
 * com o `revalidatePath`, e uma região que nasce junto com o texto nem sempre é anunciada). Com `focar` (`ok=` na URL), o
 * foco vai para o h1 da tela. `marcador` muda a cada envio: com ele, salvar de novo (o mesmo texto, a mesma URL de antes
 * a menos do marcador) também leva o foco ao h1, e a região esvazia por um instante e volta, para o texto ser anunciado
 * outra vez. `alvos`: os ids que podem receber o foco, o primeiro que estiver na tela (padrão: o h1 do Financeiro; a seção
 * "Cobrança" da tela da consulta passa o h2 dela).
 */
export function Mensagens({
  texto,
  tipo,
  focar,
  marcador = '',
  alvos = [ID_TITULO],
}: {
  texto: string;
  tipo: keyof typeof ESTILO;
  focar: boolean;
  marcador?: string;
  alvos?: readonly string[];
}) {
  // texto, não a lista: uma lista nova a cada render do pai não pode levar o foco de novo
  const alvo = alvos.join(' ');
  const [visto, setVisto] = useState(marcador);
  const [vazia, setVazia] = useState(false);
  if (visto !== marcador) {
    setVisto(marcador);
    setVazia(true);
  }
  useEffect(() => {
    if (!vazia) return;
    const t = setTimeout(() => setVazia(false), PAUSA_MS);
    return () => clearTimeout(t);
  }, [vazia]);
  useEffect(() => {
    if (focar) focarTitulo(alvo.split(' '));
  }, [focar, texto, marcador, alvo]);
  const mostrado = vazia ? '' : texto;
  return (
    <p role="status" className={mostrado ? ESTILO[tipo] : undefined}>
      {mostrado}
    </p>
  );
}
