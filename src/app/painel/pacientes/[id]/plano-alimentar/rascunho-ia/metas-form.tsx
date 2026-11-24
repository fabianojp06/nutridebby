'use client';

import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { Botao, classeDoBotao } from '@/components/ui/botao';
import { MSG_RASCUNHO_IA } from '@/modules/ia/constantes';
import { MAX_REFEICOES } from '@/modules/plano-alimentar/constantes';
import type { MetasState } from './actions';

/** = MAX_RESTRICOES de `rascunho-dados.ts` (o servidor confere; aquele arquivo lê o banco e não entra no cliente). */
const MAX_RESTRICOES = 500;
type Acao = (s: MetasState, fd: FormData) => Promise<MetasState>;
type Refeicao = { chave: string; nome: string; horario: string };

/**
 * US-121: as metas do rascunho. A meta vem do último cálculo de gasto energético e as refeições do último plano (ou as
 * seis comuns) — `metasPadrao`; as porcentagens não têm padrão (R10). Campos controlados: depois de um erro, o que foi
 * digitado continua na tela. Erros por campo com `aria-invalid` + `aria-describedby`; o de `macros` é um só, abaixo dos três.
 * Revisão final da 14B-2: o formulário é longo e os erros nascem no topo, fora da tela — com erro de campo, o aviso
 * `corrijaCampos` aparece junto do botão e o foco vai ao primeiro campo com `aria-invalid` (sem campo marcado, só o erro
 * de `refeicoes`: a "Acrescentar refeição").
 */
export function MetasForm({ acao, inicial }: { acao: Acao; inicial: { metaKcal: number | null; refeicoes: { nome: string; horario: string }[] } }) {
  const [s, enviar, enviando] = useActionState<MetasState, FormData>(acao, {});
  // chave = useId + contador: igual no servidor e no cliente (molde de receita-form.tsx)
  const prefixo = useId();
  const proxima = useRef(inicial.refeicoes.length);
  const [meta, setMeta] = useState(inicial.metaKcal === null ? '' : String(Math.round(inicial.metaKcal)));
  const [proteina, setProteina] = useState('');
  const [carboidrato, setCarboidrato] = useState('');
  const [lipidio, setLipidio] = useState('');
  const [refeicoes, setRefeicoes] = useState<Refeicao[]>(() => inicial.refeicoes.map((r, i) => ({ ...r, chave: `${prefixo}-${i}` })));
  const [restricoes, setRestricoes] = useState('');
  const [anamnese, setAnamnese] = useState(true);
  const focar = useRef<string | null>(null);
  const acrescentar = useRef<HTMLButtonElement>(null);
  const formulario = useRef<HTMLFormElement>(null);
  const comErroDeCampo = !!s.erros && Object.keys(s.erros).length > 0;
  useEffect(() => {
    if (!s.erros || !Object.keys(s.erros).length) return;
    const campo = formulario.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    (campo ?? acrescentar.current)?.focus();
  }, [s]);
  const erro = (c: string) => s.erros?.[c];
  const mudar = (chave: string, campo: 'nome' | 'horario', valor: string) => setRefeicoes((rs) => rs.map((r) => (r.chave === chave ? { ...r, [campo]: valor } : r)));
  const campoInput = 'rounded-xl border border-campo bg-cartao p-2 text-texto';
  const porcentagem = (nome: string, rotulo: string, valor: string, set: (v: string) => void) => (
    <div className="space-y-1">
      <label htmlFor={nome} className="block font-medium">{rotulo}</label>
      <input id={nome} name={nome} inputMode="decimal" value={valor} onChange={(e) => set(e.target.value)} aria-invalid={erro('macros') ? true : undefined} aria-describedby={erro('macros') ? 'macros-erro' : undefined} className={`w-28 ${campoInput}`} />
    </div>
  );
  return (
    <form ref={formulario} action={enviar} className="space-y-5">
      <div className="space-y-1">
        <label htmlFor="metaKcal" className="block font-medium">{MSG_RASCUNHO_IA.rotuloMeta}</label>
        <input id="metaKcal" name="metaKcal" inputMode="decimal" value={meta} onChange={(e) => setMeta(e.target.value)} aria-invalid={erro('metaKcal') ? true : undefined} aria-describedby={erro('metaKcal') ? 'metaKcal-erro' : undefined} className={`w-32 ${campoInput}`} />
        {erro('metaKcal') && <p id="metaKcal-erro" role="alert" className="text-sm text-erro">{erro('metaKcal')}</p>}
      </div>
      <div className="space-y-1">
        <div className="flex flex-wrap gap-4">
          {porcentagem('proteinaPct', MSG_RASCUNHO_IA.rotuloProteina, proteina, setProteina)}
          {porcentagem('carboidratoPct', MSG_RASCUNHO_IA.rotuloCarboidrato, carboidrato, setCarboidrato)}
          {porcentagem('lipidioPct', MSG_RASCUNHO_IA.rotuloLipidio, lipidio, setLipidio)}
        </div>
        {erro('macros') && <p id="macros-erro" role="alert" className="text-sm text-erro">{erro('macros')}</p>}
      </div>
      <fieldset className="space-y-2" aria-describedby={erro('refeicoes') ? 'refeicoes-erro' : undefined}>
        <legend className="font-medium">{MSG_RASCUNHO_IA.rotuloRefeicoes}</legend>
        <ol className="space-y-3">
          {refeicoes.map((r, i) => {
            const en = erro(`refeicao:${i}:nome`);
            const eh = erro(`refeicao:${i}:horario`);
            return (
              <li key={r.chave} className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <label htmlFor={`${r.chave}-nome`} className="block text-sm">Nome<span className="sr-only">{` da refeição ${i + 1}`}</span></label>
                  <input
                    id={`${r.chave}-nome`}
                    name="refeicaoNome"
                    maxLength={60}
                    value={r.nome}
                    onChange={(e) => mudar(r.chave, 'nome', e.target.value)}
                    ref={(el) => {
                      if (el && focar.current === r.chave) {
                        focar.current = null;
                        el.focus();
                      }
                    }}
                    aria-invalid={en ? true : undefined}
                    aria-describedby={en ? `${r.chave}-nome-erro` : undefined}
                    className={`w-56 ${campoInput}`}
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor={`${r.chave}-horario`} className="block text-sm">Horário<span className="sr-only">{` da refeição ${i + 1}`}</span></label>
                  <input id={`${r.chave}-horario`} name="refeicaoHorario" type="time" value={r.horario} onChange={(e) => mudar(r.chave, 'horario', e.target.value)} aria-invalid={eh ? true : undefined} aria-describedby={eh ? `${r.chave}-horario-erro` : undefined} className={`min-h-11 ${campoInput}`} />
                </div>
                <button
                  type="button"
                  className={classeDoBotao('secundario')}
                  onClick={() => {
                    setRefeicoes((rs) => rs.filter((x) => x.chave !== r.chave));
                    acrescentar.current?.focus();
                  }}
                >
                  Tirar<span className="sr-only">{` a refeição ${r.nome || i + 1}`}</span>
                </button>
                {en && <p id={`${r.chave}-nome-erro`} role="alert" className="w-full text-sm text-erro">{en}</p>}
                {eh && <p id={`${r.chave}-horario-erro`} role="alert" className="w-full text-sm text-erro">{eh}</p>}
              </li>
            );
          })}
        </ol>
        <button
          ref={acrescentar}
          type="button"
          disabled={refeicoes.length >= MAX_REFEICOES}
          className={classeDoBotao('secundario')}
          onClick={() => {
            const chave = `${prefixo}-${proxima.current++}`;
            focar.current = chave;
            setRefeicoes((rs) => (rs.length >= MAX_REFEICOES ? rs : [...rs, { chave, nome: '', horario: '' }]));
          }}
        >
          Acrescentar refeição
        </button>
        {erro('refeicoes') && <p id="refeicoes-erro" role="alert" className="text-sm text-erro">{erro('refeicoes')}</p>}
      </fieldset>
      <div className="space-y-1">
        <label htmlFor="restricoes" className="block font-medium">{MSG_RASCUNHO_IA.rotuloRestricoes}</label>
        <p id="restricoes-dica" className="text-sm text-suave">{MSG_RASCUNHO_IA.dicaRestricoes}</p>
        <textarea
          id="restricoes"
          name="restricoes"
          rows={3}
          maxLength={MAX_RESTRICOES}
          value={restricoes}
          onChange={(e) => setRestricoes(e.target.value)}
          aria-invalid={erro('restricoes') ? true : undefined}
          aria-describedby={`restricoes-dica restricoes-contador${erro('restricoes') ? ' restricoes-erro' : ''}`}
          className={`w-full max-w-2xl ${campoInput}`}
        />
        <p id="restricoes-contador" className="text-sm text-suave">{`${restricoes.length}/${MAX_RESTRICOES}`}</p>
        {erro('restricoes') && <p id="restricoes-erro" role="alert" className="text-sm text-erro">{erro('restricoes')}</p>}
      </div>
      <div className="flex min-h-11 items-center gap-2">
        {/* SUS-108: `defaultChecked` do estado — o reset automático depois de um erro voltava a marcar a caixa desmarcada */}
        <input type="checkbox" id="considerarAnamnese" name="considerarAnamnese" defaultChecked={anamnese} onChange={(e) => setAnamnese(e.target.checked)} className="size-5" />
        <label htmlFor="considerarAnamnese" className="inline-flex min-h-11 items-center">{MSG_RASCUNHO_IA.considerarAnamnese}</label>
      </div>
      <Botao disabled={enviando} aria-describedby={[comErroDeCampo && 'rascunho-campos', s.erro && 'rascunho-erro'].filter(Boolean).join(' ') || undefined}>{MSG_RASCUNHO_IA.gerar}</Botao>
      {comErroDeCampo && <p id="rascunho-campos" role="alert" className="text-sm text-erro">{MSG_RASCUNHO_IA.corrijaCampos}</p>}
      {s.erro && <p id="rascunho-erro" role="alert" className="text-sm text-erro">{s.erro}</p>}
    </form>
  );
}
