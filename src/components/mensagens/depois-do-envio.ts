'use client';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef } from 'react';

type Onde = {
  /** A tela é a das mensagens anteriores (`?antes=`): a mensagem enviada não está nela, e a consulta fica desligada. */
  naAnterior: boolean;
  /** A URL leva um retorno de ato já mostrado (`?ok=`/`?erro=` do painel): sai depois do envio, sem mexer no foco. */
  limpar?: boolean;
};

/**
 * /code-review do PR 2 (I2): o que fazer depois de um envio gravado. Na página das anteriores, a mensagem nova não aparece
 * (o refresh refaz a mesma `?antes=`) e quem envia de novo duplica a mensagem no prontuário: a tela vai para a conversa sem
 * `?antes=` (que abre rolada até o fim) e o foco só vai ao campo — ou ao socorro — depois que ela chega. Com um `?ok=` na
 * URL (nit 4), o foco vai já e a URL perde o retorno. Puro.
 */
export function depoisDoEnvio(o: Onde): { focarJa: boolean; irParaAConversa: boolean } {
  if (o.naAnterior) return { focarJa: false, irParaAConversa: true };
  return { focarJa: true, irParaAConversa: o.limpar === true };
}

/**
 * O passo depois do envio gravado (`depoisDoEnvio`) para os campos do painel e do portal: devolve a função que recebe o
 * foco a dar. Indo para a conversa (`router.replace`, sem rolar para o topo: a conversa rola até o fim sozinha), o foco
 * fica guardado e roda quando a página nova chega (`naAnterior` cai), com a lista nova na tela. O campo não remonta.
 */
export function useDepoisDoEnvio(conversa: string, onde: Onde): (focar: () => void) => void {
  const router = useRouter();
  const pendente = useRef<(() => void) | null>(null);
  const atual = useRef(onde);
  useEffect(() => {
    atual.current = onde;
  });
  useEffect(() => {
    if (onde.naAnterior || !pendente.current) return;
    const focar = pendente.current;
    pendente.current = null;
    focar();
  }, [onde.naAnterior]);
  return useCallback(
    (focar: () => void) => {
      const passo = depoisDoEnvio(atual.current);
      if (passo.focarJa) focar();
      else pendente.current = focar;
      if (passo.irParaAConversa) router.replace(conversa, { scroll: false });
    },
    [router, conversa],
  );
}
