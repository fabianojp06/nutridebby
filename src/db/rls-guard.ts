import type { Pool, PoolClient } from 'pg';

export type RlsViolation = { table: string; problem: string };

/**
 * Tabelas com tenant_id que seguem outra regra, com a justificativa.
 * foods não é exceção: tem tenant_isolation e, além dela, a política taco_leitura (só SELECT) para as linhas da TACO (Plano 04, D1).
 */
export const RLS_EXCEPTIONS: Record<string, string> = {
  user: 'identidade global do Better Auth: login ocorre antes do contexto de tenant; acesso só via services do M1 (spec §4.1)',
  consents:
    'prova de aceite (termo do paciente, DPA) gravada fora do contexto de tenant, append-only; tenant_id só identifica o vínculo aceito; acesso só por src/modules/plataforma/dpa.ts, src/modules/pacientes/convite-paciente.ts, src/modules/agenda/agendamento-publico.ts (aceite da página pública, D13), src/modules/pacientes/exportacao-job.ts (leitura dos aceites do titular no dados.json), src/modules/portal/termo.ts (novo aceite do termo no portal, US-011), test/portal.ts (helper de testes que grava o aceite do termo do paciente), scripts/e2e-seed.ts (aceites da conta de paciente de vários consultórios do E2E) e test/carga/seed.ts (aceites dos pacientes sintéticos da pilha de carga, P08-03); a anonimização (src/modules/pacientes/lgpd.ts) só pela função app_anonimizar_aceites (0065); aditivo de IA (Plano 11, A-D20): tenant_id do consultório e user_id da nutricionista, termo ia-aditivo-<versão> — linha com tenant_id não é, por si, aceite de paciente; o termo diz qual é',
  invites:
    'lido pelo token antes de existir sessão (o paciente ainda nem tem conta); acesso só por src/modules/plataforma/convites.ts, src/modules/pacientes/convite-paciente.ts e src/modules/plataforma/contas.ts (validade do convite da nutricionista na lista do admin)',
  document_verifications:
    'RN-156: lida pelo código antes de existir contexto de tenant (verificação pública); sem dado de saúde nem do paciente; acesso só por src/modules/documentos/verificacao.ts (guarda em verificacao.test.ts); DELETE e UPDATE revogados, menos situacao/situacao_em (0090)',
};

/** Tabelas com patient_id que não precisam da política de paciente, com a justificativa. */
export const PATIENT_POLICY_EXCEPTIONS: Record<string, string> = {
  stored_files:
    'D4: política própria paciente_arquivos — o paciente vê os próprios arquivos e os do consultório (logo; capa só de conteúdo visível a ele, N38/0085)',
};

interface TenantTableRow {
  table: string;
  rls: boolean;
  forced: boolean;
  has_tenant_policy: boolean;
  has_patient_col: boolean;
  has_patient_policy: boolean;
}

/**
 * Shared table selection for all tenant_id queries.
 * Selects regular and partitioned tables in public schema with a tenant_id column.
 */
const TENANT_TABLES_SELECTION = `
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
 where c.relkind in ('r', 'p')
   and exists (select 1 from information_schema.columns k where k.table_schema = 'public'
               and k.table_name = c.relname and k.column_name = 'tenant_id')
`;

/**
 * Retorna a lista de tabelas (regulares e particionadas) com coluna tenant_id.
 */
export async function listTenantTables(db: Pool | PoolClient): Promise<string[]> {
  const { rows } = await db.query<{ table: string }>(`
    select c.relname as table
    ${TENANT_TABLES_SELECTION}
     order by 1`);
  return rows.map(r => r.table);
}

export async function findRlsViolations(db: Pool | PoolClient): Promise<RlsViolation[]> {
  const { rows } = await db.query<TenantTableRow>(`
    select c.relname as table,
           c.relrowsecurity as rls,
           c.relforcerowsecurity as forced,
           exists (select 1 from pg_policies p where p.schemaname = 'public'
                   and p.tablename = c.relname and p.policyname = 'tenant_isolation') as has_tenant_policy,
           (c.relname = 'patients' or exists (select 1 from information_schema.columns k where k.table_schema = 'public'
                   and k.table_name = c.relname and k.column_name = 'patient_id')) as has_patient_col,
           exists (select 1 from pg_policies p where p.schemaname = 'public'
                   and p.tablename = c.relname and p.policyname = 'patient_isolation') as has_patient_policy
    ${TENANT_TABLES_SELECTION}
     order by 1`);

  const out: RlsViolation[] = [];
  for (const r of rows) {
    if (RLS_EXCEPTIONS[r.table]) continue;
    if (!r.rls) out.push({ table: r.table, problem: 'RLS não habilitada' });
    else if (!r.forced) out.push({ table: r.table, problem: 'RLS não forçada' });
    else if (!r.has_tenant_policy) out.push({ table: r.table, problem: 'sem política tenant_isolation' });
    if (r.has_patient_col && !r.has_patient_policy && !PATIENT_POLICY_EXCEPTIONS[r.table]) {
      out.push({ table: r.table, problem: 'sem política patient_isolation' });
    }
  }
  return out;
}

/** Nomes citados nas listas de exceção que não existem no banco (lista esquecida após renomear/remover). */
export async function findStaleExceptions(
  db: Pool | PoolClient,
  maps: Record<string, Record<string, unknown>>,
): Promise<string[]> {
  const nomes = [...new Set(Object.values(maps).flatMap((m) => Object.keys(m)))];
  if (!nomes.length) return [];
  const { rows } = await db.query<{ t: string }>(
    `select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      where c.relname = any($1)`,
    [nomes],
  );
  const existentes = new Set(rows.map((r) => r.t));
  return Object.entries(maps).flatMap(([mapa, m]) =>
    Object.keys(m)
      .filter((t) => !existentes.has(t))
      .map((t) => `${mapa}: ${t}`),
  );
}

/** Tabelas que a sessão de paciente nunca vê (política RESTRICTIVE staff_only), com o motivo. */
export const STAFF_ONLY: Record<string, string> = {
  patient_tags: 'US-019: o paciente não vê etiquetas, nem no JSON da API',
  patient_tag_links: 'US-019: o paciente não vê etiquetas, nem no JSON da API',
  consultation_notes: 'US-016: o paciente nunca vê as notas privadas, nem no JSON da API',
  availability_rules: 'US-030 / D11: o paciente só recebe horários livres já calculados, nunca as regras',
  availability_blocks: 'US-030 / D11: o motivo do bloqueio pode ser pessoal ("Médico")',
  public_booking_requests: 'RN-16: pedido da página pública (código, contato) — só o contexto publico e a equipe',
  whatsapp_conexoes: 'D2: número e estado do WhatsApp do consultório — só a equipe',
  signed_document_notes: 'Res. CFN 656, art. 3º, XII / D15 da spec de documentos: justificativa de uso e motivo de cancelamento — só a equipe (a exportação do titular lê pelo worker)',
  ia_tarefas: 'Plano 11 (spec da IA §3): pedidos e sugestões da IA — só a equipe; o paciente nunca vê, nem os próprios',
  ia_uso: 'Plano 11 (D3): registro técnico de custo da IA — só a equipe (o admin lê pela função admin_metricas_ia)',
  ia_geracoes_modelos: 'Plano 14B (US-123 (d)): pedidos de modelos sugeridos pela IA — registro técnico da equipe; não tem paciente',
  lembretes_rotina_envios: 'Plano 17 (§5.5): marca técnica do último horário enviado de cada lembrete — escrita só pelo worker (gatilho lembretes_rotina_envios_do_worker, 0119) e apagada só por ele ou pela cascata do lembrete (lembretes_rotina_envios_sem_apagar, 0129); o paciente vê os lembretes, não a marca',
  fin_configuracoes: 'Plano 20 (F-D1): financeiro do consultório — só a nutricionista; o titular recebe o que é dele pela exportação (inclusão explícita)',
  fin_categorias: 'Plano 20 (F-D1): financeiro do consultório — só a nutricionista; o titular recebe o que é dele pela exportação (inclusão explícita)',
  fin_lancamentos: 'Plano 20 (F-D1): financeiro do consultório — só a nutricionista; o titular recebe o que é dele pela exportação (inclusão explícita)',
  exames_catalogo: 'Plano 22 (EP-D8, EP-D29, EP-D30): bibliotecas do consultório — só a equipe; sem paciente',
  exames_modelos_solicitacao: 'Plano 22 (EP-D8, EP-D29, EP-D30): bibliotecas do consultório — só a equipe; sem paciente',
  exam_interpretacoes: 'Plano 22 (EP-D18, EP-D19): nota de interpretação — fora do app; o titular recebe pela exportação (inclusão explícita)',
  exam_versoes: 'Plano 22 (EP-D41): versões anteriores do exame — só a equipe; o titular recebe pela exportação, sem a justificativa',
  locais_atendimento: 'link da sala: fora do paciente e do público; projeções `app_locais_para_agendamento`/`app_local_da_consulta` (Plano 23, AG-D4)',
  recados: 'Plano 25 (RN-462): o recado do consultório e o filtro (etiquetas) — só a equipe; o paciente lê a cópia na própria conversa',
  chat_avisos_nutri: 'Plano 25 (CH-D70, RN-458): preferência e marca do último aviso por e-mail à nutricionista — pela data da marca, o paciente saberia que outro paciente escreveu nas últimas 2 h; a sessão de paciente só passa pela função app_chat_aviso_nutri_devido',
  equipe_membros: 'Plano 26 (RN-502, RN-503): a equipe do consultório (contas da recepção, permissão do Financeiro, desativação) — só a equipe; a recepção lê só a própria linha',
};

export async function findStaffOnlyViolations(db: Pool | PoolClient): Promise<RlsViolation[]> {
  const { rows } = await db.query<{ t: string }>(
    `select tablename as t from pg_policies
      where schemaname = 'public' and policyname = 'staff_only' and permissive = 'RESTRICTIVE'`,
  );
  const com = new Set(rows.map((r) => r.t));
  return Object.keys(STAFF_ONLY)
    .filter((t) => !com.has(t))
    .map((table) => ({ table, problem: 'sem política staff_only (app_enable_staff_only)' }));
}

export type ComandoPublico = 'select' | 'insert' | 'update' | 'delete';
const COMANDOS: readonly ComandoPublico[] = ['select', 'insert', 'update', 'delete'];

/**
 * D11: tabelas que o contexto `publico` (páginas sem login) pode tocar, só com estes comandos. Toda outra tabela
 * com tenant_id tem `publico_negado` (app_enable_tenant_rls). Liberar = `SELECT app_allow_publico(...)` + entrada aqui.
 */
export const PUBLICO_LIBERADO: Record<string, { comandos: readonly ComandoPublico[]; motivo: string }> = {
  availability_rules: { comandos: ['select'], motivo: 'horários livres (horariosLivres)' },
  availability_blocks: { comandos: ['select'], motivo: 'horários livres (horariosLivres)' },
  appointments: { comandos: ['select', 'insert'], motivo: 'início/fim nos horários livres, dono do link da consulta e a consulta marcada pela página pública' },
  patients: { comandos: ['select', 'insert'], motivo: 'situação do dono do link; paciente da página pública (procura pelo e-mail e cria)' },
  audit_log: { comandos: ['insert'], motivo: 'o gatilho de auditoria roda com o papel de quem grava (patients, appointments da página pública)' },
  notifications: { comandos: ['select', 'insert'], motivo: 'lembretes da consulta marcada pela página pública (INSERT … ON CONFLICT lê a linha nova)' },
  public_booking_requests: { comandos: ['select', 'insert', 'update'], motivo: 'pedido da página pública: cria, confere o código (FOR UPDATE) e conclui' },
};

/** Toda tabela com tenant_id (fora de RLS_EXCEPTIONS) nega o `publico`, ou bate exatamente com PUBLICO_LIBERADO. */
export async function findPublicoViolations(db: Pool | PoolClient): Promise<RlsViolation[]> {
  const { rows } = await db.query<{ t: string; pol: string; cmd: string; permissive: string }>(
    `select tablename as t, policyname as pol, cmd, permissive from pg_policies
      where schemaname = 'public' and policyname like 'publico%'`,
  );
  const out: RlsViolation[] = [];
  for (const table of await listTenantTables(db)) {
    if (RLS_EXCEPTIONS[table]) continue;
    const pols = rows.filter((r) => r.t === table);
    const liberado = PUBLICO_LIBERADO[table];
    if (!liberado) {
      if (pols.length !== 1 || pols[0].pol !== 'publico_negado' || pols[0].cmd !== 'ALL' || pols[0].permissive !== 'RESTRICTIVE') {
        out.push({ table, problem: pols.some((p) => p.pol !== 'publico_negado') ? 'liberada ao publico sem entrada em PUBLICO_LIBERADO' : 'sem política publico_negado (app_enable_tenant_rls/app_deny_publico)' });
      }
      continue;
    }
    const negados = COMANDOS.filter((c) => !liberado.comandos.includes(c));
    const esperadas = negados.map((c) => `publico_sem_${c}`).sort();
    // nome, comando e RESTRICTIVE: um `publico_sem_update` criado FOR SELECT (ou PERMISSIVE) não nega o UPDATE
    const certas = pols.filter((p) => p.permissive === 'RESTRICTIVE' && negados.some((c) => p.pol === `publico_sem_${c}` && p.cmd === c.toUpperCase()));
    const atuais = certas.map((p) => p.pol).sort();
    if (pols.length !== certas.length || JSON.stringify(atuais) !== JSON.stringify(esperadas)) {
      out.push({ table, problem: `políticas do publico diferentes de PUBLICO_LIBERADO (esperado ${esperadas.join(', ') || 'nenhuma'})` });
    }
  }
  return out;
}

export type ComandoEscrita = 'insert' | 'update' | 'delete';
const ESCRITAS: readonly ComandoEscrita[] = ['insert', 'update', 'delete'];

/**
 * D1 (Plano 06, P-16 a): o que a sessão de paciente pode gravar, só com estes comandos. Toda outra tabela com tenant_id
 * tem `paciente_sem_insert/update/delete` (app_enable_tenant_rls). Liberar = `SELECT app_allow_paciente_escrita(...)` +
 * entrada aqui. Sem `update`, SELECT … FOR UPDATE/SHARE de paciente não enxerga a linha.
 */
export const PACIENTE_ESCREVE: Record<string, { comandos: readonly ComandoEscrita[]; motivo: string }> = {
  patients: { comandos: ['update'], motivo: 'aceite do convite (US-011), opt-in/opt-out do WhatsApp, a pausa dos lembretes de rotina (Plano 17, gatilho patients_lembretes_do_paciente, 0119) e a trava FOR UPDATE das ações do paciente — colunas conferidas pelo gatilho paciente_colunas (0085, B-4; lembretes_pausados_em desde a 0119)' },
  appointments: { comandos: ['insert', 'update'], motivo: 'agendar, confirmar, cancelar e remarcar pelo link, pelo WhatsApp e pelo portal (US-032, US-033, US-035)' },
  notifications: { comandos: ['insert', 'update'], motivo: 'lembretes da consulta marcada pelo paciente, respostas "1"/"2" e lembretes cancelados' },
  audit_log: { comandos: ['insert'], motivo: 'o gatilho de auditoria e o auditRead rodam com o papel de quem age' },
  stored_files: { comandos: ['insert'], motivo: 'foto do diário (US-042) e original do exame enviado (US-160, Plano 12): salvarArquivo/salvarArquivos com a sessão do paciente — só os tipos diario_foto_original e exame_original (0080, 0102)' },
  access_events: { comandos: ['insert'], motivo: 'CS-02: o paciente registra o acesso do dia (D9)' },
  push_subscriptions: { comandos: ['insert', 'delete'], motivo: 'INT-03 / P06-02: ativar e cancelar notificações no aparelho' },
  diary_entries: { comandos: ['insert'], motivo: 'US-042: o paciente registra a refeição (não edita nem apaga, D11); sem foto convertida, comentário nem "visto" (0080)' },
  privacy_requests: { comandos: ['insert'], motivo: 'US-046: o titular pede a exclusão' },
  data_exports: { comandos: ['insert', 'update'], motivo: 'US-046: o titular pede os próprios dados (solicitarExportacao marca o pendente esquecido como falhou); só escopo titular (0080); UPDATE só pendente → falhou (gatilho paciente_colunas, 0085)' },
  content_views: { comandos: ['insert'], motivo: 'US-055 (D18): o paciente registra que abriu o conteúdo, uma vez; só de conteúdo que ele vê (0083)' },
  content_favorites: { comandos: ['insert', 'delete'], motivo: 'US-055: favoritar e desfavoritar; só conteúdo que ele vê (0083)' },
  signed_document_receipts: { comandos: ['insert'], motivo: 'D4 da spec de documentos: o paciente registra que abriu e confirma o recebimento do próprio documento emitido, uma vez por evento (paciente_recibo_proprio, 0090)' },
  document_access_codes: { comandos: ['insert', 'update'], motivo: 'RN-158 / D3 b: o paciente sem login pede e confere o código do próprio documento (src/modules/documentos/link-documento.ts, contexto de paciente sem conta, N7)' },
  exam_submissions: { comandos: ['insert', 'update'], motivo: 'US-160/US-161 (Plano 12): o paciente cria o envio "processando" e cancela o próprio "recebido" — políticas paciente_envio_insert/paciente_envio_update e o gatilho exam_submissions_regras (0102)' },
  exam_submission_files: { comandos: ['insert'], motivo: 'US-160 (Plano 12): o paciente registra os originais do próprio envio "processando" (paciente_envio_arquivo, 0102); não lê as páginas' },
  ia_autorizacoes: { comandos: ['insert'], motivo: 'Plano 14A (RN-107, US-106, US-107, US-109): o paciente autoriza ou retira a própria autorização de IA no app (canal app, com a própria conta) ou pelo link do e-mail (canal link, sem conta) — política paciente_autorizacao_propria (0108); UPDATE, DELETE e TRUNCATE revogados' },
  ia_nutri_mensagens: { comandos: ['update'], motivo: 'Plano 15 (US-172, US-174): o paciente avalia a resposta e encaminha a própria pergunta — só essas colunas, de nulo para valor (gatilho ia_nutri_mensagens_regras, 0116); INSERT só por app_ia_nutri_perguntar (0117)' },
  ia_nutri_consentimentos: { comandos: ['insert'], motivo: 'Plano 15 (RN-171, US-171): o paciente dá o próprio consentimento da IA Nutri no app (paciente_consentimento_proprio, 0116); a revogação só por app_ia_nutri_revogar; UPDATE, DELETE e TRUNCATE revogados' },
  lembretes_rotina: { comandos: ['update'], motivo: 'Plano 17 (§5.3): o paciente desliga e religa o próprio lembrete — só desligado_pelo_paciente_em, com o relógio do banco (gatilho lembretes_rotina_regras, 0119); não cria, não edita a configuração nem apaga' },
  aniversario_autorizacoes: { comandos: ['insert'], motivo: 'Plano 23 (RN-433, US-414): o paciente autoriza ou retira a própria autorização de mensagens de aniversário no app (origem app, com a própria conta) ou só retira pelo link do e-mail (origem link, sem conta) — política paciente_aniversario_proprio; UPDATE, DELETE e TRUNCATE revogados' },
  chat_mensagens: { comandos: ['insert'], motivo: 'Plano 25 (US-443, RN-443): o paciente envia na própria conversa liberada e não pausada — política paciente_chat_envio e gatilho chat_mensagens_regras; UPDATE, DELETE e TRUNCATE revogados' },
  chat_leituras: { comandos: ['insert', 'update'], motivo: 'Plano 25 (RN-448): o paciente avança o próprio marcador de leitura — políticas paciente_leitura_propria_insert/_update' },
};

/** B-5 (P06-12): o texto que o Postgres guarda da negação de app_deny_paciente_escrita, sem espaços e parênteses. */
const normalizarExpressao = (e: string | null) => (e ?? '').replace(/[\s()]/g, '').toLowerCase();
const NEGA_PACIENTE = normalizarExpressao("app_current_role() IS DISTINCT FROM 'paciente'::text");

/** Toda tabela com tenant_id (fora de RLS_EXCEPTIONS) nega a escrita do paciente, ou bate exatamente com PACIENTE_ESCREVE. */
export async function findPacienteEscritaViolations(db: Pool | PoolClient): Promise<RlsViolation[]> {
  const { rows } = await db.query<{ t: string; pol: string; cmd: string; permissive: string; qual: string | null; with_check: string | null }>(
    `select tablename as t, policyname as pol, cmd, permissive, qual, with_check from pg_policies
      where schemaname = 'public' and policyname like 'paciente\\_sem\\_%'`,
  );
  const out: RlsViolation[] = [];
  for (const table of await listTenantTables(db)) {
    if (RLS_EXCEPTIONS[table]) continue;
    const pode = PACIENTE_ESCREVE[table]?.comandos ?? [];
    for (const c of ESCRITAS) {
      // nome, comando, RESTRICTIVE e a expressão (B-5): um `paciente_sem_delete USING (true)` não nega o DELETE
      const negada = rows.some(
        (r) =>
          r.t === table && r.pol === `paciente_sem_${c}` && r.cmd === c.toUpperCase() && r.permissive === 'RESTRICTIVE' &&
          normalizarExpressao(c === 'insert' ? r.with_check : r.qual) === NEGA_PACIENTE,
      );
      if (!pode.includes(c) && !negada) out.push({ table, problem: `a sessão de paciente pode ${c} sem entrada em PACIENTE_ESCREVE` });
      if (pode.includes(c) && rows.some((r) => r.t === table && r.pol === `paciente_sem_${c}`)) {
        out.push({ table, problem: `PACIENTE_ESCREVE libera ${c}, mas o banco nega (paciente_sem_${c})` });
      }
    }
  }
  return out;
}

/**
 * RN-12 / D2 (Plano 07): tabelas sem patient_id que a sessão de paciente lê pela audiência do conteúdo — política
 * RESTRICTIVE `paciente_conteudo_visivel` (FOR SELECT, migration 0083). Tabela nova de conteúdo entra aqui.
 */
export const CONTEUDO_POR_AUDIENCIA: Record<string, string> = {
  contents: 'publicado e da audiência do paciente (todos, etiqueta via app_conteudo_por_etiqueta, pacientes) ou, só com liberarReceitasDoPlano, receita do plano publicado dele',
  recipes: 'herda de contents',
  recipe_ingredients: 'herda de contents',
};

/**
 * R11 (como a B-5): nome, comando e RESTRICTIVE não bastam — uma `paciente_conteudo_visivel USING (true)` mostraria ao
 * paciente todo conteúdo do tenant. Trechos (normalizados) que a expressão precisa ter: `contents` decide a audiência;
 * as outras herdam de `contents` por EXISTS.
 */
const AUDIENCIA_EXIGE: Record<string, string[]> = {
  contents: [NEGA_PACIENTE, "status='publicado'::text", 'app_current_patient', 'app_conteudo_por_etiqueta', 'app.receitas_do_plano'],
};
/** As filhas herdam de `contents` ligando a linha: sem `c.id = <tabela>.content_id`, o EXISTS vê qualquer conteúdo visível. */
const ligaAoConteudo = (t: string) => [`c.id=${t}.content_id`, `c.tenant_id=${t}.tenant_id`];
const HERDA_DE_CONTENTS = (t: string) => [NEGA_PACIENTE, 'exists', 'fromcontents', ...ligaAoConteudo(t)];

/**
 * US-055 / D14 (0083): a escrita do paciente nestas tabelas (PACIENTE_ESCREVE) só vale para conteúdo que ele vê PELA
 * AUDIÊNCIA — política RESTRICTIVE de INSERT, nunca com a liberação das receitas do plano ligada. Tabela → política.
 */
export const ESCRITA_POR_AUDIENCIA: Record<string, string> = {
  content_views: 'paciente_conteudo_visto',
  content_favorites: 'paciente_conteudo_favorito',
};
const ESCRITA_EXIGE = (t: string) => [NEGA_PACIENTE, 'app.receitas_do_plano', "isdistinctfrom'on'", 'exists', 'fromcontents', ...ligaAoConteudo(t)];

export async function findConteudoAudienciaViolations(db: Pool | PoolClient): Promise<RlsViolation[]> {
  const { rows } = await db.query<{ t: string; pol: string; cmd: string; permissive: string; qual: string | null; with_check: string | null }>(
    `select tablename as t, policyname as pol, cmd, permissive, qual, with_check from pg_policies
      where schemaname = 'public' and policyname in ('paciente_conteudo_visivel', 'paciente_conteudo_visto', 'paciente_conteudo_favorito')`,
  );
  const leitura = Object.keys(CONTEUDO_POR_AUDIENCIA).flatMap((table): RlsViolation[] => {
    const r = rows.find((x) => x.t === table && x.pol === 'paciente_conteudo_visivel' && x.permissive === 'RESTRICTIVE' && x.cmd === 'SELECT');
    if (!r) return [{ table, problem: 'sem política paciente_conteudo_visivel (RN-12)' }];
    const e = normalizarExpressao(r.qual);
    if (!(AUDIENCIA_EXIGE[table] ?? HERDA_DE_CONTENTS(table)).every((trecho) => e.includes(trecho))) {
      return [{ table, problem: 'paciente_conteudo_visivel sem a audiência (RN-12)' }];
    }
    return [];
  });
  const escrita = Object.entries(ESCRITA_POR_AUDIENCIA).flatMap(([table, pol]): RlsViolation[] => {
    const r = rows.find((x) => x.t === table && x.pol === pol && x.permissive === 'RESTRICTIVE' && x.cmd === 'INSERT');
    if (!r) return [{ table, problem: `sem política ${pol} (US-055, D14)` }];
    const e = normalizarExpressao(r.with_check);
    if (!ESCRITA_EXIGE(table).every((trecho) => e.includes(trecho))) return [{ table, problem: `${pol} sem a audiência (US-055, D14)` }];
    return [];
  });
  return [...leitura, ...escrita];
}

/**
 * Plano 26 (RN-505, RE-D15): o que a sessão `recepcao` pode tocar, só com estes comandos (matriz da spec §4.3). Toda outra
 * tabela com tenant_id tem `recepcao_negada` (app_enable_tenant_rls e o laço da rls_recepcao). Liberar =
 * `SELECT app_allow_recepcao(...)` + entrada aqui; a condição extra (paciente visível, financeiro, notificação da agenda,
 * própria linha) é uma política `recepcao_cond_<assunto>` em RECEPCAO_CONDICOES.
 */
export const RECEPCAO_LIBERADO: Record<string, { comandos: readonly ComandoPublico[]; motivo: string }> = {
  equipe_membros: { comandos: ['select'], motivo: 'RN-502, RN-503: a própria linha (permissão do Financeiro e situação da conta), pela condição recepcao_cond_propria_linha' },
  // T5a (bloco 3 da rls_recepcao; spec §4.3). As tabelas do Plano 23 (locais_atendimento) entram na regeneração (§5).
  // public_booking_requests fica de fora: pedido de pessoa nova é da nutricionista (RE-D59)
  patients: { comandos: ['select', 'insert', 'update'], motivo: 'RE-D25, RN-508: cadastro; só paciente visível (recepcao_cond_paciente_visivel); colunas pelo gatilho patients_da_recepcao (T5b)' },
  patient_cadastro: { comandos: ['select', 'insert', 'update'], motivo: 'RN-508, RE-D38: cadastro complementar sem observação nem identidade de gênero (gatilho, T5b); só de paciente visível' },
  appointments: { comandos: ['select', 'insert', 'update'], motivo: 'RN-509: agenda; só de paciente visível; colunas e transições pelo gatilho appointments_da_recepcao (T5b)' },
  notifications: { comandos: ['select', 'insert', 'update'], motivo: 'RN-507: lembretes e avisos da consulta — só TIPOS_DA_AGENDA, só de paciente visível' },
  availability_rules: { comandos: ['select'], motivo: 'RN-509: horários livres e grade da agenda' },
  availability_blocks: { comandos: ['select'], motivo: 'RN-509: grade da agenda; o motivo do bloqueio não sai do módulo' },
  audit_log: { comandos: ['insert'], motivo: 'RN-516: o gatilho de auditoria e o auditRead gravam com o papel de quem age; a recepção não lê a trilha' },
  fin_configuracoes: { comandos: ['select'], motivo: 'RN-506: valor da consulta nos formulários, com a permissão do Financeiro (recepcao_cond_financeiro)' },
  fin_categorias: { comandos: ['select'], motivo: 'RN-506: categorias nos formulários, com a permissão do Financeiro (recepcao_cond_financeiro)' },
  fin_lancamentos: { comandos: ['select', 'insert', 'update'], motivo: 'RN-506: Financeiro com a permissão; paciente visível ou sem paciente; fin_lancamentos_regras "como nutri, com falha fechada"' },
};

/** O texto que o Postgres guarda da negação de app_deny_recepcao/app_allow_recepcao, normalizado como o NEGA_PACIENTE. */
const NEGA_RECEPCAO = normalizarExpressao("app_current_role() IS DISTINCT FROM 'recepcao'::text");

/**
 * Plano 26 (RN-505): as condições extras da recepção — política RESTRICTIVE `recepcao_cond_<assunto>`, com o comando declarado
 * e a expressão INTEIRA esperada no USING e no WITH CHECK (`null` = sem a cláusula), escrita como o Postgres a guarda
 * (`pg_policies.qual`/`with_check`, com os `::text`) e comparada por igualdade depois de normalizar (sem espaços nem
 * parênteses), como a `recepcao_negada`: conferir por trecho deixaria passar `… OR NOT (…)` ou `… OR true` (revisão da T4).
 * Toda expressão declarada começa pela negação `NEGA_RECEPCAO` seguida de OR (a condição só restringe a recepção).
 * Tabela → política → regra.
 */
export type CondicaoDaRecepcao = {
  comando: 'ALL' | 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
  using: string | null;
  withCheck: string | null;
  motivo: string;
};
/**
 * RN-508 / RE-D40 (T5a): a condição do paciente visível numa tabela filha — EXISTS no paciente do mesmo consultório, nem
 * bloqueado nem anonimizado, com os filtros escritos (não só a RLS de `patients` dentro da subconsulta). `semPaciente`: a linha
 * sem paciente também passa (lançamento do Financeiro sem paciente).
 */
const pacienteVisivelPor = (t: string, semPaciente = false): CondicaoDaRecepcao => {
  const e =
    `app_current_role() IS DISTINCT FROM 'recepcao'::text OR ${semPaciente ? 'patient_id IS NULL OR ' : ''}EXISTS (SELECT 1 FROM patients p ` +
    `WHERE p.tenant_id = ${t}.tenant_id AND p.id = ${t}.patient_id AND p.status <> 'bloqueado'::text AND p.anonimizado_em IS NULL)`;
  return { comando: 'ALL', using: e, withCheck: e, motivo: 'RN-508, RE-D40: só linha de paciente visível (nem bloqueado nem anonimizado); escondido = falha fechada' };
};
/** RN-506 (T5a): a permissão do Financeiro, dentro de `(SELECT …)` — um InitPlan por consulta, não uma chamada por linha. */
const FINANCEIRO: CondicaoDaRecepcao = {
  comando: 'ALL',
  using: "app_current_role() IS DISTINCT FROM 'recepcao'::text OR (SELECT app_recepcao_tem_financeiro() AS app_recepcao_tem_financeiro)",
  withCheck: "app_current_role() IS DISTINCT FROM 'recepcao'::text OR (SELECT app_recepcao_tem_financeiro() AS app_recepcao_tem_financeiro)",
  motivo: 'RN-502, RN-506: só a recepção ativa com a permissão do Financeiro (app_recepcao_tem_financeiro)',
};
/** RN-507 (T5a): a lista é TIPOS_DA_AGENDA (src/modules/notificacoes/tipos.ts; tipos.test.ts compara as três). */
const TIPOS_DA_AGENDA_NA_POLITICA =
  "app_current_role() IS DISTINCT FROM 'recepcao'::text OR tipo = ANY (ARRAY['lembrete_24h'::text, 'lembrete_2h'::text, " +
  "'consulta_marcada'::text, 'consulta_cancelada'::text, 'resposta_confirmacao'::text, 'resposta_remarcar'::text, " +
  "'pedido_nao_confirmado'::text])";

export const RECEPCAO_CONDICOES: Record<string, Record<string, CondicaoDaRecepcao>> = {
  equipe_membros: {
    recepcao_cond_propria_linha: {
      comando: 'SELECT',
      using: "app_current_role() IS DISTINCT FROM 'recepcao'::text OR user_id = app_current_user()",
      withCheck: null,
      motivo: 'RN-503: a recepção lê só a própria linha',
    },
  },
  // T5a (bloco 3)
  patients: {
    recepcao_cond_paciente_visivel: {
      comando: 'ALL',
      using: "app_current_role() IS DISTINCT FROM 'recepcao'::text OR (status <> 'bloqueado'::text AND anonimizado_em IS NULL)",
      withCheck: "app_current_role() IS DISTINCT FROM 'recepcao'::text OR (status <> 'bloqueado'::text AND anonimizado_em IS NULL)",
      motivo: 'RN-508, RE-D35: a recepção não vê nem leva a bloqueado o paciente bloqueado ou anonimizado',
    },
  },
  patient_cadastro: { recepcao_cond_paciente_visivel: pacienteVisivelPor('patient_cadastro') },
  appointments: { recepcao_cond_paciente_visivel: pacienteVisivelPor('appointments') },
  notifications: {
    recepcao_cond_paciente_visivel: pacienteVisivelPor('notifications'),
    recepcao_cond_notificacoes_da_agenda: {
      comando: 'ALL',
      using: TIPOS_DA_AGENDA_NA_POLITICA,
      withCheck: TIPOS_DA_AGENDA_NA_POLITICA,
      motivo: 'RN-507: só os tipos da agenda (sem convite_paciente, RE-D37; nada clínico)',
    },
  },
  fin_configuracoes: { recepcao_cond_financeiro: FINANCEIRO },
  fin_categorias: { recepcao_cond_financeiro: FINANCEIRO },
  fin_lancamentos: { recepcao_cond_financeiro: FINANCEIRO, recepcao_cond_paciente_visivel: pacienteVisivelPor('fin_lancamentos', true) },
};

const NOME_DA_RECEPCAO = /^recepcao_(negada|sem_(select|insert|update|delete)|cond_[a-z0-9_]+)$/;

/**
 * Toda tabela com tenant_id (fora de RLS_EXCEPTIONS) nega a recepção (`recepcao_negada`), ou tem exatamente as `recepcao_sem_*`
 * dos comandos que RECEPCAO_LIBERADO não libera — nome, comando, RESTRICTIVE e a expressão (como a B-5). Toda política
 * `recepcao_*` do schema public segue um dos três padrões; toda `recepcao_cond_*` é RESTRICTIVE e bate com RECEPCAO_CONDICOES.
 */
export async function findRecepcaoViolations(db: Pool | PoolClient): Promise<RlsViolation[]> {
  const { rows } = await db.query<{ t: string; pol: string; cmd: string; permissive: string; qual: string | null; with_check: string | null }>(
    `select tablename as t, policyname as pol, cmd, permissive, qual, with_check from pg_policies
      where schemaname = 'public' and policyname like 'recepcao%'`,
  );
  const out: RlsViolation[] = [];
  const nega = (r: { qual: string | null; with_check: string | null }, comExpressao: 'qual' | 'with_check' | 'ambas') =>
    comExpressao === 'ambas'
      ? normalizarExpressao(r.qual) === NEGA_RECEPCAO && normalizarExpressao(r.with_check) === NEGA_RECEPCAO
      : normalizarExpressao(r[comExpressao]) === NEGA_RECEPCAO;

  for (const r of rows) {
    if (!NOME_DA_RECEPCAO.test(r.pol)) {
      out.push({ table: r.t, problem: `política ${r.pol} fora dos padrões (recepcao_negada, recepcao_sem_<cmd>, recepcao_cond_<assunto>)` });
    }
  }

  const condicoes = rows.filter((r) => r.pol.startsWith('recepcao_cond_'));
  for (const r of condicoes) {
    if (r.permissive !== 'RESTRICTIVE') out.push({ table: r.t, problem: `condição ${r.pol} PERMISSIVE (toda condição da recepção é RESTRICTIVE)` });
    const regra = RECEPCAO_CONDICOES[r.t]?.[r.pol];
    if (!regra) {
      out.push({ table: r.t, problem: `condição ${r.pol} sem entrada em RECEPCAO_CONDICOES` });
      continue;
    }
    const declaradas = [regra.using, regra.withCheck].filter((e): e is string => e !== null);
    if (declaradas.length === 0 || !declaradas.every((e) => normalizarExpressao(e).startsWith(`${NEGA_RECEPCAO}or`))) {
      out.push({ table: r.t, problem: `condição ${r.pol} declarada em RECEPCAO_CONDICOES sem começar pela negação da recepção` });
      continue;
    }
    const certa =
      r.cmd === regra.comando &&
      normalizarExpressao(r.qual) === normalizarExpressao(regra.using) &&
      normalizarExpressao(r.with_check) === normalizarExpressao(regra.withCheck);
    if (r.permissive === 'RESTRICTIVE' && !certa) out.push({ table: r.t, problem: `condição ${r.pol} sem o comando ou a expressão de RECEPCAO_CONDICOES` });
  }
  for (const [table, pols] of Object.entries(RECEPCAO_CONDICOES)) {
    for (const pol of Object.keys(pols)) {
      if (!condicoes.some((r) => r.t === table && r.pol === pol)) out.push({ table, problem: `sem a condição ${pol} (RECEPCAO_CONDICOES)` });
    }
  }

  for (const table of await listTenantTables(db)) {
    if (RLS_EXCEPTIONS[table]) continue;
    const pols = rows.filter((r) => r.t === table && !r.pol.startsWith('recepcao_cond_'));
    const liberado = RECEPCAO_LIBERADO[table];
    if (!liberado) {
      const negada = pols.length === 1 && pols[0].pol === 'recepcao_negada' && pols[0].cmd === 'ALL' && pols[0].permissive === 'RESTRICTIVE' && nega(pols[0], 'ambas');
      if (!negada) {
        out.push({
          table,
          problem: pols.some((p) => p.pol !== 'recepcao_negada')
            ? 'liberada à recepção sem entrada em RECEPCAO_LIBERADO'
            : 'sem política recepcao_negada (app_enable_tenant_rls/app_deny_recepcao)',
        });
      }
      continue;
    }
    const negados = COMANDOS.filter((c) => !liberado.comandos.includes(c));
    const esperadas = negados.map((c) => `recepcao_sem_${c}`).sort();
    const certas = pols.filter(
      (p) =>
        p.permissive === 'RESTRICTIVE' &&
        negados.some((c) => p.pol === `recepcao_sem_${c}` && p.cmd === c.toUpperCase() && nega(p, c === 'insert' ? 'with_check' : 'qual')),
    );
    if (pols.length !== certas.length || JSON.stringify(certas.map((p) => p.pol).sort()) !== JSON.stringify(esperadas)) {
      out.push({ table, problem: `políticas da recepção diferentes de RECEPCAO_LIBERADO (esperado ${esperadas.join(', ') || 'nenhuma'})` });
    }
  }
  return out;
}
