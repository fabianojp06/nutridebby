'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { removerCapa, removerPdf } from '@/modules/conteudo/arquivos';
import { ehTipoConteudo, MSG_CONTEUDO, MSG_RECEITA } from '@/modules/conteudo/constantes';
import { criarConteudo, despublicarConteudo, excluirConteudo, publicarConteudo, salvarConteudo } from '@/modules/conteudo/conteudos';
import { ConteudoError, ConteudoNaoEncontradoError } from '@/modules/conteudo/erros';
import { salvarReceita } from '@/modules/conteudo/receitas';

/** O que o formulário mandou — volta no estado com o erro (o React 19 limpa o formulário depois da ação). */
export type ValoresDoForm = { titulo: string; resumo: string; link: string; corpo: string; etiquetas: string; visibilidade: string; pacientes: string[]; tags: string[] };
export type ConteudoState = { erros?: Record<string, string>; ok?: string; valores?: ValoresDoForm };

const valoresDo = (fd: FormData): ValoresDoForm => ({
  titulo: String(fd.get('titulo') ?? ''),
  resumo: String(fd.get('resumo') ?? ''),
  link: String(fd.get('link') ?? ''),
  corpo: String(fd.get('corpo') ?? ''),
  etiquetas: String(fd.get('etiquetas') ?? ''),
  visibilidade: String(fd.get('visibilidade') ?? ''),
  pacientes: fd.getAll('pacientes').map(String),
  tags: fd.getAll('tags').map(String),
});

export async function criarConteudoAction(tipo: string, _: ConteudoState, fd: FormData): Promise<ConteudoState> {
  const { ctx } = await requireNutri('/painel/conteudos/novo');
  if (!ehTipoConteudo(tipo)) return { erros: { geral: MSG_CONTEUDO.naoEncontrado } };
  const valores = valoresDo(fd);
  let id: string;
  try {
    id = await criarConteudo(ctx, tipo, valores);
  } catch (e) {
    if (e instanceof ConteudoError) return { erros: e.erros, valores };
    throw e;
  }
  redirect(`/painel/conteudos/${id}`);
}

export async function salvarConteudoAction(id: string, _: ConteudoState, fd: FormData): Promise<ConteudoState> {
  const { ctx } = await requireNutri(`/painel/conteudos/${id}`);
  const valores = valoresDo(fd);
  try {
    await salvarConteudo(ctx, id, valores);
  } catch (e) {
    if (e instanceof ConteudoError) return { erros: e.erros, valores };
    if (e instanceof ConteudoNaoEncontradoError) return { erros: { geral: e.message }, valores };
    throw e;
  }
  revalidatePath(`/painel/conteudos/${id}`);
  return { ok: MSG_CONTEUDO.salvo };
}

export type ReceitaState = { erros?: Record<string, string>; ok?: string };

/** US-051: os ingredientes chegam como JSON (o formulário monta a lista no cliente). */
export async function salvarReceitaAction(id: string, _: ReceitaState, fd: FormData): Promise<ReceitaState> {
  const { ctx } = await requireNutri(`/painel/conteudos/${id}`);
  let ingredientes: unknown = null;
  try {
    ingredientes = JSON.parse(String(fd.get('ingredientes') ?? '[]'));
  } catch {
    ingredientes = null; // vira "Inclua pelo menos um ingrediente."
  }
  try {
    await salvarReceita(ctx, id, { rendimento: fd.get('rendimento'), porcao: fd.get('porcao'), tempo: fd.get('tempo'), modo: fd.get('modo'), ingredientes });
  } catch (e) {
    if (e instanceof ConteudoError) return { erros: e.erros };
    if (e instanceof ConteudoNaoEncontradoError) return { erros: { geral: e.message } };
    throw e;
  }
  revalidatePath(`/painel/conteudos/${id}`);
  return { ok: MSG_RECEITA.salva };
}

export async function publicarConteudoAction(id: string, _: ConteudoState, fd: FormData): Promise<ConteudoState> {
  const { ctx } = await requireNutri(`/painel/conteudos/${id}`);
  void fd; // a Tarefa 10 lê "Avisar pacientes" daqui
  try {
    await publicarConteudo(ctx, id);
  } catch (e) {
    if (e instanceof ConteudoError) return { erros: e.erros };
    if (e instanceof ConteudoNaoEncontradoError) return { erros: { geral: e.message } };
    throw e;
  }
  revalidatePath(`/painel/conteudos/${id}`);
  return { ok: MSG_CONTEUDO.publicado };
}

export async function despublicarConteudoAction(id: string): Promise<void> {
  const { ctx } = await requireNutri(`/painel/conteudos/${id}`);
  await despublicarConteudo(ctx, id).catch((e) => {
    if (!(e instanceof ConteudoNaoEncontradoError)) throw e;
  });
  revalidatePath(`/painel/conteudos/${id}`);
}

export async function excluirConteudoAction(id: string): Promise<void> {
  const { ctx } = await requireNutri(`/painel/conteudos/${id}`);
  try {
    await excluirConteudo(ctx, id);
  } catch (e) {
    // envios de capa/PDF seguidos no meio da exclusão (D17): a página mostra "Outro envio está em andamento…"
    if (e instanceof ConteudoError) redirect(`/painel/conteudos/${id}?ocupado=1`);
    if (!(e instanceof ConteudoNaoEncontradoError)) throw e;
  }
  redirect('/painel/conteudos?excluido=1');
}

export async function removerCapaAction(id: string): Promise<void> {
  const { ctx } = await requireNutri(`/painel/conteudos/${id}`);
  await removerCapa(ctx, id);
  revalidatePath(`/painel/conteudos/${id}`);
}

/** D17: o PDF de uma orientação publicada sem texto não sai — a mensagem volta para a tela (arquivos.tsx). */
export async function removerPdfAction(id: string): Promise<{ erro?: string }> {
  const { ctx } = await requireNutri(`/painel/conteudos/${id}`);
  try {
    await removerPdf(ctx, id);
  } catch (e) {
    if (e instanceof ConteudoError) return { erro: e.erros.geral };
    throw e;
  }
  revalidatePath(`/painel/conteudos/${id}`);
  return {};
}
