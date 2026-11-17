import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import { makeDb } from './db';
import { tenants } from '@/db/schema';
import { listTenantTables, PACIENTE_ESCREVE, PUBLICO_LIBERADO, RLS_EXCEPTIONS, STAFF_ONLY } from '@/db/rls-guard';
import { withConta, withTenant, type TenantRole } from '@/db/tenant';

let seqConsulta = 0;
/** Cada chamada ganha um horário próprio de 1 h (EXCLUDE appointments_sem_sobreposicao). */
const horaIso = () => sql`'2030-01-01T00:00:00Z'::timestamptz + ${++seqConsulta} * interval '2 hours'`;

/**
 * RNF-07: "tenta ler, alterar e excluir dados de outro tenant e de outro paciente do mesmo tenant
 * em todas as tabelas 🔒". Cada tabela nova com tenant_id PRECISA de uma fábrica aqui.
 *
 * PF-F3: as fábricas semeiam os DOIS tenants (A e B), cada um com os seus dois pacientes, para que o
 * teste falhe tanto se uma política negar tudo quanto se liberar tudo.
 * P03: as tabelas filhas têm FK composta (tenant_id, patient_id) → patients, então cada tenant tem os
 * próprios pacientes (PAC) e `patients` é semeada primeiro e apagada por último (ULTIMAS).
 * Fábrica que precisa de uma linha-mãe (etiqueta, atendimento) cria a mãe no mesmo comando (CTE).
 */
const FABRICAS: Record<string, (tenantId: string, patientId: string) => SQL> = {
  audit_log: (t, p) => sql`insert into audit_log (tenant_id, acao, entidade, patient_id) values (${t}, 'ler', 'isolamento', ${p})`,
  // 0080: o paciente só vê as do titular — a fábrica grava escopo titular para P2 ver as próprias linhas
  data_exports: (t, p) => sql`insert into data_exports (tenant_id, patient_id, escopo) values (${t}, ${p}, 'titular')`,
  exams: (t, p) => sql`insert into exams (tenant_id, patient_id, data, titulo) values (${t}, ${p}, '2026-01-01', 'Iso')`,
  privacy_requests: (t, p) => sql`insert into privacy_requests (tenant_id, patient_id, tipo, prazo) values (${t}, ${p}, 'exclusao', '2026-01-16')`,
  stored_files: (t, p) =>
    sql`insert into stored_files (tenant_id, patient_id, tipo, caminho, bytes, mime) values (${t}, ${p}, 'exame', ${`${t}/exame/${randomUUID()}.png`}, 1, 'image/png')`,
  rls_fixture_patient_items: (t, p) => sql`insert into rls_fixture_patient_items (tenant_id, patient_id, texto) values (${t}, ${p}, 'x')`,
  audit_fixture_registros: (t, p) => sql`insert into audit_fixture_registros (tenant_id, patient_id, texto) values (${t}, ${p}, 'x')`,
  patients: (t, p) =>
    sql`insert into patients (id, tenant_id, nome, data_nascimento, sexo, email) values (${p}, ${t}, 'Iso', '1990-01-01', 'F', ${`iso-${p}@teste.dev`})`,
  anthropometry: (t, p) => sql`insert into anthropometry (tenant_id, patient_id, data, peso_kg, altura_cm) values (${t}, ${p}, '2026-01-01', 70, 175)`,
  energy_calcs: (t, p) =>
    sql`insert into energy_calcs (tenant_id, patient_id, formula, peso_kg, altura_cm, idade, sexo, fator_atividade, tmb, get)
        values (${t}, ${p}, 'mifflin', 60, 165, 35, 'F', 1.55, 1295.25, 2007.64)`,
  anamnesis_templates: (t) => sql`insert into anamnesis_templates (tenant_id, nome, schema) values (${t}, 'Iso', '{"perguntas":[]}')`,
  consultations: (t, p) => sql`insert into consultations (tenant_id, patient_id, data, orientacoes_paciente) values (${t}, ${p}, '2026-01-01', 'x')`,
  consultation_notes: (t, p) => sql`with c as (insert into consultations (tenant_id, patient_id, data) values (${t}, ${p}, '2026-01-01') returning id)
    insert into consultation_notes (tenant_id, patient_id, consultation_id, texto) select ${t}, ${p}, c.id, 'x' from c`,
  anamneses: (t, p) =>
    sql`insert into anamneses (tenant_id, patient_id, template_snapshot, data) values (${t}, ${p}, '{"nome":"Iso","perguntas":[]}', '2026-01-01')`,
  patient_tags: (t) => sql`insert into patient_tags (tenant_id, nome) values (${t}, ${`iso-${randomUUID().slice(0, 8)}`})`,
  patient_tag_links: (t, p) => sql`with e as (insert into patient_tags (tenant_id, nome) values (${t}, ${`iso-${randomUUID().slice(0, 8)}`}) returning id)
    insert into patient_tag_links (tenant_id, patient_id, tag_id) select ${t}, ${p}, e.id from e`,
  foods: (t) =>
    sql`insert into foods (tenant_id, nome, grupo, kcal, proteina_g, carboidrato_g, lipidio_g, fibra_g)
        values (${t}, 'Iso', 'Miscelâneas', 100, 1, 1, 1, 1)`,
  food_measures: (t) =>
    sql`insert into food_measures (tenant_id, food_id, nome, plural, gramas)
        values (${t}, '00000000-0000-4000-8000-000000000003', ${`Iso ${randomUUID().slice(0, 8)}`}, 'Isos', 10)`,
  meal_plans: (t, p) => sql`insert into meal_plans (tenant_id, patient_id, titulo, status) values (${t}, ${p}, 'Iso', 'publicado')`,
  meals: (t, p) =>
    sql`with pl as (insert into meal_plans (tenant_id, patient_id, titulo, status) values (${t}, ${p}, 'Iso', 'arquivado') returning id)
        insert into meals (id, tenant_id, patient_id, plan_id, nome, ordem) select gen_random_uuid(), ${t}, ${p}, pl.id, 'Café', 0 from pl`,
  meal_items: (t, p) =>
    sql`with pl as (insert into meal_plans (tenant_id, patient_id, titulo, status) values (${t}, ${p}, 'Iso', 'arquivado') returning id),
             ml as (insert into meals (id, tenant_id, patient_id, plan_id, nome, ordem) select gen_random_uuid(), ${t}, ${p}, pl.id, 'Café', 0 from pl returning id, plan_id)
        insert into meal_items (id, tenant_id, patient_id, plan_id, meal_id, food_id, quantidade_g, ordem)
        select gen_random_uuid(), ${t}, ${p}, ml.plan_id, ml.id, '00000000-0000-4000-8000-000000000003', 100, 0 from ml`,
  availability_rules: (t) =>
    sql`insert into availability_rules (tenant_id, dia_semana, inicio, fim, duracao_min, modalidade) values (${t}, 2, '08:00', '12:00', 60, 'presencial')`,
  availability_blocks: (t) =>
    sql`insert into availability_blocks (tenant_id, inicio, fim, motivo) values (${t}, '2030-01-01T03:00:00Z', '2030-01-02T03:00:00Z', 'Iso')`,
  appointments: (t, p) => {
    const h = horaIso();
    return sql`insert into appointments (tenant_id, patient_id, inicio, fim, modalidade, origem) values (${t}, ${p}, ${h}, ${h} + interval '1 hour', 'presencial', 'nutri')`;
  },
  notifications: (t, p) => {
    const h = horaIso();
    return sql`with c as (insert into appointments (tenant_id, patient_id, inicio, fim, modalidade, origem)
        values (${t}, ${p}, ${h}, ${h} + interval '1 hour', 'presencial', 'nutri') returning id, inicio)
      insert into notifications (tenant_id, patient_id, appointment_id, inicio_consulta, canal, tipo, agendada_para) select ${t}, ${p}, c.id, c.inicio, 'email', 'lembrete_24h', now() from c`;
  },
  public_booking_requests: (t) =>
    sql`insert into public_booking_requests (id, tenant_id, token_hash, codigo_hash, email, nome, inicio, modalidade, termo_versao, expira_em)
        values (gen_random_uuid(), ${t}, ${randomUUID()}, 'x', ${`iso-${randomUUID().slice(0, 8)}@teste.dev`}, 'Iso', '2030-01-01T12:00:00Z', 'presencial', 't', now() + interval '10 minutes')`,
  access_events: (t, p) => sql`insert into access_events (tenant_id, patient_id, dia) values (${t}, ${p}, ${`2030-01-${String((++seqConsulta % 28) + 1).padStart(2, '0')}`})`,
  push_subscriptions: (t, p) =>
    sql`insert into push_subscriptions (tenant_id, patient_id, endpoint, p256dh, auth) values (${t}, ${p}, ${`https://push.example.test/${randomUUID()}`}, ${'a'.repeat(87)}, ${'b'.repeat(22)})`,
  diary_entries: (t, p) => sql`insert into diary_entries (tenant_id, patient_id, refeicao, resposta, refeicao_do_plano) values (${t}, ${p}, 'Almoço', 'como_no_plano', 'Almoço · 12:30')`,
  // Plano 07: cada fábrica cria o próprio conteúdo (UNIQUE (content_id, patient_id) em views/favoritos) no mesmo comando
  contents: (t) => sql`insert into contents (tenant_id, tipo, titulo, status, publicado_em) values (${t}, 'orientacao', 'Iso', 'publicado', now())`,
  recipes: (t) => sql`with c as (insert into contents (tenant_id, tipo, titulo) values (${t}, 'receita', 'Iso') returning id)
    insert into recipes (tenant_id, content_id, rendimento_total_g, porcao_g) select ${t}, c.id, 1000, 250 from c`,
  recipe_ingredients: (t) =>
    sql`with c as (insert into contents (tenant_id, tipo, titulo) values (${t}, 'receita', 'Iso') returning id),
             r as (insert into recipes (tenant_id, content_id, rendimento_total_g, porcao_g) select ${t}, c.id, 1000, 250 from c returning content_id)
        insert into recipe_ingredients (tenant_id, content_id, food_id, quantidade_g, ordem)
        select ${t}, r.content_id, '00000000-0000-4000-8000-000000000003', 100, 0 from r`,
  content_audience: (t, p) =>
    sql`with c as (insert into contents (tenant_id, tipo, titulo, visibilidade, status, publicado_em) values (${t}, 'orientacao', 'Iso', 'pacientes', 'publicado', now()) returning id)
        insert into content_audience (tenant_id, content_id, patient_id) select ${t}, c.id, ${p} from c`,
  content_views: (t, p) =>
    sql`with c as (insert into contents (tenant_id, tipo, titulo, status, publicado_em) values (${t}, 'orientacao', 'Iso', 'publicado', now()) returning id)
        insert into content_views (tenant_id, content_id, patient_id) select ${t}, c.id, ${p} from c`,
  content_favorites: (t, p) =>
    sql`with c as (insert into contents (tenant_id, tipo, titulo, status, publicado_em) values (${t}, 'orientacao', 'Iso', 'publicado', now()) returning id)
        insert into content_favorites (tenant_id, content_id, patient_id) select ${t}, c.id, ${p} from c`,
  // uma linha por tenant (tenant_id UNIQUE): a fábrica roda duas vezes por tenant
  whatsapp_conexoes: (t) =>
    sql`insert into whatsapp_conexoes (tenant_id, instancia) select ${t}, ${`nd-${t}`} where not exists (select 1 from whatsapp_conexoes where tenant_id = ${t})`,
  // Plano 10A: as fábricas rodam como nutri; documento EMITIDO já anonimizado (visível ao paciente e sem arquivo)
  signed_documents: (t, p) =>
    sql`insert into signed_documents (tenant_id, patient_id, status, codigo, anonimizado_em) values (${t}, ${p}, 'assinado', upper(substr(translate(md5(random()::text), 'ilou', '0123'), 1, 12)), now())`,
  signed_document_notes: (t, p) =>
    sql`with d as (insert into signed_documents (tenant_id, patient_id) values (${t}, ${p}) returning id)
        insert into signed_document_notes (tenant_id, patient_id, documento_id, justificativa_uso) select ${t}, ${p}, d.id, 'Iso' from d`,
  signed_document_receipts: (t, p) =>
    sql`with d as (insert into signed_documents (tenant_id, patient_id, status, codigo, anonimizado_em) values (${t}, ${p}, 'assinado', upper(substr(translate(md5(random()::text), 'ilou', '0123'), 1, 12)), now()) returning id)
        insert into signed_document_receipts (tenant_id, patient_id, documento_id, evento, via, registrado_por) select ${t}, ${p}, d.id, 'recebido', 'pessoalmente', app_current_user() from d`, // 0092: fora da sessão de paciente, só "pessoalmente"
  document_access_codes: (t, p) =>
    sql`with d as (insert into signed_documents (tenant_id, patient_id, status, codigo, anonimizado_em) values (${t}, ${p}, 'assinado', upper(substr(translate(md5(random()::text), 'ilou', '0123'), 1, 12)), now()) returning id)
        insert into document_access_codes (tenant_id, patient_id, documento_id, codigo_hash, expira_em) select ${t}, ${p}, d.id, 'h', now() + interval '10 minutes' from d`,
  // Plano 11 (revisão T1): sem a linha-mãe — exam_id é anulável (SET NULL ao excluir o exame, coberto em ia-schema.test.ts),
  // então a recusa vem da política de ia_tarefas, não da de exams (COM_MAE); "falhou" para não cair no índice único parcial
  // de leitura em andamento (na_fila/processando)
  ia_tarefas: (t, p) =>
    sql`insert into ia_tarefas (tenant_id, patient_id, tipo, status, exam_id, pedido_por, modelo, prompt_versao, reserva_micro_usd, erro)
        values (${t}, ${p}, 'leitura_exame', 'falhou', null, coalesce(app_current_user(), gen_random_uuid()), 'claude-opus-5-5', 'iso', 0, 'interrompida')`,
  ia_uso: (t) =>
    sql`insert into ia_uso (tenant_id, tarefa_id, tipo, modelo, prompt_versao, custo_micro_usd, situacao, mes) values (${t}, gen_random_uuid(), 'leitura_exame', 'claude-opus-5-5', 'iso', 1, 'confirmado', '2026-10')`,
  // Plano 14B: "falhou" para não cair no índice de um pacote em andamento por tenant (a fábrica roda duas vezes por tenant)
  ia_geracoes_modelos: (t) =>
    sql`insert into ia_geracoes_modelos (tenant_id, area, status, pedido_por, modelo, prompt_versao, reserva_micro_usd, erro)
        values (${t}, 'diabetes', 'falhou', coalesce(app_current_user(), gen_random_uuid()), 'claude-sonnet-5-5', 'iso', 0, 'interrompida')`,
  // Plano 14A (desvio 1 do plano): as fábricas rodam como nutri, e o gatilho ia_autorizacoes_regras só deixa a equipe gravar
  // papel, nutricionista e pedido_email, em nome da própria usuária — a retirada pela nutricionista não precisa de linha-mãe
  // (o paciente já existe), então a recusa dos testes negativos vem da política da própria tabela (fora de COM_MAE).
  // `coalesce`: nos contextos sem usuário (publico, conta) o gatilho deixa passar e a RLS recusa.
  ia_autorizacoes: (t, p) =>
    sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, canal, registrado_por) values (${t}, ${p}, 'retirou', 'nutricionista', coalesce(app_current_user(), gen_random_uuid()))`,
  // Plano 12: nasce "processando" (gatilho exam_submissions_nasce, revisão do plano); o beforeAll leva as linhas a "recebido" pelo
  // worker (a transição legal) para a sessão de paciente conseguir cancelar a própria linha (UPDATE_DO_PACIENTE); o gatilho
  // exam_submissions_regras recusa mudar tenant/paciente (IMUTAVEIS) e o exam_submissions_sem_apagar recusa o DELETE (SEM_DELETE)
  exam_submissions: (t, p) =>
    sql`insert into exam_submissions (tenant_id, patient_id, enviado_por, status, data_coleta)
        values (${t}, ${p}, coalesce(app_current_user(), gen_random_uuid()), 'processando', '2026-01-01')`,
  // a linha de arquivo precisa do original (stored_files) e do envio: cria os dois no mesmo comando (COM_MAE)
  exam_submission_files: (t, p) =>
    sql`with a as (insert into stored_files (tenant_id, tipo, caminho, bytes, mime, patient_id)
                   values (${t}, 'exame_original', ${t}::text || '/exame_original/' || gen_random_uuid()::text || '.jpg', 1, 'image/jpeg', ${p}) returning caminho),
             s as (insert into exam_submissions (tenant_id, patient_id, enviado_por, status, data_coleta)
                   values (${t}, ${p}, coalesce(app_current_user(), gen_random_uuid()), 'processando', '2026-01-01') returning id)
        insert into exam_submission_files (tenant_id, patient_id, submission_id, arquivo_path, papel, ordem)
        select ${t}, ${p}, s.id, a.caminho, 'original', 1 from a, s`,
  // Plano 15 (DP-14): a equipe não insere conversa no app, mas o banco não recusa (como ia_tarefas); a fábrica grava uma
  // pergunta já respondida, sem risco, para a sessão de paciente ter o que encaminhar (UPDATE_DO_PACIENTE)
  ia_nutri_participacoes: (t, p) =>
    sql`insert into ia_nutri_participacoes (tenant_id, patient_id, liberada_em, liberada_por) values (${t}, ${p}, now(), coalesce(app_current_user(), gen_random_uuid()))`,
  ia_nutri_mensagens: (t, p) =>
    sql`insert into ia_nutri_mensagens (tenant_id, patient_id, sessao_inicio, autor, texto, status, expira_em)
        values (${t}, ${p}, now(), 'paciente', 'Iso', 'respondida', now() + interval '180 days')`,
  // RN-171: o aceite é só do paciente (gatilho); a fábrica grava a revogação com o marcador local (o gatilho exige)
  ia_nutri_consentimentos: (t, p) =>
    sql`with m as materialized (select set_config('app.ia_nutri_revogando', '1', true) as x)
        insert into ia_nutri_consentimentos (tenant_id, patient_id, evento, canal, registrado_por)
        select ${t}, ${p}, 'revogacao', 'app', coalesce(app_current_user(), gen_random_uuid()) from m`,
  // Plano 17: água (um por paciente, índice único parcial); a marca de envio cria a mãe no mesmo comando como suplemento (com
  // texto: não colide com o índice da água) e é semeada pelo worker (PAPEL_DA_FABRICA: o gatilho lembretes_rotina_envios_do_worker
  // recusa a equipe); nos testes negativos a recusa vem da RLS da mãe (COM_MAE)
  lembretes_rotina: (t, p) =>
    sql`insert into lembretes_rotina (tenant_id, patient_id, tipo, config, criado_por)
        values (${t}, ${p}, 'agua', '{"inicio":"08:00","fim":"20:00","intervaloMin":120,"dias":[0,1,2,3,4,5,6]}', coalesce(app_current_user(), gen_random_uuid()))`,
  lembretes_rotina_envios: (t, p) =>
    sql`with l as (insert into lembretes_rotina (tenant_id, patient_id, tipo, config, texto, criado_por)
                   values (${t}, ${p}, 'suplemento', '{"horarios":["08:00"],"dias":[1,2,3,4,5]}', 'Iso', coalesce(app_current_user(), gen_random_uuid())) returning id)
        insert into lembretes_rotina_envios (lembrete_id, tenant_id, patient_id, ultimo_slot_em) select l.id, ${t}, ${p}, now() from l`,
  // Plano 20 (spec §9.5): uma linha por consultório (a fábrica roda duas vezes por tenant) — ON CONFLICT DO NOTHING
  fin_configuracoes: (t) =>
    sql`insert into fin_configuracoes (tenant_id, saldo_inicial_centavos, saldo_inicial_em) values (${t}, 0, '2026-11-01') on conflict do nothing`,
  // nome único por consultório e tipo: um por chamada
  fin_categorias: (t) => sql`insert into fin_categorias (tenant_id, tipo, nome) values (${t}, 'saida', 'Iso ' || gen_random_uuid()::text)`,
  // entrada com paciente e sem consulta (a FK da consulta é anulável: fica de fora); a categoria (FK NOT NULL) no mesmo comando
  // (COM_MAE). O gatilho fin_lancamentos_regras grava criado_por com a usuária da sessão
  fin_lancamentos: (t, p) =>
    sql`with c as (insert into fin_categorias (tenant_id, tipo, nome) values (${t}, 'entrada', 'Iso ' || gen_random_uuid()::text) returning id)
        insert into fin_lancamentos (tenant_id, tipo, categoria_id, valor_centavos, vencimento, patient_id, criado_por)
        select ${t}, 'entrada', c.id, 100, '2026-11-10', ${p}, coalesce(app_current_user(), gen_random_uuid()) from c`,
  // Plano 19: biblioteca do consultório (staff_only). Nome único por tenant e a fábrica roda duas vezes por tenant: nome aleatório.
  // As filhas criam a mãe no mesmo comando (COM_MAE); os itens usam o alimento 3 da TACO (FK RESTRICT para foods).
  referencias_nutrientes: (t) =>
    sql`insert into referencias_nutrientes (tenant_id, nome, fonte, valores) values (${t}, ${`Iso ${randomUUID().slice(0, 8)}`}, 'Iso', '{}')`,
  refeicoes_modelo: (t) => sql`insert into refeicoes_modelo (tenant_id, nome, tipo) values (${t}, 'Iso', 'Almoço')`,
  refeicoes_modelo_itens: (t) =>
    sql`with r as (insert into refeicoes_modelo (tenant_id, nome, tipo) values (${t}, 'Iso', 'Almoço') returning id)
        insert into refeicoes_modelo_itens (tenant_id, refeicao_id, food_id, quantidade_g, ordem)
        select ${t}, r.id, '00000000-0000-4000-8000-000000000003', 100, 0 from r`,
  listas_substituicao: (t) => sql`insert into listas_substituicao (tenant_id, nome) values (${t}, ${`Iso ${randomUUID().slice(0, 8)}`})`,
  listas_substituicao_grupos: (t) =>
    sql`with l as (insert into listas_substituicao (tenant_id, nome) values (${t}, ${`Iso ${randomUUID().slice(0, 8)}`}) returning id)
        insert into listas_substituicao_grupos (tenant_id, lista_id, nome, ordem) select ${t}, l.id, 'Iso', 0 from l`,
  listas_substituicao_itens: (t) =>
    sql`with l as (insert into listas_substituicao (tenant_id, nome) values (${t}, ${`Iso ${randomUUID().slice(0, 8)}`}) returning id),
             g as (insert into listas_substituicao_grupos (tenant_id, lista_id, nome, ordem) select ${t}, l.id, 'Iso', 0 from l returning lista_id, id)
        insert into listas_substituicao_itens (tenant_id, lista_id, grupo_id, food_id, quantidade_g, ordem)
        select ${t}, g.lista_id, g.id, '00000000-0000-4000-8000-000000000003', 100, 0 from g`,
  // Plano 19: ligações ao plano, com a mãe no mesmo comando (COM_MAE) e ARQUIVADA, como em meals: rascunho deixaria a paciente
  // sem linhas (paciente_sem_rascunho) e publicado bateria em meal_plans_um_publicado_idx. content_id nulo (regra 9: FK anulável
  // fica de fora).
  plano_listas_substituicao: (t, p) =>
    sql`with pl as (insert into meal_plans (tenant_id, patient_id, titulo, status) values (${t}, ${p}, 'Iso', 'arquivado') returning id)
        insert into plano_listas_substituicao (tenant_id, patient_id, plan_id, nome, conteudo, ordem) select ${t}, ${p}, pl.id, 'Iso', '{}', 0 from pl`,
  plano_conteudos: (t, p) =>
    sql`with pl as (insert into meal_plans (tenant_id, patient_id, titulo, status) values (${t}, ${p}, 'Iso', 'arquivado') returning id)
        insert into plano_conteudos (tenant_id, patient_id, plan_id, content_id, titulo, ordem) select ${t}, ${p}, pl.id, null, 'Iso', 0 from pl`,
};
/** Papel do beforeAll quando a equipe não pode semear a tabela (as fábricas rodam como `nutri` por padrão). */
const PAPEL_DA_FABRICA: Record<string, TenantRole> = { lembretes_rotina_envios: 'worker' };
/** Tabelas append-only: UPDATE/DELETE já são negados por permissão. */
const SO_INSERE = new Set(['audit_log', 'signed_document_receipts', 'ia_autorizacoes', 'ia_nutri_consentimentos']);
/**
 * D9 (Plano 11): UPDATE permitido, DELETE negado à equipe — ia_tarefas pelo gatilho ia_tarefas_sem_apagar (só o worker
 * apaga, na anonimização) e ia_uso por REVOKE. O teste de DELETE do tenant B pula o DELETE e confere que nada sumiu.
 * Plano 12: exam_submissions — gatilho exam_submissions_sem_apagar (0102): só o worker apaga, com o titular bloqueado ou anonimizado.
 * Plano 15: ia_nutri_mensagens — gatilho ia_nutri_mensagens_sem_apagar (0116): só o worker apaga, com a mensagem vencida, o
 * titular bloqueado ou anonimizado, ou na revogação (e a equipe, só a pergunta com risco de quem revogou, depois de aberta —
 * D22; a fábrica não grava essa).
 */
// Plano 20: fin_lancamentos (cancela-se, nunca se apaga) e fin_configuracoes (a linha do consultório) — DELETE revogado (0123)
const SEM_DELETE = new Set(['ia_tarefas', 'ia_uso', 'exam_submissions', 'ia_geracoes_modelos', 'ia_nutri_mensagens', 'fin_lancamentos', 'fin_configuracoes']);
/**
 * R4 do pre-flight (Plano 11): em ia_uso o DELETE é negado por permissão (REVOKE) antes da RLS, para qualquer contexto —
 * inclusive o publico, que não vê linha nenhuma. Em ia_tarefas o publico não vê linha: o gatilho (por linha) nem dispara.
 */
// Plano 14B: ia_geracoes_modelos também tem DELETE/TRUNCATE revogados (0112).
// Plano 20: fin_lancamentos e fin_configuracoes também (0123).
const DELETE_REVOGADO = new Set(['ia_uso', 'ia_geracoes_modelos', 'fin_lancamentos', 'fin_configuracoes']);
/**
 * D19 (Plano 10A): os gatilhos de imutabilidade (0091, T2) — app_documento_imutavel, o das notas e app_codigo_acesso_regras
 * (colunas do código do link, R1 do pre-flight) — recusam mudar tenant_id/patient_id com 42501 ANTES do WITH CHECK da RLS
 * (mensagem própria, não "row-level security"); em signed_documents, só o rascunho é apagado.
 */
// Plano 11 (revisão final, Minor 2): ia_tarefas_imutavel (0100) recusa mudar tenant_id/patient_id com 42501 antes da RLS.
// Plano 12: exam_submissions — gatilho exam_submissions_regras (0102): tenant e paciente são colunas fixas (42501 antes da RLS).
// Plano 14B: ia_geracoes_modelos_imutavel (0112) recusa mudar tenant_id (coluna fixa) com 42501 antes da RLS.
// Plano 15: ia_nutri_mensagens_regras (0116) recusa mudar tenant_id/patient_id (colunas fixas) com 42501 antes da RLS.
// Plano 17: lembretes_rotina_regras (0119) recusa mudar tenant_id/patient_id (colunas fixas) com 42501 antes da RLS; o
// lembretes_rotina_envios_do_worker (0119) também (tenant, paciente e lembrete fixos para todos).
const IMUTAVEIS = new Set([
  'signed_documents',
  'signed_document_notes',
  'document_access_codes',
  'ia_tarefas',
  'exam_submissions',
  'ia_geracoes_modelos',
  'ia_nutri_mensagens',
  'lembretes_rotina',
  'lembretes_rotina_envios',
  // Plano 20: fin_lancamentos_regras recusa mudar tenant_id/patient_id com 42501 antes da RLS
  'fin_lancamentos',
]);
/**
 * Em signed_documents, só o rascunho é apagado; os EMITIDOS de B ficam (gatilho), e os recibos também (SO_INSERE). Com a
 * FK composta signed_documents_paciente_fk (NO ACTION), o `delete from patients` de B falharia com 23503 nos pacientes
 * que ainda têm documento emitido ou recibo — então patients de B só apaga os pacientes sem eles (revisão do rascunho).
 */
const SO_APAGA: Record<string, SQL> = {
  signed_documents: sql`status = 'rascunho'`,
  patients: sql`not exists (select 1 from signed_documents s where s.tenant_id = patients.tenant_id and s.patient_id = patients.id)
                and not exists (select 1 from signed_document_receipts r where r.tenant_id = patients.tenant_id and r.patient_id = patients.id)
                and not exists (select 1 from ia_tarefas i where i.tenant_id = patients.tenant_id and i.patient_id = patients.id)
                and not exists (select 1 from exam_submissions e where e.tenant_id = patients.tenant_id and e.patient_id = patients.id)
                and not exists (select 1 from ia_autorizacoes a where a.tenant_id = patients.tenant_id and a.patient_id = patients.id)
                and not exists (select 1 from ia_nutri_participacoes x where x.tenant_id = patients.tenant_id and x.patient_id = patients.id)
                and not exists (select 1 from ia_nutri_mensagens x where x.tenant_id = patients.tenant_id and x.patient_id = patients.id)
                and not exists (select 1 from ia_nutri_consentimentos x where x.tenant_id = patients.tenant_id and x.patient_id = patients.id)
                and not exists (select 1 from fin_lancamentos f where f.tenant_id = patients.tenant_id and f.patient_id = patients.id)`,
  // Plano 20: a categoria com lançamento não se apaga (FK NO ACTION de fin_lancamentos, que está em SEM_DELETE) e "Consultas"
  // (chave preenchida) nunca (gatilho fin_categorias_fixas)
  fin_categorias: sql`chave is null and not exists (select 1 from fin_lancamentos f where f.tenant_id = fin_categorias.tenant_id and f.categoria_id = fin_categorias.id)`,
};
/**
 * Apagadas por último no teste de DELETE (as filhas têm FK NO ACTION/RESTRICT para elas: os itens de plano, Tarefa 6, referenciam `foods`;
 * as filhas de conteúdo, Plano 07, apontam para `contents`/`recipes` com cascata: apagar a mãe antes zeraria as linhas de B que o teste ainda conta;
 * Plano 10A: notas, recibos e códigos apontam para `signed_documents`, que aponta para `stored_files` e `patients`;
 * Plano 17: `lembretes_rotina_envios` aponta para `lembretes_rotina` com cascata — apagar o lembrete antes zeraria as marcas de B;
 * Plano 19: grupos e itens das listas e itens de "Minhas refeições" apontam para a mãe com cascata, como as de conteúdo).
 */
const ULTIMAS = ['meals', 'meal_plans', 'recipes', 'contents', 'anamnesis_templates', 'foods', 'appointments', 'signed_documents', 'stored_files', 'lembretes_rotina', 'patients', 'listas_substituicao_grupos', 'listas_substituicao', 'refeicoes_modelo'];

const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
let A: string;
let B: string;
let PAC: Record<string, [string, string]> = {};
/**
 * Revisão T1 (Plano 10A): um paciente a mais por tenant, criado só pela fábrica de `patients` (sem documento emitido nem
 * recibo), para o filtro de SO_APAGA.patients casar com alguma linha — o DELETE de B tem de apagar o de B e deixar o de A.
 */
let SEM_DOCUMENTO: Record<string, string> = {};
let P1: string;
let P2: string;
let tabelas: string[] = [];
let soEquipe = new Set<string>();
/** B-4 (0085): o gatilho paciente_colunas confere as colunas que a sessão de paciente altera — recusa (42501) antes do WITH CHECK. */
let colunasConferidas = new Set<string>();
/** B-6 (0085): paciente_sem_leitura — a sessão de paciente não lê a tabela, nem as próprias linhas (audit_log). */
let semLeituraDoPaciente = new Set<string>();

const naOrdemDeCriacao = (ts: string[]) => [...ts.filter((t) => t === 'patients'), ...ts.filter((t) => t !== 'patients')];
const naOrdemDeExclusao = (ts: string[]) => [...ts.filter((t) => !ULTIMAS.includes(t)), ...ULTIMAS.filter((t) => ts.includes(t))];

beforeAll(async () => {
  const [a, b] = await app.db
    .insert(tenants)
    .values([
      { slug: `iso-a-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Iso A' },
      { slug: `iso-b-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Iso B' },
    ])
    .returning({ id: tenants.id });
  A = a.id;
  B = b.id;
  PAC = { [A]: [randomUUID(), randomUUID()], [B]: [randomUUID(), randomUUID()] };
  [P1, P2] = PAC[A];
  tabelas = naOrdemDeCriacao((await listTenantTables(owner.pool)).filter((t) => !RLS_EXCEPTIONS[t]));
  soEquipe = new Set(
    (await owner.pool.query<{ t: string }>(`select tablename as t from pg_policies where schemaname = 'public' and policyname = 'staff_only'`)).rows.map((r) => r.t),
  );
  colunasConferidas = new Set(
    (await owner.pool.query<{ t: string }>(`select tgrelid::regclass::text as t from pg_trigger where tgname = 'paciente_colunas'`)).rows.map((r) => r.t),
  );
  semLeituraDoPaciente = new Set(
    (await owner.pool.query<{ t: string }>(`select tablename as t from pg_policies where schemaname = 'public' and policyname = 'paciente_sem_leitura'`)).rows.map((r) => r.t),
  );
  for (const t of tabelas) {
    if (!FABRICAS[t]) continue;
    for (const tenantId of [A, B]) {
      const role = PAPEL_DA_FABRICA[t] ?? 'nutri';
      const ator = role === 'nutri' ? { actorUserId: randomUUID() } : {};
      for (const p of PAC[tenantId]) await withTenant({ tenantId, role, ...ator }, (tx) => tx.execute(FABRICAS[t](tenantId, p)), app.db);
    }
  }
  // Plano 12 (revisão do plano): o envio nasce "processando"; o worker o leva a "recebido", a transição legal, para a sessão de
  // paciente ter o que cancelar e o que tentar mover
  for (const tenantId of [A, B])
    await withTenant({ tenantId, role: 'worker' }, (tx) => tx.execute(sql`update exam_submissions set status = 'recebido' where status = 'processando'`), app.db);
  SEM_DOCUMENTO = { [A]: randomUUID(), [B]: randomUUID() };
  for (const tenantId of [A, B]) {
    await withTenant({ tenantId, role: 'nutri', actorUserId: randomUUID() }, (tx) => tx.execute(FABRICAS.patients(tenantId, SEM_DOCUMENTO[tenantId])), app.db);
  }
});
afterAll(async () => {
  await app.pool.end();
  await owner.pool.end();
});

/** Coluna do titular por tabela: em `patients` é o próprio `id` (app_enable_patient_rls('patients', 'id')). */
const COLUNA_TITULAR: Record<string, string> = { patients: 'id' };
/** O paciente nunca é apagado (arquiva, bloqueia, anonimiza), e as filhas `staff_only`, invisíveis para P2, seguram a FK. */
const SEM_DELETE_DO_PACIENTE = new Set(['patients']);

const colunaTitular = async (t: string): Promise<string | null> => {
  if (COLUNA_TITULAR[t]) return COLUNA_TITULAR[t];
  const r = await owner.pool.query(
    `select 1 from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = 'patient_id'`,
    [t],
  );
  return r.rowCount! > 0 ? 'patient_id' : null;
};

const contarTenant = async (t: string, tenantId: string) =>
  Number((await owner.pool.query(`select count(*)::int as n from "${t}" where tenant_id = $1`, [tenantId])).rows[0].n);

/** Recusa pela política da RLS (WITH CHECK), não por outro motivo qualquer. */
const violaRls = (e: unknown) => {
  const c = ((e as { cause?: unknown }).cause ?? e) as { code?: string; message?: string };
  return c.code === '42501' && /row-level security/.test(c.message ?? '');
};
/**
 * Fábricas que criam a linha-mãe no mesmo comando (CTE): nos testes negativos de escrita, a RLS da MÃE recusa primeiro e o
 * INSERT na tabela nem roda. Revisão T1 (Plano 11): tabela nova não entra aqui — a fábrica grava só a própria tabela (ou a mãe
 * fica de fora, como em ia_tarefas com exam_id nulo), para que a recusa venha da política DELA.
 */
const COM_MAE = new Set([
  'consultation_notes',
  'patient_tag_links',
  'meals',
  'meal_items',
  'notifications',
  'recipes',
  'recipe_ingredients',
  'content_audience',
  'content_views',
  'content_favorites',
  'signed_document_notes',
  'signed_document_receipts',
  'document_access_codes',
  'exam_submission_files',
  'lembretes_rotina_envios',
  // Plano 20: escolha registrada na spec §9.5 — a recusa dos negativos de INSERT vem da política de fin_categorias; a prova
  // da política da própria fin_lancamentos está em src/modules/financeiro/banco.test.ts
  'fin_lancamentos',
  'refeicoes_modelo_itens',
  'listas_substituicao_grupos',
  'listas_substituicao_itens',
  'plano_listas_substituicao',
  'plano_conteudos',
]);
/** violaRls, e a recusa veio da política da própria tabela `t` (não da mãe criada no CTE da fábrica). */
const violaRlsDe = (t: string) => (e: unknown) => {
  if (!violaRls(e)) return false;
  const msg = (((e as { cause?: unknown }).cause ?? e) as { message?: string }).message ?? '';
  return COM_MAE.has(t) || msg.includes(`for table "${t}"`);
};
/** Recusa da RLS ou do gatilho paciente_colunas (B-4, 0085): o mesmo código 42501. */
const negado = (e: unknown) => (((e as { cause?: unknown }).cause ?? e) as { code?: string }).code === '42501';
/**
 * O UPDATE que a sessão de paciente consegue fazer na própria linha (gatilho paciente_colunas, 0085): em data_exports, só pendente → falhou.
 * Plano 12: exam_submissions — gatilho exam_submissions_regras (0102); o paciente só cancela o próprio recebido.
 * Plano 15: ia_nutri_mensagens — gatilho ia_nutri_mensagens_regras (0116); o paciente encaminha a própria pergunta respondida.
 * Plano 17: lembretes_rotina — gatilho lembretes_rotina_regras (0119); o paciente desliga o próprio lembrete.
 */
const UPDATE_DO_PACIENTE: Record<string, SQL> = {
  data_exports: sql`status = 'falhou'`,
  exam_submissions: sql`status = 'cancelado'`,
  ia_nutri_mensagens: sql`encaminhada_em = now()`,
  lembretes_rotina: sql`desligado_pelo_paciente_em = now()`,
};

const contarPaciente = async (t: string, col: string, tenantId: string, patientId: string) =>
  Number(
    (await owner.pool.query(`select count(*)::int as n from "${t}" where tenant_id = $1 and "${col}" = $2`, [tenantId, patientId]))
      .rows[0].n,
  );

describe('isolamento em todas as tabelas 🔒 (RNF-07, US-006)', () => {
  it('toda tabela com tenant_id tem fábrica neste teste', () => {
    expect(tabelas.filter((t) => !FABRICAS[t])).toEqual([]);
  });

  // M12: roda antes dos testes que apagam as linhas de B/P2 (o UPDATE precisa de linhas visíveis)
  it('WITH CHECK: o tenant B não grava linha com o tenant_id de A nem move a própria linha para A', async () => {
    for (const t of tabelas) {
      const antesA = await contarTenant(t, A);
      const comoB = (q: SQL) => withTenant({ tenantId: B, role: 'nutri', actorUserId: randomUUID() }, (tx) => tx.execute(q), app.db);
      await expect(comoB(FABRICAS[t](A, P1)), t).rejects.toSatisfy(violaRlsDe(t));
      if (!SO_INSERE.has(t)) {
        expect(await contarTenant(t, B), t).toBeGreaterThan(0); // há linha de B para tentar mover
        await expect(comoB(sql`update ${sql.identifier(t)} set tenant_id = ${A}`), t).rejects.toSatisfy(IMUTAVEIS.has(t) ? negado : violaRls);
      }
      expect(await contarTenant(t, A), t).toBe(antesA);
    }
  });

  it('WITH CHECK: a paciente P2 não grava linha de P1 nem move a própria linha para P1 (inclusive em patients)', async () => {
    for (const t of tabelas) {
      const col = await colunaTitular(t);
      if (!col || soEquipe.has(t)) continue;
      const antesP1 = await contarPaciente(t, col, A, P1);
      const comoP2 = (q: SQL) => withTenant({ tenantId: A, role: 'paciente', patientId: P2, actorUserId: randomUUID() }, (tx) => tx.execute(q), app.db);
      // a RLS (42501) é conferida antes da PK/UNIQUE e da FK: em patients o INSERT com id = P1 cai na política
      await expect(comoP2(FABRICAS[t](A, P1)), t).rejects.toSatisfy(violaRlsDe(t));
      if (!SO_INSERE.has(t)) {
        expect(await contarPaciente(t, col, A, P2), t).toBeGreaterThan(0);
        const mover = sql`update ${sql.identifier(t)} set ${sql.identifier(col)} = ${P1}`;
        // D1 (R1): sem `update` em PACIENTE_ESCREVE, paciente_sem_update (USING) esconde a linha do UPDATE: 0 linhas, sem erro
        if ((PACIENTE_ESCREVE[t]?.comandos ?? []).includes('update')) {
          await expect(comoP2(mover), t).rejects.toSatisfy(IMUTAVEIS.has(t) || colunasConferidas.has(t) ? negado : violaRls);
        }
        else expect((await comoP2(mover)).rowCount, t).toBe(0);
      }
      expect(await contarPaciente(t, col, A, P1), t).toBe(antesP1);
    }
  });

  it('D1: fora de PACIENTE_ESCREVE, a paciente P2 não cria nem a própria linha (tabelas com titular)', async () => {
    for (const t of tabelas) {
      const col = await colunaTitular(t);
      if (!col || soEquipe.has(t) || (PACIENTE_ESCREVE[t]?.comandos ?? []).includes('insert')) continue;
      const comoP2 = (q: SQL) => withTenant({ tenantId: A, role: 'paciente', patientId: P2, actorUserId: randomUUID() }, (tx) => tx.execute(q), app.db);
      await expect(comoP2(FABRICAS[t](A, P2)), t).rejects.toSatisfy(violaRlsDe(t));
    }
  });

  it('staff_only: a sessão de paciente não vê nem grava nada nessas tabelas, nem as próprias linhas (US-016, US-019)', async () => {
    // itera a lista declarada (não o que o banco tem): tabela que perdeu a política não pode ser pulada em silêncio
    for (const t of Object.keys(STAFF_ONLY)) {
      expect(tabelas, t).toContain(t);
      expect(soEquipe.has(t), t).toBe(true);
      expect(await contarTenant(t, A), t).toBeGreaterThan(0); // as linhas existem: é a política que esconde
      const comoP2 = (q: SQL) => withTenant({ tenantId: A, role: 'paciente', patientId: P2, actorUserId: randomUUID() }, (tx) => tx.execute(q), app.db);
      const vistas = await comoP2(sql`select 1 from ${sql.identifier(t)}`);
      expect(vistas.rows.length, t).toBe(0);
      await expect(comoP2(FABRICAS[t](A, P2)), t).rejects.toSatisfy(violaRlsDe(t));
    }
  });

  it('publico (D11): só lê e grava o que PUBLICO_LIBERADO declara; o resto — notas, anamnese… — dá 0 linhas e recusa a escrita', async () => {
    const comoPublico = (q: SQL) => withTenant({ tenantId: A, role: 'publico' }, (tx) => tx.execute(q), app.db);
    for (const t of tabelas) {
      expect(await contarTenant(t, A), t).toBeGreaterThan(0); // as linhas existem: é a política que esconde
      const pode = PUBLICO_LIBERADO[t]?.comandos ?? [];
      const vistas = (await comoPublico(sql`select tenant_id from ${sql.identifier(t)}`)).rows;
      if (pode.includes('select')) {
        expect(vistas.length, t).toBeGreaterThan(0);
        for (const row of vistas) expect(row.tenant_id, t).toBe(A); // nem o publico atravessa tenants
      } else expect(vistas.length, t).toBe(0);
      if (pode.includes('insert')) await expect(comoPublico(FABRICAS[t](B, PAC[B][0])), t).rejects.toSatisfy(violaRlsDe(t));
      else await expect(comoPublico(FABRICAS[t](A, P2)), t).rejects.toSatisfy(violaRlsDe(t));
      if (SO_INSERE.has(t)) continue; // UPDATE/DELETE já negados por permissão
      if (!pode.includes('update')) expect((await comoPublico(sql`update ${sql.identifier(t)} set tenant_id = tenant_id`)).rowCount, t).toBe(0);
      if (DELETE_REVOGADO.has(t)) await expect(comoPublico(sql`delete from ${sql.identifier(t)}`), t).rejects.toSatisfy(negado);
      else if (!pode.includes('delete')) expect((await comoPublico(sql`delete from ${sql.identifier(t)}`)).rowCount, t).toBe(0);
    }
    expect((await comoPublico(sql`select 1 from consultation_notes`)).rows).toEqual([]);
    expect((await comoPublico(sql`select 1 from anamneses`)).rows).toEqual([]);
  });

  it('conta (D2): sem tenant, não vê nem grava nada em nenhuma tabela 🔒 (patients só pela política da própria conta)', async () => {
    const outra = randomUUID(); // conta sem vínculo nenhum: a política compara com app.user_id, sem FK para `user`
    for (const t of tabelas) {
      expect(await contarTenant(t, A), t).toBeGreaterThan(0); // as linhas existem: é a política que esconde
      // R4: a TACO (foods com tenant_id nulo, taco_leitura) é dado público de referência, legível por qualquer sessão
      const vistas = await withConta(outra, (tx) => tx.execute(sql`select 1 from ${sql.identifier(t)} where tenant_id is not null`), app.db);
      expect(vistas.rows.length, t).toBe(0);
      await expect(withConta(outra, (tx) => tx.execute(FABRICAS[t](A, P1)), app.db), t).rejects.toSatisfy(violaRlsDe(t));
    }
  });

  it('o tenant B só vê e só altera as próprias linhas; as de A ficam intactas', async () => {
    for (const t of naOrdemDeExclusao(tabelas)) {
      const id = sql.identifier(t);
      const antesA = await contarTenant(t, A);
      let sobrouDeB = 0;
      await withTenant(
        { tenantId: B, role: 'nutri', actorUserId: randomUUID() },
        async (tx) => {
          // SELECT sem filtro: RLS precisa devolver só (e todas) as linhas de B — não zero (política que nega
          // tudo) nem inclui A (política que libera tudo).
          const vistas = await tx.execute(sql`select tenant_id from ${id}`);
          // D1: em foods, B também lê a TACO (tenant_id nulo), mas só altera e apaga as próprias linhas
          const proprias = vistas.rows.filter((row) => row.tenant_id === B);
          expect(proprias.length, t).toBeGreaterThanOrEqual(1);
          for (const row of vistas.rows) expect(row.tenant_id === B || (t === 'foods' && row.tenant_id === null), t).toBe(true);
          if (SO_INSERE.has(t)) return;
          // UPDATE e DELETE sem filtro: só podem afetar as linhas próprias que a RLS mostrou
          const alteradas = await tx.execute(sql`update ${id} set tenant_id = tenant_id`);
          expect(alteradas.rowCount, t).toBe(proprias.length);
          if (SEM_DELETE.has(t)) {
            await expect(tx.execute(sql`savepoint sem_delete`)).resolves.toBeDefined();
            await expect(tx.execute(sql`delete from ${id}`), t).rejects.toSatisfy(negado);
            await tx.execute(sql`rollback to savepoint sem_delete`);
            sobrouDeB = proprias.length;
            return;
          }
          const apagaveis = SO_APAGA[t] ? (await tx.execute(sql`select 1 from ${id} where ${SO_APAGA[t]}`)).rows.length : proprias.length;
          // o filtro de SO_APAGA nunca pode ficar vazio: com 0 apagáveis o DELETE não provaria nada (revisão T1)
          if (SO_APAGA[t]) expect(apagaveis, t).toBeGreaterThan(0);
          const apagadas = await tx.execute(sql`delete from ${id}${SO_APAGA[t] ? sql` where ${SO_APAGA[t]}` : sql``}`);
          expect(apagadas.rowCount, t).toBe(apagaveis); // signed_documents: só os rascunhos de B; patients: só os sem emitido nem recibo
          sobrouDeB = proprias.length - apagaveis;
        },
        app.db,
      );
      if (!SO_INSERE.has(t)) {
        expect(await contarTenant(t, A), t).toBe(antesA); // owner confirma: A não foi tocado
        // o DELETE de B de fato aconteceu; o que sobra é só o que o filtro de SO_APAGA deixa (em patients, os de B com documento emitido ou recibo)
        expect(await contarTenant(t, B), t).toBe(SO_APAGA[t] || SEM_DELETE.has(t) ? sobrouDeB : 0);
      }
      if (t === 'patients') {
        // o paciente sem documento de B foi apagado; o de A, que também casa com o filtro, segue lá
        const existe = async (tenantId: string) =>
          (await owner.pool.query(`select 1 from patients where tenant_id = $1 and id = $2`, [tenantId, SEM_DOCUMENTO[tenantId]])).rowCount;
        expect(await existe(B)).toBe(0);
        expect(await existe(A)).toBe(1);
      }
    }
  });

  it('a paciente P2 só vê e só altera as próprias linhas; as de P1 (mesmo tenant) ficam intactas (inclusive em patients)', async () => {
    for (const t of naOrdemDeExclusao(tabelas)) {
      const col = await colunaTitular(t);
      if (!col || soEquipe.has(t)) continue;
      const id = sql.identifier(t);
      const c = sql.identifier(col);
      const antesP1 = await contarPaciente(t, col, A, P1);
      const apaga = !SO_INSERE.has(t) && !SEM_DELETE_DO_PACIENTE.has(t);
      if (semLeituraDoPaciente.has(t)) expect(await contarPaciente(t, col, A, P2), t).toBeGreaterThan(0); // há linhas de P2 que ela não lê
      await withTenant(
        { tenantId: A, role: 'paciente', patientId: P2, actorUserId: randomUUID() },
        async (tx) => {
          const vistas = await tx.execute(sql`select ${c} as titular from ${id}`);
          if (semLeituraDoPaciente.has(t)) return expect(vistas.rows, t).toEqual([]); // B-6: nem as próprias (o owner contou acima)
          expect(vistas.rows.length, t).toBeGreaterThanOrEqual(1);
          for (const row of vistas.rows) expect(row.titular, t).toBe(P2);
          if (SO_INSERE.has(t)) return;
          const pode = PACIENTE_ESCREVE[t]?.comandos ?? [];
          const alteradas = await tx.execute(sql`update ${id} set ${UPDATE_DO_PACIENTE[t] ?? sql`${c} = ${c}`}`);
          // D1: sem `update` em PACIENTE_ESCREVE, o UPDATE da própria linha também dá 0 (paciente_sem_update)
          expect(alteradas.rowCount, t).toBe(pode.includes('update') ? vistas.rows.length : 0);
          if (!apaga) return;
          const apagadas = await tx.execute(sql`delete from ${id}`);
          expect(apagadas.rowCount, t).toBe(pode.includes('delete') ? vistas.rows.length : 0);
        },
        app.db,
      );
      expect(await contarPaciente(t, col, A, P1), t).toBe(antesP1); // owner confirma: as linhas de P1 seguem intactas
      if (apaga && (PACIENTE_ESCREVE[t]?.comandos ?? []).includes('delete')) expect(await contarPaciente(t, col, A, P2), t).toBe(0);
    }
  });
});
