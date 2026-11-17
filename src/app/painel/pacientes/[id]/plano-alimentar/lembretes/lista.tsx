'use client';

import { startTransition, useEffect, useOptimistic, useRef, useState, useTransition } from 'react';
import { Botao } from '@/components/ui/botao';
import type { LembreteNovo } from '@/modules/lembretes/config';
import { MAX_LIVRES, MAX_SUPLEMENTOS, rotuloDaAntecedencia, rotuloDoDiario, rotuloDoIntervalo, rotuloDosDias } from '@/modules/lembretes/constantes';
import { BotaoAcao } from '../botao-acao';
import { apagarLembreteAction, ligarLembreteAction } from './actions';
import { FormLembrete, type LembreteDoFormulario } from './form-lembrete';

type Tipo = LembreteNovo['tipo'];
/** O lembrete como a seção recebe do servidor (a data do paciente já formatada no fuso do consultório). */
export type LembreteNaTela = LembreteNovo & { id: string; ligado: boolean; desligadoPeloPacienteEm: string | null };

const NOME: Record<Tipo, string> = { agua: 'Água', refeicoes: 'Refeições', suplemento: 'Suplemento', livre: 'Lembrete livre' };
/** O fim do nome acessível dos botões de cada lembrete (WCAG 2.5.3: começa pelo texto visível do botão). */
function nomeDe(l: LembreteNovo | { tipo: Tipo; texto?: string }): string {
  if (l.tipo === 'agua') return 'lembrete de água';
  if (l.tipo === 'refeicoes') return 'lembrete de refeições';
  const texto = 'texto' in l && l.texto ? ` ${l.texto}` : '';
  return l.tipo === 'suplemento' ? `suplemento${texto}` : `lembrete livre${texto}`;
}
const NOVO: Record<'suplemento' | 'livre', LembreteDoFormulario> = {
  suplemento: { tipo: 'suplemento', texto: '', config: { horarios: ['08:00'], dias: [0, 1, 2, 3, 4, 5, 6] } },
  livre: { tipo: 'livre', texto: '', config: { horarios: ['08:00'], dias: [0, 1, 2, 3, 4, 5, 6] } },
};

/** O resumo da linha, com os formatadores de `constantes.ts` (os mesmos do portal). */
function Resumo({ l }: { l: LembreteNaTela }) {
  if (l.tipo === 'agua') return <>{`${l.config.inicio}–${l.config.fim} · a cada ${rotuloDoIntervalo(l.config.intervaloMin)} · ${rotuloDosDias(l.config.dias)}`}</>;
  if (l.tipo === 'refeicoes') return <>{`${rotuloDaAntecedencia(l.config.antecedenciaMin)} · ${rotuloDoDiario(l.config.diarioDepoisMin)}`}</>;
  return (
    <>
      <span id={`${l.id}-texto`} className="break-words">{l.texto}</span>
      {` · ${l.config.horarios.join(', ')} · ${rotuloDosDias(l.config.dias)}`}
    </>
  );
}

/** Interruptor da equipe: muda só `ligado` (a escolha do paciente fica como está). */
function Interruptor({ patientId, l, anunciar }: { patientId: string; l: LembreteNaTela; anunciar: (texto: string) => void }) {
  const [ligado, setLigado] = useOptimistic(l.ligado);
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string>();
  const rotulo = l.tipo === 'suplemento' || l.tipo === 'livre' ? `${l.id}-nome ${l.id}-texto` : `${l.id}-nome`;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={ligado}
          aria-labelledby={rotulo}
          aria-describedby={erro ? `${l.id}-interruptor-erro` : undefined}
          // aria-disabled, não disabled: o botão desabilitado perde o foco (que cairia no <body>)
          aria-disabled={pendente || undefined}
          onClick={() =>
            !pendente &&
            iniciar(async () => {
              setLigado(!l.ligado);
              const r = await ligarLembreteAction(patientId, l.id, !l.ligado);
              startTransition(() => {
                setErro(r.erro);
                if (r.ok) anunciar(r.ok);
              });
            })
          }
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full aria-disabled:opacity-60"
        >
          {/* tokens do modo (cores.test.ts): ligado na marca do modo (a clara no escuro; bg-destaque fica ~2,6:1 no cartão
              escuro), botão do trilho na cor do cartão; desligado com borda e botão em `campo` — ≥ 3:1 nos dois (WCAG 1.4.11) */}
          <span aria-hidden="true" className={`flex h-6 w-11 items-center rounded-full border-2 p-0.5 motion-safe:transition-colors ${ligado ? 'border-marca bg-marca' : 'border-campo bg-cartao'}`}>
            <span className={`size-4 rounded-full motion-safe:transition-transform ${ligado ? 'translate-x-5 bg-cartao' : 'bg-campo'}`} />
          </span>
        </button>
        <span className="text-sm">{ligado ? 'Ligado' : 'Desligado'}</span>
      </div>
      {erro && <p id={`${l.id}-interruptor-erro`} role="alert" className="text-sm text-erro">{erro}</p>}
    </div>
  );
}

type Aberto = { tipo: Tipo; id?: string } | null;
/** Os botões que recebem o foco de volta (uma seção por página: os ids não se repetem). */
const idEditar = (id: string) => `${id}-editar`;
const idAdicionar = (tipo: Tipo) => `lembretes-adicionar-${tipo}`;
type Foco = { alvo: 'titulo' } | { alvo: 'editar'; id: string } | { alvo: 'adicionar'; tipo: Tipo };

/**
 * Plano 17 (Tarefa 5): a lista, os formulários e a região viva da seção "Lembretes no app". Fica sempre montada (o
 * `revalidatePath` só troca as props): a região `role="status"` existe desde o início e só o texto muda. Depois de
 * Salvar, o foco vai ao "Editar" do lembrete salvo; depois de Apagar, ao título da seção (`tituloId`, tabIndex -1).
 */
export function ListaDeLembretes({
  patientId,
  tituloId,
  lembretes,
  sugestao,
  modelos,
  avisosDasRefeicoes,
  somenteLeitura,
}: {
  patientId: string;
  tituloId: string;
  lembretes: LembreteNaTela[];
  sugestao: LembreteNovo[] | null;
  /** O formulário de "Adicionar água"/"Adicionar refeições" abre com o item da sugestão inicial. */
  modelos: { agua: LembreteNovo; refeicoes: LembreteNovo };
  avisosDasRefeicoes: string[];
  somenteLeitura: boolean;
}) {
  const [aberto, setAberto] = useState<Aberto>(null);
  const [aviso, setAviso] = useState({ texto: '', n: 0 });
  const focar = useRef<Foco | null>(null);

  // o alvo pode ainda não existir (lembrete novo antes da página revalidada chegar): tenta de novo no próximo render
  useEffect(() => {
    const f = focar.current;
    if (!f) return;
    const el = document.getElementById(f.alvo === 'titulo' ? tituloId : f.alvo === 'editar' ? idEditar(f.id) : idAdicionar(f.tipo));
    if (!el) return;
    el.focus();
    focar.current = null;
  });

  const anunciar = (texto: string) => setAviso((a) => ({ texto, n: a.n + 1 }));
  const fechar = (foco: Foco) => {
    focar.current = foco;
    setAberto(null);
  };
  const salvo = (id: string) => {
    anunciar('Lembrete salvo.');
    fechar({ alvo: 'editar', id });
  };

  const tem = (tipo: Tipo) => lembretes.some((l) => l.tipo === tipo);
  const quantos = (tipo: Tipo) => lembretes.filter((l) => l.tipo === tipo).length;
  const novo = aberto && !aberto.id ? aberto.tipo : null;
  const inicialDoNovo = (tipo: Tipo): LembreteDoFormulario => (tipo === 'agua' ? modelos.agua : tipo === 'refeicoes' ? modelos.refeicoes : NOVO[tipo]);

  return (
    <div className="space-y-4">
      {lembretes.length > 0 && (
        <ul className="divide-y divide-linha">
          {lembretes.map((l) => {
            const editando = aberto?.id === l.id;
            return (
              <li key={l.id} className="space-y-3 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <p id={`${l.id}-nome`} className="font-semibold">{NOME[l.tipo]}</p>
                    <p className="text-sm"><Resumo l={l} /></p>
                    {l.desligadoPeloPacienteEm && <p className="text-sm text-suave">Desligado pelo paciente em {l.desligadoPeloPacienteEm}</p>}
                    {l.tipo === 'refeicoes' && avisosDasRefeicoes.map((a) => <p key={a} className="text-sm text-suave">{a}</p>)}
                  </div>
                  <div className="flex flex-wrap items-start gap-3">
                    {somenteLeitura ? (
                      <p className="text-sm">{l.ligado ? 'Ligado' : 'Desligado'}</p>
                    ) : (
                      <>
                        <Interruptor patientId={patientId} l={l} anunciar={anunciar} />
                        {!editando && (
                          <Botao id={idEditar(l.id)} type="button" variante="secundario" aria-label={`Editar ${nomeDe(l)}`} onClick={() => setAberto({ tipo: l.tipo, id: l.id })}>
                            Editar
                          </Botao>
                        )}
                        {/* o que o paciente desligou a equipe não apaga (o banco recusa, 0120): só desliga do lado dela */}
                        {!l.desligadoPeloPacienteEm && (
                          <BotaoAcao
                            acao={async () => {
                              const r = await apagarLembreteAction(patientId, l.id);
                              if (r.ok) {
                                startTransition(() => {
                                  anunciar(r.ok!);
                                  fechar({ alvo: 'titulo' });
                                });
                              }
                              return r;
                            }}
                            rotulo="Apagar"
                            nome={`Apagar ${nomeDe(l)}`}
                            confirmar="Apagar este lembrete? O paciente deixa de recebê-lo."
                            principal={false}
                          />
                        )}
                      </>
                    )}
                  </div>
                </div>
                {editando && (
                  <FormLembrete
                    patientId={patientId}
                    inicial={l}
                    nome={nomeDe(l)}
                    focarAoAbrir
                    aoSalvar={salvo}
                    aoCancelar={() => fechar({ alvo: 'editar', id: l.id })}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {sugestao && !somenteLeitura && (
        <div className="space-y-3">
          <h3 className="font-semibold">Sugestão — confira e salve</h3>
          <div className="grid gap-3 lg:grid-cols-2">
            {sugestao.map((s) => (
              <div key={s.tipo} className="space-y-3 rounded-2xl border border-borda p-4">
                <h4 className="font-semibold">{NOME[s.tipo]}</h4>
                <FormLembrete patientId={patientId} inicial={s} nome={nomeDe(s)} aoSalvar={salvo} />
              </div>
            ))}
          </div>
        </div>
      )}

      {!somenteLeitura && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            {!sugestao && !tem('agua') && (
              <Botao id={idAdicionar('agua')} type="button" variante="secundario" onClick={() => setAberto({ tipo: 'agua' })}>Adicionar água</Botao>
            )}
            {!sugestao && !tem('refeicoes') && (
              <Botao id={idAdicionar('refeicoes')} type="button" variante="secundario" onClick={() => setAberto({ tipo: 'refeicoes' })}>Adicionar refeições</Botao>
            )}
            {quantos('suplemento') < MAX_SUPLEMENTOS ? (
              <Botao id={idAdicionar('suplemento')} type="button" variante="secundario" onClick={() => setAberto({ tipo: 'suplemento' })}>Adicionar suplemento</Botao>
            ) : (
              <p className="text-sm text-suave">Limite de 5 suplementos.</p>
            )}
            {quantos('livre') < MAX_LIVRES ? (
              <Botao id={idAdicionar('livre')} type="button" variante="secundario" onClick={() => setAberto({ tipo: 'livre' })}>Adicionar lembrete livre</Botao>
            ) : (
              <p className="text-sm text-suave">Limite de 5 lembretes livres.</p>
            )}
          </div>
          {novo && (
            <div className="space-y-3 rounded-2xl border border-borda p-4">
              <h3 className="font-semibold">{NOME[novo]}</h3>
              <FormLembrete
                key={novo}
                patientId={patientId}
                inicial={inicialDoNovo(novo)}
                nome={nomeDe({ tipo: novo })}
                focarAoAbrir
                aoSalvar={salvo}
                aoCancelar={() => fechar({ alvo: 'adicionar', tipo: novo })}
              />
            </div>
          )}
        </div>
      )}

      <p role="status" className="text-sm">
        <span key={aviso.n}>{aviso.texto}</span>
      </p>
    </div>
  );
}
