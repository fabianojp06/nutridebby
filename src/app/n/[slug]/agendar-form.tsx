'use client';

import Link from 'next/link';
import { useState } from 'react';
import { SeletorHorarios } from '@/components/seletor-horarios';
import { TurnstileWidget } from '@/components/turnstile-widget';
import { MSG_TURNSTILE_FORA, MSG_TURNSTILE_INVALIDO } from '@/lib/turnstile';
import { MSG_AGENDA, MSG_PUBLICO } from '@/modules/agenda/constantes';
import type { HorarioVisivel, Modalidade } from '@/modules/agenda/horarios';

type Props = {
  slug: string;
  siteKey: string;
  modalidadeInicial: Modalidade;
  temOnline: boolean;
  semana: { rotulo: string; anterior: string | null; proxima: string | null };
  horarios: HorarioVisivel[];
  termo: { titulo: string; paragrafos: string[]; rotulo: string };
};
type Resposta = { erro?: string; erros?: Record<string, string>; pedido?: string; estado?: 'agendada' | 'horario_ocupado'; quando?: string; horarios?: HorarioVisivel[] };
type Dados = { nome: string; email: string; telefone: string; whatsapp: boolean; maiorDeIdade: boolean; aceitouTermo: boolean };

async function enviar(url: string, corpo: unknown): Promise<{ status: number; r: Resposta }> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
    return { status: res.status, r: (await res.json().catch(() => ({}))) as Resposta };
  } catch {
    return { status: 0, r: { erro: MSG_TURNSTILE_FORA } };
  }
}

const texto = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');

/**
 * RN-16 em duas etapas: dados + Turnstile → código de 6 dígitos no e-mail → consulta. Se o horário foi ocupado no meio,
 * o pedido (já verificado) escolhe outro sem novo código.
 */
export function AgendarForm({ slug, siteKey, modalidadeInicial, temOnline, semana, horarios, termo }: Props) {
  const [etapa, setEtapa] = useState<'dados' | 'codigo' | 'outro' | 'pronto'>('dados');
  const [modalidade, setModalidade] = useState<Modalidade>(modalidadeInicial);
  const [token, setToken] = useState<string | null>(null);
  const [widget, setWidget] = useState(0);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erro, setErro] = useState('');
  const [pedido, setPedido] = useState('');
  const [dados, setDados] = useState<Dados | null>(null);
  const [outros, setOutros] = useState<HorarioVisivel[]>([]);
  const [quando, setQuando] = useState('');
  const [enviando, setEnviando] = useState(false);
  const aria = (k: string) => (erros[k] ? { 'aria-invalid': true as const, 'aria-describedby': `${k}-erro` } : {});
  const msg = (k: string) => erros[k] && <p id={`${k}-erro`} role="alert" className="text-sm text-red-700">{erros[k]}</p>;
  /** O token do Turnstile é de uso único: um widget novo gera outro. */
  const novoTurnstile = () => {
    setToken(null);
    setWidget((n) => n + 1);
  };

  function tratar(status: number, r: Resposta) {
    setErros(r.erros ?? {});
    setErro(r.erro ?? '');
    if (status === 200 && r.estado === 'agendada') {
      setQuando(r.quando ?? '');
      setEtapa('pronto');
    } else if (status === 200 && r.estado === 'horario_ocupado') {
      setOutros(r.horarios ?? []);
      setErro(MSG_AGENDA.ocupado);
      setEtapa('outro');
    } else if (status === 410) {
      novoTurnstile();
      setEtapa('dados'); // pedido vencido ou bloqueado: pedir um código novo
    }
  }

  async function pedirCodigo(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) return setErro(MSG_TURNSTILE_INVALIDO);
    const f = new FormData(e.currentTarget);
    const d: Dados = {
      nome: texto(f.get('nome')),
      email: texto(f.get('email')),
      telefone: texto(f.get('telefone')),
      whatsapp: f.get('whatsapp') === 'on',
      maiorDeIdade: f.get('maiorDeIdade') === 'on',
      aceitouTermo: f.get('aceitouTermo') === 'on',
    };
    setDados(d);
    setEnviando(true);
    const { status, r } = await enviar(`/api/n/${slug}/codigo`, { ...d, inicio: f.get('inicio'), modalidade, turnstileToken: token });
    setEnviando(false);
    if (status === 200 && r.pedido) {
      setPedido(r.pedido);
      setErros({});
      setErro('');
      setToken(null); // gasto
      setEtapa('codigo');
      return;
    }
    tratar(status, r);
    // 422: os campos são conferidos antes do Turnstile, então o token não foi gasto; nos outros casos, pode ter sido
    if (status !== 422) novoTurnstile();
  }

  async function confirmar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEnviando(true);
    const { status, r } = await enviar(`/api/n/${slug}/confirmar`, { pedido, codigo: new FormData(e.currentTarget).get('codigo') });
    setEnviando(false);
    tratar(status, r);
  }

  async function escolherOutro(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEnviando(true);
    const { status, r } = await enviar(`/api/n/${slug}/horario`, { pedido, inicio: new FormData(e.currentTarget).get('inicio'), modalidade });
    setEnviando(false);
    tratar(status, r);
  }

  const alerta = erro && <p role="alert" className="text-red-700">{erro}</p>;
  const botao = (rotulo: string, desligado = enviando) => (
    <button disabled={desligado} className="rounded bg-emerald-700 px-4 py-2 text-white disabled:opacity-60">
      {rotulo}
    </button>
  );

  if (etapa === 'pronto') return <p role="status" className="rounded bg-emerald-50 p-3">{MSG_PUBLICO.agendada(quando)}</p>;
  if (etapa === 'codigo') {
    return (
      <form method="post" onSubmit={confirmar} className="max-w-sm space-y-3">
        <p role="status">{MSG_PUBLICO.enviado(dados?.email ?? '')}</p>
        <label htmlFor="codigo" className="block font-medium">Código</label>
        <input id="codigo" name="codigo" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required className="w-full rounded border p-2" {...aria('codigo')} />
        {msg('codigo')}
        {alerta}
        {botao('Confirmar agendamento')}
      </form>
    );
  }
  if (etapa === 'outro') {
    return (
      <form method="post" onSubmit={escolherOutro} className="space-y-3">
        {alerta}
        <p className="font-medium">Escolha um horário</p>
        <SeletorHorarios horarios={outros} modalidade={modalidade} erro={erros.inicio} />
        {botao('Confirmar agendamento')}
      </form>
    );
  }
  const semanaHref = (s: string) => `/n/${slug}?semana=${s}&modalidade=${modalidade}`;
  return (
    <form method="post" onSubmit={pedirCodigo} className="space-y-4">
      {temOnline && (
        <fieldset className="space-y-1">
          <legend className="font-medium">Escolha a modalidade</legend>
          {(['presencial', 'online'] as const).map((m) => (
            <div key={m} className="flex items-center gap-2">
              <input id={`mod-${m}`} type="radio" name="modalidade" value={m} checked={modalidade === m} onChange={() => setModalidade(m)} />
              <label htmlFor={`mod-${m}`}>{m === 'presencial' ? 'Presencial' : 'Online'}</label>
            </div>
          ))}
        </fieldset>
      )}
      <section aria-labelledby="horario" className="space-y-2">
        <h2 id="horario" className="text-lg font-semibold">Escolha o horário</h2>
        <nav aria-label="Semana" className="flex gap-3 text-sm">
          {semana.anterior && <Link href={semanaHref(semana.anterior)} className="underline">Semana anterior</Link>}
          <span>{semana.rotulo}</span>
          {semana.proxima && <Link href={semanaHref(semana.proxima)} className="underline">Próxima semana</Link>}
        </nav>
        <SeletorHorarios horarios={horarios} modalidade={modalidade} erro={erros.inicio} />
      </section>
      <section aria-labelledby="dados" className="max-w-md space-y-3">
        <h2 id="dados" className="text-lg font-semibold">Seus dados</h2>
        {(
          [
            ['nome', 'Nome', 'text', 'name'],
            ['email', 'E-mail', 'email', 'email'],
            ['telefone', 'Telefone (opcional)', 'tel', 'tel'],
          ] as const
        ).map(([id, rotulo, type, auto]) => (
          <div key={id} className="space-y-1">
            <label htmlFor={id} className="block font-medium">{rotulo}</label>
            <input id={id} name={id} type={type} autoComplete={auto} required={id !== 'telefone'} maxLength={id === 'email' ? 254 : 120} defaultValue={dados?.[id]} className="w-full rounded border p-2" {...aria(id)} />
            {msg(id)}
          </div>
        ))}
        <div className="flex items-start gap-2">
          <input id="whatsapp" name="whatsapp" type="checkbox" defaultChecked={dados?.whatsapp} className="mt-1" />
          <label htmlFor="whatsapp">Quero receber lembretes por WhatsApp</label>
        </div>
        <div className="flex items-start gap-2">
          <input id="maiorDeIdade" name="maiorDeIdade" type="checkbox" defaultChecked={dados?.maiorDeIdade} className="mt-1" {...aria('maiorDeIdade')} />
          <label htmlFor="maiorDeIdade">Tenho 18 anos ou mais</label>
        </div>
        {msg('maiorDeIdade')}
        <section aria-labelledby="termo-titulo" tabIndex={0} className="max-h-48 space-y-2 overflow-y-auto rounded border p-3 text-sm">
          <h3 id="termo-titulo" className="font-semibold">{termo.titulo}</h3>
          {termo.paragrafos.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </section>
        <div className="flex items-start gap-2">
          <input id="aceitouTermo" name="aceitouTermo" type="checkbox" defaultChecked={dados?.aceitouTermo} className="mt-1" {...aria('aceitouTermo')} />
          <label htmlFor="aceitouTermo">{termo.rotulo}</label>
        </div>
        {msg('aceitouTermo')}
        <TurnstileWidget key={widget} siteKey={siteKey} onToken={setToken} onIndisponivel={() => setErro(MSG_TURNSTILE_FORA)} />
        {alerta}
        {botao('Enviar código', enviando || !token)}
      </section>
    </form>
  );
}
