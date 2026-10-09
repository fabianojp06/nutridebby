import type { ReactNode } from 'react';
import type { TextoLegal } from '@/modules/ia/textos-legais';

/**
 * Plano 14A: um texto legal com os trechos em destaque (art. 33, VIII: "em destaque") como <strong>. Texto puro, sem
 * HTML vindo de fora. `classeTitulo`: a fonte do título muda entre o painel (font-titulo) e o portal (font-portal-titulo).
 * `aposTitulo`: o que vem logo abaixo do título (F4: "Esta autorização é pessoal…" na página do link).
 */
export function TextoLegalView({ texto, id, nivel = 'h2', classeTitulo = 'font-titulo text-lg font-semibold', aposTitulo }: { texto: TextoLegal; id: string; nivel?: 'h1' | 'h2' | 'h3'; classeTitulo?: string; aposTitulo?: ReactNode }) {
  const Titulo = nivel;
  return (
    <article aria-labelledby={id} className="space-y-3">
      <Titulo id={id} className={classeTitulo}>
        {texto.titulo}
      </Titulo>
      {aposTitulo}
      {texto.paragrafos.map((p, i) => (
        <p key={i}>{p.map((t, j) => (t.forte ? <strong key={j}>{t.texto}</strong> : <span key={j}>{t.texto}</span>))}</p>
      ))}
    </article>
  );
}
