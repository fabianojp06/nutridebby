'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CorpoSalvamento, RascunhoEnviado } from '@/modules/plano-alimentar/tipos';
import { comoSair, ehNavegacaoInterna } from './navegacao';
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
 * Conferência da revisão ao abrir: `paciente` do plano (nulo em modelo) e quem recarrega a página e remonta o editor
 * (`EditorPlano`) quando o servidor já está adiante.
 */
export type ConferirRevisao = { paciente: string | null; aoDesatualizar: (revisao: number) => void };

/**
 * D7: a cada edição (`edicoes` muda), espera 800 ms e envia o rascunho inteiro com a revisão atual.
 * Sem rede: "Alterações não salvas" e nova tentativa a cada 5 s e quando o navegador volta a ficar online.
 * Saída por link interno (US-022): o envio que o debounce segurava sai na hora; se a edição pode se perder
 * (conflito, última tentativa sem sucesso, ou envio em voo com edição esperando), pede confirmação antes.
 * Saída pelo botão "Sair" (`data-sair`, um formulário): o logout derrubaria o envio da desmontagem (401). Só o debounce
 * pendente: envia na hora, espera gravar e então sai (sem diálogo); falha, sem rede, erro de campo, conflito ou parado,
 * ou o envio que não gravou: pede confirmação (`comoSair`).
 * Com `conferir`: ao montar, confere se a revisão da página ainda é a do servidor (ver o efeito abaixo).
 */
export function useSalvamento(planId: string, revisaoInicial: number, montarEnvio: (revisao: number) => RascunhoEnviado, edicoes: number, conferir: ConferirRevisao | null = null) {
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

  const laco = useRef<Promise<void> | null>(null); // o laço de envio em andamento (o "Sair" espera por ele)
  const saindo = useRef(false); // a usuária escolheu sair (o envio do formulário "Sair" já foi decidido): sem pergunta do navegador
  const aguardandoSair = useRef(false); // "Sair" esperando o envio gravar: cliques repetidos não abrem outra espera

  const executar = useCallback(async () => {
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

  // Resolve quando o envio em andamento (e os que ele encadeiam) termina: o "Sair" espera por ele. Com um envio em voo,
  // a edição nova só marca `pendente` (o laço a envia depois) e devolve o laço que já corre.
  const salvar = useCallback((): Promise<void> => {
    if (parado.current) return Promise.resolve();
    if (emVoo.current) {
      pendente.current = true;
      return laco.current ?? Promise.resolve();
    }
    emVoo.current = true;
    laco.current = executar();
    return laco.current;
  }, [executar]);

  // O "Voltar" do navegador reaproveita a página que o App Router guardou (Next 16: as páginas "are reused during
  // browser back/forward navigation"), com o conteúdo e a revisão de quando ela foi aberta; outra aba também pode ter
  // gravado depois. Ao montar, consulta só a revisão (rota leve, sem auditoria). Servidor adiante, sem envio desta
  // tela a caminho (senão a revisão nova pode ser a dele): avisa quem recarrega a página e remonta o editor, em vez
  // de a primeira edição dar um falso "alterado em outra aba" por cima de um conteúdo velho.
  const paciente = conferir?.paciente ?? null;
  const aoDesatualizar = conferir?.aoDesatualizar;
  useEffect(() => {
    if (!aoDesatualizar) return;
    let vivo = true;
    void (async () => {
      try {
        const r = await fetch(`/api/painel/planos/${planId}/revisao${paciente ? `?paciente=${paciente}` : ''}`, { cache: 'no-store' });
        if (!vivo || !r.ok) return;
        const { revisao: doServidor } = (await r.json()) as { revisao: number };
        if (vivo && doServidor > revisao.current && !emVoo.current) aoDesatualizar(doServidor);
      } catch {
        // sem rede: segue com a página como está (se ela estiver velha, o salvamento mostra o conflito)
      }
    })();
    return () => {
      vivo = false;
    };
  }, [planId, paciente, aoDesatualizar]);

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
      if (saindo.current) return; // já escolheu sair (confirmou ou o envio gravou): o navegador não pergunta de novo
      if (status !== 'salvo' && status !== 'parado') e.preventDefault(); // parado: nada mais será salvo (e "Recarregar" não pergunta)
    };
    window.addEventListener('beforeunload', avisar);
    return () => window.removeEventListener('beforeunload', avisar);
  }, [status]);

  // Link interno quando o envio na saída não garante a edição: parado (não envia), última tentativa sem sucesso
  // (sem rede ou erro de campo: a próxima também falharia) ou PUT em voo com edição esperando. Captura no document,
  // antes do onClick do <Link>: cancelar no confirm impede a navegação.
  // O botão "Sair" (`data-sair`) é um formulário (POST /sair, página inteira), não um link: o logout acontece antes do
  // envio da desmontagem, que levaria 401. `comoSair` decide: tudo salvo sai direto; só o debounce pendente envia na
  // hora e espera gravar (sem diálogo) antes de enviar o formulário de saída; sem rede, erro de campo, conflito,
  // parado ou envio que não gravou pede confirmação (aceitar descarta a edição por escolha da usuária; offline, o
  // navegador mostra a página de sem conexão e a sessão segue até ela sair com rede).
  useEffect(() => {
    const sairDeVez = (form: HTMLFormElement) => {
      saindo.current = true;
      form.requestSubmit(); // não dispara `click`: o listener abaixo não intercepta de novo
    };
    const aoClicar = (e: MouseEvent) => {
      const alvo = e.target instanceof Element ? e.target : null;
      const botaoSair = !e.defaultPrevented ? alvo?.closest('[data-sair]') : null;
      if (botaoSair) {
        const form = botaoSair.closest('form');
        const saida = comoSair(status, { edicaoEsperando: agendado.current, falhou: falhou.current, parado: parado.current });
        if (!form || saida === 'direto') return;
        e.preventDefault();
        e.stopPropagation();
        if (saida === 'confirmar') {
          if (window.confirm(MSG_SAIR_SEM_SALVAR)) sairDeVez(form);
          return;
        }
        if (aguardandoSair.current) return;
        aguardandoSair.current = true;
        void (async () => {
          try {
            agendado.current = false; // o envio sai agora; o temporizador do debounce, se disparar, só repete o último estado
            await salvar().catch(() => undefined);
            const gravou = !parado.current && !falhou.current && !agendado.current && !emVoo.current;
            if (gravou || window.confirm(MSG_SAIR_SEM_SALVAR)) sairDeVez(form);
          } finally {
            aguardandoSair.current = false;
          }
        })();
        return;
      }
      const podePerder = parado.current || falhou.current || (emVoo.current && (pendente.current || agendado.current));
      if (!podePerder) return;
      const a = alvo ? alvo.closest('a[href]') : null;
      const link = a instanceof HTMLAnchorElement ? { href: a.href, target: a.target, temDownload: a.hasAttribute('download') } : null;
      if (!ehNavegacaoInterna(e, link, window.location.href) || window.confirm(MSG_SAIR_SEM_SALVAR)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener('click', aoClicar, true);
    return () => document.removeEventListener('click', aoClicar, true);
  }, [status, salvar]);

  return { status, erros, mensagem: status === 'parado' ? motivo : MENSAGEM[status] };
}
