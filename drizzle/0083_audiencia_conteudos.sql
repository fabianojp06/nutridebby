-- RN-12 / D2 (Plano 07): a sessão de paciente só vê conteúdo PUBLICADO da audiência dela, avaliada na leitura (uma
-- etiqueta aplicada agora vale agora). A audiência por etiqueta usa patient_tag_links, que é staff_only (US-019: o
-- paciente não vê nem os próprios vínculos): esta função responde só "este conteúdo é para uma etiqueta deste
-- paciente ativo?" (nota do Plano 03), sem devolver etiqueta nenhuma. A RLS é FORCE também para o dono das tabelas:
-- a leitura roda com o papel `worker` do MESMO tenant (set_config local à transação, como a app_soltar_endpoint_push
-- da 0075) e devolve o contexto do chamador ANTES de retornar — a política que a chama continua vendo `paciente`.
-- Fora da sessão de paciente responde false (não é atalho para a equipe). search_path fixo e nomes qualificados.
CREATE OR REPLACE FUNCTION app_conteudo_por_etiqueta(p_content uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := current_setting('app.role', true);
  v_patient text := current_setting('app.patient_id', true);
  v_tenant uuid := app_current_tenant();
  v_ok boolean;
BEGIN
  IF v_role IS DISTINCT FROM 'paciente' OR nullif(v_patient, '') IS NULL OR v_tenant IS NULL OR p_content IS NULL THEN
    RETURN false;
  END IF;
  PERFORM set_config('app.role', 'worker', true);
  PERFORM set_config('app.patient_id', '', true);
  v_ok := EXISTS (
    SELECT 1
      FROM public.content_audience a
      JOIN public.patient_tag_links l ON l.tenant_id = a.tenant_id AND l.tag_id = a.tag_id
      JOIN public.patients p ON p.tenant_id = l.tenant_id AND p.id = l.patient_id
     WHERE a.tenant_id = v_tenant AND a.content_id = p_content AND a.tag_id IS NOT NULL
       AND l.patient_id = v_patient::uuid AND p.status = 'ativo' AND p.anonimizado_em IS NULL);
  PERFORM set_config('app.role', v_role, true);
  PERFORM set_config('app.patient_id', v_patient, true);
  RETURN v_ok;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_conteudo_por_etiqueta(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_conteudo_por_etiqueta(uuid) TO nutri_app_role;
--> statement-breakpoint
-- A equipe, o worker, o `publico` e o `conta` não mudam (o `publico` e o `conta` já não veem nada: 0051/0073).
-- As subconsultas rodam com a RLS de quem lê: content_audience só tem as linhas do próprio paciente; meals e
-- meal_plans, só as dele (e nunca o rascunho — paciente_sem_rascunho).
CREATE POLICY paciente_conteudo_visivel ON contents AS RESTRICTIVE FOR SELECT
  USING (
    app_current_role() IS DISTINCT FROM 'paciente'
    OR (status = 'publicado' AND (
      visibilidade = 'todos'
      OR (visibilidade = 'pacientes' AND EXISTS (
        SELECT 1 FROM content_audience a
         WHERE a.tenant_id = contents.tenant_id AND a.content_id = contents.id AND a.patient_id = app_current_patient()))
      OR (visibilidade = 'etiquetas' AND app_conteudo_por_etiqueta(contents.id))
      -- RN-12, exceção (US-054): receita sugerida numa refeição do plano PUBLICADO do próprio paciente — SÓ no caminho
      -- do plano: "Meu plano" e a receita aberta pelo cartão ligam app.receitas_do_plano na própria transação
      -- (liberarReceitasDoPlano, set_config local). O feed, a busca, o filtro de etiquetas, o selo "Novo", os favoritos
      -- e o registro de visualização nunca ligam: lá a receita fora da audiência não existe.
      OR (tipo = 'receita' AND current_setting('app.receitas_do_plano', true) = 'on' AND EXISTS (
        SELECT 1 FROM meals m JOIN meal_plans pl ON pl.tenant_id = m.tenant_id AND pl.id = m.plan_id
         WHERE m.tenant_id = contents.tenant_id AND m.recipe_content_id = contents.id AND pl.status = 'publicado'))
    ))
  );
--> statement-breakpoint
CREATE POLICY paciente_conteudo_visivel ON recipes AS RESTRICTIVE FOR SELECT
  USING (app_current_role() IS DISTINCT FROM 'paciente' OR EXISTS (
    SELECT 1 FROM contents c WHERE c.tenant_id = recipes.tenant_id AND c.id = recipes.content_id));
--> statement-breakpoint
CREATE POLICY paciente_conteudo_visivel ON recipe_ingredients AS RESTRICTIVE FOR SELECT
  USING (app_current_role() IS DISTINCT FROM 'paciente' OR EXISTS (
    SELECT 1 FROM contents c WHERE c.tenant_id = recipe_ingredients.tenant_id AND c.id = recipe_ingredients.content_id));
--> statement-breakpoint
-- US-055 (defesa em profundidade, como a 0080): visualização e favorito só de conteúdo que o paciente vê PELA
-- AUDIÊNCIA — nunca com a liberação do plano ligada (D14: quem abre só pelo cartão, fora da audiência, não conta)
CREATE POLICY paciente_conteudo_visto ON content_views AS RESTRICTIVE FOR INSERT
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente' OR (
    current_setting('app.receitas_do_plano', true) IS DISTINCT FROM 'on' AND EXISTS (
      SELECT 1 FROM contents c WHERE c.tenant_id = content_views.tenant_id AND c.id = content_views.content_id)));
--> statement-breakpoint
CREATE POLICY paciente_conteudo_favorito ON content_favorites AS RESTRICTIVE FOR INSERT
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente' OR (
    current_setting('app.receitas_do_plano', true) IS DISTINCT FROM 'on' AND EXISTS (
      SELECT 1 FROM contents c WHERE c.tenant_id = content_favorites.tenant_id AND c.id = content_favorites.content_id)));
