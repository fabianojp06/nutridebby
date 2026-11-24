'use client';
import { useActionState, useEffect, useState } from 'react';
import { Dialogo } from '@/components/dialogo';
import { Botao } from '@/components/ui/botao';
import { MSG_MENSAGENS, OPCOES_FORMA_TCLE } from '@/modules/mensagens/constantes';
import { liberarAction, type EstadoDaLiberacao } from './actions';
import { ComLinkDoPerfil } from './link-do-perfil';

const L = MSG_MENSAGENS.liberacao;
const CAMPO = 'min-h-11 w-full rounded-xl border border-campo bg-cartao p-2 text-texto';

/** Os campos (a forma e a confirmação), remontados a cada resposta com o que foi enviado; o `<form>` e os botões não. */
function CamposDaLiberacao({ estado }: { estado: EstadoDaLiberacao | null }) {
  const idErro = estado?.erro ? 'erro-liberacao' : undefined;
  // só o erro de campo marca os campos (o genérico e o do carimbo não são culpa deles)
  const invalido = estado?.erro === L.erro ? true : undefined;
  return (
    <>
      <div className="space-y-1">
        <label htmlFor="forma-tcle" className="block font-medium">
          {L.perguntaForma}
        </label>
        <select id="forma-tcle" name="forma" defaultValue={estado?.forma ?? ''} aria-describedby={idErro} aria-invalid={invalido} className={CAMPO} data-foco-inicial="">
          <option value="">{L.opcaoInicial}</option>
          {Object.entries(OPCOES_FORMA_TCLE).map(([valor, rotulo]) => (
            <option key={valor} value={valor}>
              {rotulo}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-start gap-3">
        <input
          id="confirmacao-tcle"
          type="checkbox"
          name="confirmacao"
          value="sim"
          defaultChecked={estado?.confirmou ?? false}
          aria-describedby={idErro}
          aria-invalid={invalido}
          className="mt-1 size-5 shrink-0"
        />
        <label htmlFor="confirmacao-tcle">{L.confirmacao}</label>
      </div>
    </>
  );
}

/**
 * US-440 (RN-441, §6.2): o formulário do diálogo — o aviso do e-Nutricionista, "Como o paciente (ou o responsável legal)
 * concordou?" (`<select>` com "Escolha" e as duas formas; sem a forma verbal, CH-D3) e a confirmação. A orientação do TCLE
 * é a descrição do diálogo. "Liberar" fica habilitado: sem a forma ou a confirmação, o servidor devolve o erro, mostrado
 * junto aos campos (`aria-describedby`, `aria-invalid`), e o foco vai ao primeiro campo inválido; sem o carimbo, ao link do
 * Perfil (rodada da T6b, I2: só os campos remontam, nunca o `<form>` nem os botões).
 */
export function FormularioDeLiberacao({
  patientId,
  aoCancelar,
  aoOcupar,
  estadoInicial = null,
}: {
  patientId: string;
  nome: string;
  aoCancelar: () => void;
  aoOcupar?: (ocupado: boolean) => void;
  estadoInicial?: EstadoDaLiberacao | null;
}) {
  const [estado, acao, liberando] = useActionState<EstadoDaLiberacao | null, FormData>(liberarAction.bind(null, patientId), estadoInicial);
  useEffect(() => aoOcupar?.(liberando), [liberando, aoOcupar]);
  // depois de cada erro, o foco vai aonde corrigir
  useEffect(() => {
    if (!estado?.erro) return;
    const alvo = estado.semCarimbo ? 'link-perfil-liberacao' : estado.forma === '' ? 'forma-tcle' : !estado.confirmou ? 'confirmacao-tcle' : 'forma-tcle';
    document.getElementById(alvo)?.focus();
  }, [estado]);
  return (
    <form action={acao} className="space-y-4">
      <p className="rounded-2xl border border-borda p-3">{L.avisoENutricionista}</p>
      <CamposDaLiberacao key={estado?.marca ?? 'inicio'} estado={estado} />
      {estado?.erro && (
        <p key={estado.marca} id="erro-liberacao" role="alert" className="text-erro">
          {estado.semCarimbo ? <ComLinkDoPerfil texto={estado.erro} id="link-perfil-liberacao" /> : estado.erro}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-3">
        <Botao
          type="button"
          variante="secundario"
          onClick={() => {
            if (!liberando) aoCancelar();
          }}
          aria-disabled={liberando || undefined}
          className="aria-disabled:opacity-60"
        >
          {L.cancelar}
        </Botao>
        <Botao
          type="submit"
          aria-disabled={liberando || undefined}
          onClick={(e) => {
            if (liberando) e.preventDefault();
          }}
          className="aria-disabled:opacity-60"
        >
          {L.liberar}
        </Botao>
      </div>
    </form>
  );
}

/**
 * "Liberar conversa" e o diálogo (o `Dialogo` compartilhado; nunca a confirmação nativa do navegador), com a orientação do
 * TCLE como descrição (o leitor de tela a ouve ao abrir). Liberou → a página com `?ok=liberada`.
 */
export function LiberarDialogo({ patientId, nome }: { patientId: string; nome: string }) {
  const [aberto, setAberto] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  return (
    <>
      <Botao type="button" data-guia="liberar-conversa" onClick={() => setAberto(true)}>
        {L.botao}
      </Botao>
      <Dialogo aberto={aberto} titulo={L.titulo(nome)} descricao={L.texto} aoFechar={() => setAberto(false)} ocupado={ocupado} rodape={null}>
        <FormularioDeLiberacao patientId={patientId} nome={nome} aoCancelar={() => setAberto(false)} aoOcupar={setOcupado} />
      </Dialogo>
    </>
  );
}
