# `custom/` — a sua zona

Esta pasta é **sua**. Tudo que estiver aqui dentro é **preservado** quando o CRM atualiza:
a atualização substitui os arquivos do produto, mas nunca toca nesta pasta.

O resto da árvore é o contrário: qualquer arquivo do produto que você editar **será
sobrescrito** na próxima atualização, sem aviso. Se você precisa mudar algo, o caminho é
colocar a mudança aqui.

## O que dá pra fazer aqui

| Pasta | O que você põe | O que acontece | Detalhes |
|---|---|---|---|
| `custom/migrations/` | `.sql` numerado de 9000 pra cima | tabelas suas, criadas no boot | abaixo |
| `custom/paginas/` | uma pasta com `pagina.tsx` | uma tela sua em `/x/<nome>` | [`paginas/LEIA-ME.md`](paginas/LEIA-ME.md) |
| `custom/slots/` | um arquivo por âncora | um bloco seu dentro de uma tela do CRM | [`slots/LEIA-ME.md`](slots/LEIA-ME.md) |
| `custom/api/` | um arquivo por endereço | um endereço em `/api/custom/<nome>` | [`api/LEIA-ME.md`](api/LEIA-ME.md) |
| `custom/tarefas/` | um arquivo por tarefa | código seu rodando de tempos em tempos | [`tarefas/LEIA-ME.md`](tarefas/LEIA-ME.md) |
| `custom/eventos/` | um arquivo com o nome do evento | código seu reagindo ao que acontece | [`eventos/LEIA-ME.md`](eventos/LEIA-ME.md) |
| `custom/menu.ts` | uma lista | suas telas no menu lateral | comentários no arquivo |

**Onde há alguém logado e onde não há.** Em tela (`paginas/`) e em bloco (`slots/`) existe
sessão: use `clienteDaSessao()`, e o `workspaceId` sai de `usarSessao()`. Em
`api/`, `tarefas/` e `eventos/` **não há ninguém logado** — lá o caminho é
`clienteSemIsolamento()`, e o `workspaceId` você mesmo resolve (ver o aviso no
fim deste arquivo).

**Três regras valem para as seis últimas:**

1. **Importe só de `@pharma/custom`** (a lista completa está mais abaixo). O que está em
   `src/` é interno do produto e muda entre versões — o que você importar de lá funciona hoje
   e quebra depois de uma atualização, sem aviso.
2. **Erro ao RODAR fica contido.** Se a sua tela quebra durante o uso, ela mostra o erro e só
   ela: o resto do CRM e o boot seguem funcionando.
   - ⚠️ **Erro de SINTAXE é diferente**, assim como importar um pacote que não existe: os dois
     impedem o servidor de **reconstruir**. O CRM continua no ar na versão que já estava — mas
     a próxima atualização não entra no ar até você corrigir. A mensagem sai no log
     de build do painel (EasyPanel → Implantações), com arquivo e linha.
3. **O seu código não é conferido pelo compilador do produto** — erro de tipo aparece só
   quando a tela roda. **Confira antes de subir** e você não cai em nenhum dos dois casos
   acima; este comando lê só esta pasta:

   ```
   pnpm exec tsc -p custom --noEmit
   ```

   Seu editor também entende a pasta sozinho (há um `custom/tsconfig.json` aqui).

## Bibliotecas do npm

Crie um `package.json` **dentro desta pasta**, com as dependências que você usa:

```json
{ "dependencies": { "alguma-lib": "^1.0.0" } }
```

Elas são instaladas isoladamente quando o servidor reconstrói, e **não** mexem no
`package.json` do produto — que continua sendo arquivo que você não deve editar.

## O que você pode importar

```ts
// dado e sessão — em página, bloco e endereço
import { usarSessao, clienteDaSessao } from '@pharma/custom'

// componentes visuais, pra sua tela ter a cara do CRM
import { CabecalhoPagina, KpiCard, ListCard, EstadoVazio, Pill, Esqueleto } from '@pharma/custom/ui'

// SÓ onde não há ninguém logado (custom/api/, custom/tarefas/, custom/eventos/)
// — ver o aviso no fim deste arquivo
import { clienteSemIsolamento } from '@pharma/custom/servidor'
```

Ícones aceitos em `custom/menu.ts`: `Wallet`, `FileText`, `Package`, `Truck`, `Receipt`,
`Users`, `Bot`, `Boxes`, `ClipboardList`, `Landmark`, `Sparkles`, `Puzzle`. Nome fora da
lista vira o ícone padrão, sem erro.

### Os limites do `custom/menu.ts` — e o que acontece quando você passa deles

Um item fora destes limites **é recusado sem erro na tela e sem linha no log**. Se um item seu
não apareceu no menu, **confira esta tabela antes de procurar em qualquer outro lugar**.

| Regra | Passando dela |
|---|---|
| No máximo **10 itens** | do 11º **válido** em diante, o resto **não aparece** (entradas recusadas não gastam a cota) |
| `titulo` até **40 caracteres**, e não vazio | o item **some inteiro** — não é cortado |
| `caminho` até **200 caracteres**, e não vazio | o item **some inteiro** |
| `caminho` na forma `/x/nome` (veja abaixo) | o item **some inteiro** |
| `grupo` até **24 caracteres** | vira **"Personalizado"** (o item continua aparecendo) |
| `icone` da lista acima | vira o **ícone padrão** (o item continua aparecendo) |

As duas últimas linhas **degradam**; as quatro primeiras fazem o item **sumir**. Campo ausente
ou em branco conta como inválido — não é só sobre passar do tamanho.

**A forma do `caminho`** é a mesma que a pasta em `custom/paginas/` aceita:

- começa com `/x/`;
- só **letras minúsculas, números e hífen**, e o hífen nunca na ponta;
- no máximo **3 níveis** depois do `/x/`.

Estes todos são recusados, e é o tropeço mais comum: `/x/Financeiro` (maiúscula),
`/x/relatórios` (acento), `/x/meu_modulo` (sublinhado), `/x/meu modulo` (espaço),
`/x/financeiro-` (hífen na ponta), `/x/a/b/c/d` (fundo demais). O que funciona é
`/x/financeiro`, `/x/nota-fiscal`, `/x/estoque/entradas`.

## `custom/migrations/` — tabelas suas no mesmo banco

Coloque aqui arquivos `.sql` para criar tabelas ou colunas próprias. Eles rodam junto com
as atualizações oficiais do banco, no boot, automaticamente.

**A numeração é obrigatória e começa em 9000.** Nome no formato `9001_o_que_faz.sql`:

```
custom/migrations/9001_tabela_de_contratos.sql
custom/migrations/9002_campo_no_contrato.sql
```

As migrations oficiais do CRM ficam **abaixo** de 9000 e as suas de 9000 pra cima. Os dois
intervalos não se encostam, então uma atualização do produto nunca colide com um número
que você já usou. Um arquivo fora da faixa **impede o boot** com uma mensagem dizendo o
nome do arquivo — de propósito: é melhor não subir do que aplicar na ordem errada.

## 🔴 Se a sua tabela guarda dado de cliente, o filtro é SEU

**Esta é a regra mais importante para quem escreve aqui.** O CRM fala com um Postgres comum,
sem `row level security`: não existe `auth.uid()` dentro do banco, então não há sessão que
uma policy possa enxergar.

**O banco não isola mais nada. Quem isola é o seu código, em toda consulta.**

Em compensação, a regra ficou uma só — não há mais dois clientes com comportamentos
diferentes para lembrar:

```sql
create table if not exists public.meus_contratos (
  id uuid primary key default gen_random_uuid(),
  -- 🔴 A COLUNA É OBRIGATÓRIA. É ela que o SEU `.eq()` filtra — sem ela não há como
  -- separar um cliente do outro.
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  titulo text not null,
  criado_em timestamptz not null default now()
);

-- Índice em workspace_id: todo acesso seu vai passar por ele.
create index if not exists meus_contratos_ws_idx on public.meus_contratos (workspace_id);
```

Não escreva `enable row level security` nem `create policy`: não há papel `authenticated`
neste banco, nem função que diga quem está logado. Uma policy aqui seria decoração
— passaria no `psql` e não protegeria nada.

### Como fica no código

```ts
const { workspaceId } = await usarSessao()
const banco = clienteDaSessao()

// ERRADO — devolve os contratos de TODOS os clientes hospedados neste servidor
await banco.from('meus_contratos').select()

// CERTO — sempre, em toda consulta, inclusive update e delete
await banco.from('meus_contratos').select().eq('workspace_id', workspaceId)
```

**Esquecer o `.eq('workspace_id', …)` mostra o dado de um cliente para outro, sem nenhum
aviso.** Nada no banco apara esse erro — nem na escrita, nem na leitura.

## `clienteDaSessao()` e `clienteSemIsolamento()`

Os dois devolvem **o mesmo acesso ao banco** — nenhum isola.

- `clienteDaSessao()` — em páginas e blocos, onde `usarSessao()` te dá o `workspaceId`.
- `clienteSemIsolamento()` — em `custom/api/`, `custom/tarefas/` e `custom/eventos/`, onde
  não há ninguém logado e o `workspaceId` tem de vir de outro lugar (do corpo da requisição,
  de uma varredura, do evento).

A diferença entre eles é só **de onde vem o `workspaceId`**. O dever de filtrar é igual nos
dois.

## O que NÃO fazer aqui

- **Não apague esta pasta.** Sem ela, o CRM ainda sobe, mas você perde a zona protegida.
- **Não coloque segredo em arquivo.** Chaves e senhas ficam nas variáveis de ambiente do
  painel, nunca no repositório.
- **Não use números abaixo de 9000** em `custom/migrations`.
- **Não aponte um item do menu para fora de `/x/`.** Ele é ignorado: o menu do CRM não se
  reorganiza a partir daqui.
