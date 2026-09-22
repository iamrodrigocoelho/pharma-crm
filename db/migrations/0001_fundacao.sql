-- 0001_fundacao.sql — fundação do banco: usuários, sessões, chaveiro e settings.
--
-- Esta migration substituiu a antiga `0001_vault.sql`, que montava o chaveiro em cima
-- do `supabase_vault`. Três coisas que o Supabase fornecia como serviço passam a morar
-- aqui, em tabelas comuns:
--
--   · `public.usuarios`  — era `auth.users`, do GoTrue.
--   · `public.sessoes`   — era o refresh token do GoTrue guardado em cookie.
--   · `public.segredos`  — era `vault.secrets`, com cripto dentro do banco.
--
-- 🔴 O CHAVEIRO NÃO CIFRA NADA AQUI. O valor chega e sai CIFRADO (AES-256-GCM), feito
-- em `src/server/secrets.ts`. A chave vive só no ambiente do processo (PHARMA_SECRETS_KEY),
-- NUNCA no banco. Isso é de propósito e é a diferença que importa em relação ao Vault:
-- um dump do Postgres — backup vazado, réplica esquecida, `pg_dump` num laptop — não
-- entrega os segredos do comprador, porque a chave não está lá dentro. Em troca, perder
-- a variável de ambiente significa perder os segredos; está dito no DEPLOY.md.

-- == usuários ==============================================================
-- `citext` deixa o e-mail comparar sem diferenciar maiúsculas; sem ela, "Ana@x.com" e
-- "ana@x.com" seriam dois cadastros, e o app teria de normalizar em todo ponto de leitura.
create extension if not exists citext;

create table if not exists public.usuarios (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  -- scrypt, no formato `scrypt$N$r$p$sal$hash` (ver src/server/auth/senha.ts).
  senha_hash text not null,
  -- Guarda o mesmo que o `user_metadata` do GoTrue guardava: nome de exibição, tema.
  metadata jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now()
);

-- == sessões ===============================================================
-- O cookie carrega este `id` ASSINADO; a linha aqui é o que permite ENCERRAR a sessão.
-- Sem a linha, um logout só teria efeito quando o cookie vencesse.
create table if not exists public.sessoes (
  id uuid primary key,
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null
);
create index if not exists sessoes_usuario_idx on public.sessoes (usuario_id);
create index if not exists sessoes_expira_idx on public.sessoes (expira_em);

-- == chaveiro ==============================================================
create table if not exists public.segredos (
  nome text primary key,
  -- Texto cifrado + nonce + tag, empacotados pela aplicação. O banco só armazena.
  valor_cifrado text not null,
  atualizado_em timestamptz not null default now()
);

-- == settings ==============================================================
create table if not exists public.settings (
  key text primary key,
  value text
);

-- Gate de configuração do CRM (stub aditivo, mantido para as fatias futuras).
create or replace function public.crm_is_configured()
returns boolean language sql security definer set search_path = '' as $$
  select true;
$$;
