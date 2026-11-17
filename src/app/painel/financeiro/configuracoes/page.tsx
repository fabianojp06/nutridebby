import { requireNutri } from '@/lib/tenant-session';
import { lerConfiguracoes, listarCategorias } from '@/modules/financeiro/configuracoes';
import { valorParaCampo } from '@/modules/financeiro/dinheiro';
import { hojeNoFuso } from '@/modules/pacientes/datas';
import { marcadorDoEnvio, TopoDoFinanceiro } from '../topo';
import { Categorias } from './categorias';
import { FormSaldo } from './form-saldo';

export const dynamic = 'force-dynamic';

/**
 * US-300: "Configurações do Financeiro". Sem configuração (primeiro acesso), a data do saldo sugerida é hoje no fuso do
 * consultório e as categorias ainda não existem (nascem na primeira gravação, RN-302).
 */
export default async function ConfiguracoesDoFinanceiro({ searchParams }: PageProps<'/painel/financeiro/configuracoes'>) {
  const { ctx, tenant } = await requireNutri('/painel/financeiro/configuracoes');
  const parametros = await searchParams;
  const [config, categorias] = await Promise.all([lerConfiguracoes(ctx), listarCategorias(ctx)]);
  const inicial = config
    ? {
        saldoInicialEm: config.saldoInicialEm,
        saldoInicial: valorParaCampo(config.saldoInicialCentavos),
        valorConsulta: config.valorConsultaCentavos === null ? '' : valorParaCampo(config.valorConsultaCentavos),
      }
    : { saldoInicialEm: hojeNoFuso(tenant.fuso), saldoInicial: '', valorConsulta: '' };
  // depois de salvar, o redirect volta a esta tela (a mesma árvore): a chave com o `ok`, o `envio` (novo a cada salvamento,
  // mesmo com os mesmos valores) e o que foi salvo descarta o erro de um envio anterior que o estado do formulário guardaria
  const chave = [typeof parametros.ok === 'string' ? parametros.ok : '', marcadorDoEnvio(parametros.envio), ...Object.values(inicial)].join('|');
  return (
    <>
      <TopoDoFinanceiro titulo="Configurações do Financeiro" parametros={parametros} />
      <FormSaldo key={chave} inicial={inicial} />
      {config && (
        <Categorias categorias={categorias.map((c) => ({ id: c.id, tipo: c.tipo, nome: c.nome, arquivada: c.arquivadaEm !== null, fixa: c.chave !== null }))} />
      )}
    </>
  );
}
