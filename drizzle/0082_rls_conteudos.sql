-- Plano 07 (M6): RLS de tenant em todas as tabelas de conteúdo; de paciente nas que têm patient_id. A leitura por
-- audiência (RN-12) da sessão de paciente vem na 0083 (política paciente_conteudo_visivel).
SELECT app_enable_tenant_rls('contents');
--> statement-breakpoint
SELECT app_enable_tenant_rls('recipes');
--> statement-breakpoint
SELECT app_enable_tenant_rls('recipe_ingredients');
--> statement-breakpoint
SELECT app_enable_tenant_rls('content_audience');
--> statement-breakpoint
SELECT app_enable_patient_rls('content_audience');
--> statement-breakpoint
-- D6: escolher pacientes para um conteúdo ("Cardápio para gestantes" → Ana) é decisão clínica: escritas auditadas
SELECT app_enable_audit('content_audience', 'conteudos');
--> statement-breakpoint
SELECT app_enable_tenant_rls('content_views');
--> statement-breakpoint
SELECT app_enable_patient_rls('content_views');
--> statement-breakpoint
-- US-055 (D18): o paciente registra a própria visualização, uma vez (INSERT … ON CONFLICT DO NOTHING)
SELECT app_allow_paciente_escrita('content_views', 'insert');
--> statement-breakpoint
SELECT app_enable_tenant_rls('content_favorites');
--> statement-breakpoint
SELECT app_enable_patient_rls('content_favorites');
--> statement-breakpoint
-- US-055: favoritar e desfavoritar
SELECT app_allow_paciente_escrita('content_favorites', 'insert', 'delete');
--> statement-breakpoint
-- US-054 / D13: a refeição só aponta para receita do mesmo tenant; excluir o conteúdo solta só a sugestão
-- (SET NULL com lista de colunas, PG 15+: tenant_id é NOT NULL e não pode ir junto)
ALTER TABLE meals ADD CONSTRAINT meals_receita_fk
  FOREIGN KEY (tenant_id, recipe_content_id) REFERENCES contents (tenant_id, id) ON DELETE SET NULL (recipe_content_id);
