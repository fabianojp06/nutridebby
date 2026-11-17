'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { PdfEmPreparoError, PlanoError, PlanoNaoEditavelError, PlanoNaoEncontradoError } from '@/modules/plano-alimentar/erros';
import { editarPublicado, pedirNovoPdf, publicarPlano } from '@/modules/plano-alimentar/publicacao';
import { criarRascunho, descartarRascunho } from '@/modules/plano-alimentar/rascunho';

export type AcaoPlanoState = { erro?: string };
/**
 * D31 (Plano 19): o "Publicar" (`BotaoPublicar`) recebe também os avisos que não barram ("Publicar mesmo assim") e,
 * no erro de um campo, a chave dele (o erro vira link para o campo).
 */
export type PublicarState = AcaoPlanoState & { avisos?: string[]; campo?: string };

/** Os avisos que o "Publicar mesmo assim" devolve (textos curtos, poucos): o resto do formulário é ignorado. */
const avisosConfirmados = (form: FormData | undefined): string[] =>
  (form?.getAll('confirmarAvisos') ?? []).filter((a): a is string => typeof a === 'string' && a.length <= 300).slice(0, 10);

/** Usada com `useActionState` (BotaoAcao): o estado anterior que o React passa é ignorado. */
export async function criarRascunhoAction(patientId: string): Promise<AcaoPlanoState> {
  const { ctx } = await requireNutri(`/painel/pacientes/${patientId}/plano-alimentar`);
  let id: string;
  try {
    ({ id } = await criarRascunho(ctx, patientId));
  } catch (e) {
    if (e instanceof PacienteBloqueadoError) return { erro: e.message };
    if (e instanceof PacienteNaoEncontradoError) notFound();
    throw e;
  }
  redirect(`/painel/pacientes/${patientId}/plano-alimentar/${id}`);
}

/** "Descartar rascunho" (com `useActionState`): paciente bloqueado mostra o motivo e o rascunho fica. */
export async function descartarRascunhoAction(patientId: string, planId: string): Promise<AcaoPlanoState> {
  const { ctx } = await requireNutri(`/painel/pacientes/${patientId}/plano-alimentar`);
  try {
    await descartarRascunho(ctx, patientId, planId);
  } catch (e) {
    if (e instanceof PacienteBloqueadoError) return { erro: e.message };
    // já descartado (outra aba) ou plano que não é deste paciente: nada a apagar, volta à lista de versões
    if (!(e instanceof PlanoNaoEncontradoError)) throw e;
  }
  revalidatePath(`/painel/pacientes/${patientId}/plano-alimentar`);
  redirect(`/painel/pacientes/${patientId}/plano-alimentar`);
}

/**
 * US-025: publica o rascunho (arquiva o publicado anterior, congela os nutrientes e enfileira o PDF).
 * Plano que não é do paciente da URL (ou que já não existe): "Plano não encontrado." e nada muda.
 * D31 (Plano 19): com aviso, nada é publicado e os avisos voltam; o "Publicar mesmo assim" manda de volta, em
 * `confirmarAvisos`, os avisos que mostrou.
 */
export async function publicarAction(patientId: string, planId: string, _antes?: PublicarState, form?: FormData): Promise<PublicarState> {
  const { ctx } = await requireNutri(`/painel/pacientes/${patientId}/plano-alimentar/${planId}`);
  try {
    const r = await publicarPlano(ctx, patientId, planId, {}, { confirmarAvisos: avisosConfirmados(form) });
    if (r.avisos) return { avisos: r.avisos };
  } catch (e) {
    if (e instanceof PlanoError) {
      const [[campo, erro]] = Object.entries(e.erros);
      return campo === 'geral' ? { erro } : { erro, campo };
    }
    if (e instanceof PlanoNaoEditavelError || e instanceof PacienteBloqueadoError || e instanceof PlanoNaoEncontradoError) return { erro: e.message };
    if (e instanceof PacienteNaoEncontradoError) notFound();
    throw e;
  }
  revalidatePath(`/painel/pacientes/${patientId}/plano-alimentar`, 'layout');
  redirect(`/painel/pacientes/${patientId}/plano-alimentar/${planId}?publicado=1`);
}

/**
 * US-025 "Editar": cria a próxima versão em rascunho a partir do publicado (ou abre o rascunho que já existe).
 * Plano que não é do paciente da URL: "Plano não encontrado." e nenhum rascunho é criado.
 */
export async function editarPublicadoAction(patientId: string, planId: string): Promise<AcaoPlanoState> {
  const { ctx } = await requireNutri(`/painel/pacientes/${patientId}/plano-alimentar/${planId}`);
  let id: string;
  try {
    ({ id } = await editarPublicado(ctx, patientId, planId));
  } catch (e) {
    if (e instanceof PlanoError) return { erro: Object.values(e.erros)[0] };
    if (e instanceof PacienteBloqueadoError || e instanceof PlanoNaoEncontradoError) return { erro: e.message };
    if (e instanceof PacienteNaoEncontradoError) notFound();
    throw e;
  }
  redirect(`/painel/pacientes/${patientId}/plano-alimentar/${id}`);
}

/**
 * US-026 "Gerar o PDF de novo": só de 'falhou'; volta a pendente e o worker gera outra vez. Já em preparo (aba velha
 * que ainda mostra "falhou"): o motivo e a página revalidada, que passa a mostrar "Seu PDF está sendo preparado" e a
 * acompanhar o PDF; já pronto: nada a fazer, a página revalidada mostra "Baixar PDF". Plano que não é do paciente da
 * URL: "Plano não encontrado.", sem efeito.
 */
export async function pedirNovoPdfAction(patientId: string, planId: string): Promise<AcaoPlanoState> {
  const pagina = `/painel/pacientes/${patientId}/plano-alimentar/${planId}`;
  const { ctx } = await requireNutri(pagina);
  try {
    await pedirNovoPdf(ctx, patientId, planId);
  } catch (e) {
    if (e instanceof PdfEmPreparoError) {
      revalidatePath(pagina);
      return { erro: e.message };
    }
    // bloqueado: a página já esconde o botão (corrida com o bloqueio)
    if (e instanceof PlanoNaoEncontradoError || e instanceof PacienteBloqueadoError) return { erro: e.message };
    if (e instanceof PacienteNaoEncontradoError) notFound();
    throw e;
  }
  revalidatePath(pagina);
  return {};
}
