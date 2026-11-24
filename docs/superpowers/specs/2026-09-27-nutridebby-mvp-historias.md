# NutriDebby — Histórias de Usuário do MVP

Complementa [`2026-09-27-nutridebby-mvp-design.md`](2026-09-27-nutridebby-mvp-design.md). IDs de RN, RNF, INT e tabelas se referem àquele documento. A versão é a do documento de design (Apêndice C); esta revisão acompanha a **v1.10** (fechamento do Plano 07 — Biblioteca de conteúdo: notas "Plano 07, v1.10" em US-018, US-019, US-041 e US-050 a US-056 e a tabela "Textos de interface e mensagens do E6", no fim do E6; a v1.9, do Plano 06, deixou as notas "Plano 06, v1.9" e a tabela do E5; a v1.8, do Plano 05, as notas "Plano 05, v1.8" e a tabela do E4).

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
| `crn` | texto | Sim | SUS-118: "CRN" ou "CRN-" + região de 1 a 11 + separador obrigatório (espaço, "/" ou "nº") + número de 1 a 7 dígitos + sufixo opcional P (provisória) ou S (secundária), sem diferenciar maiúsc./minúsc.; grava o canônico "CRN-3 12345" ou "CRN-3 12345-P" (`normalizarCrn`). O CRN já salvo não é revalidado enquanto o campo não muda | "Informe o CRN no formato CRN-3 12345 (região de 1 a 11; inscrição provisória ou secundária: CRN-3 12345-P ou -S)." |
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
  Dado que sou nutricionista sem atividade há 30 min (Plano 12, P12-14, decisão do dono 07/10/2026; antes, 12 h)
  Quando faço qualquer requisição
  Então sou redirecionada para o login

Cenário: Tela que se atualiza sozinha não mantém a sessão (Plano 12, P12-14)
  Dado que deixei aberto um documento em "Preparando o PDF…" (ou a leitura de um exame pela IA) e saí de perto
  Quando passam 28 min sem eu usar a tela
  Então o aviso de inatividade aparece mesmo com a tela consultando o servidor sozinha

Cenário: Aviso de inatividade (Plano 12, P12-14)
  Dado que estou no painel (ou no admin) sem usar a tela há 28 min, em qualquer aba
  Então vejo o aviso "Sua sessão vai encerrar em 2 minutos por falta de uso." com o botão "Continuar conectada"
  E Esc não fecha o aviso sem eu decidir
  Quando clico em "Continuar conectada", a sessão é renovada e o aviso fecha em todas as abas
  Quando não faço nada, a sessão é encerrada e vou para /entrar com "Sua sessão foi encerrada por falta de uso. Entre de novo."

Cenário: Limite de 8 horas (Plano 12, P12-14)
  Dado que entrei (com o 2FA, se ativo) há 8 h, mesmo usando o sistema o tempo todo
  Quando a sessão chega ao limite
  Então vou para /entrar com "Sua sessão chegou ao limite de 8 horas. Entre de novo." e preciso entrar de novo, com o 2FA

Cenário: Fechar o navegador encerra o login da equipe (Plano 12, P12-14)
  Dado que entrei como nutricionista ou admin
  Quando fecho o navegador e abro de novo
  Então preciso entrar de novo (o paciente continua conectado no app por 30 dias)

Cenário: Sair
  Dado que estou logado em qualquer área (painel, administração, portal do paciente, "Segurança da conta", aceite do DPA ou "Conta temporariamente indisponível")
  Quando clico em "Sair"
  Então a sessão deste navegador é encerrada (POST /sair, só da própria origem) e vou para /entrar
  E abrir /painel, /admin ou /p/inicio de novo me manda para /entrar
  E se outra aba já saiu, "Sair" nesta aba também leva a /entrar, sem erro
  E em "Conta temporariamente indisponível" o botão só aparece para quem tem sessão

Cenário: Sair sem conseguir encerrar a sessão
  Dado que o servidor não conseguiu apagar a minha sessão
  Quando clico em "Sair"
  Então continuo logado e vejo "Não foi possível sair agora. Tente de novo." com o botão "Sair" e "Voltar ao início"

Cenário: Sair com alteração pendente no editor de plano
  Dado que estou no editor do plano alimentar e o salvamento automático ainda não enviou a minha edição
  Quando clico em "Sair"
  Então a edição é enviada e, gravada, saio sem diálogo
  E sem rede, com erro de campo, conflito entre abas ou se o envio não gravar, vejo "Há alterações que ainda não foram salvas. Sair mesmo assim?" (cancelar mantém no editor; com tudo salvo, sai sem perguntar)
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

Nota de entrega (Plano 05, v1.8): a suspensão e a reativação do admin só enfileiram o job `agenda-tenant`; o worker faz a troca dentro do `withTenant` do tenant (o admin nunca toca tabela 🔒), relendo o status do tenant sob trava (`FOR SHARE`) — um job "suspenso" atrasado, que roda depois da reativação, não ignora nada. Na reativação, os lembretes seguem a RN-05 ao pé da letra (decisão do dono, 02/10/2026): o lembrete cujo horário de envio já passou fica "ignorada" com motivo "prazo_passado" (não é reenviado nem adiado); os demais voltam a "pendente". O convite por WhatsApp (sem consulta) não volta: o convite por e-mail continua valendo.

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

Nota de entrega (Plano 06, v1.9): no portal, o topo mostra o logo ("Logo de {consultório}") e a linha "Acompanhamento com {consultório}", com a borda na cor da nutricionista (`getTenantBrand()`). Os ícones do app instalado são genéricos do NutriDebby (folha branca em fundo verde `#1d6b5a`; D21), trocáveis depois pelo SVG (`public/icones/icone.svg` + `pnpm icones`).

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
  E um aviso por WhatsApp (texto simples, SEM link) é enviado para "+5511912345678": "Olá, Ana! <nutricionista> convidou você para o NutriDebby. Enviamos o convite para o seu e-mail a***@ex.com (vale por 7 dias)."
  E o link do convite vai só no e-mail
  E conta 1 mensagem na cota do tenant

Nota de entrega (Plano 05, v1.8 — decisão do dono, 02/10/2026): o convite por WhatsApp é só um aviso. O número não foi verificado e a conversa fica no aparelho do consultório (INT-01): com o link (credencial de criação da conta), um número errado ou reciclado criaria a conta do paciente. Um texto só para conta nova ou existente (dizer que o e-mail já é paciente de outra nutricionista vazaria dado do outro consultório); o texto é montado na hora do envio, com o e-mail atual do paciente, mascarado (primeira letra + "***" + "@" + domínio). Se o paciente aceitar o convite pelo e-mail antes de o WhatsApp sair, o aviso não sai ("Não enviado: convite já aceito"). Não há reenvio do convite só por WhatsApp: reenviar é pelo e-mail. Sem WhatsApp disponível, a tela avisa: "O WhatsApp ainda não está disponível na plataforma; o convite vai só por e-mail." ou "O WhatsApp do consultório não está conectado; o convite vai só por e-mail."; a dica da opção é "Para enviar o convite por WhatsApp, informe o telefone e marque a autorização.". A tela do paciente mostra "Convite por WhatsApp: {situação}" (ex.: "Convite por WhatsApp: enviado em qua., 14/10/2026 às 10:00") ou "Convite por WhatsApp não enviado: {motivo}".

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

Nota de entrega (Plano 06, v1.9):
- **Nova versão do termo (D25):** a sessão de paciente confere em `consents` se a conta aceitou a versão atual (`TERMO_PACIENTE`) **naquele consultório**; senão vai para `/p/termo`: "Termo de Uso e Privacidade", a linha "Acompanhamento com {consultório}" (texto novo, mantido por decisão do dono em 03/10/2026), o texto do termo, a caixa "Li e aceito o Termo de Uso e Privacidade (versão {versão})" e "Continuar", desabilitado até marcar. Desde a 1.0 (P08-06, 15/10/2026, publicada pelo dono sem a revisão do advogado), quem aceitou a `0.1-provisorio` naquele consultório vai a `/p/termo` uma vez, com o aviso "O termo mudou (versão {versão}, de {data}). Leia e aceite para continuar usando o app." (texto novo; no primeiro acesso, sem o aviso).
- **Revogar o WhatsApp:** em "Perfil > Notificações", a caixa "Receber lembretes por WhatsApp" e "Salvar" ("Preferência salva."): desmarcar grava `whatsapp_optout_em`; marcar exige telefone no cadastro ("Para receber por WhatsApp, peça à sua nutricionista para cadastrar seu telefone.") e grava o opt-in com origem `paciente`; salvar com o WhatsApp já autorizado não regrava a data nem a origem (a autorização registrada pela nutricionista fica).

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

Nota de entrega (Plano 05, v1.8): `consultations.appointment_id` (nulo, FK composta para a consulta do mesmo paciente; uma consulta tem no máximo um atendimento). "Iniciar atendimento" aparece só para consulta que já começou (início ≤ agora), também em "realizada"/"faltou" sem atendimento ligado, e o atendimento salvo marca a consulta como "Realizada". Textos: "Atendimento da consulta de {quando}.", "Esta consulta já tem um atendimento registrado.", "Consulta não encontrada para este paciente.", "Esta consulta ainda não começou." (o servidor confere a mesma regra ao salvar — consulta movida para o futuro depois de a tela abrir; code-review do PR #7).

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
  E o prontuário clínico é mantido identificado, só para consulta da nutricionista, com anonimizar_apos = data do bloqueio (hoje, no fuso do consultório) + prazo legal (P-01) — o bloqueio é o último registro do prontuário (JUR-01, 09/10/2026; Res. CFN 594/2017, art. 3º, VI, "b")
  E o paciente recebe o e-mail explicando o que foi apagado e o que é mantido por obrigação legal
  E o privacy_requests fica "concluido"

Cenário: Fim do prazo de guarda
  Dado um paciente bloqueado com anonimizar_apos no passado
  Quando o job diário de retenção roda
  Então nome, e-mail, telefone e data de nascimento são substituídos por valores anônimos, os anexos são apagados de /data e anonimizado_em é preenchido

Cenário: Pedido de exclusão com consultas futuras (Plano 05, v1.8 — decisão do dono, 02/10/2026)
  Dado que P tem consultas futuras "agendada" ou "confirmada"
  Quando atendo o pedido de exclusão de P
  Então, na mesma transação, essas consultas ficam "cancelada" com cancelado_por = "sistema", sem motivo e sem pedido de remarcação
  E P não recebe "Consulta cancelada" (nenhum aviso ao paciente; o e-mail de sempre do pedido atendido continua saindo)
  E o que ainda estava pendente para P (lembretes, respostas "1"/"2", convite por WhatsApp) fica "ignorada" sem texto cifrado
  E eu recebo o e-mail "Pedido de exclusão atendido" com "Pedido de exclusão atendido: 2 consultas futuras de Ana foram canceladas." (singular: "1 consulta futura de Ana foi cancelada.")
  E a agenda mostra o selo "Cancelada pelo pedido de exclusão"
```

Nota de entrega (Plano 05, v1.8):
- **Exportação (`dados.json`):** ganha `consultas` (início, fim, modalidade, situação, origem, quem cancelou e o motivo **só quando o paciente cancelou** — o motivo do cancelamento escrito pela nutricionista fica fora, decisão do dono de 02/10/2026: é anotação dela, "Só você vê."), `lembretes` (tipo, canal, situação, agendado para, enviado em, motivo de não envio — sem texto cifrado nem ids do provedor), `aceitesDoTermo` (versão, data e IP do aceite) e `dispositivosPush` (só `{criadaEm, navegador}`; nunca endpoint nem chaves).
- **Anonimização:** a migration 0065 (`app_anonimizar_aceites`, única porta de escrita em `consents` depois do INSERT) mantém a versão e a data do aceite ligadas ao prontuário anonimizado e tira o IP e o vínculo com a conta de login; na agenda saem o motivo do cancelamento, o link online (vira `https://anonimizado.invalid`, o CHECK exige https) e o número do WhatsApp (`provider_jid`); o que estava na fila não sai mais; as inscrições de push são apagadas. Horários, situação, canal e tipo ficam (histórico e métricas, sem identificação).
- **`audit_log`:** os IPs de quem acessou ou alterou o prontuário (inclusive os do próprio paciente, pelo link da consulta ou pela página pública) ficam na anonimização, como registro de responsabilização (decisão do dono, 02/10/2026).
- **"Histórico de acessos":** ações na agenda feitas pelo próprio paciente (link da consulta, resposta no WhatsApp, página pública) não têm usuário de sessão e aparecem com o ator "Sistema" (decisão do dono, 02/10/2026).
- Atender o pedido também apaga as inscrições de push do vínculo (US-018 "inscrições de push … apagadas na hora").

Nota de entrega (Plano 06, v1.9):
- **Fotos do diário:** atender o pedido apaga as fotos do diário (originais e convertidas) logo depois da transação do atendimento (`apagarFotosDoDiario`); a varredura diária do job de retenção apaga as que sobrarem de paciente bloqueado, e a anonimização também as apaga. Uma conversão em andamento quando o paciente é bloqueado termina com a foto "removida", sem JPEG.
- **Textos:** o e-mail "Seu pedido de exclusão de dados foi atendido" e o texto da aba Privacidade passam a citar as fotos do diário (texto exato no fim do E5).
- **Exportação:** o `dados.json` ganha `diario` (data e hora, refeição, texto, comentário da nutricionista e a foto, copiada para `diario/<data no fuso>-<n>.jpg`). A exportação pedida pelo titular no portal (US-046) usa o mesmo job com `escopo = 'titular'`, sem planos em rascunho.
- **Conta de login (P06-08, D18):** na anonimização, a conta do titular sem outro vínculo não anonimizado é anonimizada ("Paciente anonimizado", `anonimo-<id>@anonimizado.invalid`, sessões e senha apagadas); com outro vínculo, fica.

Nota de entrega (Plano 07, v1.10, D15):
- **Conteúdos:** o pedido de exclusão atendido e a anonimização tiram o titular das audiências de conteúdo e apagam as visualizações e os favoritos dele (`content_audience`, `content_views`, `content_favorites`; a saída da audiência fica no "Histórico de acessos" como "Público de conteúdo"); arquivar não apaga (desarquivado, volta às audiências).
- **Exportação (equipe e titular, US-046):** o `dados.json` ganha `conteudos` — `vistos` (título e data) e `favoritos` (título e data); o título só vai de conteúdo **publicado**, e o que não está mais publicado vai como "Conteúdo indisponível" (o título pode ter virado um título interno de rascunho) — e, em cada refeição dos planos, `sugestaoDeReceita` (o título da receita sugerida; na exportação do titular, só se a receita estiver publicada). As versões do plano são lidas em lote (D04-1, sem N+1). **Desvio:** a exportação da equipe não leva os alvos de `content_audience` (a D15 limitou o conteúdo a vistos e favoritos).

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

Nota de entrega (Plano 07, v1.10, D1): as etiquetas de paciente são a audiência "Pacientes com etiqueta" dos conteúdos (US-053) e continuam invisíveis ao paciente: a política de `contents` pergunta só "este conteúdo é para uma etiqueta deste paciente?" a uma função que responde sim/não (`app_conteudo_por_etiqueta`); `patient_tag_links` segue `staff_only`. Os rótulos do filtro do feed ("sem lactose") são outra coisa: as "Etiquetas do conteúdo", visíveis ao paciente.

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
  E P recebe push "Seu novo plano alimentar está disponível" (e o e-mail com o mesmo assunto — Plano 06, ver as notas de entrega abaixo)

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

Nota de entrega (Plano 06, v1.9): na publicação, na mesma transação, saem o push "Seu novo plano alimentar está disponível" (tipo `plano_novo`, texto neutro, abre "Plano" no consultório certo) e o e-mail com o mesmo assunto e o botão "Ver meu plano" — **só** para paciente `ativo` com conta no portal; sem conta, nada (o convite já leva ao portal). Republicar várias vezes manda um aviso por publicação (sem agrupar; P06-12).

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

Nota de entrega (Plano 05, v1.8): o push só sai se o paciente tiver inscrição (a inscrição é do P06-02, Plano 06; até lá, as linhas de push ficam "Não enviado: paciente sem notificações no app"). A nutricionista marca em qualquer data (inclusive passada, para registrar um encaixe; consulta no passado não gera confirmação nem lembrete) até hoje + 5 anos ("Informe uma data válida" fora disso), com duração de 15 a 240 min; paciente arquivado: "Paciente arquivado: desarquive para agendar.". "Alterar data e hora" volta a consulta para "Agendada"; mudar só a duração, a modalidade ou o link mantém o horário e os lembretes pendentes (que saem com os dados novos) e **não manda aviso próprio** ao paciente (R3, aceito pelo dono em 02/10/2026). Cancelar: "Cancelar esta consulta? O paciente recebe um aviso por e-mail."; o motivo (até 300 caracteres) só a nutricionista vê ("Motivo do cancelamento (só você vê): …" na página da consulta).

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

Nota de entrega (Plano 05, v1.8):
- **"Agendar pelo PWA":** o domínio (antecedência de 12 h, 60 dias, corrida pelo `EXCLUDE`, aviso à nutricionista por e-mail e no quadro "Agenda" do painel) está pronto; a tela no PWA é do P06-09 (Plano 06). A "notificação no painel" é o quadro "Agenda" do painel inicial (sem tabela de notificações internas).
- **Página pública:** nasce **desligada** (`agendamento_publico_ativo` padrão `false`; o deploy da migration 0067 desliga a de todos os tenants existentes — decisão do dono, 02/10/2026); a nutricionista liga em Configurações, em "Permitir agendamento pela página pública". O botão "Entrar (já sou paciente)" fica para o Plano 06: até lá, o código por e-mail serve também para quem já é paciente — a consulta vai para o paciente ativo daquele e-mail (ele provou o e-mail); arquivado, bloqueado ou anonimizado vê "Não foi possível agendar por aqui. Fale com sua nutricionista." (também se o pedido de exclusão for atendido no meio da marcação: a página pública reconfere a situação do paciente sob a trava da consulta nova e desfaz a marcação).
- Dois passos: pedido (nome, e-mail, telefone opcional, "Tenho 18 anos ou mais", termo, "Quero receber lembretes por WhatsApp", Turnstile) → código de 6 dígitos (10 min, 5 erros invalidam o pedido) → consulta. Limites: 10 tentativas por IP por hora (HTTP 429, IP real via `TRUSTED_PROXIES`), 1 código por e-mail a cada 60 s e 5 por hora, 3 consultas futuras por e-mail conferidas **depois** do código; a resposta é a mesma para e-mail cadastrado ou não até o código ser confirmado. Horário ocupado entre o pedido e o código: outros horários da mesma semana, e o pedido verificado escolhe outro sem novo código por 30 min. Pedidos somem em 24 h.
- **Opt-in de WhatsApp de paciente que já existe:** marcar "Quero receber lembretes por WhatsApp" na página pública **não** altera o cadastro existente (o contexto sem login não altera pacientes); a autorização continua a registrada pela nutricionista ou pelo paciente no portal (aceito pelo dono em 02/10/2026). Paciente novo ganha o opt-in com origem "paciente" se informar o telefone.
- O aceite do termo na página pública fica em `consents` com `patient_id` (o visitante ainda não tem conta).

Nota de entrega (Plano 06, v1.9): "Agendar pelo PWA" em `/p/agenda/nova` (semana a semana; a escolha da modalidade só aparece se o consultório tem link online padrão), com o **teto de 3 consultas futuras** da página pública (decisão do dono, 03/10/2026): "Você já tem 3 consultas marcadas. Fale com sua nutricionista."; sucesso: "Consulta marcada para {quando}.". "Minhas consultas" (`/p/agenda`) lista as próximas e as 10 últimas, com a sigla do fuso quando o aparelho está em outro fuso (RN-06); o Início mostra "Próxima consulta: {quando}". Na página pública, "Entrar (já sou paciente)" leva a `/p/agenda` (sem sessão, ao login).

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

Nota de entrega (Plano 05, v1.8): até o PWA (P06-09), o paciente age pela página do **link assinado da consulta** (`/consulta/<token>`), que vai em todo e-mail de lembrete e de marcação: "Confirmar presença", "Cancelar consulta" e "Remarcar" dentro do prazo; fora dele, só "Avisar que preciso remarcar" ("Avisamos sua nutricionista. Ela vai entrar em contato.", uma vez). O link expira no início da consulta, deixa de valer quando a consulta muda de horário ("Este link expirou.") e é **amarrado ao e-mail do paciente**: corrigir o e-mail revoga os links já enviados ("Link inválido."). Nunca muda estado num `GET`; a página tem `Referrer-Policy: no-referrer` e `noindex`. Paciente arquivado ou bloqueado vê "Conta temporariamente indisponível"; anonimizado, "Link inválido.". Remarcar pelo paciente = cancelar a antiga (`cancelado_por = 'paciente'`, motivo "Remarcada pelo paciente") e criar a nova (`remarcada_de`) numa transação.

Nota de entrega (Plano 06, v1.9): no portal, a página da consulta (`/p/agenda/<id>`, "Sua consulta") tem as mesmas ações do link: "Confirmar presença" (grava `confirmada_via = 'link'`: o selo "Confirmada pelo link" vale para os dois; D19), "Cancelar consulta" (com a confirmação "Cancelar esta consulta?") e "Remarcar" (semana a semana, "Remarcar para este horário") dentro do prazo; fora dele, "Para alterar, fale com sua nutricionista." e "Avisar que preciso remarcar" (com o pedido já feito, o botão some; sem nada gravado, a tela não diz que avisou). Remarcar leva à página da consulta nova com "Consulta remarcada para {quando}.". "Link da chamada" só em consulta ativa online; consulta cancelada: "Esta consulta foi cancelada."; encerrada: "Consulta encerrada".

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
  Dado que a Evolution responde erro nas 3 novas tentativas
  Então a notificação WhatsApp fica "falhou"
  E um e-mail de lembrete é enviado, se o de e-mail ainda não tiver saído

Cenário: Sem duplicidade
  Dado que o worker reinicia no meio do envio
  Então o paciente recebe no máximo 1 lembrete por tipo, canal e horário da consulta (UNIQUE appointment_id + canal + tipo + inicio_consulta)
```

Nota de entrega (Plano 05, v1.8):
- **Estado no banco, não job atrasado:** o worker varre `notifications` a cada minuto (o pg-boss apaga job "created" depois de 14 dias, e uma consulta pode ser marcada com 60 dias de antecedência). As linhas dos três canais nascem na marcação; as condições (opt-in, telefone, conexão, cota, inscrição, paciente e consulta ativos, tenant ativo, horário da consulta igual ao da linha) são conferidas na hora do envio e viram "ignorada" + motivo.
- **Lembrete enviado é imutável:** mudar o horário cria linhas novas para o horário novo; a pendente do horário antigo vira "Não enviado: consulta remarcada" e a enviada fica como registro (conta na cota e nas métricas). A página da consulta mostra os lembretes dos dois horários.
- **No máximo uma vez (WhatsApp e push):** a linha é reservada ("Enviando…") antes de chamar o provedor; se o worker cair entre reservar e registrar, depois de 15 min ela vira "Falhou" e **não é retomada** (aceito pelo dono em 02/10/2026: não se sabe se saiu); o e-mail do mesmo lembrete segue o caminho dele (repete com segurança, pela chave de idempotência do Resend).
- **Horário silencioso também na reserva (RN-05, D7):** o lembrete que venceu e sairia entre 21:00 e 08:00 (worker parado, conta reativada à noite) é adiado para as 08:00 quando ainda faz sentido — senão, "ignorada"/"horario_silencioso" —, em todos os canais; o de 24 h que sai no dia da consulta diz "hoje".
- Textos do lembrete por e-mail, WhatsApp (sem link) e push (neutro): tabela "Textos de interface e mensagens do E4".

## US-035 — Confirmação pelo WhatsApp · **M**

**Como** paciente, **quero** confirmar a consulta respondendo ao WhatsApp, **para** avisar a nutricionista sem abrir outro aplicativo.

Plano 05, v1.8 (desvio do INT-01 original): sem botões *quick reply* (não confiáveis pela Evolution/Baileys). O lembrete pede uma resposta por texto; a rota do webhook reduz o texto a `confirmar` ("1", "sim", "confirmo") ou `remarcar` ("2", "remarcar", "preciso remarcar", "não posso"), sem acento, maiúsculas e pontuação, e descarta o resto sem gravar. **Nenhuma mensagem de WhatsApp leva link** (decisão do dono, 02/10/2026: o número não foi verificado e a conversa fica no aparelho do consultório) — nem o link assinado da consulta nem o link da chamada online: os links vão só por e-mail.

```gherkin
Cenário: Confirmar
  Dado que recebi o lembrete_24h por WhatsApp, que termina com "Responda 1 para confirmar ou 2 se precisar remarcar."
  Quando respondo "1"
  Então o webhook muda a consulta para "confirmada"
  E recebo "Presença confirmada. Até lá!"
  E a agenda da nutricionista mostra o selo "Confirmada via WhatsApp"

Cenário: Remarcar
  Quando respondo "2"
  Então appointments.pedido_remarcacao_em é preenchido e a nutricionista vê o alerta "Paciente pediu para remarcar" (e recebe o e-mail "Paciente pediu para remarcar")
  E recebo pelo WhatsApp: "Tudo bem! Enviamos o link para remarcar para o seu e-mail a***@ex.com." e "Se faltarem menos de 24 h para a consulta, fale direto com <nutricionista>."
  E recebo um e-mail NOVO "Remarcar sua consulta: <quando>", no meu e-mail atual, com o link assinado atual da consulta ("Escolher outro horário")

Cenário: Webhook sem autenticação válida
  Quando chega um POST sem o Bearer JWT da instância, com JWT de outra instância, vencido ou de outro algoritmo
  Então a resposta é HTTP 401 e nada é alterado

Cenário: Evento repetido
  Quando a Evolution reenvia o mesmo pedido (mesmo JWT e mesmo corpo)
  Então o estado não muda de novo, nada é enfileirado e a resposta é HTTP 200
```

Regras da resposta (Plano 05, v1.8): "1"/"2" vale para o lembrete de WhatsApp enviado **àquele número** (o destino real que a Evolution devolveu no envio) nas últimas 26 h, de consulta futura e ativa, ainda no horário daquele lembrete; se a resposta cita uma mensagem, só vale se for um desses lembretes (citar outra mensagem não faz nada); sem citação, vale o lembrete mais recente. A ação roda como o próprio paciente (RLS por paciente). A resposta automática do WhatsApp é no máximo UMA de cada tipo ("1" ou "2") por consulta e horário de início — responder de novo, ou alternar "2", "1", "2", não gera outra mensagem (a ação, porém, vale a cada resposta) — e não conta na cota. O e-mail "Remarcar sua consulta" sai no primeiro pedido e só sai de novo quando um "2" abre um pedido NOVO (depois de um "1" ter desfeito o anterior) e o último e-mail desse horário foi gravado há 60 minutos ou mais; "2" repetido sem o "1" no meio não manda outro e-mail. Já confirmada ou já com pedido de remarcação (pelo link): "1"/"2" só respondem, sem mudar a via nem avisar a nutricionista de novo. O e-mail do "2" é montado na hora do envio com o e-mail atual do paciente (o link do e-mail do lembrete pode não ter saído ou ter caído com a correção do e-mail). Pelo link da consulta, a confirmação gera o selo "Confirmada pelo link".

## US-036 — Cota de WhatsApp · **M**

**Como** dona da plataforma, **quero** limitar os envios de WhatsApp por tenant, **para** proteger o número contra bloqueio e a VPS (v1.8: com a Evolution não há custo por mensagem; a cota é limite de uso).

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

Nota de entrega (Plano 05, v1.8): contam os lembretes e convites aceitos pela Evolution (`enviada_em` no mês civil do fuso do tenant); as respostas automáticas a "1"/"2" não contam. O aviso de 80% (painel e e-mail) sai uma vez por mês. Na beira da cota, o que passa do saldo de uma volta do envio fica "pendente" e é recontado na volta seguinte pelo uso real; só vira "cota_esgotada" quando o uso do mês já está em 100% no início da volta (o e-mail e o push seguem). Tela "WhatsApp": "WhatsApps do mês: {usadas} de {cota}" e, esgotada, "Cota de WhatsApp do mês esgotada: os lembretes seguem por e-mail e notificação no app até o mês que vem.".

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

Nota de entrega (Plano 05, v1.8): taxa do mês civil no fuso do tenant = faltas ÷ consultas do mês já iniciadas e não canceladas (consulta futura não entra), com uma casa decimal: "Taxa de faltas do mês: 12,5% (2 de 16)", "Mês anterior: 40,0%", "Sem dados". "Sem registro de presença" = consulta não cancelada que terminou há mais de 24 h ainda "agendada"/"confirmada" ("1 consulta sem registro de presença" / "{n} consultas sem registro de presença", lista em "Pendências"). A presença só se registra depois do início ("A presença só pode ser registrada depois do início da consulta."); "Faltou" é recusado em consulta com atendimento ligado ("Esta consulta tem um atendimento registrado."). Quadro "Agenda" no painel inicial: "Consultas do mês", taxa, "Pedidos de remarcação", "Marcadas pelo paciente (últimos 7 dias)", "Canceladas pelo paciente (últimos 7 dias)".

## Textos de interface e mensagens do E4 (Plano 05, v1.8)

Texto exato do código (conferido na entrega). `{…}` = valor variável; `{quando}` = "sex., 16/10/2026 às 14:00 (horário de Brasília)"; `{e-mail mascarado}` = primeira letra + "***@" + domínio (ex.: "a***@ex.com").

| Onde | Textos |
|---|---|
| Horários e bloqueios (US-030) | "Horários de atendimento", "Horários da semana", "Adicionar horário", "Dia da semana", "Início", "Fim", "Duração", "Modalidade", "Presencial", "Online", "Presencial ou online", "Escolha…", "Escolha o dia da semana", "Escolha a modalidade", "A duração deve ser de 15 a 240 minutos", "O horário precisa caber pelo menos uma consulta", "Este horário se sobrepõe a outro do mesmo dia.", "Informe um horário válido (HH:MM)", "Limite de 30 horários de atendimento.", "Nenhum horário cadastrado: a página de agendamento não oferece horários.", "Excluir", "Excluir este horário de atendimento?", "Bloqueios", "Adicionar bloqueio", "Data inicial", "Data final", "Hora inicial (opcional)", "Hora final (opcional)", "Vazio = só a data inicial.", "Vazio = o dia inteiro.", "Motivo (opcional)", "A data final deve ser igual ou posterior à inicial", "O bloqueio pode ter no máximo 366 dias", "Use no máximo 120 caracteres", "Nenhum bloqueio futuro.", "Excluir este bloqueio?", "Bloqueado", "Bloqueado: {motivo}" |
| Agenda da nutricionista (US-031) | "Agenda", "Dia", "Semana", "Lista", "Hoje", "Anterior", "Próximo", "Nenhuma consulta neste período.", "Nova consulta", "Paciente", "Selecione o paciente", "Data", "Hora", "Link da chamada", "Vazio = o link padrão do seu perfil.", "Marcar consulta", "Informe uma data válida", "Este horário não existe neste dia (mudança de horário de verão).", "Paciente arquivado: desarquive para agendar.", "Consulta marcada.", "Consulta não encontrada.", "Consulta de {nome}", "Abrir prontuário", "Alterar data e hora", "Salvar alteração", "Consulta alterada.", "Só dá para alterar consulta agendada ou confirmada.", "Cancelar consulta", "Motivo do cancelamento (opcional)", "Só você vê.", "Use no máximo 300 caracteres", "Cancelar esta consulta? O paciente recebe um aviso por e-mail.", "Consulta cancelada.", "Esta consulta não pode mais ser cancelada.", "Motivo do cancelamento (só você vê): {motivo}" |
| Situação e selos da consulta | "Agendada", "Confirmada", "Cancelada", "Realizada", "Faltou", "Confirmada via WhatsApp", "Confirmada pelo link", "Cancelada pelo paciente", "Cancelada pelo pedido de exclusão", "Paciente pediu para remarcar", "Novo paciente via agendamento online", "Completar cadastro", "Consulta dentro de um bloqueio"; motivo gravado na remarcação pelo paciente: "Remarcada pelo paciente" |
| Lembretes na página da consulta (US-034) | "Lembretes", "Lembretes da consulta", "Mensagem", "Canal", "Situação", "Nenhum lembrete para esta consulta."; tipos "Lembrete de 24 h", "Lembrete de 2 h", "Confirmação da marcação", "Aviso de cancelamento", "Convite", "Resposta ao paciente"; canais "E-mail", "WhatsApp", "Notificação no app"; situações "Agendado para {quando}", "Enviando…", "Enviado em {quando}", "Entregue", "Lido", "Falhou", "Não enviado: {motivo}"; motivos "horário silencioso (21h–8h)", "já tinha passado do horário", "consulta cancelada", "consulta remarcada", "consulta encerrada", "paciente arquivado ou bloqueado", "conta suspensa", "sem autorização de WhatsApp", "sem telefone", "WhatsApp não configurado na plataforma", "WhatsApp desconectado", "cota de WhatsApp do mês esgotada", "paciente sem notificações no app", "notificações no app não configuradas", "convite já aceito", "motivo desconhecido" |
| Presença e painel (US-037, US-016) | "Registrar presença", "Realizada", "Faltou", "Presença registrada.", "A presença só pode ser registrada depois do início da consulta.", "Esta consulta tem um atendimento registrado.", "Iniciar atendimento", "Pendências", "Consultas sem registro de presença", "1 consulta sem registro de presença", "{n} consultas sem registro de presença", "Agenda" (quadro do painel), "Consultas do mês: {n}", "Taxa de faltas do mês: {x}% ({faltas} de {total})", "Mês anterior: {y}%", "Sem dados", "Pedidos de remarcação", "Marcadas pelo paciente (últimos 7 dias)", "Canceladas pelo paciente (últimos 7 dias)", "Atendimento da consulta de {quando}.", "Esta consulta já tem um atendimento registrado.", "Consulta não encontrada para este paciente.", "Esta consulta ainda não começou." |
| Link da consulta (US-033, US-035) | "Sua consulta", "Com {nutri} · {quando} · {modalidade}", "Endereço: {endereço}", "Link da chamada: {link}", "Agendada", "Presença confirmada", "Consulta realizada", "Consulta encerrada", "Confirmar presença", "Presença confirmada. Até lá!", "Esta consulta não pode mais ser confirmada.", "Remarcar", "Modalidade", "Escolha um novo horário", "Semana anterior", "Próxima semana", "Remarcar para este horário", "Consulta remarcada para {quando}.", "Esse horário não está mais disponível. Escolha outro.", "Esse horário acabou de ser ocupado. Escolha outro.", "Nenhum horário livre nesta semana.", "Nenhum horário livre nos próximos 60 dias. Fale com sua nutricionista.", "Cancelar consulta", "Cancelar esta consulta?", "Avisar que preciso remarcar", "Avisamos sua nutricionista. Ela vai entrar em contato.", "Para alterar, fale com sua nutricionista.", "Este link expirou.", "Link inválido.", "Esta consulta foi cancelada.", "Conta temporariamente indisponível" |
| Página pública (US-032, RN-16) | "Agendar consulta com {nome}", "Agendamento online indisponível. Entre em contato.", "Escolha a modalidade", "Escolha o horário", "Escolha um horário", "Semana anterior", "Próxima semana", "Seus dados", "Nome", "E-mail", "Telefone (opcional)", "Tenho 18 anos ou mais", "Quero receber lembretes por WhatsApp", "Enviar código", "Código", "Confirmar agendamento", "Informe o nome", "Informe um e-mail válido", "Telefone inválido", "Informe o telefone para receber lembretes por WhatsApp", "Confirme que você tem 18 anos ou mais", "Enviamos um código de 6 dígitos para {e-mail}. Ele vale por 10 minutos.", "Código incorreto.", "Código expirado. Peça um novo código.", "Muitas tentativas com código errado. Peça um novo código.", "Aguarde 1 minuto para pedir outro código.", "Muitas tentativas. Tente novamente mais tarde.", "Você já tem 3 consultas marcadas. Fale com sua nutricionista.", "Não foi possível agendar por aqui. Fale com sua nutricionista.", "Consulta marcada para {quando}. Enviamos a confirmação para o seu e-mail.", "Pedido grande demais.", "Pedido inválido."; em Configurações: "Permitir agendamento pela página pública" |
| WhatsApp no painel (INT-01, US-036) | "WhatsApp", "Conectar WhatsApp", "Gerar novo QR code", "No celular, abra o WhatsApp > Aparelhos conectados > Conectar um aparelho e aponte para este código.", "QR code para conectar o WhatsApp", "Conectado ao número {telefone}.", "(número ainda não informado)", "Desconectar WhatsApp", "Desconectar o WhatsApp? Os lembretes passam a sair só por e-mail e notificação no app.", "WhatsApp desconectado. Os lembretes estão saindo só por e-mail e notificação no app. (Desde {quando}.)", "O WhatsApp ainda não está disponível na plataforma. Os lembretes saem por e-mail.", "Use, de preferência, um número só do consultório. Os lembretes saem do número conectado.", "Não foi possível falar com o serviço de WhatsApp. Tente de novo em alguns minutos.", "Uso do mês", "WhatsApps do mês: {usadas} de {cota}", "Você usou 80% dos WhatsApps do mês", "Cota de WhatsApp do mês esgotada: os lembretes seguem por e-mail e notificação no app até o mês que vem.", "Conectar de novo" (aviso no painel inicial) |
| Convite por WhatsApp (US-010) | "Enviar convite por WhatsApp", "Marque que o paciente autorizou o WhatsApp", "Para enviar o convite por WhatsApp, informe o telefone e marque a autorização.", "O WhatsApp ainda não está disponível na plataforma; o convite vai só por e-mail.", "O WhatsApp do consultório não está conectado; o convite vai só por e-mail.", "Convite por WhatsApp: {situação}", "Convite por WhatsApp não enviado: {motivo}"; mensagem: "Olá, {primeiro nome}! {nutri} convidou você para o NutriDebby. Enviamos o convite para o seu e-mail {e-mail mascarado} (vale por 7 dias)." |
| Mensagens de WhatsApp ao paciente (sem link) | Lembrete de 24 h: "Olá, {primeiro nome}! Lembrete da sua consulta com {nutri}: {quando}, {modalidade}." + (presencial, se houver endereço) "Endereço: {endereço}" ou (online) "O link da chamada foi enviado para o seu e-mail {e-mail mascarado}." + linha vazia + "Responda 1 para confirmar ou 2 se precisar remarcar."; lembrete de 2 h: "Olá, {primeiro nome}! Sua consulta com {nutri} é hoje às {HH:MM} ({fuso}), {modalidade}." + as mesmas linhas; resposta a "1": "Presença confirmada. Até lá!"; resposta a "2": "Tudo bem! Enviamos o link para remarcar para o seu e-mail {e-mail mascarado}." + "Se faltarem menos de {h} h para a consulta, fale direto com {nutri}." |
| Push ao paciente (neutro: sem nome da nutricionista nem dado do paciente) | Lembrete de 24 h: "Lembrete de consulta" / "Você tem uma consulta amanhã às {HH:MM}." (no dia da consulta: "Sua consulta é hoje às {HH:MM}."); lembrete de 2 h: "Lembrete de consulta" / "Sua consulta é hoje às {HH:MM}."; marcação: "Consulta marcada" / "Sua consulta foi marcada para {quando}."; cancelamento: "Consulta cancelada" / "Sua consulta de {quando} foi cancelada." |
| E-mails ao paciente | Assuntos: "Lembrete: sua consulta é amanhã às {HH:MM}", "Lembrete: sua consulta é hoje às {HH:MM}", "Consulta marcada: {quando}", "Consulta cancelada: {quando}", "Remarcar sua consulta: {quando}", "Seu código para agendar com {nutri}: {código}". Corpo: "Olá, {primeiro nome}!", "Este é um lembrete da sua consulta com {nutri}: {quando}.", "Sua consulta com {nutri} é hoje: {quando}.", "Sua consulta com {nutri} está marcada para {quando}.", "Sua consulta com {nutri} de {quando} foi cancelada.", "Para marcar outro horário, fale com sua nutricionista.", "Endereço: {endereço}", "Link da chamada: {link}", botão "Confirmar presença ou remarcar", "Se não puder ir, use o mesmo link para remarcar ou cancelar."; resposta a "2": "Você pediu pelo WhatsApp para remarcar sua consulta com {nutri} de {quando}.", botão "Escolher outro horário", "Se faltarem menos de {h} h para a consulta, fale direto com {nutri}."; código: "Use o código {código} para confirmar o agendamento com {nutri}.", "Ele vale por 10 minutos. Se não foi você que pediu, ignore este e-mail." |
| E-mails à nutricionista (D18; nome do paciente só no corpo) | Assuntos: "Consulta marcada pelo paciente", "Consulta remarcada pelo paciente", "Consulta cancelada pelo paciente", "Paciente pediu para remarcar", "Novo paciente via agendamento online", "Seu WhatsApp foi desconectado do NutriDebby", "Você usou 80% dos WhatsApps do mês", "Pedido de exclusão atendido". Corpo: "{paciente} marcou uma consulta para {quando}.", "{paciente} remarcou a consulta para {quando}.", "{paciente} cancelou a consulta de {quando}.", "{paciente} pediu para remarcar a consulta de {quando}.", "{paciente} marcou uma consulta pela sua página de agendamento para {quando}. Complete o cadastro (data de nascimento e sexo) antes do atendimento.", botão "Ver na agenda"; "O WhatsApp do consultório foi desconectado (o celular saiu de "Aparelhos conectados" ou ficou muito tempo sem internet).", "Os lembretes estão saindo só por e-mail e notificação no app.", botão "Conectar o WhatsApp de novo"; "Já foram {usadas} de {cota} mensagens de WhatsApp neste mês.", "Quando chegar a 100%, os lembretes seguem só por e-mail e notificação no app até o mês que vem (ou até o suporte ampliar a cota).", botão "Ver o uso do WhatsApp"; "Pedido de exclusão atendido: 1 consulta futura de {primeiro nome} foi cancelada." / "Pedido de exclusão atendido: {n} consultas futuras de {primeiro nome} foram canceladas." |
| Histórico de acessos (US-007) | Entidade "Agenda"; ator "Sistema" nas ações do próprio paciente pela agenda (link, WhatsApp, página pública) |

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

Nota de entrega (Plano 06, v1.9):
- **Android:** o botão "Instalar app" aparece no Início; o `beforeinstallprompt` é guardado desde o layout do portal (vale também quando o evento chega antes da tela, logo depois do login). **iPhone:** "Instalar app" com "Para instalar no iPhone: toque em Compartilhar → Adicionar à Tela de Início." e "Depois de instalar, abra o app pela tela de início para ativar as notificações."; fora do app instalado, "Ativar notificações" não aparece. Manifest com `scope: /p/`, `start_url: /p/inicio`, `display: standalone`, **sem orientação fixa** (WCAG 1.3.4), ícones 192, 512 e 512 *maskable* e `apple-touch-icon` de 180.
- **Push de teste (desvio):** sai pelo motor de notificações do Plano 05 (tipo `push_teste`), até ~1 min depois do clique, **sem repetição**: um teste pendente por vez por paciente e no mínimo 1 min entre pedidos (cliques repetidos não geram outro push). A inscrição só vale como ativa quando o servidor confirma que o endpoint é desta conta (aparelho compartilhado, D26); uma linha por vínculo ativo da conta. Sem `VAPID_PUBLIC_KEY` no app: "Notificações no app ainda não estão disponíveis.".
- **Offline (D6):** só "Meu plano"; sem rede, qualquer página do portal mostra o plano guardado com o selo "Offline — exibindo última versão" (também quando o ping não responde em 5 s). A cópia acompanha o build, sai quando o acesso acaba, no "Sair", no login, na troca de dono e após 30 dias (spec, RNF-08).
- **Registro de acesso:** `POST /api/p/acesso`, uma vez por abertura do portal, grava no máximo 1 linha por paciente por dia **no fuso do tenant** e renova o cookie de sessão (30 dias, P06-11) e, com 2+ vínculos, o `nd_vinculo`.
- **"Sair"** do portal apaga a cópia do plano, as marcações da lista de compras e a inscrição de push do aparelho (no servidor e no navegador) antes do `POST /sair`, que responde com `Clear-Site-Data`.

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

Nota de entrega (Plano 06, v1.9):
- Refeições em ordem de horário ("{refeição} · {HH:MM}"); a **próxima refeição** (no fuso do tenant; depois da última do dia, a primeira do dia seguinte) tem o selo "Próxima refeição". Cada item mostra a medida caseira e os gramas; as kcal do item e o "Total do dia" só com "Mostrar calorias ao paciente". Item com substituições abre no toque ("Substituições"). Observação da refeição e "Orientações" do plano no fim.
- "Baixar PDF" pelo `GET /api/p/plano/pdf` (o PDF do plano publicado, por URL assinada); PDF ainda não pronto: "Seu PDF está sendo preparado. Volte em alguns minutos.".
- **Desvio:** "Sugestão de receita" fica para o Plano 07 (P07-05; `meals.recipe_content_id` ainda não existe).
- A leitura pelo paciente é auditada ("Visualizou · Plano alimentar" com o nome do paciente, D22). A P-16 foi resolvida: `stored_files` por paciente (§4.1).

Nota de entrega (Plano 07, v1.10): o cartão "Sugestão de receita: {título}" entrou na refeição (US-054), só com a receita publicada; o link abre a receita, também fora da audiência (exceção da RN-12, só por este caminho). A página "Plano" ganhou o link "Lista de compras": a aba "Compras" saiu da barra para dar lugar a "Conteúdos" (D3). A cópia offline mostra o cartão (o link da receita não abre sem rede) e muda quando a receita é renomeada.

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

Nota de entrega (Plano 06, v1.9):
- **Miniatura local (desvio):** a miniatura aparece **no formulário**, ao escolher a foto, antes de enviar; depois do envio, o registro entra na lista com "Foto sendo preparada…" até o worker converter (em geral em até ~1 min) e então mostra o JPEG convertido (só ele é assinado; o original nunca); conversão impossível: "Não foi possível processar a foto.".
- Formulário "Registrar refeição": "Refeição" (lista fixa: Café da manhã, Lanche da manhã, Almoço, Lanche da tarde, Jantar, Ceia, Outro), "O que você comeu?" (até 2000 caracteres), "Foto (opcional)" e "Registrar"; texto ou foto obrigatório ("Escreva o que você comeu ou envie uma foto."). O paciente só cria registros: não edita nem apaga (D11).
- **Cota esgotada (desvio):** com texto, o registro é salvo sem a foto e a tela diz "Registro salvo sem a foto. Espaço de armazenamento esgotado. Fale com o suporte."; só com a foto, "Espaço de armazenamento esgotado. Fale com o suporte.". O original fica guardado (conta na cota) até a conversão.
- Limite diário contado no dia do fuso do tenant, também na corrida de dois envios; acima de 10 MB, HTTP 413 com "Envie uma foto JPEG, PNG ou HEIC de até 10 MB". Sessão vencida ao registrar: "Sessão expirada. Entre de novo." com o link "Entrar", sem apagar o que foi digitado.

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

Nota de entrega (Plano 06, v1.9): "Diários" no menu do painel (`/painel/diarios`): os registros recentes de todos os pacientes (até 50), não vistos primeiro, com os selos "Novo"/"Visto" e "Comentado"; abrir um registro preenche `visto_pela_nutri_em` (uma vez) e tem "Abrir prontuário". Um comentário por registro (`comentario_nutri`, até 1000 caracteres), que ela pode corrigir ("Comentar", "Salvar comentário", "Comentário salvo."); **o push sai só no primeiro comentário** (desvio, D13: corrigir não manda outro), texto neutro, e o toque abre o Diário do consultório certo. Paciente bloqueado ou anonimizado: o registro fica só para consulta. No portal, o comentário aparece abaixo do registro em "Comentário da nutricionista".

## US-044 — Minha evolução · **S**

**Como** paciente, **quero** ver minha evolução, **para** me manter motivado.

```gherkin
Cenário: Evolução do paciente
  Quando abro a aba "Evolução"
  Então vejo gráficos de peso e medidas e a lista de orientações recebidas em cada consulta
  E não vejo notas privadas nem exames
  E o %G só aparece se a nutricionista ativar "Mostrar % de gordura ao paciente" (tenants.mostrar_perc_gordura_paciente, padrão: desligado)
```

Nota de entrega (Plano 06, v1.9): "Minha evolução" mostra, em "Medidas", a diferença entre a primeira e a última avaliação ("{medida}: {primeiro} ({data}) → {último} ({data}) · {diferença}") e os gráficos com 2 ou mais pontos de peso, IMC e circunferências; "% de gordura" só com a opção "Mostrar % de gordura ao paciente" (Configurações); dobras, densidade e exames nunca (D14). Sem nada a comparar: "Registre mais uma avaliação para ver a evolução". "Orientações recebidas": as orientações ao paciente de cada atendimento ("Nenhuma orientação registrada ainda."). Leitura auditada (D22).

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

Nota de entrega (Plano 06, v1.9): "Lista de compras" com "Para quantos dias?" (1 a 14, padrão 7; fora disso "Escolha de 1 a 14 dias.") e "Gerar lista"; calculada no servidor a partir do plano publicado; sem plano: "Sem plano publicado, não há lista de compras.". Cada item é uma caixa ("{alimento} — {quantidade}", riscado quando marcado) e a tela avisa "Marque o que já comprou: a marcação fica neste aparelho."; a marcação vale por plano e sai no "Sair", no login e na troca de dono do aparelho (RN-13).

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

Nota de entrega (Plano 06, v1.9):
- **"Baixar meus dados" (desvio, D16):** no máximo 1 pedido a cada 24 h ("Pedimos seus dados. O link chega por e-mail e vale por 24 horas." / "Você já pediu seus dados nas últimas 24 horas. O link chega por e-mail."). O ZIP é o da US-018 com `escopo = 'titular'`: sem notas privadas, sem etiquetas e sem planos em rascunho (P-16 b), com o diário e as fotos. O link do e-mail leva o consultório (`?v=`) e abre `/p/meus-dados/exportacoes/<id>` (pede login de paciente; só pedidos do titular do próprio paciente): "Seus dados", "O arquivo está pronto. O link vale até {quando}." e "Baixar arquivo" (URL assinada de 5 min), ou "Ainda estamos preparando seus dados. Volte em alguns minutos.", "Este link expirou. Peça os dados de novo em Perfil.", "Não foi possível gerar seus dados. Peça de novo em Perfil.".
- **"Pedir exclusão dos meus dados":** pede a confirmação "Pedir a exclusão? Sua nutricionista tem até 15 dias para responder. O prontuário clínico é guardado pelo prazo legal."; o prazo é hoje + 15 dias no fuso do tenant; um pedido aberto por vez ("Seu pedido de exclusão já foi registrado em {data}."); sucesso: "Pedido de exclusão registrado. Enviamos a confirmação para o seu e-mail.". A "tarefa no painel" é o quadro "Pedidos do titular" do painel inicial ("Pedido de exclusão de {nome} · prazo {data}", com link para a aba Privacidade, onde "Atender pedido de exclusão" conclui o pedido); sem e-mail à nutricionista (D17).


## Textos de interface e mensagens do E5 (Plano 06, v1.9)

Texto exato do código (conferido na entrega). `{…}` = valor variável; `{quando}` = "sex., 16/10/2026 às 14:00 (horário de Brasília)", como no E4; exceções: a sigla do fuso só aparece, com o aparelho em outro fuso (RN-06), em "Minhas consultas", "Próxima consulta: {quando}" e no cabeçalho de "Sua consulta"; "O link vale até {quando}" sai sem a sigla.

| Onde | Textos |
|---|---|
| Portal: estrutura e acesso | "Meu acompanhamento"; topo "Acompanhamento com {consultório}" e o logo ("Logo de {consultório}"); abas (`<nav aria-label="Portal">`) "Início", "Plano", "Diário", "Conteúdos", "Evolução", "Agenda", "Perfil" (Plano 07, D3: "Compras" saiu da barra e virou o link "Lista de compras" em "Plano"); "Sair"; Início: "Próxima consulta: {quando}", "Conectado como {e-mail}."; `/p/escolher`: "Com qual nutricionista você quer entrar?" (um botão por consultório; o suspenso sem botão, com "Conta temporariamente indisponível"); `/p/sem-acesso`: "Seu acesso ao portal não está ativo. Fale com sua nutricionista."; `/p/termo`: "Termo de Uso e Privacidade", "Acompanhamento com {consultório}", "Li e aceito o Termo de Uso e Privacidade (versão {versão})", "Continuar"; recusa da sessão nos formulários: "Sessão expirada. Entre de novo." + link "Entrar"; na API do portal: "Acesso negado", "Conta temporariamente indisponível" |
| Instalar e notificações (US-040) | "Instalar app"; iPhone: "Para instalar no iPhone: toque em Compartilhar → Adicionar à Tela de Início.", "Depois de instalar, abra o app pela tela de início para ativar as notificações."; "Ativar notificações", "Notificações ativadas neste aparelho.", "Você bloqueou as notificações. Para ativar, mude a permissão do site nas configurações do navegador.", "Notificações no app ainda não estão disponíveis.", "Não foi possível ativar as notificações. Tente de novo."; selo "Offline — exibindo última versão" |
| Meu plano (US-041) | "Plano", "Sua nutricionista ainda está preparando seu plano", "Baixar PDF", "Seu PDF está sendo preparado. Volte em alguns minutos.", "Total do dia: {kcal} kcal" (só com "Mostrar calorias ao paciente"), "{refeição} · {HH:MM}", selo "Próxima refeição", "{alimento} — {quantidade}" (+ " · {kcal} kcal" com a opção), "Substituições" (o leitor de tela ouve também "(ver substituições)"), "Orientações" |
| Diário (US-042) | "Diário", "Registrar refeição", "Refeição", "Escolha a refeição" (opção vazia), "Café da manhã", "Lanche da manhã", "Almoço", "Lanche da tarde", "Jantar", "Ceia", "Outro", "O que você comeu?", "Foto (opcional)", "Miniatura da foto escolhida" (texto alternativo), "Registrar", "Registro salvo.", "Registro salvo sem a foto. Espaço de armazenamento esgotado. Fale com o suporte.", "Espaço de armazenamento esgotado. Fale com o suporte.", "Escreva o que você comeu ou envie uma foto.", "Use no máximo 2000 caracteres.", "Escolha a refeição.", "Envie uma foto JPEG, PNG ou HEIC de até 10 MB", "Limite de 10 registros por dia atingido", "Tente novamente em alguns instantes.", "Conta temporariamente indisponível"; lista: "{refeição} · {quando}", "Foto sendo preparada…", "Não foi possível processar a foto.", "Foto do registro de {refeição}" (texto alternativo), "Comentário da nutricionista", "Nenhum registro ainda." |
| Diários da nutricionista (US-043) | Menu "Diários"; "Diários", "Nenhum registro de diário ainda.", "Novo", "Visto", "Comentado", "{paciente} — {refeição} · {quando}"; registro: "{paciente} — {refeição}", "Abrir prontuário", "Comentar", "Salvar comentário", "Comentário salvo.", "Escreva o comentário.", "Use no máximo 1000 caracteres.", "Registro não encontrado."; paciente bloqueado: "Comentário da nutricionista: {comentário}" e "Paciente bloqueado por pedido de exclusão: o prontuário é só para consulta." |
| Minha evolução (US-044) | "Minha evolução", "Medidas", "{medida}: {primeiro} ({data}) → {último} ({data}) · {diferença}", "Registre mais uma avaliação para ver a evolução", "Orientações recebidas", "Nenhuma orientação registrada ainda."; em Configurações do painel: "Mostrar % de gordura ao paciente" |
| Lista de compras (US-045) | "Lista de compras", "Para quantos dias?", "Gerar lista", "Escolha de 1 a 14 dias.", "Sem plano publicado, não há lista de compras.", "{alimento} — {quantidade}", "Marque o que já comprou: a marcação fica neste aparelho." |
| Agenda no portal (US-032, US-033) | "Minhas consultas", "Agendar consulta", "Próximas", "Anteriores", "Nenhuma consulta marcada.", "{quando} · {modalidade} · {situação}" ("Agendada", "Confirmada", "Cancelada", "Realizada", "Faltou"); nova consulta: "Agendar consulta", "Semana anterior", "Próxima semana", "{dd/mm/aaaa} a {dd/mm/aaaa}", "Escolha a modalidade", "Presencial", "Online", "Consulta marcada para {quando}.", "Você já tem 3 consultas marcadas. Fale com sua nutricionista."; consulta: "Sua consulta", "{quando} · {modalidade}", "Link da chamada", "Confirmar presença", "Presença confirmada. Até lá!", "Esta consulta não pode mais ser confirmada.", "Cancelar consulta", "Cancelar esta consulta?", "Consulta cancelada.", "Para alterar, fale com sua nutricionista.", "Avisar que preciso remarcar", "Avisamos sua nutricionista. Ela vai entrar em contato.", "Remarcar", "Remarcar para este horário", "Consulta remarcada para {quando}.", "Esta consulta foi cancelada.", "Consulta encerrada"; erros: "Esse horário acabou de ser ocupado. Escolha outro.", "Esse horário não está mais disponível. Escolha outro.", "Não foi possível agendar por aqui. Fale com sua nutricionista.", "Consulta não encontrada.", "Conta temporariamente indisponível"; página pública: "Entrar (já sou paciente)" |
| Perfil e privacidade (US-046, US-011) | "Perfil", "Conectado como {e-mail}.", "Notificações", "Receber lembretes por WhatsApp", "Salvar", "Preferência salva.", "Para receber por WhatsApp, peça à sua nutricionista para cadastrar seu telefone.", "Privacidade", "Baixar meus dados", "Pedimos seus dados. O link chega por e-mail e vale por 24 horas.", "Você já pediu seus dados nas últimas 24 horas. O link chega por e-mail.", "Pedir exclusão dos meus dados", "Pedir a exclusão? Sua nutricionista tem até 15 dias para responder. O prontuário clínico é guardado pelo prazo legal.", "Pedido de exclusão registrado. Enviamos a confirmação para o seu e-mail.", "Seu pedido de exclusão já foi registrado em {data}.", "Trocar de nutricionista"; página do link: "Seus dados", "O arquivo está pronto. O link vale até {quando}.", "Baixar arquivo", "Ainda estamos preparando seus dados. Volte em alguns minutos.", "Este link expirou. Peça os dados de novo em Perfil.", "Não foi possível gerar seus dados. Peça de novo em Perfil." |
| Painel: titular e LGPD (US-046, US-018) | Quadro do painel inicial "Pedidos do titular": "Pedido de exclusão de {nome}" / "Pedido de dados de {nome}" + " · prazo {dd/mm/aaaa}"; aba Privacidade do paciente: "Durante o prazo de guarda do prontuário ({n} anos contados da data do bloqueio, considerada o último registro do prontuário — Res. CFN 594/2017, art. 3º, VI, b), os dados clínicos ficam guardados, identificados e só para sua consulta. Na hora são apagadas as fotos do diário, os exames enviados pelo app que ainda não foram aceitos, as autorizações de WhatsApp, as notificações no app e os convites; as consultas futuras são canceladas, o paciente perde o acesso ao portal deste acompanhamento e recebe um e-mail explicando. No fim do prazo, os dados de identificação são anonimizados." |
| Push ao paciente (neutro: título "NutriDebby", sem nome da nutricionista nem dado de saúde) | "Notificações ativadas ✅" (abre o Início), "Sua nutricionista comentou seu diário" (abre o Diário), "Seu novo plano alimentar está disponível" (abre o Plano) |
| E-mails ao paciente | "Seu novo plano alimentar está disponível" (assunto): "Sua nutricionista publicou um novo plano alimentar para você no NutriDebby.", "Entre no portal para ver as refeições e baixar o PDF.", botão "Ver meu plano"; "Seu pedido foi registrado" (assunto): "Recebemos seu pedido de exclusão de dados. {nutri} tem até {prazo} para responder.", "Por obrigação legal, o prontuário clínico é guardado de forma bloqueada pelo prazo exigido; o resto é apagado quando o pedido for atendido. Você recebe outro e-mail nesse momento."; "Exportação de dados pronta" (assunto): "A exportação de dados que você pediu no NutriDebby está pronta.", "O link vale por 24 horas e pede que você entre no portal." (a da equipe: "…no painel."), botão "Baixar exportação"; "Seu pedido de exclusão de dados foi atendido" (assunto): "Olá, {nome}!", "{nutri} atendeu o seu pedido de exclusão de dados no NutriDebby.", "Foram apagados agora: as fotos do diário alimentar, os exames enviados pelo app que ainda não tinham sido aceitos, as autorizações de mensagens por WhatsApp, as notificações no aparelho e os convites de acesso. Suas consultas futuras foram canceladas e você não tem mais acesso ao portal deste acompanhamento. Você não recebe mais lembretes nem mensagens deste acompanhamento.", "Por obrigação legal (LGPD, art. 16, I), o prontuário clínico fica guardado de forma bloqueada, só para consulta da nutricionista, até {data}. Depois dessa data, seus dados de identificação são anonimizados.", "Se tiver dúvidas, fale com a sua nutricionista." |


### Textos do app do paciente no layout G (Plano 16)

Spec G: [`2026-10-08-nutridebby-app-paciente-g-design.md`](2026-10-08-nutridebby-app-paciente-g-design.md). Texto exato do código
(constantes `MSG_MURAL`, `MSG_JORNADA`, `MSG_G`, `MSG_PESO_OCULTO`, `MSG_COMI_ASSIM`, `AVISO_PORTAL` e o guia
`portal-novidades`), conferido no fechamento do Plano 16 (08/10/2026). **Rascunho até a Debby revisar (G-D10 = a):** trocar
um texto é trocar a constante e o teste que a cita, antes do deploy. Substituem, no portal, as abas e títulos do E5 acima
("Início", "Perfil", "Minha evolução"…); as URLs não mudaram.

| Onde | Textos |
|---|---|
| Moldura (`MSG_G`) | Seções (`<nav aria-label="Seções">`): "Hoje", "Jornada", "Plano", "Exames", "Eu"; títulos: "Olá, {primeiro nome}" (ou "Olá"), "Sua jornada", "Plano de hoje", "Meus exames", "Eu"; data da faixa "Quinta, 8 out"; topo "Acompanhamento com {consultório}", "Logo de {consultório}"; telas de detalhe: "Voltar para {destino}"; barra `<nav aria-label="Ações">`: "Foto da refeição", "Enviar exame", "Agendar" |
| Mural de Hoje (`MSG_MURAL`) | Autor: "Você", "Aviso do app", "Sua nutricionista comentou seu registro ({refeição}, {dia} às {hora})"; "{Bom dia\|Boa tarde\|Boa noite}, {nome}." antes da 1ª refeição; "Próxima refeição às {HH:MM} — {refeição}: {resumo}."; "{refeição} das {HH:MM}: {resumo}."; "{exame}: {situação}"; "Sua próxima consulta: {quando} ({modalidade})."; "Seu novo plano alimentar está disponível."; "Novo conteúdo: {título}"; "Você tem 1 documento novo." / "Você tem {n} documentos novos."; botões: "Ver a refeição", "Ver no diário", "Ver meus exames", "Ver a consulta", "Confirmar presença", "Ver o plano", "Abrir", "Ver documentos"; "Ver todo o diário"; "Dias anteriores"; vazio: "Nada por aqui ainda. Quando sua nutricionista publicar seu plano, suas refeições aparecem aqui." e "Nada para agora. Suas refeições aparecem aqui perto do horário de cada uma."; rodapé: "Seus registros do diário ficam visíveis para sua nutricionista, que pode comentar quando os ler. Este app não é um canal de conversa e não tem prazo de resposta. Dúvidas: anote para a consulta ou use os contatos do consultório. Em emergência, ligue 192."; cartões do aparelho: "Ative as notificações para saber quando houver novidades.", "Instale o app na tela inicial.", "Agora não" |
| Respostas (`ROTULO_RESPOSTA`, `MSG_COMI_ASSIM`, `MSG_DIARIO`) | "Comi assim", "Comi outra coisa", "Mandar foto do prato"; "Registrado no diário." (+ só para leitor de tela: "Para desfazer, use o botão Desfazer logo abaixo."), "Desfazer", "Registro desfeito."; sem rede: "Sem conexão. Registre quando voltar."; recusa: "Refeição não encontrada no seu plano."; no painel (`ROTULO_RESPOSTA_NUTRI`): "Comeu como no plano", "Comeu outra coisa", "Refeição do plano: {refeição} · {HH:MM}" |
| Plano e refeição aberta | "Próxima, {daqui a 1 h 25 min}", "Cerca de {n} kcal" (só com "Mostrar calorias ao paciente"), "Observação da sua nutricionista", "Sugestão de receita: {título}", "Orientações do plano", "Como foi?", "No diário" |
| Jornada (`MSG_JORNADA`) | "Sua jornada" / "Sua jornada desde {mês}"; "Sua jornada começa na primeira consulta."; "{n} consulta(s) desde {mês}"; "{±x,x kg} desde {mês}" / "Sem mudança de peso desde {mês}"; "Próximo marco: consulta {quando}" / "Nenhuma consulta marcada."; "Peso nas consultas", "Cintura nas consultas"; "Linha do tempo"; "{data} · primeira consulta", "{quando} · próxima consulta", "Online." / "Presencial.", "Medidas de {data}", "Orientação da sua nutricionista"; "Ver a consulta", "Todas as medidas", "Minhas consultas", "Agendar consulta"; "Todas as medidas": "Medidas por avaliação", "Medida", "Desde {mês}", "Nenhuma medida para mostrar." (nenhuma medida que o paciente possa ver) |
| Eu | "Conta" ("Conectado como {e-mail}."), "Consultório", "Ver meus documentos", "Notificações", "Instalar o app", Privacidade (RN-214): "Algumas informações do acompanhamento podem não aparecer no app, a critério da sua nutricionista. Suas medidas, registros e documentos estão na cópia dos seus dados (Baixar meus dados).", "Como usar o app", "Sair" |
| Guia do portal (`AVISO_PORTAL`, `portal-novidades`) | Aviso (`<aside aria-label="Novidade">`): "O app mudou. Quer ver onde ficou cada coisa?" (quem já usava) / "Boas-vindas ao app do seu acompanhamento. Quer ver como funciona?" (primeira vez), "Ver como funciona", "Agora não"; `/p/ajuda`: "Como usar o app", "Ver o tour de novo", "O app do seu acompanhamento tem cinco partes, no topo: Hoje, Jornada, Plano, Exames e Eu.", seções "Onde fica cada coisa" e "Perguntas comuns" (texto em `src/modules/ajuda/portal.ts`); passos: "Seu acompanhamento" — "No topo ficam o nome do consultório e as partes do app. Em Hoje, um resumo da sua jornada leva à Jornada."; "Hoje" — "Aqui aparecem a próxima refeição, o que você registrou, os comentários da sua nutricionista e os avisos do consultório."; "Responder à refeição" — "Quando uma refeição estiver perto do horário, ela aparece em Hoje. Toque em "Comi assim" para registrar no diário sem escrever. Se comeu outra coisa, abra a refeição e toque em "Comi outra coisa"."; "Atalhos" — "Aqui embaixo: foto da refeição, enviar exame e agendar consulta."; "Eu" — "Sua conta, documentos, notificações, privacidade, este passeio e o Sair ficam em Eu." |
| Painel: peso no app (`MSG_PESO_OCULTO`, aba Evolução) | "Peso no app do paciente", "Não mostrar peso no app", ajuda: "O paciente não vê esta opção. O peso e o IMC deixam de aparecer no app. Continuam no prontuário, nos documentos que você assina, no que você escreve (orientações e comentários aparecem como estão) e na cópia dos dados que o paciente pedir (LGPD).", "Peso oculto no app desde {dd/mm/aaaa}", "Salvar"; "Histórico de acessos": "Ligou" / "Desligou" — "Peso oculto no app" |

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

Nota de entrega (Plano 07, v1.10):
- Painel → "Conteúdos" → "Novo vídeo": "Título", "Resumo", "Link do vídeo" com o aviso "Vídeos não listados podem ser vistos por quem tiver o link." (**desvio:** com ponto, como a RN-10), "Etiquetas do conteúdo", "Quem vê" (US-053) e "Criar". O formulário guarda o endereço canônico do vídeo.
- Links aceitos (INT-05, RN-10): YouTube (`watch?v=`, `youtu.be`, `shorts`, `embed`, `live`, `m.youtube.com`) e Vimeo (inclusive o não listado com hash e `player.vimeo.com`), com `https`, `http` ou sem esquema; com usuário, senha, porta, outro domínio ou id inválido: "Use um link do YouTube ou do Vimeo". Player: YouTube `youtube-nocookie.com/embed/<id>`, Vimeo `player.vimeo.com/video/<id>?dnt=1`; o `src` sai só do id validado (regex + CHECK do banco) e o iframe tem o título acessível "Vídeo: {título}".
- **Capa padrão (desvio, D9):** um bloco com o tipo do conteúdo ("Vídeo"), sem imagem. A capa vem só do oEmbed, buscado **depois** de gravar, com prazo total de 5 s; qualquer falha (também cota esgotada ou erro de disco) deixa a capa padrão, sem bloquear nem duplicar o cadastro. Trocar o link troca a capa (a do vídeo anterior nunca fica); salvar de novo com o mesmo link não tenta outra vez.

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

Nota de entrega (Plano 07, v1.10):
- "Nova receita" cria o conteúdo (campos comuns e o link opcional do vídeo); a página do conteúdo traz o formulário "Receita": "Rendimento total (g)", "Porção (g)", "Tempo de preparo (min)" (opcional), "Modo de preparo" (o mesmo texto formatado da US-052), "Ingredientes" pela busca da tabela de alimentos ("Adicionar ingrediente"; por linha "Gramas de {nome}", "Medida caseira de {nome} (opcional)" e "Remover {nome}") e "Salvar receita" → "Receita salva.". A tela mostra "Por porção: {kcal} kcal · proteína {g} g · carboidrato {g} g · lipídio {g} g · fibra {g} g".
- Validação por campo: rendimento e porção > 0 (arredondados a 1 casa antes de conferir; rendimento até 20000 g), porção ≤ rendimento ("A porção não pode ser maior que o rendimento"), 1 a 50 ingredientes de 0,1 a 5000 g, tempo de 1 a 1440 min, modo de preparo até 10000 caracteres, medida caseira até 60; alimento que a RLS não mostra (de outro consultório): "Alimento não encontrado." no ingrediente.
- **Valores calculados na hora (desvio da RN-11, D11):** sem cópia congelada — corrigir um "Meu alimento" muda a receita publicada; alimento sem valor na TACO conta 0 e a tela avisa "Sem valor na TACO". Alimento usado em receita não pode ser excluído: "Este alimento está em um plano ou receita e não pode ser excluído.".
- Capa em "Arquivos" ("Capa (JPEG ou PNG, até 5 MB)"), tipo pelo conteúdo, convertida para JPEG ≤ 1280 px sem EXIF, com a transparência sobre branco; sem capa, a capa padrão ("Receita"). Publicar exige a receita preenchida: "Preencha a receita (rendimento, porção e ingredientes) antes de publicar.".
- Portal: "Rendimento: {g} g · Porção: {g} g", "Tempo de preparo: {n} min", a linha "Por porção: …", "Ingredientes" ("{alimento} — {quantidade}", com "Sem valor na TACO" quando for o caso), o vídeo (se houver) e "Modo de preparo".

## US-052 — Publicar orientação em texto · **S**

**Como** nutricionista, **quero** publicar orientações em texto com imagem e PDF opcional, **para** entregar materiais educativos.

```gherkin
Cenário: Orientação com PDF
  Quando publico "Como ler rótulos" com texto formatado, uma imagem e um PDF de 2 MB
  Então o paciente vê o texto formatado e o botão "Baixar material (PDF)"
  E o conteúdo de corpo_md é sanitizado: sem HTML ou script executável
```

Nota de entrega (Plano 07, v1.10):
- **Texto formatado (desvio, D7):** um subconjunto de markdown próprio, sem biblioteca — parágrafos e quebras de linha, `**negrito**`, `*itálico*`, títulos (`#` a `######`, que viram subtítulos: o título do conteúdo é o único h1), listas `-`/`*` e `1.`, links `[texto](https://…)` (só `http`/`https`, nova aba, `rel="noopener noreferrer nofollow"`) —, renderizado como elementos React: HTML digitado aparece como texto e nada usa `dangerouslySetInnerHTML`; sem retrocesso catastrófico. Ajuda do campo "Texto": "Use **negrito**, *itálico*, listas com - e títulos com ##."; até 20000 caracteres.
- **"Uma imagem" (desvio, D8):** é a capa do conteúdo (JPEG/PNG ≤ 5 MB, como a da receita); não há imagem dentro do texto.
- PDF em "Arquivos": "Material em PDF (até 10 MB)" (a história dá o exemplo de 2 MB; D20), tipo pelo conteúdo, com "Ver PDF" e "Remover PDF" no painel. No portal, "Baixar material (PDF)" pede a URL assinada (5 min) na hora do clique. Publicar exige texto ou PDF ("Escreva o texto ou envie o PDF antes de publicar."); publicada, a orientação não fica vazia ("Um conteúdo publicado precisa de texto ou PDF. Despublique antes de tirar os dois.").

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

Nota de entrega (Plano 07, v1.10):
- "Quem vê": "Todos os pacientes", "Pacientes com etiqueta" (lista "Etiquetas"; sem nenhuma, "Nenhuma etiqueta cadastrada.") ou "Pacientes específicos" (lista "Pacientes": os 500 primeiros pacientes ativos por nome). Sem alvo válido: "Escolha pelo menos uma etiqueta ou um paciente.". **Etiqueta (D1):** a da audiência é a etiqueta **de paciente** (US-019), que o paciente nunca vê; o filtro do feed usa as "Etiquetas do conteúdo" ("Separe por vírgula. Ex.: sem lactose, café da manhã"; até 10, de até 30 caracteres).
- A audiência é decidida **no banco**, na leitura (RN-12, §4.1): a etiqueta aplicada vale na hora; fora da audiência, em rascunho ou de outro consultório, o acesso pela URL dá 404 (também o PDF). Salvar o conteúdo só tira da audiência o paciente que o formulário mostrou e a nutricionista desmarcou (D15). Escolher pacientes fica no "Histórico de acessos" ("Público de conteúdo", D6).
- Ciclo (D17): "Publicar" (com "Avisar pacientes") no rascunho → "Conteúdo publicado."; "Despublicar" volta ao rascunho e tira o conteúdo do feed e do cartão do plano na hora; publicar de novo renova a data (volta ao topo do feed). "Excluir conteúdo" pede "Excluir este conteúdo? A sugestão de receita sai dos planos." e apaga a capa, o PDF e o conteúdo ("Conteúdo excluído.").
- **Aviso de novo conteúdo (desvio do texto, D4):** o push é neutro — "Sua nutricionista publicou um novo conteúdo" (título "NutriDebby"), e o toque abre "Conteúdos", onde os novos têm o selo "Novo" —, sem o título (um conteúdo dirigido por etiqueta diria uma condição de saúde na tela de bloqueio). Vai para cada paciente da audiência **com push ativo**, ao pé da letra (decisão do dono, 04/10/2026): ativo, com conta no portal e com inscrição de push no consultório. No máximo 1 a cada 24 h por paciente; publicado no horário silencioso (21h–8h), sai às 08:00; sem e-mail. A tela confirma "Conteúdo publicado. Aviso enviado para {n} pacientes." ("…para 1 paciente." no singular; sem ninguém elegível, "0 pacientes").

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

Nota de entrega (Plano 07, v1.10):
- No editor do plano, cada refeição tem "Sugestão de receita em {refeição}" (as receitas publicadas, por título; "Nenhuma" tira a sugestão). **Só no rascunho (desvio, D13):** o plano publicado é imutável (RN-01) — para sugerir no plano em uso, "Editar" cria a nova versão. "Salvar como modelo", "Criar a partir de modelo" e "Editar" copiam a sugestão; ela não entra no total do plano nem no PDF. Receita não publicada, de outro consultório, ou excluída/despublicada enquanto o rascunho salva: "Receita não encontrada." na refeição (a conferência trava a receita; nunca 500).
- Receita despublicada: a sugestão continua gravada e o editor mostra "Receita indisponível" (a nutricionista remove ou deixa; publicada de novo, o cartão volta). Receita excluída: a sugestão sai sozinha (`SET NULL`).
- Portal: "Sugestão de receita: {título}" na refeição de "Meu plano", só com a receita publicada; o link abre a receita com `?de=plano`. **Fora da audiência, só pelo cartão (desvio, D2):** a receita não aparece no feed, na busca, no filtro de etiquetas nem nos favoritos, não tem "Favoritar", não conta visualização (D14) e mostra "Voltar ao plano"; plano arquivado ou rascunho não libera nada.

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

Nota de entrega (Plano 07, v1.10):
- A aba "Conteúdos" entrou na barra no lugar de "Compras" (desvio, D3; "Lista de compras" virou link em "Plano"): sete colunas iguais, com hífen nas palavras longas, sem rolagem horizontal.
- Feed: filtros "Todos", "Vídeos", "Receitas", "Orientações" e "Favoritos" (`<nav aria-label="Filtrar conteúdos">`), "Buscar" e "Etiqueta" ("Todas"; só os rótulos dos conteúdos publicados que o paciente vê). Até 100 itens, do mais recente para o mais antigo; cada item com a capa (ou a capa padrão), o tipo, o selo "Novo" (conteúdo que o paciente ainda não abriu), o título e o resumo. Lista vazia: "Nenhum conteúdo por aqui ainda."; com busca, etiqueta ou tipo: "Nenhum conteúdo encontrado."; em "Favoritos" sem nenhum: "Você ainda não favoritou nenhum conteúdo.".
- **Busca (D19):** full-text em português, sem acento, sobre o título e o resumo, por palavras inteiras ("ave" não acha "aveia"), a partir de 2 caracteres; combinada com a etiqueta do conteúdo e o tipo.
- Detalhe: "Voltar aos conteúdos", "Favoritar"/"Remover dos favoritos", o player do vídeo, a receita (US-051) ou o texto e o PDF da orientação (US-052).
- **Visualização (desvio, D18):** registrada pelo navegador ao abrir o detalhe (a pré-busca dos links não conta), uma por paciente; o banco recusa visualização e favorito de conteúdo que o paciente não vê pela audiência. Leitura de conteúdo não é prontuário: sem auditoria (D6). Nada da aba fica offline.

## US-056 — Métricas de conteúdo · **S**

**Como** nutricionista, **quero** saber quantos pacientes viram cada conteúdo, **para** entender o que funciona.

```gherkin
Cenário: Métricas
  Dado um conteúdo com audiência de 40 pacientes, dos quais 18 abriram
  Quando abro a lista de conteúdos
  Então vejo "18 de 40 pacientes (45%)"
  E posso ver a lista de nomes de quem viu
```

Nota de entrega (Plano 07, v1.10):
- `/painel/conteudos` (menu "Conteúdos"): "Novo vídeo", "Nova receita", "Nova orientação", o filtro "Todos"/"Vídeos"/"Receitas"/"Orientações" e a tabela "Título", "Tipo", "Situação" ("Rascunho" ou "Publicado em {data}") e "Visualizações": "{vistos} de {audiência} pacientes ({pct}%)" (porcentagem inteira, meio para cima; "1 de 1 paciente (100%)" no singular), só nos publicados ("—" no rascunho), com o link "Ver quem viu: {título}" (nome acessível). Sem conteúdo: "Nenhum conteúdo ainda.".
- **Audiência atual (desvio, D14):** denominador = pacientes ativos na audiência agora, com ou sem conta no portal (RN-12); numerador = quantos deles já abriram; arquivado, bloqueado, anonimizado ou que saiu da audiência não conta em nenhum dos dois; quem abriu só pelo cartão do plano também não. Conteúdo "pacientes" cujo único alvo foi bloqueado mostra "0 de 0 pacientes (0%)" e, ao editar, pede outro público. Uma consulta agrupada para a lista inteira.
- "Quem viu: {título}" (`/painel/conteudos/<id>/visualizacoes`; também "Ver quem viu" na página do conteúdo publicado): "{paciente} — {quando}", mais recentes primeiro, só da audiência atual; ninguém: "Ninguém abriu este conteúdo ainda."; "Voltar ao conteúdo". Sem auditoria (D6).

## Textos de interface e mensagens do E6 (Plano 07, v1.10)

Texto exato do código (conferido na entrega). `{…}` = valor variável; `{data}` = "dd/mm/aaaa" e `{quando}` = como no E4, no fuso do tenant. Três textos da lista do plano não aparecem em nenhuma tela e ficaram fora: "Conteúdo despublicado." (despublicar mostra a situação "Rascunho"), "Enviar capa" e "Enviar PDF" (o envio começa ao escolher o arquivo).

| Onde | Textos |
|---|---|
| Painel: lista (US-056) | Menu "Conteúdos"; "Conteúdos", "Novo vídeo", "Nova receita", "Nova orientação"; filtro (`<nav aria-label="Filtrar conteúdos">`) "Todos", "Vídeos", "Receitas", "Orientações"; colunas "Título", "Tipo" ("Vídeo", "Receita", "Orientação"), "Situação" ("Rascunho", "Publicado em {data}"), "Visualizações" ("{vistos} de {audiência} pacientes ({pct}%)", no singular "1 de 1 paciente (100%)"; "—" no rascunho; nome acessível do link "Ver quem viu: {título}"); "Nenhum conteúdo ainda."; "Conteúdo excluído." |
| Painel: conteúdo (US-050, US-052, US-053) | "Voltar aos conteúdos"; "{tipo} · Rascunho" / "{tipo} · Publicado"; "Título", "Resumo", "Link do vídeo" + "Vídeos não listados podem ser vistos por quem tiver o link.", "Texto" + "Use **negrito**, *itálico*, listas com - e títulos com ##.", "Etiquetas do conteúdo" + "Separe por vírgula. Ex.: sem lactose, café da manhã"; "Quem vê": "Todos os pacientes", "Pacientes com etiqueta", "Pacientes específicos", "Etiquetas", "Pacientes", "Nenhuma etiqueta cadastrada."; "Criar", "Salvar", "Conteúdo salvo."; erros: "Informe o título (até 120 caracteres).", "Use no máximo 300 caracteres no resumo.", "Texto muito longo (até 20000 caracteres).", "Use até 10 etiquetas de até 30 caracteres.", "Use um link do YouTube ou do Vimeo", "Escolha quem vê este conteúdo.", "Escolha pelo menos uma etiqueta ou um paciente.", "Conteúdo não encontrado.", "Formulário inválido." (texto com caractere nulo, como no diário) |
| Painel: arquivos (US-051, US-052) | "Arquivos", "Capa (JPEG ou PNG, até 5 MB)", "Remover capa", "Material em PDF (até 10 MB)", "Ver PDF", "Remover PDF", "Enviando…", "Capa salva.", "PDF salvo."; erros: "Envie uma imagem JPEG ou PNG de até 5 MB.", "Envie um PDF de até 10 MB.", "Outro envio está em andamento. Tente de novo em instantes.", "Não foi possível enviar. Tente de novo.", "Espaço de armazenamento esgotado. Fale com o suporte." |
| Painel: publicar e excluir (US-053) | "Avisar pacientes", "Publicar", "Despublicar", "Conteúdo publicado.", "Conteúdo publicado. Aviso enviado para {n} pacientes." / "Conteúdo publicado. Aviso enviado para 1 paciente."; erros: "Preencha a receita (rendimento, porção e ingredientes) antes de publicar.", "Escreva o texto ou envie o PDF antes de publicar.", "Um conteúdo publicado precisa de texto ou PDF. Despublique antes de tirar os dois."; "Ver quem viu"; "Excluir conteúdo", "Excluir este conteúdo? A sugestão de receita sai dos planos." |
| Painel: receita (US-051) | "Receita", "Rendimento total (g)", "Porção (g)", "Tempo de preparo (min)", "Modo de preparo", "Ingredientes", "Adicionar ingrediente", "Gramas de {nome}", "Medida caseira de {nome} (opcional)", "Remover {nome}", "Por porção: {kcal} kcal · proteína {g} g · carboidrato {g} g · lipídio {g} g · fibra {g} g", "Sem valor na TACO", "Salvar receita", "Receita salva."; erros: "Informe o rendimento total em gramas (maior que 0).", "Informe a porção em gramas (maior que 0).", "A porção não pode ser maior que o rendimento", "Inclua pelo menos um ingrediente.", "A receita pode ter até 50 ingredientes.", "Quantidade deve estar entre 0,1 e 5000 g" (por ingrediente, o texto do plano alimentar), "Tempo de preparo entre 1 e 1440 minutos.", "Texto muito longo (até 10000 caracteres).", "Medida caseira até 60 caracteres.", "Alimento não encontrado."; em Alimentos: "Este alimento está em um plano ou receita e não pode ser excluído." |
| Painel: quem viu (US-056) | "Quem viu: {título}", "{paciente} — {quando}", "Ninguém abriu este conteúdo ainda.", "Voltar ao conteúdo" |
| Painel: editor do plano (US-054) | "Sugestão de receita em {refeição}", "Nenhuma", "Receita indisponível", "Receita não encontrada." |
| Painel: envios da consulta | Tipos (W-1): "Notificação de teste", "Comentário no diário", "Plano novo", "Conteúdo novo" |
| Portal: Conteúdos (US-055) | Aba "Conteúdos"; "Conteúdos"; filtro (`<nav aria-label="Filtrar conteúdos">`) "Todos", "Vídeos", "Receitas", "Orientações", "Favoritos"; "Buscar" (rótulo e botão), "Etiqueta", "Todas"; selo "Novo"; tipo "Vídeo" / "Receita" / "Orientação" (também na capa padrão); "Nenhum conteúdo por aqui ainda.", "Nenhum conteúdo encontrado.", "Você ainda não favoritou nenhum conteúdo." |
| Portal: um conteúdo (US-050 a US-052, US-054) | "Voltar aos conteúdos"; "Voltar ao plano" (receita aberta pelo cartão, fora da audiência); "Favoritar", "Remover dos favoritos"; "Vídeo: {título}" (título do player); "Rendimento: {g} g · Porção: {g} g", "Tempo de preparo: {n} min", "Por porção: …", "Ingredientes", "{alimento} — {quantidade}", "Sem valor na TACO", "Modo de preparo"; "Baixar material (PDF)" |
| Portal: Meu plano (US-041, US-054) | "Lista de compras" (link), "Sugestão de receita: {título}" |
| Push ao paciente (neutro: título "NutriDebby") | "Sua nutricionista publicou um novo conteúdo" (abre "Conteúdos") |
| Exportação (`dados.json`, US-018, US-046) | "Conteúdo indisponível" (visto ou favoritado que não está mais publicado) |

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
| US-016 | M2 | — | consultations, appointments |
| US-017 | M2 | — | anthropometry, exams |
| US-018 | M2 | RNF-08, RN-08, P-01 | patients, privacy_requests, audit_log, content_audience, content_views, content_favorites |
| US-019 | M2 | RN-12 | patient_tags, patient_tag_links, content_audience |
| US-020 | M3 | INT-04, RNF-01, P-10 | foods, food_measures |
| US-021 | M3 | — | foods |
| US-022 | M3 | RN-02, RNF-01 | meal_plans, meals, meal_items |
| US-023 | M3 | RN-02 | meal_items |
| US-024 | M3 | — | meal_plans |
| US-025 | M3 | RN-01, INT-03 | meal_plans |
| US-026 | M3 | INT-04, RNF-01 | meal_plans (pdf_path) |
| US-030 | M4 | RN-03 | availability_rules, availability_blocks |
| US-031 | M4 | RN-03, RN-05 | appointments, notifications, tenants (link_online_padrao) |
| US-032 | M4 | RN-03, RN-16, RN-17, INT-06, RNF-08 | appointments, patients, consents, public_booking_requests, public_rate_limits |
| US-033 | M4 | RN-04, RN-05 | appointments, notifications |
| US-034 | M4 | RN-05, RN-06, INT-01/02/03 | notifications, push_subscriptions, whatsapp_conexoes |
| US-035 | M4 | INT-01 | appointments, notifications, whatsapp_conexoes, public_rate_limits (marca anti-repetição do webhook) |
| US-036 | M4 | RN-09 | tenants, notifications, whatsapp_conexoes |
| US-037 | M4 | CS-03 | appointments |
| US-040 | M5 | INT-03, RNF-09, RNF-10, CS-02 | push_subscriptions, access_events, notifications |
| US-041 | M5 | RN-01, RN-12 | meal_plans, meals, meal_items, stored_files, contents |
| US-042 | M5 | RN-07, RN-18 | diary_entries, stored_files, tenants (armazenamento_bytes) |
| US-043 | M5 | INT-03 | diary_entries, notifications |
| US-044 | M5 | — | anthropometry, consultations, tenants (mostrar_perc_gordura_paciente) |
| US-045 | M5 | RN-13 | meal_items, foods |
| US-046 | M5 | RNF-08 | patients, privacy_requests, data_exports, audit_log |
| US-050 | M6 | RN-10, INT-05, RN-18 | contents, stored_files |
| US-051 | M6 | RN-11, RN-02, RN-18 | contents, recipes, recipe_ingredients, foods, stored_files |
| US-052 | M6 | RNF-06, RN-18 | contents, stored_files |
| US-053 | M6 | RN-12, INT-03, RNF-08 | contents, content_audience, notifications, push_subscriptions |
| US-054 | M6 | RN-11, RN-12, RN-01 | meals, contents, recipes |
| US-055 | M6 | RN-12, RNF-09, RNF-10 | contents, content_views, content_favorites |
| US-056 | M6 | CS-02, RN-12 | content_views, content_audience, patients |

**Resumo:** 46 histórias; 36 **M** e 10 **S**.
