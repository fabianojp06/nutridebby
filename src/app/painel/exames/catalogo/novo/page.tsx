import { requireNutri } from '@/lib/tenant-session';
import { MSG_EXAMES } from '@/modules/exames/constantes';
import { salvarExameDoCatalogoAction } from '../actions';
import { ExameCatalogoForm } from '../exame-catalogo-form';

export const dynamic = 'force-dynamic';

const VAZIO = { nome: '', unidade: '', sinonimos: '', componentes: '', modeloNotaAbaixo: '', modeloNotaAcima: '', faixas: [] };

/** Plano 22 (T3, US-370): "Novo exame do catálogo". */
export default async function NovoExameDoCatalogoPage() {
  await requireNutri('/painel/exames/catalogo/novo');
  return (
    <>
      <h1 className="font-titulo text-2xl font-semibold">{MSG_EXAMES.catalogo.tituloNovo}</h1>
      <ExameCatalogoForm acao={salvarExameDoCatalogoAction.bind(null, null)} inicial={VAZIO} />
    </>
  );
}
