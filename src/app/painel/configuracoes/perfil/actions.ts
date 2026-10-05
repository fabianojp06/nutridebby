'use server';

import { revalidatePath } from 'next/cache';
import { requireNutri } from '@/lib/tenant-session';
import { DocumentoError } from '@/modules/documentos/erros';
import { declararFitoterapia, retirarFitoterapia, salvarDadosParaDocumentos } from '@/modules/documentos/perfil-profissional';

export type DadosDocState = { erros?: Record<string, string>; ok?: boolean; valores?: Record<string, string> };
const PATH = '/painel/configuracoes/perfil';

export async function salvarDadosDocumentosAction(_prev: DadosDocState, f: FormData): Promise<DadosDocState> {
  const { ctx } = await requireNutri(PATH);
  const valores = { nomeProfissional: String(f.get('nomeProfissional') ?? ''), contatoEmail: String(f.get('contatoEmail') ?? ''), contatoTelefone: String(f.get('contatoTelefone') ?? '') };
  try {
    await salvarDadosParaDocumentos(ctx, valores);
  } catch (e) {
    if (e instanceof DocumentoError) return { erros: e.erros, valores };
    throw e;
  }
  revalidatePath(PATH);
  return { ok: true };
}

export async function declararFitoterapiaAction(_prev: DadosDocState, f: FormData): Promise<DadosDocState> {
  const { ctx } = await requireNutri(PATH);
  const valores = { registro: String(f.get('registro') ?? '') };
  try {
    await declararFitoterapia(ctx, { registro: valores.registro, confirmo: f.get('confirmo') });
  } catch (e) {
    if (e instanceof DocumentoError) return { erros: e.erros, valores };
    throw e;
  }
  revalidatePath(PATH);
  return { ok: true };
}

export async function retirarFitoterapiaAction(): Promise<void> {
  const { ctx } = await requireNutri(PATH);
  await retirarFitoterapia(ctx);
  revalidatePath(PATH);
}
