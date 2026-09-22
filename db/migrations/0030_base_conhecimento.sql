-- 0030_base_conhecimento.sql
-- O acervo que o assistente consulta para responder preco, prazo e politica. Sem ele, o
-- assistente e proibido de inventar e nao tem onde consultar — entao nao responde.

-- == extensao `vector` (pgvector) =========================================
-- O acervo usa busca por similaridade, e o tipo `vector` vem da extensao pgvector. Ela
-- precisa estar INSTALADA na imagem do Postgres — `apt install postgresql-17-pgvector`,
-- ou a imagem `pgvector/pgvector`. A pre-decolagem checa isso e nomeia o erro; ver
-- `preflight-vector.mjs` e a secao 8.5 do DEPLOY.md.
--
-- Por que um schema `extensions` proprio, e nao `public`: o codigo referencia o tipo como
-- `extensions.vector(1536)` em varios lugares (0031, 0041, 0049). Concentrar extensao fora
-- do `public` tambem evita que um `drop schema public cascade` num restore leve junto o
-- tipo de colunas que dependem dele.
create schema if not exists extensions;

-- Instalacao que ja tinha a `vector` em OUTRO schema (tipico de quem veio do Supabase, onde
-- ela nascia em `public`): mover, senao o `extensions.vector(1536)` abaixo nao resolve.
-- O `alter` exige ser DONO da extensao e pode falhar por objeto dependente; quando falhar,
-- seguimos com um `warning` NOMEADO em vez de morrer duas linhas abaixo sem explicacao.
-- Idempotente: instalacao nova nao entra no `if` e nao imprime nada.
do $$
declare esquema text;
begin
  select n.nspname into esquema
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'vector';
  if esquema is not null and esquema <> 'extensions' then
    begin
      execute 'alter extension vector set schema extensions';
      raise notice '[0030] extensao vector movida de % para extensions', esquema;
    exception when others then
      raise warning '[0030] nao foi possivel mover a extensao vector de % para extensions: %. Ver a secao 8.5 do DEPLOY.md.', esquema, sqlerrm;
    end;
  end if;
end $$;

create extension if not exists vector with schema extensions;

-- O search_path desta SESSAO, para o tipo e a opclass resolverem durante a aplicacao.
set local search_path = public, extensions;

create table if not exists public.base_conhecimento (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  titulo       text not null,
  conteudo     text not null,
  tipo         text not null default 'fato' check (tipo in ('fato','playbook')),
  -- Toda entrada nasce `operador`: e o que a tela grava, e nada no aplicativo grava
  -- `aprendizado` hoje. O segundo valor esta no `check`, e a regra dele esta no gatilho mais
  -- abaixo, porque regra escrita depois de o dado existir chega tarde — mas ele nao descreve
  -- nada que o produto faca por enquanto.
  origem       text not null default 'operador' check (origem in ('operador','aprendizado')),
  habilitado   boolean not null default true,
  embedding    extensions.vector(1536),
  -- Carimbo `openai:<modelo>:<dimensao>`. O braco semantico so considera linhas cujo carimbo
  -- casa o modelo atual: comparar vetores de modelos diferentes devolve resultado sem sentido,
  -- e sem sentido em silencio e pior que sem resultado.
  embed_versao text,
  fts          tsvector generated always as
               (to_tsvector('portuguese', coalesce(titulo,'') || ' ' || coalesce(conteudo,''))) stored,
  criado_em    timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists base_conhecimento_fts_idx
  on public.base_conhecimento using gin (fts);
create index if not exists base_conhecimento_emb_idx
  on public.base_conhecimento using hnsw (embedding extensions.vector_cosine_ops)
  where embedding is not null;
-- A tela precisa achar o que ficou sem vetor para oferecer o reprocessamento. Sem este indice
-- a entrada some do braco semantico para sempre e nada a lista.
create index if not exists base_conhecimento_sem_emb_idx
  on public.base_conhecimento (workspace_id) where embedding is null;
create index if not exists base_conhecimento_lista_idx
  on public.base_conhecimento (workspace_id, atualizado_em desc);

-- Entrada de origem `aprendizado` nasce DESLIGADA — e hoje nao existe quem a insira: a regra
-- vem ANTES do dado, de proposito, porque regra escrita depois de o dado existir chega tarde.
-- Levanta excecao em vez de corrigir em silencio: quem inserir precisa dizer
-- `habilitado => false` na propria chamada, e ai a regra fica visivel onde a decisao e tomada.
-- So no INSERT — ligar depois e decisao de uma pessoa.
create or replace function public.base_conhecimento_nascimento()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.origem = 'aprendizado' and new.habilitado then
    raise exception 'entrada de origem aprendizado nasce desligada: informe habilitado => false';
  end if;
  return new;
end $$;

-- GUARDADO pelo `pg_trigger` — catalogo diferente do da policy, mesma razao. `create trigger`
-- nao aceita `if not exists`, e a funcao acima e `create or replace` (reexecutavel), entao sem
-- esta guarda o arquivo atravessaria a funcao e pararia no gatilho.
--
-- ⚠️ Com `tgrelid`, e nao so `tgname`: nome de gatilho e unico POR TABELA no Postgres, entao um
-- gatilho homonimo em OUTRA tabela faria esta guarda achar aquele, engolir a criacao, e o
-- gatilho daqui nunca existir — sem erro, com a migration registrada como aplicada.
--
-- (Uma versao anterior deste comentario dizia que "as guardas de constraint deste banco ja
-- qualificam pelo `conrelid`". Era FALSO quando foi escrito: nove guardas — quatro na 0025,
-- duas na 0028, uma na 0039, uma na 0041 e o gatilho da 0048 — sondavam so pelo nome, e duas
-- delas estavam no mesmo commit que escreveu esta frase. Foram todas qualificadas depois. O
-- que vale hoje: TODA guarda de catalogo deste diretorio nomeia a relacao, e ha teste de disco
-- cruzando as duas pontas.)
do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgname = 'base_conhecimento_nascimento_trg'
       and tgrelid = 'public.base_conhecimento'::regclass
  ) then
    create trigger base_conhecimento_nascimento_trg
      before insert on public.base_conhecimento
      for each row execute function public.base_conhecimento_nascimento();
  end if;
end $$;

-- Busca hibrida: o braco textual e o semantico rankeiam em paralelo e se fundem por
-- 1/(k+posicao). Vetorial sozinha erra termo exato (um codigo, um CEP); textual sozinha erra
-- parafrase, que e como o cliente escreve.
--
-- `search_path = extensions` e obrigatorio: o operador `<=>` e o tipo `vector` vivem la, e
-- operador NAO se qualifica por prefixo. Vazio ou `public` quebraria toda a busca por
-- similaridade. `pg_catalog` e sempre pesquisado antes, e as tabelas vao qualificadas.
create or replace function public.base_conhecimento_buscar(
  p_ws uuid,
  p_query text,
  p_embedding extensions.vector(1536),
  p_versao text,
  p_limite int
) returns table (id uuid, titulo text, conteudo text, tipo text, score float)
language sql stable security definer set search_path = extensions as $$
with textual as (
  select b.id, row_number() over (
           order by ts_rank_cd(b.fts, websearch_to_tsquery('portuguese', p_query)) desc) as posicao
    from public.base_conhecimento b
   where b.workspace_id = p_ws and b.habilitado
     and b.fts @@ websearch_to_tsquery('portuguese', p_query)
   limit p_limite * 2
), semantico as (
  select b.id, row_number() over (order by b.embedding <=> p_embedding) as posicao
    from public.base_conhecimento b
   where b.workspace_id = p_ws and b.habilitado
     and p_embedding is not null
     and b.embedding is not null
     and b.embed_versao = p_versao
   order by b.embedding <=> p_embedding
   limit p_limite * 2
)
select b.id, b.titulo, b.conteudo, b.tipo,
       (coalesce(1.0 / (60 + textual.posicao), 0.0)
      + coalesce(1.0 / (60 + semantico.posicao), 0.0))::float as score
  from public.base_conhecimento b
  left join textual on textual.id = b.id
  left join semantico on semantico.id = b.id
 where textual.id is not null or semantico.id is not null
 order by score desc
 limit p_limite;
$$;