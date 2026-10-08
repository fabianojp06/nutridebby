'use client';

/**
 * US-148 / Q13-1 ★ (SBIS NGS1.12.01): por que esta versão corrige a anterior. Só numa retificação; obrigatório para preparar;
 * fica só no prontuário (como o motivo do cancelamento). Controlado pelo editor (o reset do React 19 o apagaria depois de um erro).
 */
export function MotivoRetificacao({ valor, aoMudar, erro }: { valor: string; aoMudar: (v: string) => void; erro?: string }) {
  return (
    <div className="space-y-1">
      <label htmlFor="motivoRetificacao" className="block font-medium">Motivo da retificação</label>
      <textarea
        id="motivoRetificacao"
        name="motivoRetificacao"
        maxLength={500}
        value={valor}
        onChange={(ev) => aoMudar(ev.target.value)}
        aria-invalid={erro ? true : undefined}
        aria-describedby={erro ? 'motivoRetificacao-dica motivoRetificacao-erro' : 'motivoRetificacao-dica'}
        className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto"
      />
      <p id="motivoRetificacao-dica" className="text-sm text-suave">Fica só no prontuário.</p>
      {erro && <p id="motivoRetificacao-erro" role="alert" className="text-sm text-erro">{erro}</p>}
    </div>
  );
}
