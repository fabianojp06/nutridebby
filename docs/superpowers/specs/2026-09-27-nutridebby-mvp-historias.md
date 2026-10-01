# NutriDebby — Histórias de Usuário do MVP

Complementa [`2026-09-27-nutridebby-mvp-design.md`](2026-09-27-nutridebby-mvp-design.md). IDs de RN, RNF, INT e tabelas se referem àquele documento.

**Prioridade (MoSCoW):** **M** = Must (bloqueia o go-live) · **S** = Should (entra no MVP; pode ir para depois do go-live se o prazo apertar).
**Estimativas:** feitas no planejamento (writing-plans), não aqui.

## Definition of Done (vale para todas as histórias)

- [ ] Critérios de aceite automatizados: Vitest (regra/serviço) e/ou Playwright (fluxo de tela)
- [ ] Toda tabela nova com `tenant_id` tem RLS forçada **e** está coberta pelo teste de isolamento (RNF-07)
- [ ] Leitura/alteração de dado de saúde gera `audit_log` (RNF-08)
- [ ] Validação com Zod no servidor; mensagens de erro em pt-BR
- [ ] Telas do PWA sem violações axe de nível A/AA (RNF-10)
- [ ] Sem dado de saúde em logs ou no Sentry (RNF-11)
- [ ] CI verde; PR revisado
- [ ] Migration reversível ou com nota de rollback no PR

## Índice

| Épico | Histórias |
|---|---|
| E1 — Plataforma & acesso (M1) | US-001 a US-007 |
| E2 — Pacientes & prontuário (M2) | US-010 a US-019 |
| E3 — Plano alimentar (M3) | US-020 a US-026 |
| E4 — Agenda & lembretes (M4) | US-030 a US-037 |
| E5 — Portal do paciente (M5) | US-040 a US-046 |
| E6 — Biblioteca de conteúdo (M6) | US-050 a US-056 |

---

# E1 — Plataforma & acesso

## US-001 — Admin cria conta de nutricionista · **M**

**Como** admin da plataforma, **quero** criar a conta de uma nutricionista, **para que** ela comece a usar o sistema sem cadastro público.

| Campo | Tipo | Obrig. | Validação | Erro |
|---|---|---|---|---|
| `nome_exibicao` | texto | Sim | 3–80 caracteres | "Informe o nome (3 a 80 caracteres)" |
| `email` | e-mail | Sim | formato válido; único em `users` | "Informe um e-mail válido" (formato); "E-mail já cadastrado" (duplicado) |
| `crn` | texto | Sim | `^CRN-?\d{1,2}\s?\d{3,6}$` (sem diferenciar maiúsc./minúsc.) | "CRN inválido. Ex.: CRN-3 12345" |
| `slug` | texto | Sim | `^[a-z0-9-]{3,40}$`; único | "Use de 3 a 40 letras minúsculas, números ou hífen" (formato); "Endereço já em uso" (duplicado) |

Na tela, o campo `slug` tem o rótulo "Endereço da página" e a dica "Vai compor o link da página pública de agendamento, quando ela estiver disponível: `<APP_URL>/n/seu-endereco`. Não é o endereço do consultório." (v1.5: o rótulo "Endereço" sozinho era confundido com o endereço do consultório).

```gherkin
Cenário: Criação com sucesso
  Dado que estou logado como admin
  Quando crio a conta "Debby Silva", e-mail "debby@exemplo.com", CRN "CRN-3 12345", slug "debby"
  Então um tenant com status "ativa" e wa_cota_mensal 500 é criado
  E um usuário role "nutri" vinculado ao tenant é criado sem senha
  E um e-mail de convite com link válido por 72 h é enviado para "debby@exemplo.com"

Cenário: Slug duplicado
  Dado que já existe o tenant com slug "debby"
  Quando tento criar outra conta com slug "debby"
  Então vejo "Endereço já em uso"
  E nenhum tenant ou usuário é criado

Cenário: Convite expirado
  Dado que o convite foi enviado há mais de 72 h
  Quando a nutricionista abre o link
  Então vê "Convite expirado. Peça um novo ao suporte."
  E o admin tem o botão "Reenviar convite" na lista de contas

Cenário: Reenviar convite de conta suspensa
  Dado que o tenant está suspenso
  Quando o admin tenta "Reenviar convite"
  Então vê "Conta suspensa: reative antes de reenviar o convite."
  E nenhum e-mail é enviado (RN-15)

Cenário: Primeiro admin
  Dado um banco recém-criado, sem nenhum admin
  Quando executo "pnpm admin:criar admin@<dominio>" no container
  Então um usuário role "admin" é criado e recebe o e-mail para definir a senha e configurar o 2FA
  E não existe nenhuma tela pública para criar admin
```

**Impacto:** `tenants`, `users`, `verifications`, `invites`; e-mail (INT-02). **Plano 02:** a criação é uma Server Action da tela do admin, sem `POST /api/admin/tenants`.

## US-002 — Login, primeiro acesso e recuperação de senha · **M**

**Como** usuário (nutricionista, paciente ou admin), **quero** entrar com e-mail e senha e recuperar a senha, **para** acessar minha área com segurança.

Senha: mínimo de 10 caracteres, pelo menos 1 letra e 1 número; é recusada se estiver na lista de senhas comuns (top 10 mil).

```gherkin
Cenário: Primeiro acesso da nutricionista pelo convite
  Dado que recebi o convite válido
  Quando defino a senha "Nutri2026segura" e aceito o DPA (contrato de tratamento de dados)
  Então sou direcionada para /painel
  E tenants.dpa_aceito_em é preenchido

Cenário: Login redireciona por perfil
  Dado que existem usuários com role "admin", "nutri" e "paciente"
  Quando cada um faz login com credenciais corretas
  Então o admin vai para /admin, a nutri para /painel e o paciente para /p

Cenário: Bloqueio por tentativas
  Dado que errei a senha 5 vezes em 15 minutos com o mesmo e-mail e IP
  Quando tento a 6ª vez, mesmo com a senha correta
  Então recebo HTTP 429 e a mensagem "Muitas tentativas. Tente novamente em 15 minutos."

Cenário: Recuperação de senha sem revelar cadastro
  Quando peço recuperação para um e-mail qualquer
  Então vejo sempre "Se o e-mail estiver cadastrado, você receberá um link"
  E o link, se enviado, vale por 1 h e só pode ser usado uma vez

Cenário: Recuperação protegida pelo Turnstile (INT-06)
  Dado que o Turnstile ainda não entregou o token
  Então o botão vem acompanhado da dica "Aguarde a verificação anti-robô." e fica desabilitado durante o envio
  Quando o token é ausente ou inválido, o servidor responde 403 e vejo "Confirme que você não é um robô."
  E quando o Turnstile está fora do ar, o servidor responde 503 e vejo "Tente novamente em alguns minutos"
  E em ambos os casos nenhum link é enviado e nada é gravado

Cenário: Expiração da sessão
  Dado que sou nutricionista sem atividade há 12 h
  Quando faço qualquer requisição
  Então sou redirecionada para o login
```

**Impacto:** Better Auth; `users`, `sessions`, `verifications`.

## US-003 — 2FA (obrigatório para o admin, opcional para a nutricionista) · **M**

**Como** nutricionista ou admin, **quero** a verificação em duas etapas, **para** proteger os dados de saúde dos pacientes.

```gherkin
Cenário: Ativar 2FA
  Dado que estou em Configurações > Segurança
  Quando leio o QR Code no app autenticador e digito o código de 6 dígitos correto
  Então o 2FA fica ativo
  E recebo 10 códigos de recuperação de uso único, exibidos uma única vez

Cenário: Login com 2FA
  Dado que tenho 2FA ativo
  Quando informo e-mail e senha corretos
  Então o sistema pede o código TOTP antes de criar a sessão

Cenário: Segredo protegido
  Então users.totp_secret_enc é gravado cifrado com AES-256-GCM e nunca aparece em texto puro no banco

Cenário: Admin obrigatório
  Dado um admin sem 2FA configurado
  Quando faz login
  Então só consegue acessar a tela de configuração do 2FA até concluí-la
```

## US-004 — Admin suspende e reativa conta · **M**

**Como** admin, **quero** suspender e reativar uma conta, **para** tratar inadimplência ou encerramento sem apagar dados.

```gherkin
Cenário: Suspender
  Dado que o tenant "debby" está ativo e tem uma consulta daqui a 10 h com lembrete pendente
  Quando o admin suspende o tenant
  Então a nutricionista e os pacientes veem "Conta temporariamente indisponível" ao acessar
  E o lembrete pendente passa a status "ignorada" com motivo "tenant_suspenso"
  E nenhum dado do tenant é removido

Nota de entrega (Plano 02): a tela "Conta temporariamente indisponível", a revogação das sessões e o bloqueio do login já valem; a mudança do lembrete pendente para "ignorada" (motivo "tenant_suspenso") e o reagendamento na reativação entram no P05-06, quando a tabela `notifications` existir. Hoje o job de e-mail já ignora tenant suspenso. Para pacientes, a checagem por vínculo entra no Plano 06.

Cenário: Reativar
  Dado que o tenant "debby" está suspenso
  Quando o admin reativa o tenant
  Então o acesso volta ao normal
  E os lembretes de consultas futuras são reagendados conforme RN-05

Cenário: Admin não vê prontuário
  Dado que estou logado como admin
  Quando chamo qualquer rota /api/painel/* ou /api/p/*
  Então recebo HTTP 403

Cenário: Conta inexistente
  Dado que a conta não existe mais
  Quando o admin tenta suspender, reativar ou ajustar a cota dela
  Então vê "Conta não encontrada."
```

Nomes acessíveis por conta na lista do admin: "Reenviar convite para <nome de exibição>", "Suspender a conta <nome>", "Reativar a conta <nome>", campo "Cota mensal de WhatsApp de <nome>" e botão "Salvar a cota de <nome>".

## US-005 — Configurar perfil e marca · **M**

**Como** nutricionista, **quero** configurar logo, cor, nome de exibição, CRN, endereço, fuso, antecedências e horário de atendimento, **para que** o PDF, o PWA e as mensagens tenham a minha identidade.

| Campo | Validação |
|---|---|
| Logo | PNG/JPEG/SVG ≤ 2 MB; redimensionado para no máx. 512 px. SVG com filtros é recusado: "SVG com filtros não é aceito. Envie o logo em PNG." (o mesmo texto vale para SVG com `<!DOCTYPE` fora da forma comum dos editores — literal com `<` ou `>` ou subconjunto interno — ou com marcação XML sem fechamento). SVG que não termina de rasterizar em 5 s: "Não foi possível processar este SVG. Envie o logo em PNG." (HTTP 415). Só um logo é processado por vez no servidor: "Tente novamente em alguns instantes." (HTTP 429), e depois de um SVG interrompido os SVGs desse tenant ficam recusados por 10 min com o mesmo texto |
| `cor_primaria` | hex `^#[0-9a-fA-F]{6}$`; contraste ≥ 4,5:1 com branco (senão: "Cor muito clara para texto branco") |
| `antecedencia_min_h` | inteiro 0–72 |
| `cancelamento_min_h` | inteiro 0–72 |
| `link_online_padrao` | começa com `https://` ("Informe um link que comece com https://"); até 500 caracteres ("Use no máximo 500 caracteres") |

```gherkin
Cenário: Marca aplicada
  Dado que defini a cor "#2E7D32" e enviei meu logo
  Quando o paciente abre o PWA e quando gero o PDF de um plano
  Então ambos exibem meu logo e usam a cor "#2E7D32"
```

Nota de entrega (Plano 02): a marca é aplicada no painel; o PWA (Plano 06) e o PDF do plano (P04-09) passam a consumi-la por `getTenantBrand()`. **Risco residual aceito (2026-09-29):** a recusa de SVG com filtro é por varredura do texto e pode ser burlada por artifício de parser; o dano fica contido pelo processo filho morto em 5 s, um logo por vez e resfriamento de 10 min por tenant.

## US-006 — Isolamento entre tenants (história técnica) · **M**

**Como** dona do produto, **quero** garantia automatizada de que uma nutricionista nunca acessa dados de outra, **para** cumprir a LGPD e manter a confiança das clientes.

```gherkin
Cenário: Leitura cruzada bloqueada no banco
  Dado os tenants A e B, cada um com 1 registro em cada tabela 🔒
  Quando uma transação com app.tenant_id = A faz SELECT, UPDATE e DELETE sem filtro em cada tabela 🔒
  Então só registros de A são retornados ou afetados

Cenário: Acesso por ID de outro tenant na API
  Dado que sou a nutricionista do tenant A
  Quando chamo GET /api/painel/pacientes/{id de paciente do tenant B}
  Então recebo HTTP 404

Cenário: Paciente não vê outro paciente do mesmo tenant
  Dado os pacientes P1 e P2 do tenant A
  Quando uma transação com app.role = "paciente" e app.patient_id = P1 faz SELECT sem filtro em diary_entries, meal_plans, appointments e anthropometry
  Então só registros de P1 são retornados
  E GET /api/p/diario/{id de registro de P2}, feito na sessão de P1, retorna HTTP 404

Cenário: Transação sem tenant definido
  Quando o role da aplicação consulta uma tabela 🔒 sem app.tenant_id definido
  Então a consulta retorna 0 linhas (a política compara com NULL)

Cenário: Nova tabela sem RLS quebra o CI
  Dado uma migration que cria uma tabela com coluna tenant_id sem RLS forçada
  Quando o CI roda
  Então o teste de verificação de RLS falha, listando a tabela
```

## US-007 — Auditoria de acesso a dados de saúde · **M**

**Como** nutricionista (controladora), **quero** o registro de quem acessou ou alterou cada prontuário, **para** responder a pedidos do titular e à ANPD.

```gherkin
Cenário: Leitura auditada
  Quando abro o prontuário do paciente P
  Então é gravado audit_log (actor = eu, acao = "ler", entidade = "patients", entidade_id = P, ip)

Cenário: Log imutável
  Quando o role da aplicação tenta UPDATE ou DELETE em audit_log
  Então o banco retorna erro de permissão

Cenário: Consulta do log
  Dado que estou no prontuário do paciente P
  Quando abro a aba "Histórico de acessos"
  Então vejo os acessos a P em ordem decrescente, com paginação de 50 itens
  E o histórico inclui leituras e alterações das tabelas filhas de P (antropometria, exames…), não só de `patients`
```

Nota de entrega (Plano 02): o service `listAccessHistory` e o componente `HistoricoAcessos` já estão prontos e testados; a aba é montada no prontuário no P03-01, quando o prontuário existir.

---

# E2 — Pacientes & prontuário

## US-010 — Cadastrar paciente e enviar convite · **M**

**Como** nutricionista, **quero** cadastrar um paciente e convidá-lo, **para que** ele acesse o portal.

| Campo | Tipo | Obrig. | Validação | Erro |
|---|---|---|---|---|
| `nome` | texto | Sim | 2–120 caracteres | "Informe o nome" |
| `data_nascimento` | data | Sim | passado; idade 18–120 (RN-17) | "O sistema atende apenas pacientes a partir de 18 anos" |
| `sexo` | enum F/M | Sim | — | "Selecione o sexo biológico (usado nas fórmulas)" |
| `email` | e-mail | Sim | único no tenant | "Paciente já cadastrado com este e-mail" |
| `telefone` | texto | Não | normalizado para E.164 (+55 padrão) | "Telefone inválido" |
| `whatsapp_autorizado` | bool | Não | exige telefone | — |
| `enviar_convite_whatsapp` | bool | Não | exige `whatsapp_autorizado` | "Marque que o paciente autorizou o WhatsApp" |

```gherkin
Cenário: Cadastro com convite por e-mail
  Quando cadastro "Ana Souza", nascida em 10/03/1991, sexo F, e-mail "ana@ex.com"
  Então o paciente é criado com status "ativo" e user_id nulo
  E um e-mail de convite com link válido por 7 dias é enviado

Cenário: Convite também por WhatsApp
  Dado que informei o telefone "(11) 91234-5678"
  E marquei "Paciente autorizou receber mensagens por WhatsApp" e "Enviar convite por WhatsApp"
  Quando salvo
  Então whatsapp_optin_em é preenchido com whatsapp_optin_origem = "nutri"
  E o template convite_paciente é enviado para "+5511912345678"
  E conta 1 mensagem na cota do tenant

Cenário: WhatsApp sem autorização
  Dado que não marquei "Paciente autorizou receber mensagens por WhatsApp"
  Então a opção "Enviar convite por WhatsApp" fica desabilitada
  E nenhuma mensagem de WhatsApp é enviada a esse paciente

Cenário: E-mail já usado por paciente de outra nutricionista
  Dado que "ana@ex.com" já é usuário paciente no tenant B
  Quando o tenant A cadastra "ana@ex.com"
  Então o cadastro é aceito no tenant A
  E o convite diz "Entre com sua conta existente para ver os dados da nutricionista <A>"
  E nenhum dado do tenant B é exibido ao tenant A
```

## US-011 — Paciente aceita convite, consentimentos · **M**

**Como** paciente, **quero** criar minha senha e entender como meus dados são usados, **para** acessar o portal com segurança.

```gherkin
Cenário: Aceite do convite
  Dado que abri o link de convite válido
  Quando defino a senha e marco "Li e aceito o Termo de Uso e Privacidade (versão 1.0)"
  Então patients.user_id é preenchido
  E consents registra termo_versao "1.0", data e IP
  E sou levado ao PWA com o tutorial de instalação

Cenário: Consentimento obrigatório
  Quando tento continuar sem marcar o termo
  Então o botão "Continuar" fica desabilitado

Cenário: Opt-in de WhatsApp separado
  Dado que estou no aceite
  Quando marco "Quero receber lembretes por WhatsApp"
  Então patients.whatsapp_optin_em é preenchido com whatsapp_optin_origem = "paciente"
  E se a nutricionista já tinha registrado a autorização, a opção vem marcada e posso desmarcá-la

Cenário: Revogar o WhatsApp
  Quando desmarco "Receber lembretes por WhatsApp" em Perfil > Notificações
  Então whatsapp_optout_em é preenchido e nenhum WhatsApp é enviado a partir desse momento
  E os lembretes continuam por e-mail e push

Cenário: Nova versão do termo
  Dado que o termo mudou para a versão "1.1"
  Quando faço login
  Então preciso aceitar a versão "1.1" antes de usar o portal
```

## US-012 — Anamnese com modelo editável · **M**

**Como** nutricionista, **quero** montar meus modelos de anamnese e preenchê-los na consulta, **para** padronizar a coleta.

Tipos de pergunta: texto curto, texto longo, número (com unidade), sim/não, escolha única, múltipla escolha, data.

```gherkin
Cenário: Modelo padrão
  Dado que acabei de criar minha conta
  Então existe o modelo "Anamnese geral" com as seções: queixa principal, histórico clínico, medicamentos, alergias/intolerâncias, hábitos intestinais, sono, atividade física, consumo de água, álcool/tabaco, preferências e aversões

Cenário: Snapshot do modelo
  Dado que preenchi uma anamnese do paciente com o modelo "Anamnese geral"
  Quando depois altero ou excluo uma pergunta do modelo
  Então a anamnese já preenchida continua exibindo as perguntas originais (template_snapshot)

Cenário: Obrigatória não preenchida
  Dado que a pergunta "Alergias" é obrigatória
  Quando salvo sem respondê-la
  Então vejo "Responda: Alergias" e nada é salvo
```

## US-013 — Registrar antropometria · **M**

**Como** nutricionista, **quero** registrar medidas e dobras, **para** acompanhar a composição corporal.

Circunferências: braço, cintura, abdome, quadril, coxa, panturrilha (cm, 1 casa decimal). Dobras em mm (1 casa decimal) conforme o protocolo escolhido (Apêndice A).

```gherkin
Cenário: IMC automático
  Quando registro peso 70 kg e altura 175 cm
  Então o IMC exibido é 22,86

Cenário: Jackson & Pollock 3 dobras — homem
  Dado um paciente do sexo M com 30 anos
  Quando escolho o protocolo "JP 3 dobras" e informo peitoral 15, abdominal 20 e coxa 15 (soma 50 mm)
  Então a densidade é 1,06432 e o %G (Siri) é 15,08

Cenário: Jackson & Pollock 3 dobras — mulher
  Dado uma paciente do sexo F com 35 anos
  Quando informo tríceps 20, supra-ilíaca 20 e coxa 20 (soma 60 mm)
  Então o %G é 24,44

Cenário: Dobra faltando
  Dado o protocolo "JP 7 dobras"
  Quando deixo a dobra "axilar média" em branco
  Então %G não é calculado e vejo "Preencha as 7 dobras para calcular o % de gordura"
  E as demais medidas podem ser salvas

Cenário: Valor fora da faixa
  Quando informo peso 0 ou 500 kg
  Então vejo "Peso deve estar entre 1 e 400 kg"
```

## US-014 — Calcular gasto energético · **M**

**Como** nutricionista, **quero** calcular TMB e GET com fórmulas reconhecidas, **para** definir a meta calórica do plano.

```gherkin
Cenário: Mifflin-St Jeor
  Dado uma paciente F, 35 anos, com última antropometria de 60 kg e 165 cm
  Quando escolho "Mifflin-St Jeor" e fator de atividade 1,55
  Então a TMB é 1295 kcal e o GET é 2008 kcal
  E o botão "Usar como meta do plano" preenche meta_kcal = 2008 no rascunho aberto

Cenário: Comparar fórmulas
  Quando abro o cálculo para a mesma paciente
  Então vejo lado a lado Harris-Benedict 1371, Mifflin 1295 e FAO/OMS 1351 (TMB, kcal, arredondamento meio para cima)

Cenário: Fator inválido
  Quando informo o fator 3,0
  Então vejo "Fator de atividade deve estar entre 1,00 e 2,50"
```

## US-015 — Registrar exames · **S**

**Como** nutricionista, **quero** anexar laudos e lançar valores, **para** acompanhar marcadores ao longo do tempo.

```gherkin
Cenário: Anexar laudo
  Quando envio um PDF de 3 MB com título "Hemograma" e data 01/09/2026
  Então o arquivo é salvo em /data e só é servido por URL assinada válida por 5 min

Cenário: Arquivo inválido
  Quando envio um .exe ou um PDF de 25 MB
  Então vejo "Envie PDF, JPEG ou PNG de até 20 MB"

Cenário: Valores e gráfico
  Dado que lancei "Glicemia de jejum" = 110 mg/dL em 01/06 e 95 mg/dL em 01/09
  Quando abro Evolução > Exames > Glicemia de jejum
  Então vejo um gráfico com os 2 pontos em ordem cronológica
```

## US-016 — Registrar atendimento · **M**

**Como** nutricionista, **quero** registrar cada consulta com notas privadas e orientações ao paciente, **para** manter o histórico clínico.

```gherkin
Cenário: Atendimento a partir da agenda
  Dado uma consulta de hoje com status "confirmada"
  Quando clico em "Iniciar atendimento"
  Então abre um registro de atendimento vinculado ao appointment_id
  E os atalhos para anamnese, antropometria, cálculo e plano ficam na mesma tela

Cenário: Privacidade das notas
  Dado que escrevi em notas_privadas "suspeita de compulsão"
  E em orientacoes_paciente "beber 2 L de água/dia"
  Quando o paciente abre o PWA
  Então vê "beber 2 L de água/dia" e nunca vê "suspeita de compulsão" (nem no JSON da API)
```

## US-017 — Evolução do paciente · **M**

**Como** nutricionista, **quero** ver gráficos da evolução, **para** avaliar resultados e mostrar ao paciente.

```gherkin
Cenário: Gráficos
  Dado um paciente com 4 registros de antropometria
  Quando abro a aba Evolução
  Então vejo gráficos de peso, IMC, %G e circunferências por data
  E uma tabela com a diferença entre o primeiro e o último registro (ex.: "−3,2 kg")

Cenário: Poucos dados
  Dado um paciente com 1 registro
  Então vejo "Registre mais uma avaliação para ver a evolução" no lugar dos gráficos
```

## US-018 — Arquivar, exportar e excluir dados (LGPD) · **M**

**Como** nutricionista, **quero** arquivar pacientes e atender pedidos de exportação ou exclusão, **para** cumprir a LGPD.

```gherkin
Cenário: Arquivar
  Quando arquivo o paciente P
  Então P não consegue mais entrar no portal deste tenant, não recebe notificações e sai das audiências de conteúdo
  E o prontuário continua acessível para mim, com o selo "Arquivado"

Cenário: Exportar
  Quando clico em "Exportar dados" do paciente P
  Então um job gera um ZIP com dados.json (todas as tabelas de P) e prontuario.pdf
  E recebo o link por e-mail, válido por 24 h
  E audit_log registra acao "exportar"

Cenário: Pedido de exclusão durante o prazo de guarda (RNF-08)
  Dado um privacy_requests de exclusão do paciente P
  Quando confirmo "Atender pedido de exclusão" digitando o nome dele
  Então P passa a status "bloqueado": sem portal, sem notificações e fora das audiências
  E fotos do diário, opt-ins e inscrições de push de P são apagados na hora
  E o prontuário clínico é mantido identificado, só para consulta da nutricionista, com anonimizar_apos = última consulta + prazo legal (P-01)
  E o paciente recebe o e-mail explicando o que foi apagado e o que é mantido por obrigação legal
  E o privacy_requests fica "concluido"

Cenário: Fim do prazo de guarda
  Dado um paciente bloqueado com anonimizar_apos no passado
  Quando o job diário de retenção roda
  Então nome, e-mail, telefone e data de nascimento são substituídos por valores anônimos, os anexos são apagados de /data e anonimizado_em é preenchido
```

## US-019 — Etiquetas de paciente · **S**

**Como** nutricionista, **quero** etiquetar pacientes (ex.: `gestante`, `diabetes`), **para** filtrar a lista e direcionar conteúdos.

```gherkin
Cenário: Etiquetar e filtrar
  Dado que criei a etiqueta "gestante" e a apliquei a 3 pacientes
  Quando filtro a lista por "gestante"
  Então vejo exatamente esses 3 pacientes

Cenário: Paciente não vê etiquetas
  Quando o paciente usa o PWA
  Então nenhuma etiqueta aparece para ele, nem no JSON da API
```

---

# E3 — Plano alimentar

## US-020 — Buscar alimentos · **M**

**Como** nutricionista, **quero** buscar alimentos da TACO e os meus, **para** montar o plano rapidamente.

```gherkin
Cenário: Busca tolerante a acento
  Quando digito "feijao carioca"
  Então "Feijão, carioca, cozido" aparece entre os 5 primeiros resultados em ≤ 300 ms

Cenário: Busca sem resultado ou com falha (Plano 04)
  Quando nenhum alimento corresponde ao que digitei
  Então vejo "Nenhum alimento encontrado."
  E quando a busca falha, vejo "Não foi possível buscar agora. Tente de novo."

Cenário: Origem visível
  Então cada resultado mostra o selo "TACO" ou "Meu alimento"

Cenário: Medidas caseiras (seed IBGE — INT-04)
  Dado que escolho "Arroz, tipo 1, cozido", que tem a medida "colher de sopa cheia" (25 g) no seed
  Quando seleciono essa medida e quantidade 4
  Então quantidade_g = 100 e medida_caseira_txt = "4 colheres de sopa cheias"

Cenário: Alimento sem medida caseira
  Dado um alimento sem medidas no seed
  Então só posso informar gramas
  E vejo o atalho "Cadastrar medida caseira", que grava em food_measures do meu tenant

Cenário: Cadastro de medida caseira (Plano 04)
  Dado o alimento "Arroz, tipo 1, cozido" aberto na tela Alimentos
  Quando cadastro a medida "pires pequeno" (plural "pires pequenos") com 120 g
  Então vejo `Medida "pires pequeno" cadastrada.` e ela passa a valer nos planos
  E o nome da medida não pode repetir o de outra medida do mesmo alimento, nem o de uma medida do IBGE dele
```

| Campo da medida | Validação | Erro |
|---|---|---|
| nome e plural | 2–60 caracteres | "Informe o nome da medida e o plural" |
| gramas | de 0,1 a 5000 | "Gramas da medida devem estar entre 0,1 e 5000" |
| nome | único por alimento no tenant, também em relação às medidas do IBGE do alimento | "Você já tem uma medida com esse nome para este alimento." |

Textos da tela (Plano 04): alimento sem medida, "Sem medida caseira: no plano, informe a quantidade em gramas ou cadastre uma medida abaixo."; alimento sem valor de energia na TACO, "Sem valor na TACO"; alimento que não existe ou é de outro tenant, "Alimento não encontrado.". A medida fica no singular abaixo de 2 ("1,5 colher de sopa cheia") e no plural a partir de 2. A lista de resultados é navegável pelo teclado (setas, Enter, Esc): na tela Alimentos cada resultado é um link e o Enter abre o alimento destacado; no editor do plano, escolher o resultado adiciona o item.

Nota de entrega (Plano 04): o seed do IBGE tem 28 alimentos básicos (44 medidas), não os 150 (INT-04, P-10, E-08). Uma medida própria com o mesmo nome de uma medida do IBGE do mesmo alimento é recusada no cadastro, porque o seletor do editor mostraria dois rótulos iguais com gramas diferentes; nesse caso a mensagem é a mesma de nome repetido, "Você já tem uma medida com esse nome para este alimento." (`MSG_MEDIDA.duplicada`), que é ligeiramente inexata para uma medida do IBGE (a nutricionista não a "tem"); um texto próprio fica para o dono decidir.

## US-021 — Cadastrar alimento próprio · **S**

**Como** nutricionista, **quero** cadastrar alimentos e produtos que não estão na TACO, **para** usá-los nos planos.

```gherkin
Cenário: Cadastro
  Quando cadastro "Pão low carb Marca X" com 250 kcal, 12 g de proteína, 8 g de carboidrato, 18 g de lipídio e 6 g de fibra por 100 g
  Então ele aparece nas minhas buscas com o selo "Meu alimento"
  E não aparece para nenhuma outra nutricionista

Cenário: TACO não editável
  Quando tento editar um alimento da TACO
  Então só vejo o botão "Duplicar como meu alimento"
```

Na tela Alimentos (Plano 04) o botão de cadastro é "Cadastrar meu alimento". Ao duplicar, as medidas do IBGE do original vêm junto e continuam com a origem "IBGE" (a origem é da medida, não do alimento). Se a TACO não tem todos os valores do original, a tela de edição da cópia mostra "A TACO não tem todos os valores deste alimento: confira os campos com 0."

| Campo | Validação | Erro |
|---|---|---|
| `nome` | 2–120 caracteres | "Informe o nome do alimento (2 a 120 caracteres)" |
| `grupo` | um dos grupos da TACO | "Escolha o grupo do alimento" |
| energia, proteína, carboidrato, lipídio e fibra (por 100 g) | energia de 0 a 900 kcal; os demais de 0 a 100 g; nenhum em branco | "Valores por 100 g: energia entre 0 e 900 kcal; os demais entre 0 e 100 g" |

```gherkin
Cenário: Alimento da TACO não pode ser alterado (Plano 04)
  Quando uma requisição tenta alterar ou apagar um alimento da TACO
  Então vejo "Alimentos da TACO não podem ser alterados. Use "Duplicar como meu alimento"."

Cenário: Alimento em uso (Plano 04)
  Dado um "Meu alimento" que já está num plano alimentar
  Quando tento excluí-lo
  Então vejo "Este alimento está em um plano e não pode ser excluído."
  E o plano publicado não muda se eu corrigir o alimento depois (RN-01)
```

## US-022 — Montar plano com cálculo em tempo real · **M**

**Como** nutricionista, **quero** montar refeições e ver os totais recalculados ao vivo, **para** fechar a meta com precisão.

```gherkin
Cenário: Cálculo do item
  Dado que o alimento tem 130 kcal por 100 g
  Quando adiciono 150 g
  Então o item mostra 195 kcal
  E os totais da refeição e do dia são atualizados em ≤ 100 ms

Cenário: Alimento sem valor na TACO (Plano 04)
  Dado um alimento sem energia na TACO (ex.: "Leite, de vaca, integral")
  Então o item mostra "Sem valor na TACO" no lugar da kcal e conta 0 nos totais, sem NaN

Cenário: Indicador de meta (RN-02)
  Dado meta_kcal = 2000
  Quando o total do dia é 2080 kcal
  Então o indicador fica verde (4%)
  Quando o total do dia é 2150 kcal
  Então fica amarelo (7,5%)
  Quando o total do dia é 2300 kcal
  Então fica vermelho (15%)
  E o indicador tem texto, não só cor: "Dentro da meta (+4%)", "Atenção (+7,5%)" ou "Fora da meta (+15%)" (com "−" abaixo da meta)

Cenário: Distribuição de macros
  Então vejo proteína, carboidrato e lipídio em g, em g/kg de peso e em % do VET
  E a fibra total em g
  E o g/kg usa o peso da última antropometria; sem antropometria vejo "—" e a dica "Registre a antropometria para ver g/kg" (Plano 04)
  E o modelo de plano, que não tem paciente, não mostra a coluna g/kg

Cenário: Salvamento automático
  Quando altero qualquer item
  Então o rascunho é salvo em até 2 s, sem clicar em "Salvar"
  E se a conexão cair, vejo "Alterações não salvas" e o salvamento é repetido quando a conexão voltar

Cenário: Duas abas no mesmo rascunho (Plano 04)
  Dado o mesmo rascunho aberto em duas abas, e a primeira já salvou uma alteração
  Quando a segunda tenta salvar com a revisão antiga
  Então vê "Este plano foi alterado em outra aba. Recarregue a página para continuar." e nada é sobrescrito em silêncio

Cenário: Sair do editor com alteração pendente (Plano 04)
  Quando clico num link interno logo depois de editar
  Então a edição que esperava os 800 ms é enviada na hora e a navegação segue sem aviso
  Mas se a edição pode se perder (conflito entre abas, última tentativa sem sucesso, ou envio em andamento com outra edição esperando)
  Então vejo "Há alterações que ainda não foram salvas. Sair mesmo assim?" e, se cancelo, continuo no editor
```

Estados da linha de salvamento (Plano 04): "Salvando…", "Salvo", "Alterações não salvas" (sem rede, nova tentativa ao voltar a conexão e a cada 5 s) e "Corrija os campos destacados para salvar." (erro de campo). O servidor compara o rascunho com o banco e aplica só o que mudou, então o histórico de acessos registra uma linha por item realmente alterado, não uma por salvamento. O envio acontece 800 ms depois da última edição.

| Campo | Validação | Erro |
|---|---|---|
| `titulo` | 1–120 caracteres | "Informe o título do plano (até 120 caracteres)" |
| nome da refeição | 1–60 caracteres | "Informe o nome da refeição (até 60 caracteres)" |
| `horario` | HH:MM (obrigatório só para publicar) | "Horário inválido (use HH:MM)" |
| quantidade do item | de 0,1 a 5000 g | "Quantidade deve estar entre 0,1 e 5000 g" |
| `meta_kcal` | de 500 a 10000 kcal | "Meta deve estar entre 500 e 10000 kcal" |
| `orientacoes` e `observacao` | até 2000 caracteres | "Texto muito longo (até 2000 caracteres)." |
| plano | até 15 refeições e 200 itens (os botões de adicionar ficam desabilitados, com este texto) | "O plano pode ter até 15 refeições e 200 itens." |
| cálculo de gasto usado como meta | do mesmo paciente | "Cálculo de gasto energético não encontrado." |
| alimento do item | existente e visível ao tenant | "Alimento não encontrado." |

Outras mensagens do salvamento (Plano 04): requisição inválida, "Não foi possível salvar estes dados. Recarregue a página."; corpo acima de 512 KB, "Plano grande demais."; plano inexistente ou de outro tenant, "Plano não encontrado."; sessão expirada, "Sessão expirada. Entre de novo."; paciente bloqueado, "Paciente bloqueado por pedido de exclusão: o prontuário é só para consulta.". Nesses casos, no conflito entre abas e na versão já publicada, a linha de salvamento mostra o motivo, oferece "Recarregar" e o editor para de tentar; sem rede ou com erro do servidor (5xx) continua "Alterações não salvas", com nova tentativa. Cada envio leva uma chave (`envio`); se a resposta de um envio que gravou se perde, a tentativa seguinte é aceita em vez de virar um falso "alterado em outra aba". Com o paciente bloqueado, o plano abre só para consulta ("Versão N · Rascunho", sem publicar, editar, salvar como modelo nem descartar), e a lista de versões não oferece criar nem editar. Um item cuja medida própria foi excluída mostra a opção "{nome} (removida)", com os gramas gravados, e pode voltar a gramas; as medidas aparecem com os gramas em vírgula decimal, com as casas que têm ("concha (12,25 g)"). Ao abrir, o editor confere a revisão do plano: se a página veio do "Voltar" do navegador com um conteúdo antigo, ou outra aba gravou depois, os dados são recarregados em vez de a próxima edição dar "Este plano foi alterado em outra aba". Botões e rótulos do editor: "Criar plano", "Continuar o rascunho (versão N)", "Editar o plano publicado", "Descartar rascunho" (confirma "Descartar este rascunho?"), "Usar como meta do plano" (escolhe um cálculo de gasto energético do paciente), "Adicionar refeição", "Orientações gerais" e "Mostrar calorias ao paciente".

## US-023 — Substituições · **M**

**Como** nutricionista, **quero** definir opções de substituição por item, **para** dar flexibilidade ao paciente.

```gherkin
Cenário: Grupo de substituição
  Dado o item principal "Pão francês 50 g" no café da manhã
  Quando adiciono as substituições "Tapioca 40 g" e "Cuscuz 100 g"
  Então elas ficam ligadas ao item principal por substitui_item_id (Plano 04: em vez de grupo_substituicao)
  E não entram no total do dia (RN-02)
  E cada substituição mostra a própria kcal e a diferença para o principal (ex.: "+12 kcal")

Cenário: Substituição ou principal sem valor na TACO (Plano 04)
  Dado que um dos dois lados não tem energia na TACO
  Então a linha mostra "Sem valor na TACO" no lugar da kcal e nenhuma diferença, no editor e no PDF (a diferença contaria 0 no lado sem valor e daria um número enganoso, como "−150 kcal")

Cenário: Mover e remover (Plano 04)
  Quando movo um item principal com ↑ ou ↓
  Então as substituições dele vão junto e ele pula o grupo inteiro do vizinho
  E uma substituição só se move dentro do próprio grupo
  E remover o principal remove as substituições dele
```

No editor (Plano 04) o botão é "Adicionar substituição para {alimento}" e só existe em item principal; com 200 itens ele fica desabilitado, com "O plano pode ter até 15 refeições e 200 itens.". Uma substituição que não aponta para um principal da mesma refeição é recusada: "A substituição precisa estar ligada a um alimento principal da mesma refeição."

## US-024 — Modelos de plano · **S**

**Como** nutricionista, **quero** salvar e reutilizar planos-modelo, **para** ganhar tempo com perfis parecidos.

```gherkin
Cenário: Criar a partir de modelo
  Dado o modelo "Emagrecimento 1600 kcal"
  Quando crio o plano da paciente Ana a partir dele
  Então um rascunho com as mesmas refeições e itens é criado para Ana
  E alterar o plano de Ana não altera o modelo

Cenário: Salvar plano como modelo
  Quando clico em "Salvar como modelo" em um plano
  Então uma cópia com is_template = true e patient_id nulo é criada

Cenário: Salvar como modelo só com tudo salvo (Plano 04)
  Dado que o editor ainda diz "Salvando…", "Alterações não salvas" ou mostra erro de campo
  Então "Salvar como modelo" fica desabilitado, com a dica "Só dá para continuar com as alterações salvas." (a dica não aparece durante "Salvando…"), porque a cópia sai do que está no banco
  E ao salvar vejo "Modelo salvo."

Cenário: Gerenciar modelos (Plano 04)
  Quando abro "Modelos de plano"
  Então posso "Criar modelo" (vazio), abri-lo para editar e usar "Excluir modelo" (os planos criados a partir dele não mudam)
  E o modelo não se publica nem tem g/kg
  E "Criar a partir de modelo" só aparece para o paciente que ainda não tem rascunho: um rascunho por paciente, e uma corrida recusa com "Já existe um rascunho para este paciente."

Cenário: Paciente bloqueado por pedido de exclusão (Plano 04, US-018)
  Dado que o pedido de exclusão do paciente foi atendido (ou ele já foi anonimizado)
  Então o plano dele não vira modelo: "Salvar como modelo" não aparece e, numa corrida com o bloqueio, é recusado com "Paciente bloqueado por pedido de exclusão: o prontuário é só para consulta."
```

Nota de privacidade (Plano 04, ver RNF-08): ao salvar um plano de paciente como modelo, as `orientacoes` e as `observacao` das refeições vão junto. Esse texto livre sai do alcance da RLS por paciente, da exportação e da exclusão do titular. A nutricionista (controladora) deve revisá-lo antes de salvar; a tela ainda não avisa.

## US-025 — Publicar plano (versionamento) · **M**

**Como** nutricionista, **quero** publicar o plano para o paciente, **para que** ele passe a ver a versão final.

```gherkin
Cenário: Primeira publicação
  Quando publico o rascunho do paciente P
  Então o status vira "publicado" com versao 1
  E P recebe push "Seu novo plano alimentar está disponível" (adiado para o Plano 06, ver a nota de entrega abaixo)

Cenário: Nova versão arquiva a anterior (RN-01)
  Dado que P tem o plano v1 publicado
  Quando clico em "Editar"
  Então é criado o rascunho v2 e a v1 continua visível para P
  Quando publico a v2
  Então a v1 vira "arquivado" e a v2 vira "publicado" na mesma transação
  E o banco nunca tem 2 planos publicados para P

Cenário: Rascunho invisível
  Então o paciente nunca vê planos com status "rascunho" (nem pela API)
  E isso vale no banco, pela política paciente_sem_rascunho (§4.1), não só na API (Plano 04)

Cenário: Publicar só com tudo salvo e completo (Plano 04)
  Dado que o editor ainda diz "Salvando…", "Alterações não salvas" ou mostra erro de campo
  Então "Publicar" fica desabilitado, com a dica "Só dá para continuar com as alterações salvas." (a dica não aparece durante "Salvando…")
  E publicar pede a confirmação "Publicar esta versão para o paciente? A versão publicada hoje será arquivada." e, com sucesso, mostra "Plano publicado."
  E o plano é recusado, com o motivo, se não tem alimento ("Inclua pelo menos uma refeição com um alimento para publicar."), se falta horário ("Informe o horário de todas as refeições.") ou se uma refeição está vazia ("A refeição "{nome}" não tem alimentos.")

Cenário: Versão publicada não se altera (Plano 04)
  Quando uma requisição tenta salvar um plano já publicado
  Então vejo "Este plano já foi publicado e não pode ser alterado. Use "Editar" para criar uma nova versão."
  E "Editar" só existe na versão publicada: numa versão já arquivada vejo "Esta versão não está mais publicada. Recarregue a página."
  E se o paciente já tem rascunho, "Editar" abre esse rascunho em vez de criar outro (um rascunho por paciente, RN-01)
  E "Publicar" e "Editar" só valem para o plano do paciente da tela: um plano de outro paciente (ou que não existe mais) responde "Plano não encontrado." e nada muda
```

Nota de entrega (Plano 04): o push e o e-mail de aviso na publicação ficam para o Plano 06 (P06: push + e-mail), porque o portal do paciente e o push só existem lá e um aviso agora levaria o paciente a uma tela vazia; o ponto de entrada está comentado em `publicarPlano` (`publicacao.ts`), para entrar na mesma transação. Publicar congela em cada item a cópia dos valores dos alimentos (`nutrientes`, RN-01). Na lista de versões, a data de publicação é exibida no fuso do tenant (RN-06).

## US-026 — PDF do plano · **M**

**Como** nutricionista, **quero** gerar um PDF com a minha marca, **para** entregar ou imprimir.

```gherkin
Cenário: Conteúdo do PDF
  Quando gero o PDF do plano publicado
  Então ele tem: logo, nome e CRN da nutricionista, nome do paciente, data, refeições com horário, itens com medida caseira e gramas, substituições, orientações e a fonte "TACO 4ª ed. — NEPA/UNICAMP" no rodapé
  E os totais nutricionais só aparecem se eu marcar "Mostrar calorias ao paciente" (meal_plans.mostrar_calorias, padrão: desmarcado; vale também para o PWA)
  E, com a opção marcada, o PDF traz "Total do dia: N kcal" e, na linha seguinte, "Proteína: N g · Carboidrato: N g · Lipídio: N g · Fibra: N g" (Plano 04), o total de kcal de cada refeição e a kcal de cada item ("—" no item sem energia na TACO), e a diferença de kcal da substituição só quando os dois lados têm valor

Cenário: Geração na publicação
  Quando publico um plano
  Então o worker gera o PDF e grava meal_plans.pdf_path em ≤ 30 s
  E o download pelo painel ou pelo PWA é imediato (sem gerar de novo)
  E um plano com 6 refeições e 40 itens gera o PDF em ≤ 5 s de processamento
  E uma refeição maior que a página continua na página seguinte, sem cortar item nem observação (Plano 04)

Cenário: Download antes de o PDF ficar pronto
  Dado que o PDF ainda está sendo gerado
  Quando o paciente toca em "Baixar PDF"
  Então vê "Seu PDF está sendo preparado" e o botão é liberado quando o arquivo fica pronto

Cenário: PDF que não ficou pronto (Plano 04)
  Dado que o worker esgotou as tentativas, a cota de armazenamento acabou, ou o PDF ficou pendente por mais de 1 h
  Então a tela mostra "Não foi possível gerar o PDF. Tente de novo." com o botão "Gerar o PDF de novo"
  E se o PDF já está sendo preparado, o botão responde "O PDF já está sendo preparado."
  E se o PDF já ficou pronto (outra aba pediu antes), o botão não dá erro e a tela passa a mostrar "Baixar PDF"
  E de um plano de outro paciente, o botão responde "Plano não encontrado." e nada vai para a fila

Cenário: Paciente bloqueado por pedido de exclusão (Plano 04, US-018)
  Dado que o pedido de exclusão do paciente foi atendido
  Então o PDF que já existe continua em "Baixar PDF" (consulta) até a anonimização
  Mas nenhum PDF novo é gerado: o job da fila desiste e marca "falhou", "Gerar o PDF de novo" é recusado com "Paciente bloqueado por pedido de exclusão: o prontuário é só para consulta."
  E no lugar do botão a tela mostra "Não foi possível gerar o PDF."
```

Nota de entrega (Plano 04): no painel, o PDF pronto aparece como o botão "Baixar PDF" (link assinado de 5 min). Enquanto "Seu PDF está sendo preparado", a tela consulta só o estado do PDF a cada 3 s, por até 1 minuto, pela rota `GET /api/painel/planos/[id]/pdf?paciente=<id>`, que devolve apenas o status (`pendente`/`pronto`/`falhou`) e não registra leitura do prontuário, porque o status de geração não é dado de saúde; depois desse minuto é preciso recarregar a página. Uma varredura do worker (a cada 15 min) troca por "falhou" o PDF pendente há mais de 1 h, contada do pedido do PDF (`meal_plans.pdf_pedido_em`, gravado na publicação e no "Gerar o PDF de novo"; outra gravação no plano, como arquivá-lo ao publicar a versão seguinte, não renova o prazo), para a nutricionista sempre ter a saída "Gerar o PDF de novo". O PDF usa Helvetica (WinAnsi), como o do prontuário: caracteres fora desse conjunto (ex.: emoji) saem como "?". A conferência visual do desenho do PDF (refeição grande, logo) fica para o deploy.

---

# E4 — Agenda & lembretes

## US-030 — Horários de atendimento e bloqueios · **M**

**Como** nutricionista, **quero** definir meus horários e bloqueios, **para que** só os horários livres sejam oferecidos.

```gherkin
Cenário: Geração de horários
  Dado a regra "terça, 08:00–12:00, 60 min, presencial"
  Então terça tem os horários 08:00, 09:00, 10:00 e 11:00

Cenário: Bloqueio
  Dado um bloqueio de 20/10/2026 a 24/10/2026 com motivo "Congresso"
  Então nenhum horário é oferecido nesses dias
  E as consultas já marcadas no período aparecem destacadas: "Consulta dentro de um bloqueio"

Cenário: Regra inválida
  Quando salvo início 12:00 e fim 08:00
  Então vejo "O fim deve ser depois do início"
```

## US-031 — Nutricionista agenda consulta · **M**

**Como** nutricionista, **quero** marcar consultas na agenda (dia, semana e lista), **para** organizar meus atendimentos.

```gherkin
Cenário: Agendar
  Quando marco a Ana em 15/10/2026 às 09:00, 60 min, online, com link "https://meet.google.com/abc-defg-hij"
  Então a consulta é criada com status "agendada" e origem "nutri"
  E a Ana recebe e-mail e push de confirmação
  E os lembretes de 24 h e 2 h são agendados (RN-05)

Cenário: Sobreposição
  Dado que já há consulta das 09:00 às 10:00
  Quando tento marcar outra às 09:30
  Então vejo "Conflito com a consulta de <nome> às 09:00"

Cenário: Fora do horário de atendimento
  Quando marco em um horário fora das regras
  Então o sistema permite, com o aviso "Fora do seu horário de atendimento", porque a nutricionista tem autonomia

Cenário: Link online
  Dado que configurei tenants.link_online_padrao = "https://meet.google.com/abc-defg-hij"
  Quando marco uma consulta online sem informar link
  Então a consulta usa o link padrão
  E se não houver link padrão nem link informado, vejo "Informe o link da chamada (https://…)"
  E consultas online marcadas pelo paciente só são oferecidas se houver link padrão
```

## US-032 — Paciente agenda online · **M**

**Como** paciente, **quero** escolher um horário livre, **para** marcar consulta sem trocar mensagens.

```gherkin
Cenário: Agendar pelo PWA
  Dado que sou paciente ativo e antecedencia_min_h = 12
  Quando abro "Agendar" às 10:00 de 14/10
  Então o primeiro horário oferecido é a partir das 22:00 de 14/10
  E nenhum horário depois de 60 dias é oferecido
  Quando escolho 16/10 às 09:00
  Então a consulta é criada com origem "paciente"
  E a nutricionista recebe notificação no painel e por e-mail

Cenário: Corrida pelo mesmo horário (RN-03)
  Dado que 2 pacientes enviam o mesmo horário ao mesmo tempo
  Então exatamente 1 consulta é criada
  E o outro paciente vê "Esse horário acabou de ser ocupado. Escolha outro."

Cenário: Página pública /n/<slug> (RN-16)
  Dado que agendamento_publico_ativo = true e um visitante sem login em app.<dominio>/n/debby
  Quando escolhe um horário
  Então precisa entrar (se já for paciente) ou informar nome, e-mail e telefone, declarar ter 18 anos ou mais, aceitar o termo e passar pelo Turnstile
  E recebe no e-mail um código de 6 dígitos válido por 10 min
  Quando digita o código correto
  Então um paciente é criado com origem "agendamento_publico", sem data de nascimento e sem sexo, e a consulta é marcada
  E a nutricionista vê o selo "Novo paciente via agendamento online" e a pendência "Completar cadastro"

Cenário: Abuso na página pública
  Dado que o e-mail já tem 3 consultas futuras nesse tenant
  Quando tenta agendar a 4ª
  Então vê "Você já tem 3 consultas marcadas. Fale com sua nutricionista."
  E após 10 tentativas na mesma hora, o IP recebe HTTP 429

Cenário: Página pública desativada
  Dado agendamento_publico_ativo = false
  Quando alguém abre /n/debby
  Então vê o nome da nutricionista e "Agendamento online indisponível. Entre em contato." e nenhum horário
```

## US-033 — Cancelar ou remarcar · **M**

**Como** paciente, **quero** cancelar ou remarcar dentro do prazo, **para** não faltar sem avisar.

```gherkin
Cenário: Dentro do prazo (RN-04)
  Dado cancelamento_min_h = 24 e consulta daqui a 30 h
  Quando remarco para outro horário livre
  Então a consulta antiga fica "cancelada" (cancelado_por = paciente) e a nova é criada
  E os lembretes pendentes da antiga passam a "ignorada" e os da nova são agendados
  E a nutricionista é notificada

Cenário: Fora do prazo
  Dado consulta daqui a 20 h
  Então não vejo os botões "Cancelar" e "Remarcar"
  E vejo "Para alterar, fale com sua nutricionista."
```

## US-034 — Lembretes automáticos · **M**

**Como** nutricionista, **quero** que os pacientes recebam lembretes automáticos, **para** reduzir faltas.

```gherkin
Cenário: Agendamento dos lembretes
  Dado uma consulta em 16/10 às 14:00 (fuso do tenant), paciente com opt-in de WhatsApp e push ativo
  Então existem notifications "lembrete_24h" para 15/10 14:00 e "lembrete_2h" para 16/10 12:00
  E cada uma nos canais email, whatsapp e push

Cenário: Horário silencioso (RN-05)
  Dado uma consulta em 16/10 às 08:00
  Então o lembrete_24h vai em 15/10 às 08:00
  E o lembrete_2h (06:00) fica "ignorada" com motivo "horario_silencioso"

Cenário: Criada em cima da hora
  Dado que às 10:00 marco uma consulta para as 15:00 do mesmo dia
  Então o lembrete_24h fica "ignorada" com motivo "prazo_passado"
  E o lembrete_2h é agendado para as 13:00

Cenário: Falha no WhatsApp com fallback
  Dado que a Meta responde erro nas 3 novas tentativas
  Então a notificação WhatsApp fica "falhou"
  E um e-mail de lembrete é enviado, se o de e-mail ainda não tiver saído

Cenário: Sem duplicidade
  Dado que o worker reinicia no meio do envio
  Então o paciente recebe no máximo 1 lembrete por tipo e canal (UNIQUE appointment_id + canal + tipo)
```

## US-035 — Confirmação pelo WhatsApp · **M**

**Como** paciente, **quero** confirmar a consulta com um toque no WhatsApp, **para** avisar a nutricionista sem digitar.

```gherkin
Cenário: Confirmar
  Dado que recebi o lembrete_24h com os botões "Confirmo" e "Preciso remarcar"
  Quando toco em "Confirmo"
  Então o webhook muda a consulta para "confirmada"
  E a agenda da nutricionista mostra o selo "Confirmada via WhatsApp"

Cenário: Remarcar
  Quando toco em "Preciso remarcar"
  Então recebo uma resposta com o link do PWA para remarcar
  E appointments.pedido_remarcacao_em é preenchido e a nutricionista vê o alerta "Paciente pediu para remarcar"

Cenário: Webhook sem assinatura válida
  Quando chega um POST com X-Hub-Signature-256 inválido
  Então a resposta é HTTP 401 e nada é alterado

Cenário: Evento repetido
  Quando a Meta reenvia o mesmo evento
  Então o estado não muda de novo e a resposta é HTTP 200
```

## US-036 — Cota de WhatsApp · **M**

**Como** dona da plataforma, **quero** limitar os envios de WhatsApp por tenant, **para** controlar o custo enquanto não há cobrança.

```gherkin
Cenário: Aviso em 80% (RN-09)
  Dado wa_cota_mensal = 500
  Quando o tenant envia a 400ª mensagem do mês
  Então aparece um aviso no painel e a nutricionista recebe e-mail "Você usou 80% dos WhatsApps do mês"

Cenário: Cota esgotada
  Dado que o tenant já enviou 500 mensagens no mês
  Quando um lembrete de WhatsApp vai sair
  Então fica "ignorada" com motivo "cota_esgotada"
  E os lembretes por e-mail e push continuam

Cenário: Virada do mês
  Quando começa um novo mês civil no fuso do tenant
  Então a contagem volta a 0

Cenário: Admin amplia cota
  Quando o admin muda a cota para 1000
  Então os envios voltam imediatamente
```

## US-037 — Registrar realizada ou falta · **M**

**Como** nutricionista, **quero** marcar se a consulta aconteceu ou se houve falta, **para** medir a taxa de faltas (CS-03).

```gherkin
Cenário: Marcar falta
  Dado uma consulta passada com status "agendada" ou "confirmada"
  Quando marco "Faltou"
  Então o status vira "faltou" e entra na taxa de faltas do mês

Cenário: Pendências
  Dado consultas passadas há mais de 24 h sem status final
  Então o painel mostra "3 consultas sem registro de presença"

Cenário: Indicador
  Então o painel inicial mostra: consultas do mês, taxa de faltas do mês e a do mês anterior
```

---

# E5 — Portal do paciente (PWA)

## US-040 — Instalar o PWA e ativar notificações · **M**

**Como** paciente, **quero** instalar o app na tela do celular e receber notificações, **para** não perder lembretes.

```gherkin
Cenário: Android
  Dado Chrome no Android
  Quando abro o PWA pela 1ª vez
  Então vejo o botão "Instalar app", que chama o prompt nativo

Cenário: iPhone (INT-03)
  Dado Safari no iOS fora do modo standalone
  Então vejo o tutorial ilustrado "Compartilhar → Adicionar à Tela de Início"
  E a opção de ativar notificações só aparece depois de instalado

Cenário: Permissão de push
  Quando toco em "Ativar notificações" e aceito
  Então uma push_subscription é gravada para este dispositivo
  E recebo um push de teste "Notificações ativadas ✅"

Cenário: Offline
  Dado que já abri meu plano online antes
  Quando fico sem conexão
  Então ainda consigo ver o plano publicado (cache do service worker)
  E vejo o selo "Offline — exibindo última versão"

Cenário: Registro de acesso (métrica CS-02)
  Quando abro o PWA autenticado
  Então access_events registra no máximo 1 linha por paciente por dia
```

## US-041 — Ver meu plano alimentar · **M**

**Como** paciente, **quero** ver meu plano atual de forma clara no celular, **para** segui-lo no dia a dia.

```gherkin
Cenário: Plano do dia
  Quando abro a aba "Plano"
  Então vejo as refeições em ordem de horário, com a próxima refeição destacada
  E cada item mostra a medida caseira e os gramas
  E posso tocar no item para ver as substituições
  E a receita anexada à refeição (US-054) aparece como cartão "Sugestão de receita"

Cenário: Sem plano publicado
  Então vejo "Sua nutricionista ainda está preparando seu plano"

Cenário: Baixar PDF
  Quando toco em "Baixar PDF"
  Então recebo o mesmo PDF da US-026
```

Nota (Plano 04): o banco já esconde o `rascunho` do paciente (política `paciente_sem_rascunho`, §4.1) e `stored_files` do PDF ainda é restrita só por tenant; o que falta antes de existir sessão de paciente está na pendência P-16.

## US-042 — Diário alimentar · **M**

**Como** paciente, **quero** registrar o que comi com texto e foto, **para** que minha nutricionista acompanhe.

```gherkin
Cenário: Registro com foto (RN-07)
  Quando registro "Almoço" com o texto "arroz, feijão, frango" e uma foto HEIC de 6 MB
  Então o registro aparece imediatamente com uma miniatura local
  E o worker converte a foto para JPEG ≤ 1600 px, sem EXIF/GPS

Cenário: Limite diário
  Dado que já fiz 10 registros hoje
  Quando tento o 11º
  Então vejo "Limite de 10 registros por dia atingido"

Cenário: Arquivo inválido
  Quando envio uma foto de 15 MB ou um PDF
  Então vejo "Envie uma foto JPEG, PNG ou HEIC de até 10 MB"

Cenário: Cota de armazenamento do tenant (RN-18)
  Dado que o tenant usa 100% da cota de 5 GB
  Quando envio uma foto
  Então vejo "Espaço de armazenamento esgotado. Fale com o suporte." e o registro em texto é salvo sem a foto
```

## US-043 — Nutricionista comenta o diário · **S**

**Como** nutricionista, **quero** ver e comentar o diário dos pacientes, **para** dar feedback entre consultas.

```gherkin
Cenário: Feed de diários
  Quando abro "Diários"
  Então vejo os registros recentes de todos os pacientes, com os não vistos primeiro
  E abrir um registro preenche diary_entries.visto_pela_nutri_em

Cenário: Comentar
  Quando comento "Ótima escolha de proteína!" em um registro
  Então o paciente recebe push "Sua nutricionista comentou seu diário"
  E vê o comentário abaixo do registro
```

## US-044 — Minha evolução · **S**

**Como** paciente, **quero** ver minha evolução, **para** me manter motivado.

```gherkin
Cenário: Evolução do paciente
  Quando abro a aba "Evolução"
  Então vejo gráficos de peso e medidas e a lista de orientações recebidas em cada consulta
  E não vejo notas privadas nem exames
  E o %G só aparece se a nutricionista ativar "Mostrar % de gordura ao paciente" (tenants.mostrar_perc_gordura_paciente, padrão: desligado)
```

## US-045 — Lista de compras · **S**

**Como** paciente, **quero** gerar a lista de compras do meu plano, **para** facilitar a ida ao mercado.

```gherkin
Cenário: Gerar lista (RN-13)
  Dado um plano com "Arroz, tipo 1, cozido 100 g" no almoço e no jantar
  Quando gero a lista para 7 dias
  Então o item "Arroz, tipo 1, cozido" aparece com 1,4 kg no grupo "Cereais e derivados"
  E as substituições não entram na lista

Cenário: Marcar comprado
  Quando marco um item como comprado
  Então ele fica riscado e a marcação continua ao reabrir no mesmo dispositivo
```

## US-046 — Meus dados (LGPD do titular) · **M**

**Como** paciente, **quero** baixar meus dados e pedir exclusão, **para** exercer meus direitos na LGPD.

```gherkin
Cenário: Exportar meus dados
  Quando toco em "Baixar meus dados" em Perfil > Privacidade
  Então recebo por e-mail um link (24 h) para o ZIP da US-018, só com dados visíveis ao paciente (sem notas privadas e sem planos alimentares em `rascunho`, ver P-16)

Cenário: Pedir exclusão
  Quando toco em "Pedir exclusão dos meus dados"
  Então é criado um privacy_requests (tipo "exclusao", status "aberto", prazo = hoje + 15 dias)
  E a nutricionista vê a tarefa "Pedido de exclusão de <nome>" no painel
  E eu recebo o e-mail "Seu pedido foi registrado"
```

---

# E6 — Biblioteca de conteúdo

## US-050 — Publicar vídeo por link · **M**

**Como** nutricionista, **quero** publicar vídeos do YouTube ou Vimeo, **para** orientar os pacientes entre as consultas.

```gherkin
Cenário: Link válido (RN-10, INT-05)
  Quando colo "https://youtu.be/dQw4w9WgXcQ" com o título "Como montar o prato"
  Então video_provider = "youtube" e video_id = "dQw4w9WgXcQ"
  E a capa é obtida via oEmbed
  E vejo o aviso "Vídeos não listados podem ser vistos por quem tiver o link"

Cenário: Domínio não suportado
  Quando colo "https://tiktok.com/@x/video/1"
  Então vejo "Use um link do YouTube ou do Vimeo"

Cenário: oEmbed indisponível
  Dado que o oEmbed responde erro ou demora mais de 5 s
  Então o conteúdo é salvo com a capa padrão

Cenário: Player sem rastreamento
  Quando o paciente abre o vídeo
  Então o iframe usa youtube-nocookie.com/embed/<id>
```

## US-051 — Publicar receita com cálculo nutricional · **M**

**Como** nutricionista, **quero** cadastrar receitas com ingredientes da tabela de alimentos, **para** que o valor nutricional por porção seja calculado sozinho.

| Campo | Validação |
|---|---|
| `rendimento_total_g` | > 0 |
| `porcao_g` | > 0 e ≤ rendimento |
| ingredientes | ≥ 1; quantidade > 0 |
| foto de capa | JPEG/PNG ≤ 5 MB |

```gherkin
Cenário: Cálculo por porção (RN-11)
  Dado ingredientes que somam 2000 kcal
  E rendimento_total_g = 1000 e porcao_g = 250
  Então a receita mostra 500 kcal por porção, com proteína, carboidrato, lipídio e fibra proporcionais

Cenário: Porção maior que rendimento
  Quando informo porção de 1200 g e rendimento de 1000 g
  Então vejo "A porção não pode ser maior que o rendimento"

Cenário: Vídeo opcional
  Quando adiciono um link do YouTube à receita
  Então o vídeo aparece acima do modo de preparo
```

## US-052 — Publicar orientação em texto · **S**

**Como** nutricionista, **quero** publicar orientações em texto com imagem e PDF opcional, **para** entregar materiais educativos.

```gherkin
Cenário: Orientação com PDF
  Quando publico "Como ler rótulos" com texto formatado, uma imagem e um PDF de 2 MB
  Então o paciente vê o texto formatado e o botão "Baixar material (PDF)"
  E o conteúdo de corpo_md é sanitizado: sem HTML ou script executável
```

## US-053 — Definir quem vê cada conteúdo · **M**

**Como** nutricionista, **quero** escolher o público de cada conteúdo, **para** mandar o material certo para cada paciente.

```gherkin
Cenário: Por etiqueta (RN-12)
  Dado um conteúdo com visibilidade "etiquetas" = ["gestante"]
  Então só pacientes ativos com a etiqueta "gestante" o veem
  Quando aplico "gestante" a outra paciente
  Então ela passa a ver o conteúdo imediatamente

Cenário: Pacientes específicos
  Dado um conteúdo com visibilidade "pacientes" = [Ana]
  Então só a Ana o vê, e o acesso direto de outro paciente pela URL retorna 404

Cenário: Rascunho
  Então conteúdos com status "rascunho" não aparecem para nenhum paciente

Cenário: Aviso de novo conteúdo
  Quando publico um conteúdo com "Avisar pacientes" marcado
  Então cada paciente da audiência com push ativo recebe 1 push "Novo conteúdo: <título>"
  E no máximo 1 push de conteúdo por paciente a cada 24 h (os demais ficam agrupados no feed)
```

## US-054 — Anexar receita a uma refeição do plano · **S**

**Como** nutricionista, **quero** sugerir uma receita da biblioteca em uma refeição do plano, **para** dar ideias práticas ao paciente.

```gherkin
Cenário: Anexar
  Quando anexo a receita "Panqueca de aveia" ao café da manhã do plano da Ana
  Então meals.recipe_content_id é preenchido
  E a Ana vê o cartão "Sugestão de receita" nessa refeição, mesmo que a receita não esteja na audiência dela (exceção da RN-12)
  E os valores da receita não entram no total do plano (é só sugestão)

Cenário: Receita despublicada
  Dado que despubliquei a receita anexada
  Então o cartão some do plano da paciente, e no editor vejo "Receita indisponível"
```

## US-055 — Aba "Conteúdos" no PWA · **M**

**Como** paciente, **quero** navegar pelos vídeos, receitas e orientações da minha nutricionista, **para** aprender e ter ideias.

```gherkin
Cenário: Feed
  Quando abro a aba "Conteúdos"
  Então vejo os conteúdos da minha audiência, do mais recente para o mais antigo, com filtros Vídeos / Receitas / Orientações
  E os conteúdos ainda não vistos mostram o selo "Novo"

Cenário: Busca e filtro
  Quando busco "aveia" e filtro pela etiqueta de conteúdo "sem lactose"
  Então vejo só conteúdos com "aveia" no título ou resumo e com essa etiqueta

Cenário: Favoritos
  Quando favorito uma receita
  Então ela aparece em "Favoritos"

Cenário: Registro de visualização
  Quando abro um conteúdo
  Então content_views registra (conteúdo, paciente) uma única vez
```

## US-056 — Métricas de conteúdo · **S**

**Como** nutricionista, **quero** saber quantos pacientes viram cada conteúdo, **para** entender o que funciona.

```gherkin
Cenário: Métricas
  Dado um conteúdo com audiência de 40 pacientes, dos quais 18 abriram
  Quando abro a lista de conteúdos
  Então vejo "18 de 40 pacientes (45%)"
  E posso ver a lista de nomes de quem viu
```

---

## Matriz de rastreabilidade

| História | Módulo | Requisitos / regras / integrações | Tabelas principais |
|---|---|---|---|
| US-001 | M1 | D-06, INT-02 | tenants, users |
| US-002 | M1 | RNF-06 | users, sessions |
| US-003 | M1 | RNF-06 | users |
| US-004 | M1 | RN-15 | tenants, notifications |
| US-005 | M1 | RNF-10 | tenants |
| US-006 | M1 | RNF-07, §4.1 | todas 🔒 |
| US-007 | M1 | RNF-08 | audit_log |
| US-010 | M2 | INT-01 (opt-in), INT-02, RN-09, RN-17 | patients |
| US-011 | M2 | RNF-08, INT-01 | patients, consents |
| US-012 | M2 | — | anamnesis_templates, anamneses |
| US-013 | M2 | Apêndice A | anthropometry |
| US-014 | M2 | RN-14, Apêndice A | energy_calcs, meal_plans |
| US-015 | M2 | RNF-06 | exams |
| US-016 | M2 | — | consultations |
| US-017 | M2 | — | anthropometry, exams |
| US-018 | M2 | RNF-08, RN-08, P-01 | patients, privacy_requests, audit_log |
| US-019 | M2 | RN-12 | patient_tags, patient_tag_links |
| US-020 | M3 | INT-04, RNF-01, P-10 | foods, food_measures |
| US-021 | M3 | — | foods |
| US-022 | M3 | RN-02, RNF-01 | meal_plans, meals, meal_items |
| US-023 | M3 | RN-02 | meal_items |
| US-024 | M3 | — | meal_plans |
| US-025 | M3 | RN-01, INT-03 | meal_plans |
| US-026 | M3 | INT-04, RNF-01 | meal_plans (pdf_path) |
| US-030 | M4 | RN-03 | availability_rules, availability_blocks |
| US-031 | M4 | RN-03, RN-05 | appointments, notifications, tenants (link_online_padrao) |
| US-032 | M4 | RN-03, RN-16, RN-17, INT-06, RNF-08 | appointments, patients, consents |
| US-033 | M4 | RN-04, RN-05 | appointments, notifications |
| US-034 | M4 | RN-05, RN-06, INT-01/02/03 | notifications |
| US-035 | M4 | INT-01 | appointments, notifications |
| US-036 | M4 | RN-09 | tenants, notifications |
| US-037 | M4 | CS-03 | appointments |
| US-040 | M5 | INT-03, RNF-09, CS-02 | push_subscriptions, access_events |
| US-041 | M5 | RN-01 | meal_plans, meals |
| US-042 | M5 | RN-07, RN-18 | diary_entries, tenants (armazenamento_bytes) |
| US-043 | M5 | INT-03 | diary_entries |
| US-044 | M5 | — | anthropometry, consultations |
| US-045 | M5 | RN-13 | meal_items, foods |
| US-046 | M5 | RNF-08 | patients, privacy_requests, audit_log |
| US-050 | M6 | RN-10, INT-05 | contents |
| US-051 | M6 | RN-11 | contents, recipes, recipe_ingredients |
| US-052 | M6 | RNF-06 | contents |
| US-053 | M6 | RN-12, INT-03 | content_audience |
| US-054 | M6 | RN-11 | meals, contents |
| US-055 | M6 | RN-12 | contents, content_views, content_favorites |
| US-056 | M6 | CS-02 | content_views |

**Resumo:** 46 histórias; 36 **M** e 10 **S**.
