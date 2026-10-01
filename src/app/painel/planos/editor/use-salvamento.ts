'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CorpoSalvamento, RascunhoEnviado } from '@/modules/plano-alimentar/tipos';
import { ehNavegacaoInterna } from './navegacao';
import { enviosIncertosDepois, interpretarResposta, type RespostaSalvamento } from './resposta';

/** `parado`: repetir não adianta (conflito entre abas, paciente bloqueado, versão publicada, sessão expirada, plano
 * que sumiu, corpo grande demais); a linha de salvamento mostra o motivo e o editor não insiste. */
export type StatusSalvamento = 'salvo' | 'salvando' | 'offline' | 'erro' | 'parado';

const MENSAGEM: Record<Exclude<StatusSalvamento, 'parado'>, string> = {
  salvo: 'Salvo',
  salvando: 'Salvando…',
  offline: 'Alterações não salvas',
  erro: 'Corrija os campos destacados para salvar.',
};
const ESPERA_MS = 800; // US-022: salvo em até 2 s
const REPETIR_MS = 5000;
const MSG_SAIR_SEM_SALVAR = 'Há alterações que ainda não foram salvas. Sair mesmo assim?';

/**
 * D7: a cada edição (`edicoes` muda), espera 800 ms e envia o rascunho inteiro com a revisão atual.
 * Sem rede: "Alterações não salvas" e nova tentativa a cada 5 s e quando o navegador volta a ficar online.
 * Saída por link interno (US-022): o envio que o debounce segurava sai na hora; se a edição pode se perder
 * (conflito, última tentativa sem sucesso, ou envio em voo com edição esperando), pede confirmação antes.
 */
export function useSalvamento(planId: string, revisaoInicial: number, montarEnvio: (revisao: number) => RascunhoEnviado, edicoes: number) {
  const [status, setStatus] = useState<StatusSalvamento>('salvo');
  const [motivo, setMotivo] = useState(''); // mensagem do `parado`
  const [erros, setErros] = useState<Record<string, string>>({});
  const revisao = useRef(revisaoInicial);
  const montar = useRef(montarEnvio);
  const atual = useRef(edicoes); // edições feitas até a última renderização
  useEffect(() => {
    montar.current = montarEnvio; // sempre o estado da última renderização, sem tocar em ref durante o render
    atual.current = edicoes;
  });
  const emVoo = useRef(false);
  const pendente = useRef(false);
  const parado = useRef(false); // não insiste (ver `parado` em StatusSalvamento)
  const falhou = useRef(false); // a última tentativa não salvou (sem rede ou erro de campo)
  // D7: os `envio` sem resposta confirmada desde o último "Salvo" (enviosIncertosDepois). Os PUT seguintes os levam:
  // se o último gravado é um deles (a resposta é que se perdeu), o servidor aceita a revisão antiga em vez de dar um
  // falso conflito.
  const incertos = useRef<string[]>([]);
  const agendado = useRef(false); // há edição esperando os 800 ms

  const salvar = useCallback(async () => {
    if (parado.current) return;
    if (emVoo.current) {
      pendente.current = true;
      return;
    }
    emVoo.current = true;
    try {
      // edição que chega com um envio em voo (`pendente`) é enviada logo depois, com a revisão nova
      do {
        pendente.current = false;
        setStatus('salvando');
        const enviadas = atual.current;
        const envio = crypto.randomUUID();
        const corpo: CorpoSalvamento = { ...montar.current(revisao.current), envio, ...(incertos.current.length ? { enviosIncertos: incertos.current } : {}) };
        let resposta: RespostaSalvamento;
        try {
          const r = await fetch(`/api/painel/planos/${planId}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(corpo),
          });
          resposta = interpretarResposta(r.status, await r.json().catch(() => null));
        } catch {
          resposta = { tipo: 'incerto' }; // sem rede, ou a resposta se perdeu no caminho
        }
        incertos.current = enviosIncertosDepois(incertos.current, envio, resposta);
        if (resposta.tipo === 'salvo') {
          revisao.current = resposta.revisao;
          falhou.current = false;
          setErros({});
          // "Salvo" só se nada foi digitado depois do envio (senão a edição nova ainda está por salvar)
          setStatus(pendente.current || atual.current !== enviadas ? 'salvando' : 'salvo');
        } else if (resposta.tipo === 'campos') {
          falhou.current = true;
          setErros(resposta.erros);
          setStatus('erro');
        } else if (resposta.tipo === 'parar') {
          parado.current = true;
          setMotivo(resposta.mensagem);
          setStatus('parado');
        } else {
          falhou.current = true;
          setStatus('offline');
        }
      } while (pendente.current && !parado.current);
    } finally {
      emVoo.current = false;
    }
  }, [planId]);

  // Nova edição: "Salvando…" já na renderização (padrão "ajustar estado ao mudar prop"); o `parado` não é apagado.
  const [vistas, setVistas] = useState(edicoes);
  if (edicoes !== vistas) {
    setVistas(edicoes);
    if (edicoes > 0) setStatus((s) => (s === 'parado' ? s : 'salvando'));
  }

  useEffect(() => {
    if (edicoes === 0) return;
    agendado.current = true;
    const t = setTimeout(() => {
      agendado.current = false;
      void salvar();
    }, ESPERA_MS);
    return () => clearTimeout(t);
  }, [edicoes, salvar]);

  // Navegação interna (a página desmonta): o envio que o debounce segurava sai na hora, em vez de ser cancelado. Um
  // fetch comum sobrevive à navegação do App Router; com um PUT em voo, `salvar` encadeia o envio depois dele (mesma
  // revisão, nunca dois PUT ao mesmo tempo). O setState de `salvar` depois de desmontado não faz nada (React 19).
  useEffect(
    () => () => {
      if (!agendado.current) return;
      agendado.current = false;
      void salvar();
    },
    [salvar],
  );

  useEffect(() => {
    if (status !== 'offline') return;
    const repetir = () => void salvar();
    const t = setInterval(repetir, REPETIR_MS);
    window.addEventListener('online', repetir);
    return () => {
      clearInterval(t);
      window.removeEventListener('online', repetir);
    };
  }, [status, salvar]);

  useEffect(() => {
    const avisar = (e: BeforeUnloadEvent) => {
      if (status !== 'salvo' && status !== 'parado') e.preventDefault(); // parado: nada mais será salvo (e "Recarregar" não pergunta)
    };
    window.addEventListener('beforeunload', avisar);
    return () => window.removeEventListener('beforeunload', avisar);
  }, [status]);

  // Link interno quando o envio na saída não garante a edição: parado (não envia), última tentativa sem sucesso
  // (sem rede ou erro de campo: a próxima também falharia) ou PUT em voo com edição esperando. Captura no document,
  // antes do onClick do <Link>: cancelar no confirm impede a navegação.
  useEffect(() => {
    const aoClicar = (e: MouseEvent) => {
      const podePerder = parado.current || falhou.current || (emVoo.current && (pendente.current || agendado.current));
      if (!podePerder) return;
      const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
      const link = a instanceof HTMLAnchorElement ? { href: a.href, target: a.target, temDownload: a.hasAttribute('download') } : null;
      if (!ehNavegacaoInterna(e, link, window.location.href) || window.confirm(MSG_SAIR_SEM_SALVAR)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener('click', aoClicar, true);
    return () => document.removeEventListener('click', aoClicar, true);
  }, []);

  return { status, erros, mensagem: status === 'parado' ? motivo : MENSAGEM[status] };
}
