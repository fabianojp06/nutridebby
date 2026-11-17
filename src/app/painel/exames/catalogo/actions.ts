'use server';

import { redirect } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { adicionarNomesParaComecar, excluirExameDoCatalogo, salvarExameDoCatalogo } from '@/modules/exames/catalogo';
import { CatalogoError } from '@/modules/exames/catalogo-regras';
import { MSG_EXAMES } from '@/modules/exames/constantes';
import { entradaDoExame, novoMarcador, valoresDoExame } from '../valores';

/** Plano 22 (T3, US-370): as actions do catálogo. Erro devolve `valores` (nada do que foi digitado some) e `envio` (o formulário remonta com eles). */
export type ExameCatalogoState = { erros?: Record<string, string>; valores?: Record<string, string>; envio?: number };
export type NomesParaComecarState = { erro?: string; envio?: number };

const LISTA = '/painel/exames/catalogo';

export async function salvarExameDoCatalogoAction(id: string | null, _prev: ExameCatalogoState, fd: FormData): Promise<ExameCatalogoState> {
  const { ctx, tenant } = await requireNutri(id ? `${LISTA}/${id}` : `${LISTA}/novo`);
  try {
    await salvarExameDoCatalogo(ctx, tenant, id, entradaDoExame(fd));
  } catch (e) {
    if (e instanceof CatalogoError) return { erros: e.erros, valores: valoresDoExame(fd), envio: Date.now() };
    throw e;
  }
  redirect(`${LISTA}?ok=salvo&r=${novoMarcador()}`);
}

/** O `DialogoConfirmar` chama depois do "Excluir": de volta à lista com "Exame excluído do catálogo." (já excluído em outra aba: só volta). */
export async function excluirExameDoCatalogoAction(id: string): Promise<void> {
  const { ctx } = await requireNutri(LISTA);
  const excluiu = await excluirExameDoCatalogo(ctx, id);
  redirect(excluiu ? `${LISTA}?ok=excluido&r=${novoMarcador()}` : LISTA);
}

/** RN-372: "Adicionar ao catálogo" — os nomes marcados (`nome`, um por caixa); o diálogo fecha pelo novo marcador da URL. */
export async function adicionarNomesParaComecarAction(_prev: NomesParaComecarState, fd: FormData): Promise<NomesParaComecarState> {
  const { ctx } = await requireNutri(LISTA);
  const nomes = fd.getAll('nome').filter((n): n is string => typeof n === 'string');
  if (!nomes.length) return { erro: MSG_EXAMES.catalogo.nenhumMarcado, envio: Date.now() };
  let n: number;
  try {
    n = await adicionarNomesParaComecar(ctx, nomes);
  } catch (e) {
    if (e instanceof CatalogoError) return { erro: Object.values(e.erros)[0], envio: Date.now() };
    throw e;
  }
  redirect(`${LISTA}?ok=adicionados&n=${n}&r=${novoMarcador()}`);
}
