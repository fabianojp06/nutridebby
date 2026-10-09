'use client';
import { useState } from 'react';

type Situacao = { id: string; nome: string; situacao: string };

/** O texto a anunciar: só os envios que já estavam na lista e mudaram de situação ("Nome: situação"); vazio se nada mudou. */
export function anuncioDasMudancas(antes: readonly Situacao[], depois: readonly Situacao[]): string {
  const anterior = new Map(antes.map((e) => [e.id, e.situacao]));
  return depois
    .filter((e) => anterior.has(e.id) && anterior.get(e.id) !== e.situacao)
    .map((e) => `${e.nome}: ${e.situacao}`)
    .join('. ');
}

/**
 * Hotfix de 09/10/2026 (RNF-10): quando o router.refresh() (AtualizarEnquantoProcessa) traz uma situação nova — o worker
 * terminou —, o leitor de tela ouve "Nome: situação" sem o foco sair do lugar. Uma região única, sempre montada e vazia
 * na abertura (região viva inserida já com texto pode não ser anunciada; uma por linha seria anunciada inteira, como no
 * diário); o texto só muda quando alguma situação muda, então refresh igual não anuncia nada. A lista anterior fica em
 * estado e é comparada na renderização (sem efeito).
 */
export function AnunciarSituacoes({ envios }: { envios: Situacao[] }) {
  const [antes, setAntes] = useState(envios);
  const [aviso, setAviso] = useState('');
  if (antes !== envios) {
    setAntes(envios);
    const novo = anuncioDasMudancas(antes, envios);
    if (novo) setAviso(novo);
  }
  return <p role="status" className="sr-only">{aviso}</p>;
}
