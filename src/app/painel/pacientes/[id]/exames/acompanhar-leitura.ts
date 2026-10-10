import { CONSULTA_AUTOMATICA } from '@/lib/consulta-automatica';
import { ACOMPANHAR_IA_MAX_MS, POLL_IA_LENTO_MS, POLL_IA_MS, POLL_IA_RAPIDO_VEZES } from '@/modules/ia/constantes';

/**
 * RNF-100: enquanto a tarefa da IA (leitura do laudo, `/api/painel/ia/tarefas/{id}`, ou pacote de modelos, Plano 14B,
 * `/api/painel/ia/geracoes/{id}` — os mesmos nomes de situação) está na fila ou em andamento, consulta só a situação (GET sem auditoria e, P12-14, sem contar como uso da sessão): a cada 3 s nas
 * primeiras 60 vezes, depois a cada 15 s, até a tarefa não poder mais estar em andamento (ACOMPANHAR_IA_MAX_MS). Quando
 * a situação muda, chama `aoMudar` uma vez e para. Uma consulta de cada vez (a próxima só é agendada depois da resposta).
 * Devolve a função que para (desmontagem do componente).
 */
export function acompanharLeitura(url: string, aoMudar: () => void, buscar: typeof fetch = fetch, agora: () => number = Date.now): () => void {
  const fim = agora() + ACOMPANHAR_IA_MAX_MS;
  let consultas = 0;
  let ativo = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const agendar = () => {
    if (!ativo) return;
    const espera = consultas < POLL_IA_RAPIDO_VEZES ? POLL_IA_MS : POLL_IA_LENTO_MS;
    if (agora() + espera > fim) return;
    timer = setTimeout(consultar, espera);
  };
  const consultar = async () => {
    consultas++;
    try {
      const r = await buscar(url, CONSULTA_AUTOMATICA);
      if (ativo && r.ok) {
        const { status } = (await r.json()) as { status: string };
        if (ativo && status !== 'na_fila' && status !== 'processando') {
          ativo = false;
          aoMudar();
          return;
        }
      }
    } catch {
      // sem rede: tenta na próxima vez
    }
    agendar();
  };
  agendar();
  return () => {
    ativo = false;
    clearTimeout(timer);
  };
}
