'use client';

import { startTransition, useActionState, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Botao } from '@/components/ui/botao';
import type { ConfigAgua, ConfigHorarios, ConfigRefeicoes, DiaDaSemana, LembreteNovo } from '@/modules/lembretes/config';
import { INTERVALOS_AGUA, MAX_HORARIOS, rotuloDoIntervalo, TEXTO_MAX } from '@/modules/lembretes/constantes';
import { salvarLembreteAction, type FormLembreteState } from './actions';

/** Semana na ordem seg…dom (0 = domingo): o nome curto à vista e o completo como nome acessível. */
const DIAS: { valor: DiaDaSemana; curto: string; nome: string }[] = [
  { valor: 1, curto: 'Seg', nome: 'Segunda-feira' },
  { valor: 2, curto: 'Ter', nome: 'Terça-feira' },
  { valor: 3, curto: 'Qua', nome: 'Quarta-feira' },
  { valor: 4, curto: 'Qui', nome: 'Quinta-feira' },
  { valor: 5, curto: 'Sex', nome: 'Sexta-feira' },
  { valor: 6, curto: 'Sáb', nome: 'Sábado' },
  { valor: 0, curto: 'Dom', nome: 'Domingo' },
];
const ANTECEDENCIA: [string, string][] = [['0', 'Na hora'], ['15', '15 min antes'], ['30', '30 min antes']];
const DIARIO: [string, string][] = [['', 'Não pedir'], ['30', '30 min depois'], ['60', '60 min depois']];
const DICA_TEXTO = 'Aparece só dentro do app, nunca na tela de bloqueio do celular.';
const AJUDA_SUPLEMENTO = 'O lembrete não substitui a prescrição: composição, via e posologia vão na receita e no prontuário.';
/** NORMAS-F2 (TRI-17-20 #62): a ajuda fixa também no lembrete livre (texto provisório, a revisar pela Debby). */
const AJUDA_LIVRE = 'O lembrete não substitui a prescrição nem as orientações registradas no prontuário.';
/** As chaves de erro que cada tipo mostra ao lado do campo; as outras (`geral`, `tipo`) vão junto do Salvar. */
const CAMPOS: Record<LembreteNovo['tipo'], string[]> = {
  agua: ['inicio', 'fim', 'intervaloMin', 'dias'],
  refeicoes: ['antecedenciaMin', 'diarioDepoisMin'],
  suplemento: ['texto', 'horarios', 'dias'],
  livre: ['texto', 'horarios', 'dias'],
};
const CAMPO = 'w-full rounded-xl border border-campo bg-cartao p-2 text-texto';

const descricao = (...ids: (string | false | undefined)[]) => ids.filter(Boolean).join(' ') || undefined;

function Erro({ id, children }: { id: string; children?: string }) {
  return children ? <p id={id} role="alert" className="text-sm text-erro">{children}</p> : null;
}

function Selecao({ id, nome, rotulo, valor, opcoes, erro, aoMudar }: { id: string; nome: string; rotulo: string; valor: string; opcoes: [string, string][]; erro?: string; aoMudar: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block font-medium">{rotulo}</label>
      <select id={id} name={nome} value={valor} onChange={(e) => aoMudar(e.target.value)} aria-invalid={erro ? true : undefined} aria-describedby={descricao(erro && `${id}-erro`)} className={`${CAMPO} min-h-11`}>
        {opcoes.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
      </select>
      <Erro id={`${id}-erro`}>{erro}</Erro>
    </div>
  );
}

function Hora({ id, nome, rotulo, valor, erro, aoMudar }: { id: string; nome: string; rotulo: string; valor: string; erro?: string; aoMudar: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block font-medium">{rotulo}</label>
      <input id={id} name={nome} type="time" value={valor} onChange={(e) => aoMudar(e.target.value)} aria-invalid={erro ? true : undefined} aria-describedby={descricao(erro && `${id}-erro`)} className={`${CAMPO} min-h-11`} />
      <Erro id={`${id}-erro`}>{erro}</Erro>
    </div>
  );
}

function Dias({ id, dias, erro, aoMudar }: { id: string; dias: DiaDaSemana[]; erro?: string; aoMudar: (d: DiaDaSemana[]) => void }) {
  return (
    <fieldset aria-describedby={descricao(erro && `${id}-erro`)} className="space-y-1">
      <legend className="font-medium">Dias da semana</legend>
      <div className="flex flex-wrap gap-2">
        {DIAS.map((d) => (
          <label key={d.valor} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-campo px-3">
            <input
              type="checkbox"
              name="dias"
              value={d.valor}
              checked={dias.includes(d.valor)}
              onChange={(e) => aoMudar(e.target.checked ? [...dias, d.valor] : dias.filter((x) => x !== d.valor))}
              aria-invalid={erro ? true : undefined}
              className="size-5"
            />
            <span aria-hidden="true">{d.curto}</span>
            <span className="sr-only">{d.nome}</span>
          </label>
        ))}
      </div>
      <Erro id={`${id}-erro`}>{erro}</Erro>
    </fieldset>
  );
}

function Horarios({ id, horarios, erro, aoMudar }: { id: string; horarios: string[]; erro?: string; aoMudar: (h: string[]) => void }) {
  const campos = useRef<(HTMLInputElement | null)[]>([]);
  const focar = useRef<number | null>(null);
  useEffect(() => {
    if (focar.current === null) return;
    campos.current[focar.current]?.focus();
    focar.current = null;
  });
  return (
    <fieldset aria-describedby={descricao(erro && `${id}-erro`)} className="space-y-2">
      <legend className="font-medium">Horários</legend>
      {horarios.map((h, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label htmlFor={`${id}-${i}`} className="block text-sm">Horário {i + 1}</label>
            <input
              ref={(el) => {
                campos.current[i] = el;
              }}
              id={`${id}-${i}`}
              name="horarios"
              type="time"
              value={h}
              onChange={(e) => aoMudar(horarios.map((x, j) => (j === i ? e.target.value : x)))}
              aria-invalid={erro ? true : undefined}
              aria-describedby={descricao(erro && `${id}-erro`)}
              className={`${CAMPO} min-h-11`}
            />
          </div>
          {horarios.length > 1 && (
            <Botao
              type="button"
              variante="secundario"
              onClick={() => {
                focar.current = Math.max(0, i - 1);
                aoMudar(horarios.filter((_, j) => j !== i));
              }}
            >
              Remover horário {i + 1}
            </Botao>
          )}
        </div>
      ))}
      {horarios.length < MAX_HORARIOS && (
        <Botao
          type="button"
          variante="secundario"
          onClick={() => {
            focar.current = horarios.length;
            aoMudar([...horarios, '']);
          }}
        >
          Adicionar horário
        </Botao>
      )}
      <Erro id={`${id}-erro`}>{erro}</Erro>
    </fieldset>
  );
}

function Texto({ id, tipo, valor, erro, aoMudar }: { id: string; tipo: 'suplemento' | 'livre'; valor: string; erro?: string; aoMudar: (v: string) => void }) {
  const suplemento = tipo === 'suplemento';
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block font-medium">{suplemento ? 'Nome do suplemento' : 'Texto do lembrete'}</label>
      <input
        id={id}
        name="texto"
        value={valor}
        maxLength={TEXTO_MAX[tipo]}
        onChange={(e) => aoMudar(e.target.value)}
        aria-invalid={erro ? true : undefined}
        aria-describedby={descricao(`${id}-dica`, `${id}-ajuda`, erro && `${id}-erro`)}
        className={`${CAMPO} min-h-11`}
      />
      <p id={`${id}-dica`} className="text-sm text-suave">{DICA_TEXTO}</p>
      <p id={`${id}-ajuda`} className="text-sm text-suave">{suplemento ? AJUDA_SUPLEMENTO : AJUDA_LIVRE}</p>
      <Erro id={`${id}-erro`}>{erro}</Erro>
    </div>
  );
}

/** O lembrete com que o formulário abre: o salvo (com `id`) ou a sugestão/um novo em branco. */
export type LembreteDoFormulario = LembreteNovo & { id?: string };

/**
 * Plano 17 (Tarefa 5): o formulário de um lembrete (novo ou edição). Tudo controlado (o React 19 reseta campos não
 * controlados depois de cada action: um erro nunca apaga o que foi digitado); `noValidate`, para valerem as mensagens
 * pt-BR do servidor. `nome`: o fim do nome acessível do "Salvar" ("lembrete de água", "suplemento Vitamina D").
 */
export function FormLembrete({
  patientId,
  inicial,
  nome,
  focarAoAbrir = false,
  aoSalvar,
  aoCancelar,
}: {
  patientId: string;
  inicial: LembreteDoFormulario;
  nome: string;
  focarAoAbrir?: boolean;
  aoSalvar: (id: string) => void;
  aoCancelar?: () => void;
}) {
  const id = useId();
  const tipo = inicial.tipo;
  const agua = tipo === 'agua' ? (inicial.config as ConfigAgua) : null;
  const refeicoes = tipo === 'refeicoes' ? (inicial.config as ConfigRefeicoes) : null;
  const comHorarios = tipo === 'suplemento' || tipo === 'livre' ? (inicial.config as ConfigHorarios) : null;

  const [inicio, setInicio] = useState(agua?.inicio ?? '');
  const [fim, setFim] = useState(agua?.fim ?? '');
  const [intervaloMin, setIntervaloMin] = useState(String(agua?.intervaloMin ?? ''));
  const [antecedenciaMin, setAntecedenciaMin] = useState(String(refeicoes?.antecedenciaMin ?? 0));
  const [diarioDepoisMin, setDiarioDepoisMin] = useState(refeicoes?.diarioDepoisMin == null ? '' : String(refeicoes.diarioDepoisMin));
  const [texto, setTexto] = useState(inicial.tipo === 'suplemento' || inicial.tipo === 'livre' ? inicial.texto : '');
  const [horarios, setHorarios] = useState<string[]>(comHorarios?.horarios.length ? comHorarios.horarios : ['']);
  const [dias, setDias] = useState<DiaDaSemana[]>(agua?.dias ?? comHorarios?.dias ?? []);

  const [state, enviar, pendente] = useActionState<FormLembreteState, FormData>(async (prev, fd) => {
    const r = await salvarLembreteAction(patientId, prev, fd);
    // na mesma transição da página revalidada: o formulário fecha e o lembrete salvo aparece juntos
    if (r.ok && r.id) startTransition(() => aoSalvar(r.id!));
    return r;
  }, {});
  const e = state.erros ?? {};
  const gerais = Object.entries(e).filter(([k]) => !CAMPOS[tipo].includes(k)).map(([, v]) => v);

  const primeiro = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focarAoAbrir) primeiro.current?.querySelector<HTMLElement>('input, select')?.focus();
  }, [focarAoAbrir]);

  const campo = (sufixo: string) => `${id}-${sufixo}`;
  let campos: ReactNode;
  if (tipo === 'agua') {
    campos = (
      <>
        <div className="grid gap-3 sm:grid-cols-3">
          <Hora id={campo('inicio')} nome="inicio" rotulo="Início" valor={inicio} erro={e.inicio} aoMudar={setInicio} />
          <Hora id={campo('fim')} nome="fim" rotulo="Fim" valor={fim} erro={e.fim} aoMudar={setFim} />
          <Selecao id={campo('intervalo')} nome="intervaloMin" rotulo="Intervalo" valor={intervaloMin} erro={e.intervaloMin} aoMudar={setIntervaloMin} opcoes={INTERVALOS_AGUA.map((m) => [String(m), rotuloDoIntervalo(m)])} />
        </div>
        <Dias id={campo('dias')} dias={dias} erro={e.dias} aoMudar={setDias} />
      </>
    );
  } else if (tipo === 'refeicoes') {
    campos = (
      <div className="grid gap-3 sm:grid-cols-2">
        <Selecao id={campo('antecedencia')} nome="antecedenciaMin" rotulo="Aviso da refeição" valor={antecedenciaMin} erro={e.antecedenciaMin} aoMudar={setAntecedenciaMin} opcoes={ANTECEDENCIA} />
        <Selecao id={campo('diario')} nome="diarioDepoisMin" rotulo="Pedir registro no diário" valor={diarioDepoisMin} erro={e.diarioDepoisMin} aoMudar={setDiarioDepoisMin} opcoes={DIARIO} />
      </div>
    );
  } else {
    campos = (
      <>
        <Texto id={campo('texto')} tipo={tipo} valor={texto} erro={e.texto} aoMudar={setTexto} />
        <Horarios id={campo('horarios')} horarios={horarios} erro={e.horarios} aoMudar={setHorarios} />
        <Dias id={campo('dias')} dias={dias} erro={e.dias} aoMudar={setDias} />
      </>
    );
  }

  return (
    <form key={state.envio} action={enviar} noValidate className="space-y-4">
      <input type="hidden" name="tipo" value={tipo} />
      <input type="hidden" name="id" value={inicial.id ?? ''} />
      <div ref={primeiro} className="space-y-4">{campos}</div>
      <div className="space-y-2">
        {gerais.map((m) => <p key={m} role="alert" className="text-sm text-erro">{m}</p>)}
        <div className="flex flex-wrap gap-3">
          {/* aria-disabled, não disabled: com o erro do servidor, o foco fica no Salvar em vez de cair no <body> */}
          <Botao type="submit" aria-disabled={pendente || undefined} onClick={(ev) => pendente && ev.preventDefault()} className="aria-disabled:opacity-60" aria-label={`Salvar ${nome}`}>Salvar</Botao>
          {aoCancelar && <Botao type="button" variante="secundario" onClick={aoCancelar}>Cancelar</Botao>}
        </div>
      </div>
    </form>
  );
}
