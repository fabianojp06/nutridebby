import type { RespostaGeracao, TurnoIA, UsoTokens } from './provedor';

/**
 * Plano 14B (D1): o formato do laço de ferramentas, comum aos dois provedores reais (a API direta e o Bedrock falam a mesma
 * Messages API). Fica aqui, sem importar nenhum SDK (RNF-103: guarda em guardas.test.ts), para que a montagem do histórico
 * e a classificação da resposta (final, ferramentas, recusa ou cortada) nunca divirjam entre os provedores; cada provedor
 * só converte para o tipo do próprio SDK e informa o uso e o request-id.
 */

/** Um bloco do turno do usuário, no formato da API. */
export type BlocoDoUsuarioNaApi = { type: 'text'; text: string } | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: true };
/** Uma mensagem do histórico, no formato da API. O turno do assistente leva o bruto da resposta anterior, sem mudança. */
export type MensagemNaApi = { role: 'assistant'; content: unknown[] } | { role: 'user'; content: BlocoDoUsuarioNaApi[] };

/** O mínimo da resposta da API que a classificação lê (a mensagem dos dois SDKs encaixa nesse formato). */
export type RespostaNaApi = {
  stop_reason: string | null;
  stop_details?: { category?: string | null } | null;
  content: readonly { type: string; id?: string; name?: string; input?: unknown; text?: string }[];
};

/**
 * Os turnos do laço no formato da API. O do assistente volta como veio (o bruto da resposta anterior, com o raciocínio e a
 * assinatura) — nada é editado; o do usuário leva o texto e os resultados das ferramentas.
 */
export function mensagensDaGeracao(turnos: readonly TurnoIA[]): MensagemNaApi[] {
  return turnos.map(
    (t): MensagemNaApi =>
      t.papel === 'assistente'
        ? { role: 'assistant', content: t.bruto as unknown[] }
        : {
            role: 'user',
            content: t.blocos.map(
              (b): BlocoDoUsuarioNaApi =>
                b.tipo === 'texto' ? { type: 'text', text: b.texto } : { type: 'tool_result', tool_use_id: b.chamadaId, content: b.conteudo, ...(b.erro ? { is_error: true as const } : {}) },
            ),
          },
  );
}

/**
 * A resposta de uma volta: recusa e corte pelo stop_reason (como na leitura), ferramentas ou o texto final. `tool_use` sem
 * nenhuma chamada válida (com id e nome) vira `cortada`, para o laço não girar sem chamada; qualquer outro stop_reason que
 * não seja `end_turn` também.
 */
export function respostaDaGeracao(r: RespostaNaApi, uso: UsoTokens, requestId: string | null): RespostaGeracao {
  const base = { bruto: r.content, uso, requestId };
  if (r.stop_reason === 'refusal') return { tipo: 'recusa', categoria: r.stop_details?.category ?? null, ...base };
  if (r.stop_reason === 'tool_use') {
    const chamadas = r.content.flatMap((b) => (b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string' ? [{ id: b.id, nome: b.name, entrada: b.input }] : []));
    return chamadas.length ? { tipo: 'ferramentas', chamadas, ...base } : { tipo: 'cortada', ...base };
  }
  if (r.stop_reason !== 'end_turn') return { tipo: 'cortada', ...base };
  return { tipo: 'final', texto: r.content.map((b) => (b.type === 'text' && typeof b.text === 'string' ? b.text : '')).join(''), ...base };
}
