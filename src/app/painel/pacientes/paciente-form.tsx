'use client';

import { useActionState, useState, type ReactNode, type SelectHTMLAttributes } from 'react';
import { Campo } from '@/components/campo';
import { ESCOLARIDADES, ESTADOS_CIVIS, IDENTIDADES_DE_GENERO, MSG_CADASTRO, tamanhoDoTexto, UFS, type Opcao } from '@/modules/pacientes/cadastro-textos';
import type { PacienteState } from './actions';
import type { ValoresPaciente } from './valores';

type Props = {
  acao: (prev: PacienteState, formData: FormData) => Promise<PacienteState>;
  inicial: ValoresPaciente;
  botao: string;
  /** O paciente já ativou o acesso: o e-mail é o login dele. */
  emailBloqueado?: boolean;
  somenteLeitura?: boolean;
  /** US-010: a opção "Enviar convite por WhatsApp" (só no cadastro), com o aviso de quando ela não teria como sair agora. */
  conviteWhatsapp?: { aviso: string | null };
};

const R = MSG_CADASTRO.rotulos;
const D = MSG_CADASTRO.dicas;
const CAMPO = 'w-full rounded-xl border border-campo bg-cartao p-2 text-texto';

/** Título de seção do formulário: a legenda do fieldset é o h2 (o leitor de tela acha a seção pelos títulos). */
function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-4">
      <legend className="mb-2">
        <h2 className="text-lg font-semibold">{titulo}</h2>
      </legend>
      {children}
    </fieldset>
  );
}

/**
 * Lista fechada (US-260) com a opção vazia "Selecione". Nunca desabilitada sozinha: select desabilitado não vai no
 * FormData (a ação manteria o valor gravado, `entradaDoFormulario`); o só leitura vem do fieldset de fora.
 */
function Lista<V extends string>({
  id,
  rotulo,
  opcoes,
  erro,
  dica,
  ...select
}: { id: string; rotulo: string; opcoes: readonly Opcao<V>[]; erro?: string; dica?: string } & SelectHTMLAttributes<HTMLSelectElement>) {
  const descricao = [dica ? `${id}-dica` : null, erro ? `${id}-erro` : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block font-medium">{rotulo}</label>
      <select id={id} name={id} aria-invalid={erro ? true : undefined} aria-describedby={descricao} className={`min-h-11 ${CAMPO}`} {...select}>
        <option value="">{MSG_CADASTRO.selecione}</option>
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.rotulo}
          </option>
        ))}
      </select>
      {dica && <p id={`${id}-dica`} className="text-sm text-suave">{dica}</p>}
      {erro && <p id={`${id}-erro`} role="alert" className="text-sm text-erro">{erro}</p>}
    </div>
  );
}

/**
 * Plano 18 (US-260, §8.4): o cadastro em seções — Dados gerais, Contato e endereço e Observação —, o mesmo no Perfil e
 * em "Novo paciente". Manda todos os campos ('' quando vazio); `noValidate`: as mensagens são as do servidor (spec).
 */
export function PacienteForm({ acao, inicial, botao, emailBloqueado, somenteLeitura, conviteWhatsapp }: Props) {
  const [state, action, pendente] = useActionState<PacienteState, FormData>(acao, {});
  const v = state.valores ?? inicial;
  const e = state.erros ?? {};
  const [telefone, setTelefone] = useState(v.telefone);
  // US-010 "WhatsApp sem autorização": o convite por WhatsApp só fica habilitado com a autorização marcada. A caixa da
  // autorização continua não controlada — depois de cada envio o React volta o formulário para `v` (o que foi enviado,
  // ou o que ficou salvo) —, e este estado acompanha o que ela mostra: muda com o clique e volta junto quando `v` muda
  const [autorizado, setAutorizado] = useState(v.whatsappAutorizado);
  // a observação é controlada pelo contador "{n} de 1.000 caracteres" (contado como o servidor, `tamanhoDoTexto`)
  const [observacao, setObservacao] = useState(v.observacao);
  const [valoresVistos, setValoresVistos] = useState(v);
  if (valoresVistos !== v) {
    setValoresVistos(v);
    setAutorizado(v.whatsappAutorizado);
    setObservacao(v.observacao);
  }
  const conviteDesabilitado = !autorizado || !telefone.trim();
  const texto = (id: keyof typeof R & keyof ValoresPaciente, extra: { dica?: string; autoComplete?: string; inputMode?: 'numeric' | 'tel' } = {}) => (
    <Campo id={id} rotulo={R[id]} defaultValue={v[id] as string} erro={e[id]} {...extra} />
  );
  return (
    <form action={action} noValidate data-guia="cadastro-paciente" className="space-y-6">
      <fieldset disabled={somenteLeitura} className="space-y-6">
        <Secao titulo={MSG_CADASTRO.secoes.dadosGerais}>
          <Campo id="nome" rotulo={R.nome} required defaultValue={v.nome} erro={e.nome} autoComplete="off" />
          {texto('nomeSocial', { dica: D.nomeSocial, autoComplete: 'off' })}
          <Campo id="dataNascimento" rotulo={R.dataNascimento} type="date" required defaultValue={v.dataNascimento} erro={e.dataNascimento} />
          <fieldset className="space-y-1" aria-invalid={e.sexo ? true : undefined} aria-describedby={e.sexo ? 'sexo-erro' : undefined}>
            <legend className="font-medium">Sexo biológico (usado nas fórmulas)</legend>
            {[
              ['F', 'Feminino'],
              ['M', 'Masculino'],
            ].map(([valor, rotulo]) => (
              <div key={valor} className="flex min-h-11 items-center gap-2">
                <input id={`sexo-${valor}`} name="sexo" type="radio" value={valor} defaultChecked={v.sexo === valor} />
                <label htmlFor={`sexo-${valor}`}>{rotulo}</label>
              </div>
            ))}
            {e.sexo && <p id="sexo-erro" role="alert" className="text-sm text-erro">{e.sexo}</p>}
          </fieldset>
          <Lista id="identidadeGenero" rotulo={R.identidadeGenero} opcoes={IDENTIDADES_DE_GENERO} defaultValue={v.identidadeGenero} erro={e.identidadeGenero} dica={D.identidadeGenero} />
          <Lista id="estadoCivil" rotulo={R.estadoCivil} opcoes={ESTADOS_CIVIS} defaultValue={v.estadoCivil} erro={e.estadoCivil} />
          <Lista id="escolaridade" rotulo={R.escolaridade} opcoes={ESCOLARIDADES} defaultValue={v.escolaridade} erro={e.escolaridade} />
          {texto('ocupacao', { dica: D.ocupacao })}
          {texto('nacionalidade', { dica: D.nacionalidade })}
          {texto('naturalidade', { dica: D.naturalidade })}
          <div className="space-y-1">
            {texto('cpf', { dica: D.cpf, autoComplete: 'off', inputMode: 'numeric' })}
            {/* RN-261: o outro paciente com o mesmo CPF (sem o link quando ele está bloqueado) */}
            {e.cpf && state.cpfExistenteId && (
              <p className="text-sm">
                <a href={`/painel/pacientes/${state.cpfExistenteId}/perfil`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-destaque underline">
                  {MSG_CADASTRO.abrirExistente}
                </a>
              </p>
            )}
          </div>
          <Campo
            id="email"
            rotulo={R.email}
            type="email"
            required
            defaultValue={v.email}
            erro={e.email}
            readOnly={emailBloqueado}
            dica={emailBloqueado ? 'O paciente já ativou o acesso; o e-mail não pode ser alterado.' : undefined}
          />
        </Secao>
        <Secao titulo={MSG_CADASTRO.secoes.contatoEEndereco}>
          <Campo id="telefone" rotulo={R.telefone} type="tel" value={telefone} onChange={(ev) => setTelefone(ev.target.value)} erro={e.telefone} dica={D.telefone} />
          <div className="flex items-start gap-2">
            <input
              id="whatsappAutorizado"
              name="whatsappAutorizado"
              type="checkbox"
              className="mt-1"
              defaultChecked={v.whatsappAutorizado}
              onChange={(ev) => setAutorizado(ev.target.checked)}
              disabled={!telefone.trim()}
              aria-invalid={e.whatsappAutorizado ? true : undefined}
              aria-describedby={e.whatsappAutorizado ? 'whatsappAutorizado-erro' : undefined}
            />
            <label htmlFor="whatsappAutorizado">Paciente autorizou receber mensagens por WhatsApp</label>
          </div>
          {e.whatsappAutorizado && <p id="whatsappAutorizado-erro" role="alert" className="text-sm text-erro">{e.whatsappAutorizado}</p>}
          {conviteWhatsapp && (
            <div className="space-y-1">
              <div className="flex items-start gap-2">
                <input
                  id="enviarConviteWhatsapp"
                  name="enviarConviteWhatsapp"
                  type="checkbox"
                  className="mt-1"
                  defaultChecked={v.enviarConviteWhatsapp}
                  disabled={conviteDesabilitado}
                  aria-invalid={e.enviarConviteWhatsapp ? true : undefined}
                  aria-describedby={
                    [conviteDesabilitado ? 'enviarConviteWhatsapp-dica' : null, conviteWhatsapp.aviso ? 'enviarConviteWhatsapp-aviso' : null, e.enviarConviteWhatsapp ? 'enviarConviteWhatsapp-erro' : null]
                      .filter(Boolean)
                      .join(' ') || undefined
                  }
                />
                <label htmlFor="enviarConviteWhatsapp">Enviar convite por WhatsApp</label>
              </div>
              {conviteDesabilitado && (
                <p id="enviarConviteWhatsapp-dica" className="text-sm text-suave">Para enviar o convite por WhatsApp, informe o telefone e marque a autorização.</p>
              )}
              {conviteWhatsapp.aviso && <p id="enviarConviteWhatsapp-aviso" className="text-sm text-suave">{conviteWhatsapp.aviso}</p>}
            </div>
          )}
          {e.enviarConviteWhatsapp && <p id="enviarConviteWhatsapp-erro" role="alert" className="text-sm text-erro">{e.enviarConviteWhatsapp}</p>}
          {texto('telefoneFixo', { dica: D.telefoneFixo, inputMode: 'tel' })}
          <fieldset className="space-y-4">
            <legend className="font-medium">{MSG_CADASTRO.legendaEndereco}</legend>
            {texto('cep', { autoComplete: 'postal-code', inputMode: 'numeric' })}
            {texto('logradouro', { autoComplete: 'address-line1' })}
            {texto('numero')}
            {texto('complemento', { autoComplete: 'address-line2' })}
            {texto('bairro')}
            {texto('cidade', { autoComplete: 'address-level2' })}
            <Lista id="uf" rotulo={R.uf} opcoes={UFS} defaultValue={v.uf} erro={e.uf} autoComplete="address-level1" />
          </fieldset>
        </Secao>
        <Secao titulo={MSG_CADASTRO.secoes.observacao}>
          <div className="space-y-1">
            <label htmlFor="observacao" className="block font-medium">{R.observacao}</label>
            <p id="observacao-aviso" className="text-sm text-suave">{MSG_CADASTRO.avisoObservacao}</p>
            <textarea
              id="observacao"
              name="observacao"
              rows={4}
              value={observacao}
              onChange={(ev) => setObservacao(ev.target.value)}
              aria-invalid={e.observacao ? true : undefined}
              aria-describedby={`observacao-aviso observacao-contador${e.observacao ? ' observacao-erro' : ''}`}
              className={CAMPO}
            />
            {/* sem região viva: o contador é lido junto do campo (aria-describedby), sem anunciar a cada tecla */}
            <p id="observacao-contador" className="text-sm text-suave">{MSG_CADASTRO.contadorObservacao(tamanhoDoTexto(observacao))}</p>
            {e.observacao && <p id="observacao-erro" role="alert" className="text-sm text-erro">{e.observacao}</p>}
          </div>
        </Secao>
      </fieldset>
      {e.geral && <p role="alert" className="text-erro">{e.geral}</p>}
      {state.ok && <p role="status">Cadastro salvo.</p>}
      {!somenteLeitura && <button disabled={pendente} className="inline-flex min-h-11 items-center justify-center rounded-full bg-destaque px-5 font-semibold text-white hover:brightness-95">{botao}</button>}
    </form>
  );
}
