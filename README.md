# Pharma CRM

CRM completo que roda **no seu servidor**, contra o **seu** banco de dados. Contatos,
empresas, negócios num quadro de arrastar e soltar, atividades e agenda, campos criados por
você, automações, relatórios e uma **caixa de entrada de WhatsApp e de mensagens diretas do
Instagram** — com vários espaços de trabalho dentro da mesma instalação.

O produto inteiro funciona **offline e para sempre**. Não há licença, não há chave para colar,
não há tela que se destranque pagando e **nada telefona para casa**: o CRM não fala com
servidor de licenciamento nenhum, e não existe caminho pelo qual ele pare de funcionar por
decisão de terceiro.

**A caixa de entrada e o assistente são opcionais e nascem desligados** — e são a parte que
não roda offline. Cada um depende de uma conta sua fora do CRM: um servidor de mensagens ou
a Meta para os canais, e uma conta de inteligência artificial para o **assistente**
automático, que responde sozinho enquanto a sua equipe não pode. **Quem não ligar nenhum
não muda nada:** o CRM segue exatamente como está. O [`docs/DEPLOY.md`](docs/DEPLOY.md) traz o
custo de cada um **antes** do passo a passo.

---

## Instalar

O guia é o **[`docs/DEPLOY.md`](docs/DEPLOY.md)**, escrito para quem nunca usou Docker: vai
do `.zip` que você recebeu até a conta do dono criada.

Em uma linha: o CRM sobe como **um container**, buildado pelo `Dockerfile` que já vem na sua
cópia, contra um **Postgres** seu, e recebe **duas variáveis de ambiente** obrigatórias mais
um volume para os arquivos enviados. Nenhum segredo mora dentro da imagem — tudo fica nas
variáveis e pode ser trocado a qualquer momento.

Se o app não subir, o próprio log diz o que falta, e a seção "O app não subiu" do guia traz a
tabela de mensagem por mensagem.

## Customizar sem perder o trabalho

A atualização **substitui os arquivos do produto**. Por isso existe uma zona que é sua:

- **[`custom/`](custom/LEIA-ME.md)** — tudo aqui dentro é preservado em toda atualização.
  São sete pontos de extensão: tabelas suas (`custom/migrations/`, arquivos `.sql` numerados
  de `9000` para cima, aplicados no boot), telas (`custom/paginas/`), blocos dentro de telas
  do produto (`custom/slots/`), endereços de API (`custom/api/`), código rodando de tempos em
  tempos (`custom/tarefas/`), código reagindo ao que acontece (`custom/eventos/`) e os itens
  do menu lateral (`custom/menu.ts`). Leia
  [`custom/LEIA-ME.md`](custom/LEIA-ME.md) antes da primeira linha — em especial a parte do
  isolamento entre espaços de trabalho: **o banco não isola nada**, nem na leitura nem na
  escrita, e toda consulta sua precisa de `.eq('workspace_id', …)`. Uma consulta sem ele
  mostra o dado de um cliente para outro, sem nenhum aviso. O `LEIA-ME` mostra o certo e o
  errado lado a lado.
- **[`AGENTS.md`](AGENTS.md)** — as mesmas regras escritas para um agente de código (Claude
  Code, Cursor, Codex). Se você desenvolve com IA, é esse arquivo que a mantém dentro de
  `custom/` em vez de editar o produto.

Editar arquivos fora de `custom/` funciona, mas a edição é sobrescrita na próxima
atualização — sobra uma cópia num branch de backup, e a tela de atualização avisa antes de
qualquer coisa.

Nome, logo e cores **não são código**: mudam em **Configurações → Servidor → Marca**.

## Atualizar

Pelo git, no seu repositório: traga os arquivos da versão nova e faça o servidor reconstruir.
As migrações de banco pendentes são aplicadas sozinhas no boot, antes de o aplicativo subir.

Uma coisa que vale antes de atualizar: o que sobrescreve é **o código**, nunca o banco. O que
muda em cada versão está no [`CHANGELOG.md`](CHANGELOG.md).

> A tela **Configurações → Servidor → Atualizações**, que baixava a versão nova em um clique,
> saiu junto com o licenciamento comercial: ela dependia de uma chave de licença para falar
> com o servidor de distribuição. Atualizar passou a ser o caminho do git.

## Ajuda

1. **[`docs/DEPLOY.md`](docs/DEPLOY.md)** — instalação, atualização, backup e a lista de erros
   de boot com a solução de cada um. Comece sempre por aqui.
2. A **página de diagnóstico** do próprio CRM, para quando ele sobe mas alguma variável está
   errada. O guia explica quando ela aparece — e quando ela não ajuda em nada.
3. O **log do container**, que nomeia o que falta antes de o aplicativo subir. A **versão**
   aparece no rodapé de Configurações.
