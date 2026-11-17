/**
 * Sinal de abrir/fechar do `<summary>` com `display:flex` (o flex tira o marcador nativo do `<details>`). Seta em SVG
 * que gira com o `<details>` aberto — o `<details>` leva `group` (molde: `src/app/painel/pacientes/[id]/inicio/secao.tsx`;
 * em SVG e não em texto, para o axe não deixar o "▸" em "incomplete" no contraste).
 */
export function SetaDetails() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2 shrink-0 transition-transform group-open:rotate-90">
      <path d="M6 3l5 5-5 5" />
    </svg>
  );
}
