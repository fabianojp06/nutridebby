import { sql } from 'drizzle-orm';
import { boolean, check, customType, date, foreignKey, index, integer, numeric, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { jsonbSeguro } from '../jsonb-seguro';
import { user } from './auth';
import { storedFiles, tenants } from './platform';
import type { ModeloSchema, Resposta, SnapshotModelo } from '@/modules/pacientes/anamnese-tipos';

export const citext = customType<{ data: string }>({ dataType: () => 'citext' });

/**
 * Prontuário (M2). `user_id` nulo até o paciente aceitar o convite. `data_nascimento` e `sexo`
 * alimentam as fórmulas; só podem faltar em paciente do agendamento público (Plano 05) ou anonimizado.
 * `patients_tenant_id_unique` é o alvo das FKs compostas das tabelas filhas: um registro do tenant A
 * nunca aponta para paciente do tenant B, nem por bug de serviço.
 */
export const patients = pgTable(
  'patients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
    nome: text('nome').notNull(),
    dataNascimento: date('data_nascimento', { mode: 'string' }),
    sexo: text('sexo'),
    telefoneE164: text('telefone_e164'),
    email: citext('email').notNull(),
    origem: text('origem').notNull().default('nutri'),
    whatsappOptinEm: timestamp('whatsapp_optin_em', { withTimezone: true }),
    whatsappOptinOrigem: text('whatsapp_optin_origem'),
    whatsappOptoutEm: timestamp('whatsapp_optout_em', { withTimezone: true }),
    /** Plano 11 (A-D9): "Não usar IA com os dados deste paciente". Congelada desde o Plano 14A (RN-128, 0109): ninguém grava; a exportação a mostra se preenchida. */
    iaRecusadaEm: timestamp('ia_recusada_em', { withTimezone: true }),
    /**
     * Plano 11 (A-D19): ciência do aviso de IA — versão, data e canal juntos (o canal `portal` fica reservado, spec §5.3).
     * Congelada desde o Plano 14A (RN-128, 0109): ninguém grava; a exportação a mostra se preenchida.
     */
    iaAvisoVersao: text('ia_aviso_versao'),
    /** Plano 11: data da ciência do aviso de IA. Congelada desde o Plano 14A (RN-128, 0109): ninguém grava; a exportação a mostra se preenchida. */
    iaAvisoEm: timestamp('ia_aviso_em', { withTimezone: true }),
    /** Plano 11: canal da ciência do aviso de IA. Congelada desde o Plano 14A (RN-128, 0109): ninguém grava; a exportação a mostra se preenchida. */
    iaAvisoCanal: text('ia_aviso_canal'),
    /**
     * Plano 11 (D5): e-mail do aviso enfileirado, aguardando o envio (a ciência era gravada no pós-envio do worker).
     * Congelada desde o Plano 14A (RN-128, 0109): ninguém grava; a exportação a mostra se preenchida.
     */
    iaAvisoEnviadoEm: timestamp('ia_aviso_enviado_em', { withTimezone: true }),
    /**
     * Plano 16 (G-D1, RN-203): "Não mostrar peso no app" — só a equipe liga (aba Evolução do prontuário); o portal deixa de
     * mostrar peso e IMC (filtrado no servidor). Fora de `livres` no gatilho paciente_colunas (0085): a sessão de paciente não muda.
     */
    pesoOcultoNoAppEm: timestamp('peso_oculto_no_app_em', { withTimezone: true }),
    /**
     * Plano 17 (§5.3): "Pausar todos os lembretes" — só a sessão de paciente pausa e retoma (relógio do banco); o worker
     * (anonimização) e a ida a `bloqueado` (exclusão atendida) limpam. Gatilho patients_lembretes_do_paciente (0119) e
     * `livres` do paciente_colunas. A equipe NUNCA inclui esta coluna no `set()` de um UPDATE (salvo a limpeza na ida a
     * `bloqueado`): reenviar o valor lido perde os microssegundos do clock_timestamp() e o gatilho recusa com 42501.
     */
    lembretesPausadosEm: timestamp('lembretes_pausados_em', { withTimezone: true }),
    status: text('status').notNull().default('ativo'),
    bloqueadoEm: timestamp('bloqueado_em', { withTimezone: true }),
    anonimizarApos: date('anonimizar_apos', { mode: 'string' }),
    anonimizadoEm: timestamp('anonimizado_em', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('patients_tenant_email_unique').on(t.tenantId, t.email),
    unique('patients_tenant_id_unique').on(t.tenantId, t.id),
    uniqueIndex('patients_tenant_user_idx').on(t.tenantId, t.userId).where(sql`${t.userId} is not null`),
    // Plano 06: os vínculos de uma conta de paciente em todos os tenants (escolha do consultório no portal)
    index('patients_user_idx').on(t.userId).where(sql`${t.userId} is not null`),
    index('patients_tenant_status_idx').on(t.tenantId, t.status),
    check('patients_sexo_valido', sql`${t.sexo} is null or ${t.sexo} in ('F', 'M')`),
    check('patients_origem_valida', sql`${t.origem} in ('nutri', 'agendamento_publico')`),
    check('patients_status_valido', sql`${t.status} in ('ativo', 'arquivado', 'bloqueado')`),
    check('patients_optin_origem_valida', sql`${t.whatsappOptinOrigem} is null or ${t.whatsappOptinOrigem} in ('nutri', 'paciente')`),
    check('patients_telefone_e164', sql`${t.telefoneE164} is null or ${t.telefoneE164} ~ '^\\+[1-9][0-9]{7,14}$'`),
    check(
      'patients_nascimento_e_sexo',
      sql`${t.origem} = 'agendamento_publico' or ${t.anonimizadoEm} is not null or (${t.dataNascimento} is not null and ${t.sexo} is not null)`,
    ),
    check('patients_ia_aviso_junto', sql`(${t.iaAvisoVersao} is null) = (${t.iaAvisoEm} is null) and (${t.iaAvisoVersao} is null) = (${t.iaAvisoCanal} is null)`),
    check('patients_ia_aviso_canal_valido', sql`${t.iaAvisoCanal} is null or ${t.iaAvisoCanal} in ('email', 'em_maos', 'portal')`),
    check('patients_ia_aviso_versao_tamanho', sql`${t.iaAvisoVersao} is null or char_length(${t.iaAvisoVersao}) <= 40`),
  ],
);

export type PatientRow = typeof patients.$inferSelect;

/** US-019. Nome sem diferenciar maiúsculas ("Gestante" = "gestante"). A sessão de paciente não vê (staff_only). */
export const patientTags = pgTable(
  'patient_tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    nome: citext('nome').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('patient_tags_tenant_nome_unique').on(t.tenantId, t.nome),
    unique('patient_tags_tenant_id_unique').on(t.tenantId, t.id),
    check('patient_tags_nome_tamanho', sql`char_length(${t.nome}) between 1 and 40`),
  ],
);

export const patientTagLinks = pgTable(
  'patient_tag_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    tagId: uuid('tag_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('patient_tag_links_unique').on(t.patientId, t.tagId),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'patient_tag_links_paciente_fk' }),
    foreignKey({ columns: [t.tenantId, t.tagId], foreignColumns: [patientTags.tenantId, patientTags.id], name: 'patient_tag_links_etiqueta_fk' }).onDelete('cascade'),
    index('patient_tag_links_etiqueta_idx').on(t.tenantId, t.tagId),
  ],
);

/** US-016. O que o paciente pode ver fica aqui (orientações); as notas privadas ficam em consultation_notes (staff_only). */
export const consultations = pgTable(
  'consultations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    data: date('data', { mode: 'string' }).notNull(),
    orientacoesPaciente: text('orientacoes_paciente'),
    /**
     * Plano 05: atendimento iniciado pela agenda ("Iniciar atendimento"). Uma consulta, no máximo um atendimento. A FK
     * composta (mesmo tenant e mesmo paciente) para `appointments` fica só na migration custom 0064: o schema da agenda
     * importa este arquivo, e declarar aqui criaria um import circular.
     */
    appointmentId: uuid('appointment_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** Plano 23 (RN-430): previsão de retorno; não vai ao portal nem à IA. */
    retornoPrevistoEm: date('retorno_previsto_em', { mode: 'string' }),
  },
  (t) => [
    unique('consultations_tenant_paciente_id_unique').on(t.tenantId, t.patientId, t.id),
    uniqueIndex('consultations_consulta_idx').on(t.appointmentId).where(sql`${t.appointmentId} is not null`),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'consultations_paciente_fk' }),
    check('consultations_orientacoes_tamanho', sql`char_length(${t.orientacoesPaciente}) <= 5000`),
    index('consultations_paciente_data_idx').on(t.tenantId, t.patientId, t.data),
    check('consultations_retorno_previsto_faixa', sql`${t.retornoPrevistoEm} is null or ${t.retornoPrevistoEm} between ${t.data} and ${t.data} + 730`),
  ],
);

/** US-016 "Privacidade das notas": a sessão de paciente não vê esta tabela (staff_only). A FK tripla impede nota de um paciente no atendimento de outro. */
export const consultationNotes = pgTable(
  'consultation_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    consultationId: uuid('consultation_id').notNull().unique(),
    texto: text('texto').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'consultation_notes_paciente_fk' }),
    foreignKey({
      columns: [t.tenantId, t.patientId, t.consultationId],
      foreignColumns: [consultations.tenantId, consultations.patientId, consultations.id],
      name: 'consultation_notes_atendimento_fk',
    }).onDelete('cascade'),
    check('consultation_notes_tamanho', sql`char_length(${t.texto}) between 1 and 20000`),
  ],
);

export type ConsultationRow = typeof consultations.$inferSelect;

/** US-013. `imc` é calculado pelo banco; densidade e %G, pelo serviço (Apêndice A), só com as dobras completas. */
export const anthropometry = pgTable(
  'anthropometry',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    consultationId: uuid('consultation_id'),
    data: date('data', { mode: 'string' }).notNull(),
    pesoKg: numeric('peso_kg', { precision: 5, scale: 2, mode: 'number' }).notNull(),
    alturaCm: numeric('altura_cm', { precision: 5, scale: 1, mode: 'number' }).notNull(),
    imc: numeric('imc', { precision: 6, scale: 2, mode: 'number' }).generatedAlwaysAs(sql`round(peso_kg / ((altura_cm / 100) * (altura_cm / 100)), 2)`),
    circunferencias: jsonbSeguro('circunferencias').$type<Record<string, number>>().notNull().default({}),
    dobrasMm: jsonbSeguro('dobras_mm').$type<Record<string, number>>().notNull().default({}),
    protocolo: text('protocolo').notNull().default('nenhum'),
    densidade: numeric('densidade', { precision: 6, scale: 5, mode: 'number' }),
    percGordura: numeric('perc_gordura', { precision: 5, scale: 2, mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('anthropometry_peso_faixa', sql`${t.pesoKg} between 1 and 400`),
    check('anthropometry_altura_faixa', sql`${t.alturaCm} between 30 and 250`),
    check('anthropometry_protocolo_valido', sql`${t.protocolo} in ('jp3', 'jp7', 'nenhum')`),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'anthropometry_paciente_fk' }),
    foreignKey({
      columns: [t.tenantId, t.patientId, t.consultationId],
      foreignColumns: [consultations.tenantId, consultations.patientId, consultations.id],
      name: 'anthropometry_atendimento_fk',
    }),
    index('anthropometry_paciente_data_idx').on(t.tenantId, t.patientId, t.data),
  ],
);

export type AnthropometryRow = typeof anthropometry.$inferSelect;

/** US-014. Guarda o que entrou na conta (peso, altura, idade, sexo) e o resultado sem arredondar; a tela mostra kcal inteiros. */
export const energyCalcs = pgTable(
  'energy_calcs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    formula: text('formula').notNull(),
    pesoKg: numeric('peso_kg', { precision: 5, scale: 2, mode: 'number' }).notNull(),
    alturaCm: numeric('altura_cm', { precision: 5, scale: 1, mode: 'number' }).notNull(),
    idade: integer('idade').notNull(),
    sexo: text('sexo').notNull(),
    fatorAtividade: numeric('fator_atividade', { precision: 3, scale: 2, mode: 'number' }).notNull(),
    // 6 casas: o mesmo valor que as fórmulas devolvem; com 2 casas, 1500,4951 viraria 1500,50 e a lista
    // mostraria 1501 onde a tela de sucesso mostrou 1500 (arredondamento duplo, RN-14)
    tmb: numeric('tmb', { precision: 12, scale: 6, mode: 'number' }).notNull(),
    get: numeric('get', { precision: 12, scale: 6, mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('energy_calcs_formula_valida', sql`${t.formula} in ('harris_benedict', 'mifflin', 'fao_oms')`),
    check('energy_calcs_fator_faixa', sql`${t.fatorAtividade} between 1.00 and 2.50`),
    check('energy_calcs_sexo_valido', sql`${t.sexo} in ('F', 'M')`),
    check('energy_calcs_idade_adulto', sql`${t.idade} >= 18`),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'energy_calcs_paciente_fk' }),
    index('energy_calcs_paciente_idx').on(t.tenantId, t.patientId, t.createdAt),
  ],
);

export type EnergyCalcRow = typeof energyCalcs.$inferSelect;

/** US-012. "Excluir" = arquivar (as anamneses preenchidas guardam o snapshot). Um só modelo padrão por tenant. */
export const anamnesisTemplates = pgTable(
  'anamnesis_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    nome: text('nome').notNull(),
    schema: jsonbSeguro('schema').$type<ModeloSchema>().notNull(),
    padrao: boolean('padrao').notNull().default(false),
    arquivadoEm: timestamp('arquivado_em', { withTimezone: true }),
    /**
     * Plano 14B (US-123 (f)): o modelo sugerido pela IA — a geração de onde veio (nunca muda, gatilho 0112). A FK composta
     * para `ia_geracoes_modelos` fica só na migration custom 0112 (`ia.ts` importa este arquivo; declará-la aqui criaria
     * import circular — o mesmo motivo da FK de `consultations` para `appointments`, 0064).
     */
    iaGeracaoId: uuid('ia_geracao_id'),
    /** Plano 14B (US-123 (g), RN-125): quem aprovou o modelo sugerido e quando (imutáveis depois de gravados). */
    aprovadoEm: timestamp('aprovado_em', { withTimezone: true }),
    aprovadoPor: uuid('aprovado_por'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('anamnesis_templates_tenant_id_unique').on(t.tenantId, t.id),
    uniqueIndex('anamnesis_templates_padrao_idx').on(t.tenantId).where(sql`${t.padrao}`),
    check('anamnesis_templates_nome_tamanho', sql`char_length(${t.nome}) between 1 and 80`),
    check('anamnesis_templates_aprovacao_coerente', sql`(${t.aprovadoEm} is null) = (${t.aprovadoPor} is null) and (${t.aprovadoEm} is null or ${t.iaGeracaoId} is not null)`),
    // RN-125: o modelo de anamnese sugerido e não aprovado nunca é o padrão (defesa: o código não tem "tornar padrão", desvio 9)
    check('anamnesis_templates_padrao_aprovado', sql`not ${t.padrao} or ${t.iaGeracaoId} is null or ${t.aprovadoEm} is not null`),
  ],
);

export const anamneses = pgTable(
  'anamneses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    templateId: uuid('template_id'),
    templateSnapshot: jsonbSeguro('template_snapshot').$type<SnapshotModelo>().notNull(),
    respostas: jsonbSeguro('respostas').$type<Record<string, Resposta>>().notNull().default({}),
    data: date('data', { mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'anamneses_paciente_fk' }),
    foreignKey({ columns: [t.tenantId, t.templateId], foreignColumns: [anamnesisTemplates.tenantId, anamnesisTemplates.id], name: 'anamneses_modelo_fk' }),
    index('anamneses_paciente_idx').on(t.tenantId, t.patientId, t.data),
  ],
);

export type AnamnesisTemplateRow = typeof anamnesisTemplates.$inferSelect;
export type AnamneseRow = typeof anamneses.$inferSelect;

/** US-015. O laudo é um stored_files (cota, URL assinada); apagar o arquivo pela API de armazenamento solta o vínculo sozinho. */
export const exams = pgTable(
  'exams',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    data: date('data', { mode: 'string' }).notNull(),
    titulo: text('titulo').notNull(),
    arquivoPath: text('arquivo_path').references(() => storedFiles.caminho, { onDelete: 'set null' }),
    valores: jsonbSeguro('valores')
      // Plano 22 (RN-376, C-378): refMin/refMax opcionais (faixa numérica do laudo)
      .$type<{ nome: string; valor: number; unidade: string | null; referencia: string | null; iaTarefaId?: string; refMin?: number; refMax?: number }[]>()
      .notNull()
      .default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    // Plano 22 (RN-385, EP-D22): "Mostrar no app" — o paciente só lê o exame com a marca (política paciente_exame_liberado);
    // quem ligou e quem retirou ficam no audit_log. Anulável, sem default; não mexe em updated_at
    mostrarNoAppEm: timestamp('mostrar_no_app_em', { withTimezone: true }),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'exams_paciente_fk' }),
    check('exams_titulo_tamanho', sql`char_length(${t.titulo}) between 1 and 120`),
    check('exams_arquivo_do_tenant', sql`${t.arquivoPath} is null or ${t.arquivoPath} like ${t.tenantId}::text || '/%'`),
    index('exams_paciente_data_idx').on(t.tenantId, t.patientId, t.data),
    // Plano 11: alvo da FK composta ia_tarefas → exams (mesmo tenant e mesmo paciente), como consultations_tenant_paciente_id_unique
    unique('exams_tenant_paciente_id_unique').on(t.tenantId, t.patientId, t.id),
  ],
);

export type ExamRow = typeof exams.$inferSelect;

/** US-018 / RNF-08: pedidos do titular (exportação, exclusão). Prazo de resposta: 15 dias. */
export const privacyRequests = pgTable(
  'privacy_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    tipo: text('tipo').notNull(),
    status: text('status').notNull().default('aberto'),
    prazo: date('prazo', { mode: 'string' }).notNull(),
    concluidoEm: timestamp('concluido_em', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('privacy_requests_tipo_valido', sql`${t.tipo} in ('exportacao', 'exclusao')`),
    check('privacy_requests_status_valido', sql`${t.status} in ('aberto', 'concluido')`),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'privacy_requests_paciente_fk' }),
    index('privacy_requests_paciente_idx').on(t.tenantId, t.patientId, t.status),
    // US-046 / D17: um pedido aberto por paciente e tipo (pedir de novo mostra a data do que já está aberto)
    uniqueIndex('privacy_requests_aberto_unique').on(t.tenantId, t.patientId, t.tipo).where(sql`${t.status} = 'aberto'`),
  ],
);

/** US-018 "Exportar": estado do job e do link de 24 h. O ZIP é um stored_files (cota; some ao expirar). */
export const dataExports = pgTable(
  'data_exports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    status: text('status').notNull().default('pendente'),
    arquivoPath: text('arquivo_path').references(() => storedFiles.caminho, { onDelete: 'set null' }),
    expiraEm: timestamp('expira_em', { withTimezone: true }),
    /** Sem FK, como `audit_log.actor_user_id`: o SET NULL de uma FK dispararia o gatilho de auditoria fora do tenant. */
    solicitadoPor: uuid('solicitado_por'),
    /** US-046 (Plano 06): `titular` = pedida pelo paciente no portal (sem planos em rascunho, link do portal). */
    escopo: text('escopo').notNull().default('equipe'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('data_exports_escopo_valido', sql`${t.escopo} in ('equipe', 'titular')`),
    check('data_exports_status_valido', sql`${t.status} in ('pendente', 'pronta', 'falhou', 'expirada')`),
    check('data_exports_arquivo_do_tenant', sql`${t.arquivoPath} is null or ${t.arquivoPath} like ${t.tenantId}::text || '/exportacao/%'`),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'data_exports_paciente_fk' }),
    index('data_exports_paciente_idx').on(t.tenantId, t.patientId, t.createdAt),
  ],
);

/** Listas fechadas do cadastro complementar (US-260); os rótulos ficam em `src/modules/pacientes/cadastro-textos.ts`. */
export const IDENTIDADES_DE_GENERO = ['mulher', 'homem', 'nao_binario', 'outra', 'prefere_nao_informar'] as const;
export const ESTADOS_CIVIS = ['solteiro', 'casado', 'uniao_estavel', 'separado', 'divorciado', 'viuvo'] as const;
export const ESCOLARIDADES = [
  'sem_escolaridade',
  'fundamental_incompleto',
  'fundamental_completo',
  'medio_incompleto',
  'medio_completo',
  'superior_incompleto',
  'superior_completo',
  'pos_graduacao',
] as const;
export const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'] as const;

const naLista = (lista: readonly string[]) => sql.raw(lista.map((v) => `'${v}'`).join(', '));

/**
 * Plano 18 (spec D1, §9.1, US-260): cadastro complementar do paciente (Res. CFN 594/2017), 1:1 com `patients`, só com o
 * que a ficha precisa além do cadastro de sempre. Tabela filha para que o contexto de paciente sem login (convite, links,
 * webhook, contexto da IA Nutri, "No app") nunca leia CPF, endereço nem observação: política RESTRICTIVE
 * `patient_cadastro_paciente_com_conta`. Auditada como `patients` ("Cadastro do paciente"; o `criar` aparece como "Alterou").
 * Gatilhos: `patient_cadastro_colunas_fixas` (id, tenant e paciente não mudam), `patient_cadastro_sem_apagar` (só o worker
 * apaga, com o titular anonimizado) e `patient_cadastro_titular_ativo` (titular anonimizado não ganha INSERT nem UPDATE). Toda regra dos CHECKs é conferida no servidor antes de gravar (D23: o 23514 leva a
 * linha inteira ao log do Postgres).
 */
export const patientCadastro = pgTable(
  'patient_cadastro',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    /** Só dígitos; o dígito verificador é conferido no servidor (RN-261). Nunca na lista, no cabeçalho, em URL nem em log. */
    cpf: text('cpf'),
    nomeSocial: text('nome_social'),
    identidadeGenero: text('identidade_genero'),
    estadoCivil: text('estado_civil'),
    escolaridade: text('escolaridade'),
    ocupacao: text('ocupacao'),
    nacionalidade: text('nacionalidade'),
    naturalidade: text('naturalidade'),
    telefoneFixoE164: text('telefone_fixo_e164'),
    cep: text('cep'),
    logradouro: text('logradouro'),
    numero: text('numero'),
    complemento: text('complemento'),
    bairro: text('bairro'),
    cidade: text('cidade'),
    uf: text('uf'),
    observacao: text('observacao'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('patient_cadastro_paciente_unique').on(t.tenantId, t.patientId),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'patient_cadastro_paciente_fk' }),
    uniqueIndex('patient_cadastro_cpf_unico').on(t.tenantId, t.cpf).where(sql`${t.cpf} is not null`),
    check('patient_cadastro_cpf_check', sql`${t.cpf} ~ '^[0-9]{11}$'`),
    check('patient_cadastro_nome_social_check', sql`char_length(${t.nomeSocial}) between 2 and 120`),
    check('patient_cadastro_identidade_genero_check', sql`${t.identidadeGenero} in (${naLista(IDENTIDADES_DE_GENERO)})`),
    check('patient_cadastro_estado_civil_check', sql`${t.estadoCivil} in (${naLista(ESTADOS_CIVIS)})`),
    check('patient_cadastro_escolaridade_check', sql`${t.escolaridade} in (${naLista(ESCOLARIDADES)})`),
    check('patient_cadastro_ocupacao_check', sql`char_length(${t.ocupacao}) between 2 and 80`),
    check('patient_cadastro_nacionalidade_check', sql`char_length(${t.nacionalidade}) between 2 and 60`),
    check('patient_cadastro_naturalidade_check', sql`char_length(${t.naturalidade}) between 2 and 80`),
    check('patient_cadastro_telefone_fixo_e164_check', sql`${t.telefoneFixoE164} ~ '^\\+[1-9][0-9]{7,14}$'`),
    check('patient_cadastro_cep_check', sql`${t.cep} ~ '^[0-9]{8}$'`),
    check('patient_cadastro_logradouro_check', sql`char_length(${t.logradouro}) between 2 and 120`),
    check('patient_cadastro_numero_check', sql`char_length(${t.numero}) between 1 and 10`),
    check('patient_cadastro_complemento_check', sql`char_length(${t.complemento}) between 1 and 60`),
    check('patient_cadastro_bairro_check', sql`char_length(${t.bairro}) between 2 and 60`),
    check('patient_cadastro_cidade_check', sql`char_length(${t.cidade}) between 2 and 60`),
    check('patient_cadastro_uf_check', sql`${t.uf} in (${naLista(UFS)})`),
    check('patient_cadastro_observacao_check', sql`char_length(${t.observacao}) between 1 and 1000`),
  ],
);

export type PatientCadastroRow = typeof patientCadastro.$inferSelect;
