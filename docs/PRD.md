# PRD — Pharma CRM

> **Documento de requisitos de produto.** Descreve o que o Pharma CRM é, para quem, o que ele
> faz hoje e as regras que não podem ser quebradas. Reflete o código da versão **0.9.1 / linha
> 0.10** (Postgres puro, sem licenciamento comercial). Para instalação, ver
> [`DEPLOY.md`](DEPLOY.md); para a linguagem visual, ver [`DESIGN.md`](DESIGN.md).

---

## 1. Visão

Um **CRM completo que roda no servidor do cliente, contra o banco do cliente** — e que
funciona **offline e para sempre**. Não há licença, chave, tela que se destranque pagando nem
qualquer chamada para "casa". Nenhum terceiro consegue desligar o CRM.

As partes que dependem de serviço externo (caixa de entrada de WhatsApp/Instagram e o
assistente de IA) são **opcionais e nascem desligadas**. Quem não liga nenhuma delas tem o CRM
inteiro, sem perda.

### 1.1 Princípios de produto

| Princípio | O que significa na prática |
|---|---|
| **Soberania de dados** | Tudo mora no Postgres e no volume do cliente. Segredos são cifrados com uma chave que **não** fica no banco. |
| **Nada telefona para casa** | Nenhuma requisição de saída por iniciativa própria. Só falam para fora os integradores que o cliente liga (provedor de WhatsApp, Meta, provedor de IA). |
| **Opcional é desligado por padrão** | Canais e assistente só existem depois de configurados. Ausência não degrada o resto. |
| **Atualizar não apaga customização** | Existe uma zona (`custom/`) preservada em toda atualização, com sete pontos de extensão documentados. |
| **Erro explica o que fazer** | Boot, diagnóstico e telas nomeiam o problema e a saída — nunca uma falha silenciosa. |
| **Escrito para quem não é técnico** | Guia de instalação, changelog e textos de tela falam a língua do comprador, não do desenvolvedor. |

---

## 2. Público

| Persona | Quem é | O que precisa |
|---|---|---|
| **Dono da instalação** | Quem comprou e roda o CRM no próprio servidor (EasyPanel/VPS). Muitas vezes nunca usou Docker. | Subir o CRM com dois valores e um volume; entender erros de boot; fazer backup; configurar marca. |
| **Gestor / administrador do espaço** | Responsável comercial de um espaço de trabalho. | Funis e etapas, campos próprios, automações, relatórios, equipe e convites, canais e agentes. |
| **Vendedor / atendente** | Usuário do dia a dia. | Quadro de negócios, agenda, contatos, caixa de entrada, assumir conversas do assistente. |
| **Integrador / desenvolvedor do comprador** | Quem customiza a instalação (inclusive com agente de código). | Pontos de extensão estáveis (`custom/`), SDK `@pharma/custom`, API v1 com credenciais. |

---

## 3. Escopo funcional

A navegação lateral organiza o produto em três grupos, mais os itens que o comprador adiciona.

### 3.1 Dia a dia

#### Painel (`/painel`)
- KPIs com variação contra o período anterior (`Delta`) e sparkline por série.
- Gráfico de negócios por etapa e agenda pessoal ("Minha agenda").
- Seletor de período.

#### Negócios (`/negocios`)
- **Quadro kanban** por funil, com arrastar e soltar (`@dnd-kit`), ordem persistida por coluna
  e anúncios de arraste para leitor de tela.
- Seletor de funil, busca no quadro, menu por cartão (editar, duplicar, excluir).
- Ganhar/perder negócio (com motivo de perda), responsável, valor, previsão de fechamento.
- **SLA por etapa** e histórico de movimentação.
- Detalhe do negócio (`/negocios/[id]`) com timeline, atividades, anexos, campos
  customizados e relacionados.

#### Agenda (`/agenda`)
- Atividades agrupadas por seção (atrasadas, hoje, próximas), com tipos de atividade
  configuráveis e próxima atividade exibida no negócio/contato.

#### Conversas (`/conversas`) — *opcional*
- Caixa de entrada unificada de **WhatsApp** e **Instagram Direct**, em tempo real (eventos
  próprios do CRM, com re-leitura automática quando a conexão cai).
- Filtros, busca, paginação, rascunhos por conversa, status de entrega por mensagem.
- Conversa vinculada a contato e a negócio; ações de **assumir**, **devolver ao assistente** e
  **arquivar**.
- Regras de janela de 24h da Meta, divisão de mensagem longa, conversão de Markdown para o
  formato do WhatsApp, mídia (download com retentativa e reserva de espaço).

### 3.2 Cadastros

| Tela | Funcionalidade |
|---|---|
| **Contatos** (`/contatos`, `/contatos/[id]`) | Lista paginada, formulário em drawer, detalhe com timeline, anexos, negócios relacionados e campos customizados. Telefone normalizado por sufixo para casar com canais. |
| **Empresas** (`/empresas`, `/empresas/[id]`) | Mesmo padrão de contatos, com pessoas e negócios da empresa. |
| **Base de conhecimento** (`/base-conhecimento`) | Acervo que o assistente consulta (busca vetorial com `pgvector`), por assistente. Opcional: sem a extensão, só esta parte fica de fora. |

### 3.3 Automação e análise

#### Automações (`/automacoes`)
Regras *gatilho → condições → ações*, com templates, editor visual de condição e log de
execuções.

| Gatilhos | Ações |
|---|---|
| Negócio criado | Mover para etapa |
| Negócio movido de etapa (de/para) | Criar atividade |
| Negócio ganho | Atribuir responsável |
| Negócio perdido | Chamar webhook |
| Campo alterado | Atualizar campo |
| Negócio parado numa etapa | Criar negócio |
| Atividade venceu | |

Execução por *tick* periódico com orçamento de tempo; número máximo de ações por regra.

#### Agentes de IA (`/agentes`) — *opcional*
- **Assistentes** que respondem sozinhos nos canais enquanto a equipe não pode, com persona,
  horário de atendimento, base de conhecimento própria e ferramentas sobre o CRM.
- Fila de rodadas, tetos por persona, **orçamento e custo agregado** (rodadas pagas), handoff
  para humano ("quem responde"), follow-up.
- **Simulador** (`/agentes/testar`) para testar o assistente sem canal real.
- Runtime: Mastra + provedor OpenAI (chave do próprio cliente, cifrada).

#### Relatórios (`/relatorios`)
- Construtor com quatro tipos: **funil de conversão**, **tempo por etapa**, **forecast** (valor
  × probabilidade) e **tabela dinâmica** (pivot por campos).
- Filtro por status (todos, aberto, ganho, perdido), relatórios salvos e exportação CSV.

### 3.4 Configurações (`/config`)

| Área | O que configura |
|---|---|
| Funis e etapas | Múltiplos funis, etapas com cor da paleta fixa, ordem, SLA |
| Campos | Campos customizados por entidade, opções, matriz de obrigatoriedade por etapa (gate) |
| Tipos de atividade | Nome e ícone |
| Canais | WhatsApp por código de pareamento (uazapi), WhatsApp Cloud oficial (Meta), Instagram |
| IA | Chave do provedor, modelo |
| Equipe | Membros, papéis, convites por link (`/convite/[token]`) |
| Importar | Importação de CSV (detecção de codificação) e ZIP |
| Tema | Claro/escuro por usuário |
| **Servidor → Marca** *(só o dono)* | Nome, logo, favicon e cor de acento — com portão de contraste |

### 3.5 Multi-espaço e acesso
- Vários **espaços de trabalho** (workspaces) na mesma instalação; seletor na barra lateral.
- Contas próprias do CRM (senha com hash, sessão assinada por `AWAVE_SESSION_SECRET`).
- Primeira conta criada vira **dono da instalação**; cadastro aberto controlado.
- Membro inativo perde acesso; usuário sem espaço cai em `/sem-workspace`.

---

## 4. Integrações

### 4.1 API de integração v1
Autenticação por credencial de API criada nas Configurações (comparação *timing-safe*).

| Endpoint | Função |
|---|---|
| `GET /api/v1/health` | Saúde da API |
| `GET /api/v1/echo` | Prova que a credencial está correta |
| `POST /api/v1/upsert-lead` | Cria/atualiza contato |
| `POST /api/v1/upsert-deal` | Cria/atualiza negócio |
| `GET /api/v1/ler-deal` | Lê um negócio |
| `POST /api/v1/mover-etapa` | Move negócio de etapa |
| `POST /api/v1/anexar-atividade` | Registra atividade num negócio |

Erros têm formato único `{"error":{"code": "..."}}`; `401 nao_autorizado` = credencial
ausente/errada.

### 4.2 Webhooks de saída
Entrega de eventos (inclusive exclusões) para URL configurada, com assinatura e política de
retentativa. Também é uma das ações de automação.

### 4.3 Webhooks de entrada de canais
`/api/canais/[provider]/webhook` — verificação de assinatura da Meta, corpo com tamanho
limitado, rate limit e identidade do envelope.

---

## 5. Extensibilidade (`custom/`)

Zona preservada em toda atualização. Sete pontos de extensão:

| Onde | Vira |
|---|---|
| `custom/migrations/` (`.sql` ≥ 9000) | Tabelas próprias, aplicadas no boot |
| `custom/paginas/<nome>/pagina.tsx` | Tela em `/x/<nome>` dentro do CRM logado |
| `custom/slots/<ancora>.tsx` | Bloco dentro de uma tela do produto |
| `custom/api/<nome>.ts` | Endpoint em `/api/custom/<nome>` |
| `custom/tarefas/<nome>.ts` | Código periódico (limite de 10 s) |
| `custom/eventos/<evento>.ts` | Reação a `lead-novo`, `deal-novo`, `etapa-mudou`, `deal-ganho`, `deal-perdido`, `lead-excluido`, `deal-excluido` |
| `custom/menu.ts` | Até 10 itens no menu lateral |

**Requisitos de contrato:**
- Importar apenas de `@pharma/custom`, `@pharma/custom/ui` e `@pharma/custom/servidor`.
- Erro de execução fica contido na própria extensão (limite de erro); o resto do CRM segue.
- **Toda consulta customizada filtra por `workspace_id`** — com Postgres puro não há RLS
  protegendo leitura.
- Migrations idempotentes (precisam aguentar rodar duas vezes).

---

## 6. Requisitos não funcionais

### 6.1 Implantação
- **Um container** (Next.js 16, `Dockerfile` incluso) + **um Postgres** do cliente.
- Variáveis obrigatórias: `DATABASE_URL`, `AWAVE_SESSION_SECRET`; recomendada:
  `AWAVE_SECRETS_KEY`. Volume obrigatório em `/app/dados` (arquivos enviados).
- Nenhum segredo embutido na imagem; nenhuma variável de build.
- Infra mínima: **2 GB RAM / 2 vCPU** (pico no build da imagem).
- Migrações pendentes aplicadas no boot, antes do app subir; *preflight* valida variáveis e
  nomeia o erro no log. Página `/diagnostico` quando falta configuração.
- `pgvector` opcional (só a base de conhecimento depende dele).

### 6.2 Segurança
- Isolamento por espaço de trabalho em toda consulta do produto (FKs compostas amarram linha
  ao workspace).
- Segredos (tokens de canal, chave de IA, segredo de webhook) **cifrados** antes de ir ao
  banco; a chave fica fora dele.
- Arquivos servidos só pelo servidor (`/api/arquivos/...`), buckets privados.
- Upload de ZIP seguro, corpo de requisição com teto, erros sanitizados antes de exibir.
- Expurgo de dados de canais.

### 6.3 Backup
Duas metades, com a mesma data: `pg_dump` do banco **e** o volume `/app/dados`. Restaurar só
o banco preserva texto mas perde mídia.

### 6.4 Acessibilidade e qualidade visual
- Contraste AA medido em todos os pares texto × superfície nos dois temas (barreira em teste).
- Anel de foco único, `prefers-reduced-motion` respeitado globalmente, controles nativos
  preservados. Detalhes em [`DESIGN.md`](DESIGN.md).
- Idioma: **pt-BR** em toda a interface e documentação.

### 6.5 Desempenho
- Instância única recomendada (escalar cópias do app não é o caminho — ver `DEPLOY.md §6.5`).
- Índices de busca e tetos de consulta; ticks com orçamento de tempo.

---

## 7. Stack

| Camada | Tecnologia |
|---|---|
| App | Next.js 16 (App Router, Server Actions), React 19, TypeScript 6 |
| Banco | PostgreSQL (driver `postgres`), migrações SQL próprias (`migrate.mjs`) |
| Validação | Zod 4 |
| IA | Mastra (`@mastra/core`) + `@ai-sdk/openai`; `pgvector` para embeddings |
| UI | CSS Modules + tokens em `globals.css`, `lucide-react`, fonte Geist (local) |
| Drag and drop | `@dnd-kit` |
| Testes | Vitest |
| Pacotes | pnpm 10 |

---

## 8. Fora de escopo

- Licenciamento, ativação ou qualquer bloqueio remoto.
- Atualização em um clique (removida junto com a licença; atualização é via git).
- Migração automática de instalações Supabase (v0.9.x) para Postgres puro.
- Escalonamento horizontal do app.
- Envio de e-mail/marketing em massa.

---

## 9. Métricas de sucesso

| Métrica | Alvo |
|---|---|
| Tempo do `.zip` ao CRM no ar, para quem nunca usou Docker | < 30 min seguindo só o `DEPLOY.md` |
| Falhas de boot sem mensagem acionável no log | 0 |
| Pares de contraste reprovados em AA | 0 (barreira na suíte) |
| Customizações perdidas em atualização | 0 fora de edição direta no produto |
| Vazamento de dado entre espaços de trabalho | 0 |

---

## 10. Riscos e pontos em aberto

- **Perda da `AWAVE_SECRETS_KEY`** = perda dos segredos (recadastro manual). Mitigação:
  guia insiste em guardá-la com a senha do banco.
- **Volume ausente** apaga anexos a cada deploy. Mitigação: destaque no guia e no changelog.
- **Isolamento de leitura em `custom/`** depende de disciplina do integrador (sem RLS).
- **LEIA-MEs de `custom/` ainda mencionam licença e "atualização em 1 clique"**
  (`custom/api/`, `custom/tarefas/`, `custom/paginas/`, `custom/LEIA-ME.md`) — texto
  desatualizado após a remoção do licenciamento; precisa de revisão.
- **Nomenclatura mista** (Pharma CRM / Awave CRM / variáveis `AWAVE_*`) — decidir o nome
  público definitivo.
- Caminho assistido de migração Supabase → Postgres para quem está na v0.9.1.
