import { FocoNaAncora } from '@/components/foco-na-ancora';
import { formatarDecimal } from '@/lib/numero';
import { MSG_CADASTRO_INCOMPLETO } from '@/modules/pacientes/base';
import { formatarDataHora, hojeNoFuso, idadeEm } from '@/modules/pacientes/datas';
import { FORMULAS_TMB, kcal, type Sexo } from '@/modules/pacientes/formulas';
import { listarCalculos, medidasRecentes, MSG_GASTO } from '@/modules/pacientes/gasto-energetico';
import { carregarProntuario } from '../prontuario';
import { salvarCalculoAction } from './actions';
import { CalculoForm } from './calculo-form';

export const dynamic = 'force-dynamic';

const NOME = Object.fromEntries(FORMULAS_TMB.map((f) => [f.id, f.nome]));

export default async function GastoEnergeticoPage({ params }: PageProps<'/painel/pacientes/[id]/gasto-energetico'>) {
  const { id } = await params;
  const { ctx, tenant, paciente } = await carregarProntuario(id);
  const [medidas, calculos] = await Promise.all([medidasRecentes(ctx, paciente.id), listarCalculos(ctx, paciente.id)]);
  const cadastroCompleto = !!paciente.dataNascimento && !!paciente.sexo;
  const idade = paciente.dataNascimento ? idadeEm(paciente.dataNascimento, hojeNoFuso(tenant.fuso)) : null;
  const podeCalcular = cadastroCompleto && paciente.status !== 'bloqueado' && idade !== null && Number.isFinite(idade) && idade >= 18;
  return (
    <div className="space-y-8">
      <FocoNaAncora />
      <section aria-labelledby="novo-calculo" className="max-w-3xl space-y-3">
        <h2 id="novo-calculo" tabIndex={-1} className="text-lg font-semibold">Calcular gasto energético</h2>
        {!cadastroCompleto ? (
          <p role="status">{MSG_CADASTRO_INCOMPLETO}</p>
        ) : podeCalcular ? (
          <CalculoForm
            acao={salvarCalculoAction.bind(null, paciente.id)}
            sexo={paciente.sexo as Sexo}
            idade={idade}
            pesoKg={medidas.pesoKg}
            alturaCm={medidas.alturaCm}
          />
        ) : paciente.status !== 'bloqueado' ? (
          <p role="status">{MSG_GASTO.menor}</p>
        ) : null}
      </section>
      <section aria-labelledby="calculos" className="space-y-3">
        <h2 id="calculos" className="text-lg font-semibold">Cálculos salvos</h2>
        {calculos.length === 0 ? (
          <p>Nenhum cálculo salvo.</p>
        ) : (
          <table className="w-full text-left">
            <caption className="sr-only">Cálculos de gasto energético, do mais recente para o mais antigo</caption>
            <thead className="text-sm text-suave">
              <tr>
                <th scope="col">Quando</th>
                <th scope="col">Fórmula</th>
                <th scope="col">Peso / altura</th>
                <th scope="col">Idade</th>
                <th scope="col">Fator</th>
                <th scope="col">TMB (kcal)</th>
                <th scope="col">GET (kcal)</th>
              </tr>
            </thead>
            <tbody>
              {calculos.map((c) => (
                <tr key={c.id} className="border-t border-linha">
                  <td>{formatarDataHora(c.createdAt, tenant.fuso)}</td>
                  <td>{NOME[c.formula]}</td>
                  <td>{`${formatarDecimal(c.pesoKg, 2)} kg / ${formatarDecimal(c.alturaCm, 1)} cm`}</td>
                  <td>{c.idade}</td>
                  <td>{formatarDecimal(c.fatorAtividade, 2)}</td>
                  <td>{kcal(c.tmb)}</td>
                  <td>{kcal(c.get)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
