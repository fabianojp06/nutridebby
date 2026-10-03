import { pedidoNaoSaiu } from '@/lib/rede';
import { chaveDoWebhook } from './jwt';
import { e164DoJid, WhatsappIndisponivelError, type CodigoFalha, type ProvedorWhatsapp, type ResultadoEnvio } from './provedor';

export const EVENTOS_WEBHOOK = ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE'] as const;

type Opcoes = { url: string; apiKey: string; webhookUrl: string; webhookSecret?: string; fetchImpl?: typeof fetch; timeoutMs?: number };
type Resposta = { status: number; json: unknown; texto: string };
const falha = (definitivo: boolean, codigo: CodigoFalha): ResultadoEnvio => ({ ok: false, definitivo, codigo });

/**
 * D1: cliente HTTP da Evolution API v2.3.7 (Baileys). Corpo do sendText conforme o DTO da v2
 * (`{ number, text }`; a página da documentação ainda mostra `textMessage.text`, formato da v1).
 * Respostas nunca são logadas (trazem número, QR e o token da instância).
 */
export function evolutionProvedor(o: Opcoes): ProvedorWhatsapp {
  const base = o.url.replace(/\/+$/, '');
  const f = o.fetchImpl ?? fetch;
  const inst = (i: string) => encodeURIComponent(i);

  async function chamar(metodo: 'GET' | 'POST' | 'DELETE', caminho: string, corpo?: unknown): Promise<Resposta> {
    const res = await f(`${base}${caminho}`, {
      method: metodo,
      headers: { apikey: o.apiKey, ...(corpo === undefined ? {} : { 'content-type': 'application/json' }) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(o.timeoutMs ?? 10_000), // INT-01: 10 s
    });
    const texto = await res.text();
    let json: unknown = null;
    try {
      json = texto ? JSON.parse(texto) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json, texto };
  }

  /** Chamada que precisa dar certo: falha vira WhatsappIndisponivelError só com o nome do erro ou o status HTTP. */
  async function exigir(metodo: 'GET' | 'POST' | 'DELETE', caminho: string, corpo?: unknown, aceitar: number[] = []): Promise<Resposta> {
    let r: Resposta;
    try {
      r = await chamar(metodo, caminho, corpo);
    } catch (e) {
      throw new WhatsappIndisponivelError(`Evolution sem resposta (${e instanceof Error ? e.name : 'erro'})`);
    }
    if (r.status >= 300 && !aceitar.includes(r.status)) throw new WhatsappIndisponivelError(`Evolution respondeu HTTP ${r.status}`);
    return r;
  }

  return {
    nome: 'evolution',
    async enviarTexto(e) {
      let r: Resposta;
      try {
        r = await chamar('POST', `/message/sendText/${inst(e.instancia)}`, { number: e.numero, text: e.texto, delay: 1200, linkPreview: false });
      } catch (err) {
        // timeout (10 s, inclusive lendo a resposta) e conexão derrubada podem ter saído: definitivo. Só a falha de conexão repete.
        return pedidoNaoSaiu(err) ? falha(false, 'indisponivel') : falha(true, 'sem_resposta');
      }
      if (r.status === 200 || r.status === 201) {
        const k = (r.json as { key?: { id?: unknown; remoteJid?: unknown } } | null)?.key;
        return typeof k?.id === 'string' && typeof k.remoteJid === 'string' ? { ok: true, id: k.id, jid: k.remoteJid } : falha(true, 'resposta_invalida');
      }
      if (r.status === 400) return falha(true, /"exists"\s*:\s*false/.test(r.texto) ? 'numero_sem_whatsapp' : 'recusado');
      if (r.status === 401 || r.status === 403) return falha(true, 'nao_autorizado');
      if (r.status === 404) return falha(true, 'instancia_inexistente');
      return falha(false, 'indisponivel');
    },

    async conectar(instancia) {
      if (!o.webhookSecret) throw new WhatsappIndisponivelError('EVOLUTION_WEBHOOK_SECRET ausente');
      const atual = await exigir('GET', `/instance/connectionState/${inst(instancia)}`, undefined, [404]);
      if (atual.status === 404) {
        await exigir('POST', '/instance/create', {
          instanceName: instancia,
          integration: 'WHATSAPP-BAILEYS',
          qrcode: true,
          groupsIgnore: true,
          rejectCall: false,
          alwaysOnline: false,
          readMessages: false,
          readStatus: false,
          syncFullHistory: false,
        });
      }
      // D4: a cada conexão o webhook é (re)configurado — troca de segredo ou de URL vale a partir daqui. O jwt_key é o
      // DESTA instância (derivado do segredo-mestre): o JWT que a Evolution gera só vale para ela (D4 a).
      await exigir('POST', `/webhook/set/${inst(instancia)}`, {
        webhook: { enabled: true, url: o.webhookUrl, headers: { jwt_key: chaveDoWebhook(o.webhookSecret, instancia) }, byEvents: false, base64: false, events: [...EVENTOS_WEBHOOK] },
      });
      const q = await exigir('GET', `/instance/connect/${inst(instancia)}`);
      const j = q.json as { base64?: unknown; instance?: { state?: unknown } } | null;
      if (j?.instance?.state === 'open') return { estado: 'conectada' };
      if (typeof j?.base64 === 'string' && j.base64.startsWith('data:image/png;base64,')) return { estado: 'qr', qr: j.base64 };
      throw new WhatsappIndisponivelError('Evolution não devolveu o QR code');
    },

    async estado(instancia) {
      const r = await exigir('GET', `/instance/fetchInstances?instanceName=${inst(instancia)}`, undefined, [404]);
      // só a linha DESTA instância: se o filtro fosse ignorado, o número de outro consultório nunca entra aqui
      const lista: unknown[] = r.status !== 404 && Array.isArray(r.json) ? r.json : [];
      const i = lista.find((x): x is { connectionStatus?: unknown; ownerJid?: unknown } => (x as { name?: unknown } | null)?.name === instancia);
      if (!i) return { estado: 'desconectada', numero: null };
      const estado = i.connectionStatus === 'open' ? 'conectada' : i.connectionStatus === 'connecting' ? 'conectando' : 'desconectada';
      return { estado, numero: typeof i.ownerJid === 'string' ? e164DoJid(i.ownerJid) : null };
    },

    async desconectar(instancia) {
      // 400 = já não estava conectada; 404 = a instância não existe — nos dois casos, desconectada
      await exigir('DELETE', `/instance/logout/${inst(instancia)}`, undefined, [400, 404]);
    },
  };
}
