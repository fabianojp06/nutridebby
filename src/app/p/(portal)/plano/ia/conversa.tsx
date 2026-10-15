'use client';
import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useOnline } from '@/components/portal/online';
import { CONSULTA_AUTOMATICA } from '@/lib/consulta-automatica';
import { CONSULTA_LENTA_MS, CONSULTA_RAPIDA_MS, MAX_PERGUNTA, MSG_IA_NUTRI, SESSAO_MS } from '@/modules/ia/nutri-paciente/constantes';
import type { MensagemDoPaciente } from '@/modules/ia/nutri-paciente/conversa';
import type { CodigoTextoFixo } from '@/modules/ia/nutri-paciente/textos';
import { avaliarAction, encaminharAction, enviarANutriAction, perguntarAction, type RetornoConversa } from './actions';
import { TextoFixo } from './texto-fixo';

/** RNF-160: 5 s nas primeiras 12 consultas (1 min), depois 30 s. */
export const proximoIntervalo = (consultas: number): number => (consultas < 12 ? CONSULTA_RAPIDA_MS : CONSULTA_LENTA_MS);

/**
 * Qual pergunta ganha "Enviar para minha nutricionista" no item `i` (US-172, §7.5): abaixo da RESPOSTA (montada ou texto
 * fixo) da pergunta que ainda pode ser encaminhada; na própria pergunta quando ela falhou sem resposta gravada. A de risco
 * nunca (`podeEncaminhar` é falso: ela já foi à fila sozinha).
 */
export function encaminharNoItem(ms: readonly MensagemDoPaciente[], i: number): string | null {
  const m = ms[i];
  const antes = ms[i - 1];
  if (m.autor === 'ia' && antes?.autor === 'paciente' && antes.podeEncaminhar) return antes.id;
  if (m.autor === 'paciente' && m.podeEncaminhar && ms[i + 1]?.autor !== 'ia') return m.id;
  return null;
}

/** Depois de perguntar ou enviar: o campo esvazia quando a pergunta foi gravada; "Pensando…" só quando ela vai à IA. */
export function estadoDoRetorno(r: RetornoConversa): { limpar: boolean; aviso: string; textoFixo: CodigoTextoFixo | null } {
  return { limpar: !!r.limpar, aviso: r.aviso ?? (r.limpar ? MSG_IA_NUTRI.pensando : ''), textoFixo: r.textoFixo ?? null };
}

/** "A resposta chegou." quando a pergunta em andamento termina (comparação na renderização, como AnunciarSituacoes). */
export const chegouResposta = (andavaAntes: boolean, emAndamento: boolean): boolean => andavaAntes && !emAndamento;

/** UMA região de status para tudo (RNF-167): sem conexão vence; pergunta em andamento ou envio em curso → "Pensando…". */
export function textoDoStatus(o: { online: boolean; emAndamento: boolean; enviando: boolean; aviso: string }): string {
  if (!o.online) return MSG_IA_NUTRI.semConexao;
  return o.emAndamento || o.enviando ? MSG_IA_NUTRI.pensando : o.aviso;
}

const CAIXA = 'rounded-xl border border-borda p-3 text-sm';
const BOTAO = 'min-h-11 rounded-xl border border-borda bg-cartao px-4 disabled:opacity-60';

/**
 * RNF-167 (§7.8): rótulo visível "Sua dúvida" e contador por aria-describedby (sem anunciar a cada tecla); UMA região
 * `role="status"` sempre montada (molde de exames/anunciar-situacoes.tsx, hotfix de 09/10/2026) para "Pensando…", "Sem
 * conexão…", "A resposta chegou.", os retornos de Enviar/Avaliar e os erros — o foco vai para ela depois de cada envio
 * (nunca fica num botão desabilitado ou que saiu); mensagens em <ol> com o autor em texto; a IA sem a borda de destaque das
 * mensagens da nutricionista; alvos ≥ 44 px; nada da pergunta guardado no aparelho (nenhum armazenamento do navegador). `podePerguntar`
 * falso (indisponível, sem plano, desativada): a conversa só para ler — sem campo, sem avaliar e sem encaminhar.
 */
export function Conversa({ tenantId, mensagens, podePerguntar, sessaoNova, textoInicial }: {
  tenantId: string;
  mensagens: MensagemDoPaciente[];
  podePerguntar: boolean;
  sessaoNova: boolean;
  textoInicial: string | null;
}) {
  const router = useRouter();
  const online = useOnline();
  const contadorId = useId();
  const [texto, setTexto] = useState(textoInicial ?? '');
  const [aviso, setAviso] = useState('');
  const [textoFixoSemMensagem, setTextoFixoSemMensagem] = useState<CodigoTextoFixo | null>(null);
  // /code-review do PR #37: avaliar e encaminhar mudam o item AQUI, sem reler a conversa (cada releitura é um auditRead)
  const [avaliadas, setAvaliadas] = useState<ReadonlySet<string>>(() => new Set());
  const [encaminhadas, setEncaminhadas] = useState<ReadonlySet<string>>(() => new Set());
  const [enviando, iniciar] = useTransition();
  const status = useRef<HTMLParagraphElement>(null);
  const ultimaRef = useRef<HTMLLIElement>(null);
  const emAndamento = mensagens.some((m) => m.autor === 'paciente' && (m.status === 'na_fila' || m.status === 'processando'));

  const [andavaAntes, setAndavaAntes] = useState(emAndamento);
  if (andavaAntes !== emAndamento) {
    setAndavaAntes(emAndamento);
    if (chegouResposta(andavaAntes, emAndamento)) setAviso(MSG_IA_NUTRI.respostaChegou);
  }

  useEffect(() => {
    if (!emAndamento) return;
    let consultas = 0;
    let parado = false;
    let t: ReturnType<typeof setTimeout>;
    const consultar = async () => {
      if (parado) return;
      if (document.visibilityState === 'visible') {
        consultas += 1;
        const r = await fetch('/api/p/ia-nutri/situacao', CONSULTA_AUTOMATICA).catch(() => null);
        const lista = r?.ok ? ((await r.json().catch(() => null)) as { id: string; status: string }[] | null) : null;
        if (parado) return;
        // a única releitura automática da conversa (um auditRead): quando nenhuma pergunta está mais em andamento
        if (lista && !lista.some((x) => x.status === 'na_fila' || x.status === 'processando')) return router.refresh();
      }
      t = setTimeout(consultar, proximoIntervalo(consultas));
    };
    t = setTimeout(consultar, CONSULTA_RAPIDA_MS);
    return () => {
      parado = true;
      clearTimeout(t);
    };
  }, [emAndamento, router]);

  // a resposta nova aparece no fim da lista: rolar até ela quando chega (sem tirar o foco da região de status)
  useEffect(() => {
    if (aviso === MSG_IA_NUTRI.respostaChegou) ultimaRef.current?.scrollIntoView({ block: 'nearest' });
  }, [aviso]);

  /**
   * Depois de qualquer envio: o texto no status e o foco nele. Sem refresh do roteador aqui (/code-review do PR #37):
   * perguntar e enviar direto já chamam `revalidatePath('/p/plano/ia')`, que numa Server Action atualiza a tela na mesma
   * ida (Next 16, `revalidatePath.md`, "Updates the UI immediately") — um refresh a mais relia a conversa outra vez, e cada
   * leitura grava um "Visualizou — IA Nutri" (auditRead de conversaDoPaciente). Avaliar e encaminhar não releem nada:
   * `marcar` muda o item pelo estado local.
   */
  const concluir = (r: RetornoConversa, marcar?: { avaliada?: string; encaminhada?: string }) => {
    const e = estadoDoRetorno(r);
    if (e.limpar) setTexto('');
    setTextoFixoSemMensagem(e.textoFixo);
    setAviso(e.aviso);
    if (r.feito && marcar?.avaliada) setAvaliadas((s) => new Set(s).add(marcar.avaliada!));
    if (r.feito && marcar?.encaminhada) setEncaminhadas((s) => new Set(s).add(marcar.encaminhada!));
    status.current?.focus();
  };
  const enviar = (acao: typeof perguntarAction | typeof enviarANutriAction) => {
    const fd = new FormData();
    fd.set('texto', texto);
    iniciar(async () => concluir(await acao(tenantId, fd)));
  };

  const vazio = !texto.trim();
  return (
    <div className="space-y-4">
      <ol className="space-y-3" aria-label="Conversa">
        {mensagens.map((m, i) => {
          const criada = new Date(m.criadaEm).getTime();
          const novaSessao = i === 0 || criada - new Date(mensagens[i - 1].criadaEm).getTime() > SESSAO_MS;
          const encaminharId = podePerguntar ? encaminharNoItem(mensagens, i) : null;
          const comConteudo = !!(m.texto || m.textoFixo);
          return (
            <li key={m.id} ref={i === mensagens.length - 1 ? ultimaRef : undefined} className="space-y-2">
              {novaSessao && <p className="rounded-xl bg-p-clara p-3 text-sm">{MSG_IA_NUTRI.avisoInicio}</p>}
              <div className={m.autor === 'paciente' ? 'ml-4 space-y-1 rounded-xl bg-cartao p-3' : 'space-y-1'}>
                <p className="text-sm font-semibold">{m.autor === 'paciente' ? MSG_IA_NUTRI.autorPaciente : m.autor === 'ia' ? MSG_IA_NUTRI.autorIa : MSG_IA_NUTRI.autorSistema}</p>
                {m.texto && <p className="whitespace-pre-line wrap-break-word">{m.texto}</p>}
                {m.textoFixo && <TextoFixo codigo={m.textoFixo} />}
                {!comConteudo && <p className="text-suave">{MSG_IA_NUTRI.apagada}</p>}
                {m.autor === 'ia' && comConteudo && <p className="text-sm text-suave">{MSG_IA_NUTRI.rodapeResposta}</p>}
              </div>
              {podePerguntar && m.autor === 'ia' && comConteudo && (m.avaliacao || avaliadas.has(m.id)
                ? <p className="text-sm">{MSG_IA_NUTRI.avaliado}</p>
                : <Avaliar tenantId={tenantId} mensagemId={m.id} aoConcluir={(r) => concluir(r, { avaliada: m.id })} />)}
              {/* US-174: o estado da dúvida fica na conversa (também depois de recarregar); a pergunta com risco já está na
                  fila e o texto fixo de risco fala do consultório: sem o "Pronto!…" sob ela (D11) */}
              {m.autor === 'paciente' && !m.risco && (m.duvida === 'aberta' || (m.duvida === null && encaminhadas.has(m.id))) && <p className={CAIXA}>{MSG_IA_NUTRI.encaminhada}</p>}
              {m.autor === 'paciente' && m.duvida === 'vista' && <p className={CAIXA}>{MSG_IA_NUTRI.duvidaVista}</p>}
              {encaminharId && !encaminhadas.has(encaminharId) && <Encaminhar tenantId={tenantId} perguntaId={encaminharId} aoConcluir={(r) => concluir(r, { encaminhada: encaminharId })} />}
            </li>
          );
        })}
        {/* RN-173: sessão nova (conversa vazia ou última mensagem há mais de 30 min) → a abertura ANTES de perguntar */}
        {sessaoNova && <li className="rounded-xl bg-p-clara p-3 text-sm">{MSG_IA_NUTRI.avisoInicio}</li>}
      </ol>
      {textoFixoSemMensagem && (
        <div className="space-y-1">
          <p className="text-sm font-semibold">{MSG_IA_NUTRI.autorIa}</p>
          <TextoFixo codigo={textoFixoSemMensagem} />
        </div>
      )}
      <p ref={status} tabIndex={-1} role="status" className="text-sm">{textoDoStatus({ online, emAndamento, enviando, aviso })}</p>
      {podePerguntar && (
        // method="post": tocado antes da hidratação, o navegador nunca põe a pergunta na URL (formularios-post.test.ts, regra 3)
        <form
          method="post"
          onSubmit={(e) => {
            e.preventDefault();
            enviar(perguntarAction);
          }}
          className="space-y-2"
        >
          <label htmlFor="duvida" className="block font-semibold">{MSG_IA_NUTRI.campo}</label>
          <textarea
            id="duvida"
            name="texto"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            maxLength={MAX_PERGUNTA}
            aria-describedby={contadorId}
            rows={3}
            autoComplete="off"
            className="w-full rounded-xl border border-borda bg-cartao p-3"
          />
          <p id={contadorId} className="text-sm text-suave">{MSG_IA_NUTRI.contador(Array.from(texto).length)}</p>
          <div className="flex flex-wrap gap-2">
            <button disabled={!online || enviando || emAndamento || vazio} className="min-h-11 rounded-xl bg-destaque px-4 font-semibold text-white disabled:opacity-60">
              {MSG_IA_NUTRI.enviar}
            </button>
            {/* DP-16: direto à fila — também com o limite do dia/mês ou a cota esgotada */}
            <button type="button" onClick={() => enviar(enviarANutriAction)} disabled={!online || enviando || vazio} className={BOTAO}>
              {MSG_IA_NUTRI.enviarDireto}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/** "Ajudou" / "Não ajudou" (US-172): o retorno vai para a região de status do `Conversa`, que continua montada quando os botões saem. */
function Avaliar({ tenantId, mensagemId, aoConcluir }: { tenantId: string; mensagemId: string; aoConcluir: (r: RetornoConversa) => void }) {
  const online = useOnline();
  const [pendente, iniciar] = useTransition();
  const avaliar = (valor: 'ajudou' | 'nao_ajudou') => iniciar(async () => aoConcluir(await avaliarAction(tenantId, mensagemId, valor)));
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => avaliar('ajudou')} disabled={!online || pendente} className={BOTAO}>
        {MSG_IA_NUTRI.ajudou}
      </button>
      <button type="button" onClick={() => avaliar('nao_ajudou')} disabled={!online || pendente} className={BOTAO}>
        {MSG_IA_NUTRI.naoAjudou}
      </button>
    </div>
  );
}

/** "Enviar para minha nutricionista" (US-174): a pergunta vai à fila; o botão sai pelo estado local quando o retorno traz `feito`. */
function Encaminhar({ tenantId, perguntaId, aoConcluir }: { tenantId: string; perguntaId: string; aoConcluir: (r: RetornoConversa) => void }) {
  const online = useOnline();
  const [pendente, iniciar] = useTransition();
  return (
    <button type="button" onClick={() => iniciar(async () => aoConcluir(await encaminharAction(tenantId, perguntaId)))} disabled={!online || pendente} className={BOTAO}>
      {MSG_IA_NUTRI.encaminhar}
    </button>
  );
}
