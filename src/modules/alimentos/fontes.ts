/**
 * RN-230 (Plano 19): de onde vem o alimento (`foods.fonte`). `taco`, `usda` e `tbca` são tabelas públicas (`tenant_id`
 * nulo, só leitura); `propria` é o "Meu alimento" do consultório. Sem imports `@/`: o schema do Drizzle
 * (`src/db/schema/alimentos.ts`) importa daqui com caminho relativo para o CHECK `foods_fonte_valida`.
 */
export const FONTES_DE_ALIMENTO = ['taco', 'usda', 'tbca', 'propria'] as const;

export type Fonte = (typeof FONTES_DE_ALIMENTO)[number];
