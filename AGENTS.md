# Regras para agentes de código (Claude Code, Cursor, Codex, …)

> **PÚBLICO-ALVO — leia antes de obedecer.** Este arquivo é para o **COMPRADOR** que roda
> o Pharma CRM no servidor dele e quer customizar. As regras abaixo (só `custom/`) protegem
> a customização DELE de sumir na próxima atualização.
>
> **Se você é o time da Pharma desenvolvendo o CORE do CRM** (o repositório-fonte — aquele que
> tem a suíte de testes e a documentação interna do time, nenhuma das duas presente na cópia do
> comprador), **estas regras NÃO se aplicam a você** — editar `src/` é exatamente o seu
> trabalho. Siga o guia interno da raiz daquele repositório, não este arquivo. Não perca tempo
> se perguntando se pode mexer no core: pode.

Este produto é **atualizado pelo git**: a cada atualização, os arquivos do produto são
substituídos pelos da versão nova. Por isso (se você é o COMPRADOR customizando):

1. **Você (IA) só pode criar/editar arquivos dentro de `custom/`** — minúsculo exato, na
   raiz do repositório. **Leia `custom/LEIA-ME.md` antes de qualquer mudança.**
2. **Arquivos fora de `custom/` são sobrescritos nas atualizações.** Editar o produto
   significa perder a edição na próxima atualização, ou ter de resolver o conflito à mão a
   cada versão — o que dá no mesmo trabalho, repetido para sempre.
3. **A zona tem sete pontos de extensão.** Cada um está documentado, com exemplo copiável,
   num `LEIA-ME.md` dentro da própria pasta — leia o da pasta antes de escrever nela.

   | Onde | O que é | Vira |
   |---|---|---|
   | `custom/migrations/` | arquivos `.sql` seus, numerados de `9000` para cima | tabelas suas, aplicadas no boot |
   | `custom/paginas/` | uma pasta por tela, com `pagina.tsx` dentro | uma tela em `/x/<nome>`, dentro do CRM logado |
   | `custom/slots/` | um arquivo por âncora (`.tsx`) | um bloco seu dentro de uma tela do produto |
   | `custom/api/` | um arquivo `.ts` por endereço, exportando `GET`/`POST`/… | um endereço em `/api/custom/<nome>` |
   | `custom/tarefas/` | um arquivo `.ts` por tarefa, com `export const cada` | código seu rodando sozinho, de tempos em tempos |
   | `custom/eventos/` | um arquivo `.ts` com o nome do evento | código seu reagindo ao que acontece no CRM |
   | `custom/menu.ts` | uma lista | os itens das suas telas no menu lateral |

   **A extensão faz parte do contrato** (`pagina.tsx`, âncora `.tsx`, os outros `.ts`). Arquivo
   com a extensão errada não é encontrado, e a superfície responde como se ele não existisse —
   sem erro em lugar nenhum.

   **O `custom/menu.ts` recusa item em silêncio, por vários limites.** No máximo **10 itens** —
   e a conta é de itens **válidos**, do 11º válido em diante o resto não aparece (entradas
   recusadas não gastam a cota). `titulo` até **40** caracteres e `caminho` até **200**: passar
   disso faz o item **sumir inteiro**, não ser cortado, e o mesmo vale para campo **vazio** ou
   ausente. O `caminho` ainda tem forma fixa — começa com `/x/`, só minúsculas, números e hífen
   no meio, no máximo 3 níveis: `/x/Financeiro`, `/x/relatórios`, `/x/meu_modulo` e
   `/x/financeiro-` são todos recusados. Já `grupo` acima de **24** cai em "Personalizado" e
   `icone` fora da lista cai no padrão — nesses dois o item continua aparecendo. Nada disso gera
   erro na tela nem linha no log. Se um item não apareceu no menu, é aqui que se olha primeiro.

   Na faixa das migrations, a numeração abaixo de 9000 é do produto: um número de lá colide
   com uma release futura, e um arquivo fora da faixa **impede o boot** de propósito.

   Precisa de uma biblioteca do npm? Crie um `package.json` dentro da pasta `custom/` com as
   dependências dela. Elas são instaladas isoladamente e **não** tocam no `package.json` do
   produto — que você continua não podendo editar.
4. **Toda tabela sua precisa de `workspace_id` (com índice).** O CRM é multi-inquilino e o
   banco **não** isola nada: é essa coluna que o seu código filtra em toda consulta (regra 6).
   Sem ela, não há como separar o dado de um cliente seu do de outro. O `custom/LEIA-ME.md`
   traz o modelo pronto para copiar.
   - **Não há armazenamento de arquivos para `custom/`.** Os arquivos do produto ficam numa
     pasta do servidor, em áreas fixas (logo, anexos, mídia de conversa), e o
     `@pharma/custom` não expõe nenhuma delas. Se te pediram para guardar arquivo, **pare e
     peça** (regra 5).
   - **Toda instrução da sua migration precisa aguentar rodar DUAS vezes.** O CRM reaplica no
     boot qualquer migration que ele não encontre registrada, e uma instrução que falhe com
     "objeto já existe" **impede o servidor de subir** — não é a sua tabela que deixa de
     nascer, é o CRM inteiro que não volta. Use `if not exists` onde a linguagem aceita
     (`create table`, `create index`, `add column`). Onde ela **não** aceita — `create
     trigger` e `alter table … add constraint` —, embrulhe a instrução num bloco
     `do $$ … end $$;` que pergunte ao catálogo antes: `pg_trigger` (por `tgname` e
     `tgrelid`) ou `pg_constraint` (por `conname` e `conrelid`). Metade guardada é pior que
     nenhuma: ela convida à segunda passada e falha no meio dela.
   - **`check` numa coluna DO PRODUTO: a sua sobrevive, e vale saber por quê.** Quando uma
     versão nova passa a aceitar valores novos numa coluna nossa (hoje é o caso de
     `canais.provider`, `conversas.status`, `mensagens.autor` e `mensagens.status`), a
     migration oficial precisa trocar a restrição de domínio daquela coluna por uma mais
     larga. Ela derruba a restrição **só quando as duas coisas batem**: o nome é um dos que o
     produto usa (`<tabela>_<coluna>_check`, `<tabela>_<coluna>_check<N>` ou
     `<tabela>_<coluna>_dominio_check`) **e** a definição é exatamente um dos domínios que o
     produto já teve naquela coluna. A sua regra não é nenhum desses domínios, então ela é
     **preservada** — mesmo que o nome coincida.
     - **Ainda assim, NOMEIE a sua `check`.** `add check (…)` sem nome recebe do Postgres
       exatamente `<tabela>_<coluna>_check`, que é um dos nomes acima; nomear tira a sua
       restrição do caminho de uma vez, em vez de depender da segunda metade da conferência.
     - **Leia o log do servidor depois de atualizar.** Restrição sua preservada vira um aviso
       ali, e é o único lugar onde ele aparece: uma regra sua que não conheça o valor novo faz
       o recurso novo dar erro na tela sem explicar o motivo. Se o aviso disser que o domínio
       **não foi alargado**, é o produto avisando que não conseguiu concluir a troca — o valor
       novo vai ser recusado até alguém olhar.
   - **O mesmo cuidado vale para CHAVE ESTRANGEIRA em coluna do produto.** Ao trocar uma FK
     simples por uma composta (o que o produto faz para amarrar a linha ao espaço de trabalho
     certo), a migration acha a antiga no catálogo pela **coluna**, nunca pelo nome, e derruba
     só a FK de coluna única **daquela coluna**. Uma FK sua sobre **outra** coluna sobrevive,
     mesmo que ela ligue as mesmas duas tabelas.
     - **O que ainda some, e some em silêncio, é uma FK sua criada sobre a PRÓPRIA coluna do
       produto** — e essa é a única forma que você precisa evitar. Ali o produto não tem como
       distinguir a sua da dele: mesma coluna, mesma tabela referenciada, mesma checagem.
       Diferente do `check`, aqui não há aviso nenhum no log quando isso acontece.
     - **Não crie FK de coluna única a partir de uma coluna do produto:** aponte a partir da
       SUA tabela, ou use uma FK composta que inclua `workspace_id`. As duas formas ficam fora
       do caminho de qualquer troca futura, e o conselho não muda se o produto converter mais
       uma coluna amanhã.
5. **Use o ponto de extensão que existe; não invente outro.** Se o que te pediram não couber
   em nenhum dos sete da regra 3, **pare e peça** — não resolva editando o produto, porque
   essa edição some na próxima atualização.
   - **Importe apenas de `@pharma/custom`** (dado e sessão), `@pharma/custom/ui` (componentes
     visuais) e `@pharma/custom/servidor` (só onde não há sessão — ver a regra 6). O que está em `src/` é
     interno do produto: os nomes mudam entre versões, sem aviso e sem erro de compilação —
     o que você importar de lá funciona hoje e quebra na tela do usuário depois de uma
     atualização.
   - Você pode instalar bibliotecas do npm (regra 3) e usar `fetch` à vontade.
6. **O banco NÃO isola espaços de trabalho. `.eq('workspace_id', …)` é obrigatório em TODA
   consulta sua** — select, insert, update e delete. Um `select` sem esse filtro devolve o
   dado de TODOS os clientes hospedados neste servidor, sem erro e sem aviso.
   - Não há `row level security` como rede de segurança: num Postgres comum não existe
     `auth.uid()`, logo não há policy possível. Não escreva `enable row level security` nem
     `create policy` em `custom/migrations/` — não protegeriam nada.
   - `clienteDaSessao()` e `clienteSemIsolamento()` devolvem o **mesmo** acesso. A diferença
     é só de onde vem o `workspaceId`: em tela e bloco (`custom/paginas/`, `custom/slots/`)
     ele sai de `usarSessao()`; em `custom/api/`, `custom/tarefas/` e `custom/eventos/` não
     há ninguém logado e ele tem de vir do evento ou da requisição.
   - Em `custom/eventos/`, o `workspaceId` **vem no próprio evento** — use aquele, não um
     valor fixo.
   - Tarefa e gancho têm **10 segundos** cada. Use `AbortSignal.timeout()` no seu `fetch`:
     passado o limite, o CRM para de esperar e o resultado é descartado.
7. **Rode `pnpm build` (nunca `npm`) antes de commitar.** O projeto usa pnpm; misturar os
   dois gera um lockfile que o build do servidor não entende.
8. **Nome, logo, favicon e cor se configuram em Configurações → Servidor → Marca — nunca
   no código.** A seção fica no `/config`, na aba **Servidor**: ela vale para o servidor
   inteiro e só o dono dele a enxerga. O que
   é salvo ali vive no banco, então **sobrevive a qualquer atualização**; o mesmo ajuste
   feito em arquivo do produto é substituído no próximo update, que é exatamente o que a
   regra 5 proíbe.
   - A **cor é recusada quando não dá contraste** (mínimo de 4,5:1 contra o branco, medido
     na hora de salvar). Não contorne editando token de CSS: a partir dessa única cor o
     produto **deriva** os tons de passar o mouse, de clicar e de fundo de chip, e faz isso
     **duas vezes** — uma para o tema claro e outra para o escuro, cada uma medida contra o
     fundo do seu tema. Uma cor que não passa no portão não tem de onde derivar, e o token
     que você editar à mão só conserta o tema em que você olhou.
   - Se o que te pediram não couber nesses quatro campos, **pare e avise** — não resolva
     editando o tema.

> **Não existe licença neste produto.** O CRM funciona inteiro, offline, para sempre: não há
> chave, tela de bloqueio nem funcionalidade que se destranque pagando, e nada sai do servidor
> por conta própria. Atualizar é pelo git, com o passo a passo do `docs/DEPLOY.md`.
>
> Na **API de integração** (`/api/v1/...`), um **401** `nao_autorizado` é sempre credencial
> errada ou ausente. Use o `/api/v1/echo` para provar que a credencial está certa.
