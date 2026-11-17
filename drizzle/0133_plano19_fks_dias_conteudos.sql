-- Plano 19 (spec §9.1, §9.2): o que o Drizzle não gera — o CHECK dos dias da semana (função), as FKs com
-- SET NULL (coluna) e o ramo novo da RN-12 (RN-253) na política de contents.
--
-- RN-246: dias da semana de uma refeição — 1 a 7 valores, de 0 (domingo) a 6 (sábado), em ordem crescente, sem
-- repetição e sem elemento nulo. CHECK não aceita subconsulta, então a regra fica numa função IMMUTABLE (como a
-- app_etiquetas_validas da 0082). array_position(d, NULL) recusa {1,NULL}: bool_and e comparações com NULL deixariam
-- passar. search_path fixo: o CHECK roda também na restauração do backup (pg_restore com search_path vazio,
-- test/restauracao.test.ts). Nunca devolve NULL (um CHECK com NULL passaria).
CREATE OR REPLACE FUNCTION app_dias_semana_validos(d smallint[]) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT coalesce(
    d IS NOT NULL
    AND array_ndims(d) = 1
    AND cardinality(d) BETWEEN 1 AND 7
    AND array_position(d, NULL) IS NULL
    AND d = ARRAY(SELECT DISTINCT x FROM unnest(d) AS x WHERE x BETWEEN 0 AND 6 ORDER BY x),
    false)
$$;
--> statement-breakpoint
ALTER TABLE meals ADD CONSTRAINT meals_dias_validos CHECK (app_dias_semana_validos(dias_semana));
--> statement-breakpoint
-- RN-238 / D30 (molde da 0082): excluir o perfil solta só o ponteiro dos rascunhos e modelos (o publicado não tem
-- referencia_id: CHECK meal_plans_referencia_so_rascunho, e guarda a cópia em referencia_congelada). SET NULL com lista
-- de colunas (PG 15+): tenant_id é NOT NULL e não pode ir junto.
ALTER TABLE meal_plans ADD CONSTRAINT meal_plans_referencia_fk
  FOREIGN KEY (tenant_id, referencia_id) REFERENCES referencias_nutrientes (tenant_id, id) ON DELETE SET NULL (referencia_id);
--> statement-breakpoint
-- RN-253: excluir o conteúdo deixa a ligação com content_id nulo e o título copiado ("{título} (excluído)" no editor).
ALTER TABLE plano_conteudos ADD CONSTRAINT plano_conteudos_conteudo_fk
  FOREIGN KEY (tenant_id, content_id) REFERENCES contents (tenant_id, id) ON DELETE SET NULL (content_id);
--> statement-breakpoint
-- RN-12, exceção ampliada (RN-253, D24): com app.receitas_do_plano ligado (liberarReceitasDoPlano, só no caminho do
-- plano), além da receita sugerida numa refeição (US-054, 0083), o conteúdo PUBLICADO de qualquer tipo ligado por
-- plano_conteudos a um plano PUBLICADO do próprio paciente. As subconsultas rodam com a RLS de quem lê: plano_conteudos
-- e meal_plans só têm as linhas do próprio paciente, nunca o rascunho (paciente_sem_rascunho). O resto é a 0083 sem
-- mudança; o feed, a busca, os favoritos e o registro de visualização (paciente_conteudo_visto) continuam sem a liberação.
DROP POLICY paciente_conteudo_visivel ON contents;
--> statement-breakpoint
CREATE POLICY paciente_conteudo_visivel ON contents AS RESTRICTIVE FOR SELECT
  USING (
    app_current_role() IS DISTINCT FROM 'paciente'
    OR (status = 'publicado' AND (
      visibilidade = 'todos'
      OR (visibilidade = 'pacientes' AND EXISTS (
        SELECT 1 FROM content_audience a
         WHERE a.tenant_id = contents.tenant_id AND a.content_id = contents.id AND a.patient_id = app_current_patient()))
      OR (visibilidade = 'etiquetas' AND app_conteudo_por_etiqueta(contents.id))
      OR (current_setting('app.receitas_do_plano', true) = 'on' AND (
        (tipo = 'receita' AND EXISTS (
          SELECT 1 FROM meals m JOIN meal_plans pl ON pl.tenant_id = m.tenant_id AND pl.id = m.plan_id
           WHERE m.tenant_id = contents.tenant_id AND m.recipe_content_id = contents.id AND pl.status = 'publicado'))
        OR EXISTS (
          SELECT 1 FROM plano_conteudos pc JOIN meal_plans pl ON pl.tenant_id = pc.tenant_id AND pl.id = pc.plan_id
           WHERE pc.tenant_id = contents.tenant_id AND pc.content_id = contents.id AND pl.status = 'publicado')
      ))
    ))
  );
