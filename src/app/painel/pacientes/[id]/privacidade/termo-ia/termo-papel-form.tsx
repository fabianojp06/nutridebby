'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Botao } from '@/components/ui/botao';
import { MSG_AUTORIZACAO } from '@/modules/ia/constantes';

type Erros = Partial<Record<'geral' | 'codigo' | 'data' | 'arquivo' | 'confirmacao', string>>;
const FALHOU = 'Não foi possível salvar. Tente de novo.';

/**
 * US-108 "Guardar o termo assinado": multipart para a rota do painel (o arquivo de até 20 MB não passa por Server Action),
 * como o laudo dos exames. Sucesso → volta à aba Privacidade com "Termo registrado…" (?ia=papel). Erros por campo, com
 * aria-invalid/aria-describedby; o geral em role="alert". `noValidate` (R5 do pre-flight): o "Salvar" com campos vazios
 * chega à rota, que devolve os textos da US-108 por campo — a validação nativa do navegador os esconderia. Revisão final
 * (RN-107/RN-109): a nutricionista digita o código de referência lido no papel (o de agora não aparece aqui: o servidor
 * recusa o papel impresso com outra versão ou outro destino) e a confirmação cita a versão e o destino.
 */
export function TermoPapelForm({ patientId, versao, destino }: { patientId: string; versao: string; destino: string }) {
  const router = useRouter();
  const [erros, setErros] = useState<Erros>({});
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEnviando(true);
    setErros({});
    try {
      const res = await fetch(`/api/painel/pacientes/${patientId}/autorizacao-ia/termo`, { method: 'POST', body: new FormData(e.currentTarget) });
      if (res.ok) {
        router.push(`/painel/pacientes/${patientId}/privacidade?ia=papel`);
        return;
      }
      const r = (await res.json().catch(() => ({}))) as { erros?: Erros };
      setErros(r.erros ?? { geral: FALHOU });
    } catch {
      setErros({ geral: FALHOU });
    }
    setEnviando(false);
  }

  const campo = (nome: keyof Erros) => (erros[nome] ? { 'aria-invalid': true as const, 'aria-describedby': `${nome}-erro` } : {});
  const erro = (nome: keyof Erros) =>
    erros[nome] && (
      <p id={`${nome}-erro`} role="alert" className="text-erro">
        {erros[nome]}
      </p>
    );
  return (
    <form method="post" noValidate onSubmit={enviar} className="space-y-3 print:hidden">
      <div>
        <label htmlFor="codigo" className="block font-medium">
          {MSG_AUTORIZACAO.codigoLido}
        </label>
        <p id="codigo-dica" className="text-sm text-suave">
          {MSG_AUTORIZACAO.dicaCodigoLido}
        </p>
        <input
          id="codigo"
          name="codigo"
          type="text"
          required
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={40}
          className="min-h-11 rounded-xl border border-campo bg-cartao p-2 font-mono text-texto"
          aria-describedby={erros.codigo ? 'codigo-dica codigo-erro' : 'codigo-dica'}
          {...(erros.codigo ? { 'aria-invalid': true as const } : {})}
        />
        {erro('codigo')}
      </div>
      <div>
        <label htmlFor="data" className="block font-medium">
          {MSG_AUTORIZACAO.dataAssinatura}
        </label>
        <input id="data" name="data" type="date" required className="min-h-11 rounded-xl border border-campo bg-cartao p-2 text-texto" {...campo('data')} />
        {erro('data')}
      </div>
      <div>
        <label htmlFor="arquivo" className="block font-medium">
          {MSG_AUTORIZACAO.arquivoTermo}
        </label>
        {/* F5 (§18.5): o arquivo mostra todas as páginas (o rodapé de cada uma traz o código e "Página x de y") */}
        <p id="arquivo-dica" className="text-sm text-suave">
          {MSG_AUTORIZACAO.dicaArquivoTermo}
        </p>
        <input
          id="arquivo"
          name="arquivo"
          type="file"
          required
          accept="image/jpeg,image/png,application/pdf"
          className="min-h-11"
          aria-describedby={erros.arquivo ? 'arquivo-dica arquivo-erro' : 'arquivo-dica'}
          {...(erros.arquivo ? { 'aria-invalid': true as const } : {})}
        />
        {erro('arquivo')}
      </div>
      <div className="flex min-h-11 items-start gap-2">
        <input id="confirmacao" name="confirmacao" type="checkbox" required className="mt-1 h-5 w-5 shrink-0" {...campo('confirmacao')} />
        <label htmlFor="confirmacao">{MSG_AUTORIZACAO.confirmacaoPapel(versao, destino)}</label>
      </div>
      {erro('confirmacao')}
      {erro('geral')}
      <Botao type="submit" disabled={enviando}>
        {MSG_AUTORIZACAO.salvar}
      </Botao>
    </form>
  );
}
