import { and, eq, sql } from 'drizzle-orm';
import { patientCadastro, patients } from '@/db/schema';

/**
 * Plano 18 (D7, RN-266): nas telas do Financeiro o paciente aparece pelo nome de exibição — o nome social, quando há, senão o
 * nome civil, como a lista de pacientes (`p.nomeSocial ?? p.nome`). Só a projeção do nome social sai de `patient_cadastro`
 * (nada de CPF nem do resto do cadastro). Quem usa faz o `leftJoin(patientCadastro, cadastroDoPaciente)` depois do join de
 * `patients`; sem paciente (lançamento avulso), `null`.
 *
 * O CSV para o contador (`exportacao.ts`, documento fiscal) e a seção `financeiro` do `dados.json` (`titular.ts`) ficam com o
 * nome civil (`patients.nome`) — o `dados.json` já traz o nome social em `paciente.cadastro`.
 */
export const nomeDeExibicao = sql<string | null>`coalesce(${patientCadastro.nomeSocial}, ${patients.nome})`;

/** A linha do cadastro complementar do paciente do join (no mesmo consultório). */
export const cadastroDoPaciente = and(eq(patientCadastro.tenantId, patients.tenantId), eq(patientCadastro.patientId, patients.id));
