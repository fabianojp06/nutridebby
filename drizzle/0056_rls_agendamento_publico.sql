SELECT app_enable_tenant_rls('public_booking_requests');
--> statement-breakpoint
SELECT app_enable_staff_only('public_booking_requests');
--> statement-breakpoint
-- D11: o pedido da página pública é lido, criado e atualizado (tentativas, verificado, concluído; SELECT … FOR UPDATE) no contexto publico
SELECT app_allow_publico('public_booking_requests', 'select', 'insert', 'update');
