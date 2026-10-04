'use server';
import { revalidatePath } from 'next/cache';
import { requirePaciente } from '@/lib/paciente-session';
import { idValido } from '@/modules/pacientes/base';
import { marcarFavorito, registrarVisualizacao } from '@/modules/portal/conteudos';

/** A tela para onde o login volta; id forjado na chamada da ação não entra no caminho. */
const tela = (id: string) => (idValido(id) ? `/p/conteudos/${id}` : '/p/conteudos');

/** D18: chamada pela página no navegador, uma vez (não no render: a pré-busca do next/link não conta). Sem revalidar. */
export async function vistoAction(id: string): Promise<void> {
  const { ctx } = await requirePaciente(tela(id));
  await registrarVisualizacao(ctx, id);
}

/** US-055 "Favoritos". */
export async function favoritoAction(id: string, favorito: boolean): Promise<void> {
  const { ctx } = await requirePaciente(tela(id));
  await marcarFavorito(ctx, id, favorito === true);
  revalidatePath(tela(id));
  revalidatePath('/p/conteudos');
}
