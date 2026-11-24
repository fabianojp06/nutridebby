import { acessoComDocumentos } from '@/app/painel/documentos-liberados';
import { MSG_MODELOS } from '@/modules/documentos/modelos';
import { SecoesDePrescricao } from '../../secoes';
import { grupoDaUrl, LISTA_DE_ITENS } from '../../valores';
import { salvarItemSalvoAction } from '../actions';
import { ItemSalvoForm } from '../item-salvo-form';

export const dynamic = 'force-dynamic';

/**
 * Plano 22 (T10b, US-379): "Novo item salvo" — o item nasce do primeiro tipo do grupo (`?tipo=`; "Suplementos" →
 * suplemento, "Fitoterápicos" → planta ou droga vegetal, que não exige habilitação). O tipo muda no seletor do item.
 */
export default async function NovoItemSalvoPage({ searchParams }: PageProps<'/painel/prescricao/itens/novo'>) {
  const { tenant } = await acessoComDocumentos(`${LISTA_DE_ITENS}/novo`);
  const grupo = grupoDaUrl((await searchParams).tipo);
  return (
    <>
      <h1 className="font-titulo text-2xl font-semibold">{MSG_MODELOS.novoItem}</h1>
      <SecoesDePrescricao atual={grupo} />
      <ItemSalvoForm
        acao={salvarItemSalvoAction.bind(null, null)}
        nome=""
        tipoNovo={grupo === 'fitoterapicos' ? 'planta_cha' : 'suplemento'}
        habilitada={!!tenant.fitoterapiaRegistro}
      />
    </>
  );
}
